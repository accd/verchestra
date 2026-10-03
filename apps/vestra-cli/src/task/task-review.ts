import { HumanReviewCoordinator, modelPriceTable, type HumanReviewPorts } from "@verchestra/application";
import { WorkflowMachine, type RunSnapshot } from "@verchestra/domain";
import { ArtifactSealer, RunCapsuleBuilder, type EvidenceSigner } from "@verchestra/evidence";
import type { RuntimeStore } from "@verchestra/platform-node";

import { installedReleaseManifest } from "../release-manifest.ts";
import { TaskAuthority } from "./task-authority.ts";
import { capsuleBudgetConsumption } from "./task-budget.ts";
import { confirmDigest } from "./task-confirm.ts";
import { SIGNING_PASSPHRASE, readCredentials } from "./task-credentials.ts";
import { stateInvalid, taskError } from "./task-errors.ts";
import { canonicalDigest } from "./task-files.ts";
import type { TaskCommandIo } from "./task-io.ts";
import { HUMAN_ACTOR, type TaskPlanRecord } from "./task-plan-record.ts";
import { loadTaskPolicy } from "./task-policy.ts";
import { openRunRecord, type RunCheckpoints, type RunRecord } from "./task-run-record.ts";
import { workspaceSigner, workspaceTrustRoot } from "./task-signing.ts";
import { branchName, reviewSurface } from "./task-surface.ts";
import { applyWorkflow, currentRun, verificationRun } from "./task-workflow.ts";
import { openRuntime, openTaskWorkspace, parseRunId, type TaskWorkspace } from "./task-workspace.ts";

type Digest = `sha256:${string}`;
type Surface = Awaited<ReturnType<typeof reviewSurface>>;

interface ReviewContext {
  readonly io: TaskCommandIo;
  readonly workspace: TaskWorkspace;
  readonly plan: TaskPlanRecord;
  readonly pkg: Awaited<ReturnType<RunRecord["approvedPackage"]>>;
  readonly grant: Awaited<ReturnType<RunRecord["loadGrant"]>>;
  readonly runtime: RuntimeStore;
  readonly runRecord: RunRecord;
  readonly checkpoints: RunCheckpoints;
  readonly authority: TaskAuthority;
}

const ref = (artifactId: string, value: unknown) => ({ artifactId, digest: canonicalDigest(value) });

// invariant: what chose the sessions that wrote the change: the implementer of
// a single-session run, or the whole approved coordination plan, every node's
// driver and model with it.
function modelSelection(plan: TaskPlanRecord) {
  const request = plan.request;
  return request.schemaVersion === 1
    ? ref("selection:implementer", request.driver)
    : ref("selection:coordination", request.execution);
}

async function gateRefs(context: ReviewContext, refs: readonly string[]) {
  const store = context.runRecord.gateEvidence;
  const result = [];
  for (const evidenceRef of refs) result.push(ref(evidenceRef, (await store.load(evidenceRef)) ?? evidenceRef));
  return result;
}

async function toolReceipts(context: ReviewContext) {
  const latest = await context.checkpoints.executor();
  return (latest?.toolReceiptRefs ?? []).map((entry) => ref(entry, entry));
}

async function budgetEvidence(context: ReviewContext) {
  const ledger = (await context.checkpoints.repair())?.budgetLedger;
  if (ledger === undefined) return {};
  return {
    budgetEvidence: {
      declared: context.plan.request.budgets,
      ...capsuleBudgetConsumption(ledger),
      priceTableVersion: modelPriceTable.version,
      stopReason: ledger.stopReason
    }
  };
}

// why: a completed run carries its verification and human review; a rejected
// review ends the run ABORTED, and the rejection record is then the terminal
// reason the capsule carries instead.
function closingRefs(snapshot: RunSnapshot, surface: Surface, review: Readonly<Record<string, unknown>>) {
  const reviewRef = { artifactId: String(review["reviewRef"]), digest: review["reviewDigest"] as Digest };
  if (snapshot.state !== "COMPLETED")
    return { terminalErrorRef: { artifactId: `terminal:${reviewRef.artifactId}`, digest: reviewRef.digest } };
  return {
    verificationRef: { artifactId: "verification:report", digest: surface.surface.verification.reportDigest },
    humanReviewRef: reviewRef
  };
}

async function capsuleInput(
  context: ReviewContext,
  surface: Surface,
  snapshot: RunSnapshot,
  review: Readonly<Record<string, unknown>>
) {
  const { plan, pkg, grant } = context;
  const terminal = context.runtime.listEvents(plan.runId).at(-1);
  // invariant: the review seals after its own terminal transition, which the
  // store journals in the same transaction as the run's new state.
  if (terminal === undefined) throw stateInvalid("VES_TASK_STATE_MALFORMED", "The run journal holds no transition");
  return {
    workspaceId: plan.workspaceId,
    runId: plan.runId,
    runKind: "feature",
    runVersion: snapshot.version,
    status: snapshot.state,
    riskTier: plan.request.task.risk,
    requestDigest: plan.requestDigest,
    workspaceFingerprint: canonicalDigest({ workspaceId: plan.workspaceId }),
    executionPackageRef: { artifactId: plan.packageId, digest: plan.packageDigest },
    sourceStateRefs: [{ artifactId: `source:${plan.request.sourceRevision}`, digest: plan.sourceStateDigest }],
    releaseDigest: canonicalDigest({ release: installedReleaseManifest.semanticVersion }),
    policyDigests: [plan.policyViewDigest],
    skillLockDigest: pkg.payload.bindings.skillLockDigest,
    evidence: {
      decisions: [ref("decision:human-review", review)],
      modelSelections: [modelSelection(plan), ref("selection:verifier", plan.request.verifier)],
      contexts: [
        { artifactId: `context:${plan.contextManifestDigest.slice(7, 39)}`, digest: plan.contextManifestDigest }
      ],
      capabilityGrants: [ref(`grant:${grant?.grantId ?? "none"}`, grant ?? {})],
      approvals: [
        { artifactId: plan.approvalRequest.approvalId, digest: plan.approvalRequest.bindingDigest as Digest }
      ],
      claims: [ref(`lease:${plan.workspaceId}`, { ownerId: plan.runId })],
      tasks: [ref(`task:${plan.request.task.taskId}`, plan.request.task)],
      gates: await gateRefs(context, surface.commit.gateEvidenceRefs),
      operationReceipts: await toolReceipts(context),
      outputs: [ref(`commit:${surface.commit.commitId}`, surface.surface)],
      terminal: [ref(`event:${terminal.eventId}`, terminal)]
    },
    ...closingRefs(snapshot, surface, review),
    ...(await budgetEvidence(context)),
    terminalTransition: {
      eventId: terminal.eventId,
      eventDigest: canonicalDigest(terminal),
      fromState: terminal.previousState,
      toState: snapshot.state,
      occurredAt: terminal.occurredAt
    },
    sealedAt: new Date().toISOString()
  };
}

async function sealCapsule(
  context: ReviewContext,
  signer: EvidenceSigner,
  surface: Surface,
  review: Readonly<Record<string, unknown>>
): Promise<string> {
  const snapshot = currentRun(context.runtime, context.plan.runId);
  const capsule = await new RunCapsuleBuilder({ sealer: new ArtifactSealer({ signer }) }).build(
    await capsuleInput(context, surface, snapshot, review)
  );
  await context.runRecord.saveCapsule(capsule);
  context.runtime.recordRunCapsuleSeal({
    runId: context.plan.runId,
    stateVersion: snapshot.version,
    status: snapshot.state,
    capsuleId: capsule.artifactId,
    payloadDigest: capsule.payloadDigest,
    sealedAt: capsule.issuedAt
  });
  return capsule.artifactId;
}

// invariant: a review binds the verification report that is on disk; a claim
// about any other report, or about none, is not valid.
async function verifyReport(runRecord: RunRecord, verification: Readonly<Record<string, unknown>>) {
  const report = await runRecord.loadReport();
  if (report === undefined) return { valid: false, reportRef: "", reportDigest: "", verdict: "", commitId: "" };
  const reportDigest = canonicalDigest(report);
  return {
    valid:
      `verification:${reportDigest.slice(7, 39)}` === verification["reportRef"] &&
      reportDigest === verification["reportDigest"],
    reportRef: `verification:${reportDigest.slice(7, 39)}`,
    reportDigest,
    verdict: report.verdict,
    commitId: report.commitId
  };
}

function reviewPorts(context: ReviewContext): HumanReviewPorts {
  return {
    reports: { verify: async (verification) => verifyReport(context.runRecord, verification) },
    humanAuthority: {
      verify: async () => {
        const decision = context.authority.decide("human-review", true);
        return {
          authorized: decision.decision === "allow",
          authorizationRef: `cedar:${decision.evidenceDigest.slice(7, 39)}`
        };
      }
    },
    reviews: {
      save: async (review) => {
        const reviewDigest = await context.runRecord.saveReview(review);
        return { reviewRef: `review:${reviewDigest.slice(7, 39)}`, reviewDigest };
      }
    },
    workflow: {
      apply: async (snapshot, command) => {
        const decided = WorkflowMachine.decide(snapshot, command);
        if (decided.accepted) applyWorkflow(context.runtime, context.plan.runId, command);
        return decided;
      }
    }
  };
}

function reviewInput(context: ReviewContext, surface: Surface, outcome: string, typed: string) {
  return {
    schemaVersion: 1,
    workspaceId: context.plan.workspaceId,
    run: verificationRun(currentRun(context.runtime, context.plan.runId)),
    reviewer: { actorId: HUMAN_ACTOR, actorKind: "human" },
    verification: {
      reportRef: `verification:${surface.surface.verification.reportDigest.slice(7, 39)}`,
      reportDigest: surface.surface.verification.reportDigest,
      verdict: surface.report.verdict,
      commitId: surface.commit.commitId
    },
    reviewSurfaceDigest: typed,
    currentSurfaceDigest: surface.digest,
    outcome,
    findingRefs: []
  };
}

export async function reviewTask(
  io: TaskCommandIo,
  options: {
    readonly runId: unknown;
    readonly outcome: unknown;
    readonly surfaceDigest: unknown;
    readonly confirmStdin: boolean;
  }
) {
  const runId = parseRunId(options.runId);
  const workspace = await openTaskWorkspace(io);
  const runRecord = openRunRecord(workspace, runId);
  const plan = await runRecord.loadPlan();
  const runtime = openRuntime(workspace);
  try {
    const state = currentRun(runtime, runId).state;
    if (state !== "HUMAN_REVIEW")
      throw taskError(
        "VES_TASK_TRANSITION_REFUSED",
        { state, command: "review" },
        "Only a run in HUMAN_REVIEW can be reviewed"
      );
    // invariant: the review seals a Run Capsule over the Execution Package the
    // plan bound, so that package is proven before the surface is read, the
    // human confirms, or the review is recorded, exactly as `approve` proves it.
    const pkg = await runRecord.approvedPackage(plan);
    // invariant: the Run Capsule binds the grant marker, so a marker that
    // does not verify stops the review here, not after it is recorded.
    const grant = await runRecord.loadGrant();
    const surface = await reviewSurface(workspace.repositoryRoot, plan, runRecord);
    if (options.surfaceDigest !== surface.digest)
      throw taskError("VES_TASK_SURFACE_MISMATCH", {}, "The review surface changed or the digest is wrong");
    await confirmDigest(io, surface.digest, { confirmStdin: options.confirmStdin, label: "surface" });
    const credentials = await readCredentials(
      {
        workspaceId: workspace.workspaceId,
        platform: io.platform,
        ...(io.keychainPath === undefined ? {} : { keychainPath: io.keychainPath })
      },
      [SIGNING_PASSPHRASE]
    );
    const signer = await workspaceSigner(workspace, credentials.get(SIGNING_PASSPHRASE) as string);
    const policy = await loadTaskPolicy(io.controlRoot);
    const authority = new TaskAuthority({ runtime, plan, policy, trust: await workspaceTrustRoot(workspace) });
    const checkpoints = runRecord.checkpoints(runtime, plan.request.task.taskId);
    const context: ReviewContext = { io, workspace, plan, pkg, grant, runtime, runRecord, checkpoints, authority };
    const review = await new HumanReviewCoordinator(reviewPorts(context)).review(
      reviewInput(context, surface, String(options.outcome), String(options.surfaceDigest))
    );
    if (review["status"] === "REVIEW_REJECTED")
      applyWorkflow(runtime, runId, {
        type: "ABORT",
        actorRole: "human",
        actorId: HUMAN_ACTOR,
        evidence: ["human-review-record"]
      });
    const capsuleId = await sealCapsule(context, signer, surface, review);
    const branch = branchName(plan);
    return {
      runId,
      state: currentRun(runtime, runId).state,
      outcome: options.outcome,
      reviewRef: review["reviewRef"],
      capsuleId,
      branch,
      commitId: surface.commit.commitId,
      inspect: `git log --stat ${surface.commit.baseCommit}..${branch} && git diff ${surface.commit.baseCommit}..${branch}`,
      merge: "Verchestra never merges. Merge or delete the branch yourself when you are satisfied."
    };
  } finally {
    runtime.close();
  }
}
