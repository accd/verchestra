import { join } from "node:path";

import {
  IndependentVerificationCoordinator,
  type BudgetMeter,
  type TaskRunCommit,
  type TaskRunVerification,
  type VerificationPorts
} from "@verchestra/application";
import { WorkflowMachine, type RunSnapshot, type WorkflowCommand, type WorkflowDecision } from "@verchestra/domain";
import type { GateCommandProfile, RuntimeStore } from "@verchestra/platform-node";

import { parseVerdict, runCodexVerifier, verifierPrompt, type VerifierClaim } from "./task-codex.ts";
import { canonicalDigest, sha256 } from "./task-files.ts";
import { git, gitBuffer } from "./task-git.ts";
import { activeStateDigest, MutationSensor } from "./task-mutation-sensor.ts";
import { IMPLEMENTER_ACTOR, VERIFIER_ACTOR, implementerDriverId, type TaskPlanRecord } from "./task-plan-record.ts";
import type { ProviderProcesses } from "./task-process-tree.ts";
import type { RunRecord } from "./task-run-record.ts";
import { applyWorkflow, verificationRun } from "./task-workflow.ts";
import { scratchCheckouts, type TaskWorkspace } from "./task-workspace.ts";

const MAXIMUM_EVIDENCE_FILE_BYTES = 1024 * 1024;

export interface VerifierContext {
  readonly workspace: TaskWorkspace;
  readonly plan: TaskPlanRecord;
  readonly runtime: RuntimeStore;
  readonly runRecord: Pick<RunRecord, "saveReport" | "saveLesson">;
  readonly gates: Readonly<Record<string, GateCommandProfile>>;
  readonly verifier:
    | { readonly executable: string; readonly credential: string }
    | { readonly executable: string; readonly identityDirectory: string };
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly meter: BudgetMeter | undefined;
  readonly providers: ProviderProcesses;
}

async function inspectEvidence(
  context: VerifierContext,
  request: Parameters<VerificationPorts["evidence"]["inspect"]>[0]
) {
  let text: string;
  try {
    text = (
      await gitBuffer(
        context.workspace.repositoryRoot,
        ["cat-file", "blob", `${request.commitId}:${request.claim.file}`],
        MAXIMUM_EVIDENCE_FILE_BYTES
      )
    ).toString("utf8");
  } catch {
    return { valid: false };
  }
  const lines = text.split(/\r?\n/u);
  if (request.claim.lineEnd > lines.length) return { valid: false };
  const cited = lines.slice(request.claim.lineStart - 1, request.claim.lineEnd).join("\n");
  if (cited.trim().length === 0) return { valid: false };
  return {
    valid: true,
    commitId: request.commitId,
    expectedOutcomeDigest: request.expectedOutcomeDigest,
    assertionDigest: sha256(cited)
  };
}

function workflowPort(context: VerifierContext): VerificationPorts["workflow"] {
  return {
    apply: async (snapshot: RunSnapshot, command: WorkflowCommand): Promise<WorkflowDecision> => {
      const decided = WorkflowMachine.decide(snapshot, command);
      if (!decided.accepted) return decided;
      applyWorkflow(context.runtime, context.plan.runId, {
        type: command.type,
        actorRole: command.actorRole,
        actorId: command.actorId,
        evidence: command.evidence
      });
      return decided;
    }
  };
}

// invariant: the expected outcome is derived from the approved task alone
// (criterion, requirement, done criteria, and the commit under review), never
// from anything the verifier model said.
function expectedOutcome(plan: TaskPlanRecord, commit: TaskRunCommit, criterionId: string, requirementId: string) {
  return canonicalDigest({
    criterionId,
    requirementId,
    commitId: commit.commitId,
    doneCriteria: plan.request.task.doneCriteria
  });
}

function ports(context: VerifierContext, commit: TaskRunCommit): VerificationPorts {
  const expected = (criterion: { readonly criterionId: string; readonly requirementId: string }) =>
    expectedOutcome(context.plan, commit, criterion.criterionId, criterion.requirementId);
  const sensor = new MutationSensor({
    workspace: context.workspace,
    runId: context.plan.runId,
    sourceRevision: context.plan.request.sourceRevision,
    changeScope: context.plan.request.task.changeScope,
    gates: context.plan.request.gates,
    profiles: context.gates
  });
  return {
    expectations: {
      derive: async (criterion) => ({
        expectedOutcomeRef: `expected:${criterion.criterionId}`,
        expectedOutcomeDigest: expected(criterion)
      })
    },
    evidence: { inspect: (request) => inspectEvidence(context, request) },
    sensor: {
      activeStateDigest: () => activeStateDigest(context.workspace.repositoryRoot),
      run: (request) => sensor.run(request)
    },
    lessons: {
      record: async (lesson) => ({
        lessonRef: `lesson:${(await context.runRecord.saveLesson(lesson)).slice(7, 39)}`
      })
    },
    reports: {
      save: async (report) => {
        const reportDigest = await context.runRecord.saveReport(report);
        return { reportRef: `verification:${reportDigest.slice(7, 39)}`, reportDigest };
      }
    },
    workflow: workflowPort(context)
  };
}

function verificationInput(
  context: VerifierContext,
  commit: TaskRunCommit,
  run: RunSnapshot,
  claims: readonly VerifierClaim[]
) {
  const { plan } = context;
  const criterionFor = (requirementId: string) => `AC-${requirementId}`;
  const expected = (requirementId: string) => expectedOutcome(plan, commit, criterionFor(requirementId), requirementId);
  const satisfied = claims.filter((entry) => entry.satisfied && entry.evidence !== undefined);
  return {
    schemaVersion: 2,
    workspaceId: plan.workspaceId,
    run: verificationRun(run),
    verifier: {
      actorId: VERIFIER_ACTOR,
      actorKind: "model",
      passportRef: `passport:codex:${plan.request.verifier.model}`
    },
    implementerDriverId: implementerDriverId(plan.request),
    verifierDriverId: plan.request.verifier.driverId,
    packageDigest: plan.packageDigest,
    commit: {
      commitId: commit.commitId,
      authorActorId: IMPLEMENTER_ACTOR,
      gateEvidenceDigest: commit.gateEvidenceDigest
    },
    criteria: plan.request.task.requirementIds.map((requirementId) => ({
      criterionId: criterionFor(requirementId),
      requirementId,
      whenRef: `task:${plan.request.task.taskId}:delivered`,
      thenRef: `done:${requirementId}`,
      independentTestRef: `gates:${requirementId}`
    })),
    evidenceClaims: satisfied.map((entry) => ({
      criterionId: criterionFor(entry.requirementId),
      evidenceRef: `evidence:${entry.requirementId}`,
      file: entry.evidence!.file,
      lineStart: entry.evidence!.lineStart,
      lineEnd: entry.evidence!.lineEnd,
      assertionRef: `assertion:${entry.requirementId}`,
      expectedOutcomeDigest: expected(entry.requirementId)
    })),
    mutations: satisfied
      .filter((entry) => entry.implementationFile !== undefined)
      .map((entry) => ({
        mutationId: `mutation:${entry.requirementId}`,
        criterionId: criterionFor(entry.requirementId),
        operator: "revert-implementation",
        targetRef: `path:${entry.implementationFile!}`,
        expectedFailureRef: `gates:${entry.requirementId}`
      }))
  };
}

export async function verifyTask(
  context: VerifierContext,
  commit: TaskRunCommit,
  run: RunSnapshot,
  signal: AbortSignal
): Promise<TaskRunVerification> {
  const review = await scratchCheckouts(context.workspace, context.plan.runId, "review");
  const repositoryRoot = context.workspace.repositoryRoot;
  const diff = await git(repositoryRoot, [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    commit.baseCommit,
    commit.commitId
  ]);
  // invariant: the verifier reads a checkout of the task commit that lives
  // only as long as its session, so a checkout the worktree module could not
  // remove stops the run before any verdict is recorded.
  const text = await review.checkouts.withScratchCheckout(
    { name: commit.commitId, commitId: commit.commitId },
    (checkout) =>
      runCodexVerifier({
        workspaceId: context.plan.workspaceId,
        runId: context.plan.runId,
        manifestId: context.plan.contextManifestDigest,
        request: context.plan.request,
        ...context.verifier,
        env: context.env,
        sessionRoot: join(context.workspace.layout.sessionsRoot, `codex-${context.plan.runId}`),
        cwd: checkout.directory,
        prompt: verifierPrompt(context.plan.request, diff, commit.commitId),
        meter: context.meter,
        signal,
        providers: context.providers
      })
  );
  const claims = parseVerdict(text, context.plan.request.task.requirementIds);
  const result = await new IndependentVerificationCoordinator(ports(context, commit)).verify(
    verificationInput(context, commit, run, claims)
  );
  return {
    verdict: result["verdict"] === "PASS" ? "PASS" : "FAIL",
    nextState: String(result["nextState"]),
    reportRef: String(result["reportRef"])
  };
}
