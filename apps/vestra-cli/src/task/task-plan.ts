import { randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import type { ContextManifest } from "@verchestra/agent-runtime";
import {
  ApprovalRequester,
  canonicalTaskGatePlan,
  normalizeTaskRequestV1,
  type ApprovalIntent,
  type NormalizedTaskRequest
} from "@verchestra/application";
import {
  ArtifactSealer,
  ExecutionPackageBuilder,
  type EvidenceSigner,
  type SignedExecutionPackage
} from "@verchestra/evidence";
import { NodeContentDigest, SystemClock } from "@verchestra/platform-node";

import { loadProviderAuth, type ProviderAuth } from "../task-provider-auth.ts";
import type { TaskCommandIo } from "./task-io.ts";
import { SIGNING_PASSPHRASE, readCredentials } from "./task-credentials.ts";
import { compileTaskContext, REPOSITORY_SOURCE } from "./task-context.ts";
import { stableCode, taskError } from "./task-errors.ts";
import { canonicalDigest, sha256 } from "./task-files.ts";
import { loadGateAllowlist } from "./task-gates.ts";
import { git } from "./task-git.ts";
import { MARKER_SEAL, WRITE_CAPABILITY, type TaskPlanRecord } from "./task-plan-record.ts";
import { loadTaskPolicy } from "./task-policy.ts";
import { openRunRecord } from "./task-run-record.ts";
import { ephemeralSigner, workspaceSigner } from "./task-signing.ts";
import { applyWorkflow } from "./task-workflow.ts";
import { openRuntime, openTaskWorkspace, type TaskWorkspace } from "./task-workspace.ts";

type Digest = `sha256:${string}`;
const MAXIMUM_REQUEST_BYTES = 256 * 1024;
const APPROVAL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

async function readRequest(io: TaskCommandIo, path: string): Promise<NormalizedTaskRequest> {
  const target = isAbsolute(path) ? path : resolve(io.controlRoot, path);
  const metadata = await lstat(target).catch(() => undefined);
  if (metadata?.isFile() !== true || metadata.size > MAXIMUM_REQUEST_BYTES)
    throw taskError("VES_TASK_REQUEST_REJECTED", { reason: "VES_TASK_REQUEST_UNREADABLE" }, "Request is unreadable");
  try {
    return normalizeTaskRequestV1(JSON.parse(await readFile(target, "utf8")) as unknown);
  } catch (error) {
    const reason = error instanceof SyntaxError ? "VES_TASK_REQUEST_NOT_JSON" : stableCode(error);
    throw taskError("VES_TASK_REQUEST_REJECTED", { reason }, "The task request was rejected", { cause: error });
  }
}

// why: the source state is the exact committed tree the task starts from; a
// revision is immutable, so its digest binds the approval to content rather
// than to a moving branch.
async function sourceState(repositoryRoot: string, revision: string): Promise<Digest> {
  const resolved = async (spec: string) =>
    (await git(repositoryRoot, ["rev-parse", "--verify", "--end-of-options", spec])).trim();
  try {
    const commit = await resolved(`${revision}^{commit}`);
    if (commit !== revision) throw new Error("revision is not exact");
    return canonicalDigest({ revision, tree: await resolved(`${revision}^{tree}`) });
  } catch (error) {
    throw taskError(
      "VES_TASK_REQUEST_REJECTED",
      { reason: "VES_TASK_SOURCE_REVISION_UNKNOWN" },
      "sourceRevision is not a commit in this repository",
      { cause: error }
    );
  }
}

function requirements(request: NormalizedTaskRequest) {
  return request.task.requirementIds.map((requirementId) => {
    const gates = request.gates.filter((gate) => gate.requirementIds.includes(requirementId));
    return {
      requirementId,
      priority: "must" as const,
      acceptanceCriteria:
        `WHEN task ${request.task.taskId} is delivered THEN it SHALL meet: ${request.task.doneCriteria.join("; ")}`.slice(
          0,
          4096
        ),
      assumptionState: "closed" as const,
      independentTest: gates.map((gate) => gate.declaredCommand).join("; "),
      artifactDigest: canonicalDigest({ requirementId, doneCriteria: request.task.doneCriteria })
    };
  });
}

function packageInput(context: PlanContext, manifest: ContextManifest) {
  const { request, workspace, runId } = context;
  const ref = (artifactId: string, value: unknown) => ({ artifactId, digest: canonicalDigest(value) });
  return {
    packageVersion: 1,
    workspaceId: workspace.workspaceId,
    projectIds: [`workspace:${workspace.workspaceId}`],
    featureId: `task:${request.task.taskId}`,
    executionContractDigest: canonicalDigest(request),
    requirements: requirements(request),
    decisions: [ref("decision:task-request", request)],
    tasks: [
      {
        taskId: request.task.taskId,
        sequence: 1,
        requirementIds: request.task.requirementIds,
        dependsOn: [],
        componentRefs: [request.task.component],
        verificationCommands: request.task.verificationCommands,
        doneCriteria: request.task.doneCriteria,
        risk: request.task.risk,
        expectedCommit: request.task.expectedCommitBoundary
      }
    ],
    completedTaskEvidence: [],
    contextRecipes: [{ artifactId: manifest.recipeId, digest: manifest.recipeDigest }],
    discoveryEvidence: [{ artifactId: "context:manifest", digest: manifest.manifestId }],
    dataPolicies: [ref("data:repository-read-at-revision", request.task.changeScope)],
    seedSpecifications: [ref("seed:none", [])],
    requiredCapabilities: [WRITE_CAPABILITY],
    roleRequirements: [
      { role: "implementer", capabilities: [WRITE_CAPABILITY], minimumContextTokens: 16_000, reasoning: "high" },
      { role: "verifier", capabilities: ["read-only"], minimumContextTokens: 16_000, reasoning: "high" }
    ],
    gates: request.gates.map((gate) => ({
      gateId: gate.gateId,
      command: gate.declaredCommand,
      evidenceRequired: true
    })),
    approvalRequirements: ["human-execution-approval", "human-review"],
    workClaimRequirement: { scopeDigest: canonicalDigest(request.task.changeScope), mode: "exclusive" as const },
    budgets: request.budgets,
    ...(request.onGateFailure === undefined ? {} : { onGateFailure: request.onGateFailure }),
    completionCriteria: [
      {
        criterionId: `complete:${request.task.taskId}`,
        requirementIds: request.task.requirementIds,
        verificationRefs: request.gates.map((gate) => gate.gateId)
      }
    ],
    canonicalLocation: {
      gitOwnerId: canonicalDigest(workspace.workspaceId),
      logicalPath: `.verchestra/execution-packages/${runId}.json`
    },
    createdByRunId: runId,
    createdAt: context.createdAt,
    bindings: {
      sourceState: { [REPOSITORY_SOURCE]: context.sourceStateDigest },
      policyDigest: context.policyDigest,
      skillLockDigest: context.skillLockDigest,
      contextDigest: manifest.manifestId as Digest,
      dataAccessDigest: canonicalDigest({ read: request.task.changeScope }),
      effectPlanDigest: canonicalDigest({ write: request.task.changeScope, protected: request.task.protectedPaths }),
      verificationPlanDigest: context.gatePlanDigest,
      destinationDigest: canonicalDigest(DESTINATIONS),
      capabilityDigest: canonicalDigest([WRITE_CAPABILITY]),
      budgetDigest: canonicalDigest(request.budgets),
      evidenceDigest: canonicalDigest(["gate-evidence", "verification-report", "human-review", "run-capsule"])
    }
  };
}

const DESTINATIONS = Object.freeze(["provider:anthropic", "provider:openai"]);

interface PlanContext {
  readonly workspace: TaskWorkspace;
  readonly request: NormalizedTaskRequest;
  readonly runId: string;
  readonly createdAt: string;
  readonly sourceStateDigest: Digest;
  readonly policyDigest: Digest;
  readonly gatePlanDigest: Digest;
  readonly skillLockDigest: Digest;
}

function approvalIntent(context: PlanContext, manifest: ContextManifest, pkg: SignedExecutionPackage): ApprovalIntent {
  const { request } = context;
  return {
    action: "execution",
    workspaceId: context.workspace.workspaceId,
    runId: context.runId,
    policyDigest: context.policyDigest,
    contextRecipeDigest: manifest.recipeDigest,
    semanticObligationsDigest: manifest.semanticObligationsDigest,
    contextManifestDigest: manifest.manifestId,
    expiresAt: new Date(Date.parse(context.createdAt) + APPROVAL_LIFETIME_MS).toISOString(),
    review: {
      packageDigest: `sha256:${pkg.payloadDigest}`,
      sourceStateDigest: context.sourceStateDigest,
      // why: approval surface values are tokens that start with a letter or
      // digit, and a logical path may start with a dot.
      scope: request.task.changeScope.map((path) => `path:${path}`),
      protectedPaths: request.task.protectedPaths.map((path) => `path:${path}`),
      tasks: [request.task.taskId],
      dataAccess: ["repository:read-at-revision"],
      capabilities: [WRITE_CAPABILITY],
      selectedPassports: [`claude-code:${request.driver.model}`, `codex:${request.verifier.model}`],
      destinations: [...DESTINATIONS],
      budgets: [
        `cost-usd:${request.budgets.maximumCostUsd}`,
        `tokens:${request.budgets.maximumTokens}`,
        `duration-ms:${request.budgets.maximumDurationMs}`
      ],
      claims: [`workspace-writer-lease:${context.workspace.workspaceId}`],
      gates: request.gates.map((gate) => gate.gateId),
      risks: [`risk:${request.task.risk}`],
      assumptions: ["single-writer", "no-merge"],
      completionCriteria: request.task.requirementIds,
      evidenceRefs: [`package:${pkg.artifactId}`, `context:${manifest.manifestId}`]
    }
  };
}

async function skillLockDigest(controlRoot: string): Promise<Digest> {
  const text = await readFile(join(controlRoot, ".verchestra", "skills.lock.json")).catch(() => undefined);
  return text === undefined ? canonicalDigest({ skills: "none" }) : sha256(text);
}

async function planSigner(io: TaskCommandIo, workspace: TaskWorkspace, dryRun: boolean): Promise<EvidenceSigner> {
  if (dryRun) return ephemeralSigner();
  const credentials = await readCredentials(
    {
      workspaceId: workspace.workspaceId,
      platform: io.platform,
      ...(io.keychainPath === undefined ? {} : { keychainPath: io.keychainPath })
    },
    [SIGNING_PASSPHRASE]
  );
  return workspaceSigner(workspace, credentials.get(SIGNING_PASSPHRASE) as string);
}

async function persist(
  context: PlanContext,
  manifest: ContextManifest,
  pkg: SignedExecutionPackage,
  record: TaskPlanRecord
) {
  const runRecord = openRunRecord(context.workspace, context.runId);
  await runRecord.savePackage(pkg);
  await runRecord.saveContextManifest(manifest);
  await runRecord.savePlan(record);
  const runtime = openRuntime(context.workspace);
  try {
    runtime.createRun({
      runId: context.runId,
      runKind: "feature",
      state: "EXECUTION_READY",
      version: 0,
      repairCycles: 0,
      approval: undefined,
      terminalCapsuleRequired: false
    });
    applyWorkflow(runtime, context.runId, {
      type: "REQUEST_EXECUTION_APPROVAL",
      actorRole: "planner",
      actorId: "planner:vestra-task-plan",
      evidence: ["execution-package"]
    });
  } finally {
    runtime.close();
  }
}

export async function planTask(io: TaskCommandIo, requestPath: string, dryRun: boolean) {
  const request = await readRequest(io, requestPath);
  const workspace = await openTaskWorkspace(io, { ensure: !dryRun });
  await loadGateAllowlist(workspace, request);
  // why: a malformed credential mode is reported at plan time, before an
  // approval is spent on a run that could never start. No credential is read.
  const providerAuth = await loadProviderAuth(workspace.layout.workspaceRoot);
  const policy = await loadTaskPolicy(io.controlRoot);
  const context: PlanContext = {
    workspace,
    request,
    runId: `run_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    sourceStateDigest: await sourceState(workspace.repositoryRoot, request.sourceRevision),
    policyDigest: policy.digest,
    gatePlanDigest: sha256(canonicalTaskGatePlan({ schemaVersion: 1, commands: request.gates })),
    skillLockDigest: await skillLockDigest(io.controlRoot)
  };
  const signer = await planSigner(io, workspace, dryRun);
  const manifest = await compileTaskContext({
    ...context,
    workspaceId: workspace.workspaceId,
    repositoryRoot: workspace.repositoryRoot,
    signer
  });
  const pkg = await new ExecutionPackageBuilder({ sealer: new ArtifactSealer({ signer }) }).build(
    packageInput(context, manifest)
  );
  const intent = approvalIntent(context, manifest, pkg);
  const approvalRequest = new ApprovalRequester({
    digest: new NodeContentDigest(),
    clock: new SystemClock(),
    uuid: randomUUID
  }).request(intent);
  const record: TaskPlanRecord = {
    schemaVersion: 1,
    runId: context.runId,
    workspaceId: workspace.workspaceId,
    createdAt: context.createdAt,
    request,
    requestDigest: canonicalDigest(request),
    sourceStateDigest: context.sourceStateDigest,
    contextManifestDigest: manifest.manifestId as Digest,
    policyViewDigest: policy.digest,
    gatePlanDigest: context.gatePlanDigest,
    packageId: pkg.artifactId,
    packageDigest: `sha256:${pkg.payloadDigest}`,
    approvalIntent: intent,
    approvalRequest,
    markerSeal: MARKER_SEAL
  };
  if (!dryRun) await persist(context, manifest, pkg, record);
  return planSurface(record, manifest, dryRun, providerAuth);
}

export function planSurface(
  record: TaskPlanRecord,
  manifest: Pick<ContextManifest, "fragments" | "omissions">,
  dryRun: boolean,
  providerAuth: ProviderAuth
) {
  return {
    runId: record.runId,
    dryRun,
    state: dryRun ? "NOT_PERSISTED" : "AWAITING_EXECUTION_APPROVAL",
    bindingDigest: record.approvalRequest.bindingDigest,
    approvalExpiresAt: record.approvalRequest.expiresAt,
    review: record.approvalRequest.review,
    sourceRevision: record.request.sourceRevision,
    contextFragments: manifest.fragments.length,
    contextOmissions: manifest.omissions.length,
    implementer: record.request.driver,
    verifier: record.request.verifier,
    // invariant: informational and machine-local. The mode is read again at
    // start and is not part of the binding the human approves.
    providerAuth: { "claude-code": providerAuth.implementer, codex: providerAuth.verifier },
    next: dryRun
      ? "Plan again without --dry-run to create an approvable run."
      : `vestra task approve --run-id ${record.runId} --binding-digest ${record.approvalRequest.bindingDigest}`
  };
}
