import { TERMINAL_WORKFLOW_STATES, type RunState } from "@verchestra/domain";
import { NodeGitWorktreeAdapter, type RuntimeStore } from "@verchestra/platform-node";

import { budgetStatus } from "./task-budget.ts";
import { continuation, coordinationStatus } from "./task-coordination-surface.ts";
import { taskError } from "./task-errors.ts";
import type { TaskCommandIo } from "./task-io.ts";
import { HUMAN_ACTOR, isCoordinatedPlan, type TaskPlanRecord } from "./task-plan-record.ts";
import type { NodeUncertainty } from "./task-resumption.ts";
import {
  UNVERIFIED_DRIVER,
  openRunRecord,
  type ExecutorCheckpoint,
  type RunCheckpoints,
  type RunRecord
} from "./task-run-record.ts";
import { branchName, reviewSurface } from "./task-surface.ts";
import { applyWorkflow, currentRun } from "./task-workflow.ts";
import { openRuntime, openTaskWorkspace, parseRunId, type TaskWorkspace } from "./task-workspace.ts";

const CANCEL_WAIT_MS = 60_000;

function nextActions(
  state: RunState,
  runId: string,
  driven: boolean,
  uncertain: readonly Pick<NodeUncertainty, "digest">[]
): readonly string[] {
  const cancel = `vestra task cancel --run-id ${runId}`;
  if ((TERMINAL_WORKFLOW_STATES as readonly string[]).includes(state)) return [];
  if (driven) return [cancel];
  const byState: Partial<Record<RunState, readonly string[]>> = {
    AWAITING_EXECUTION_APPROVAL: [`vestra task approve --run-id ${runId} --binding-digest <sha256:…>`, cancel],
    EXECUTION_AUTHORIZED: [`vestra task start --run-id ${runId}`, cancel],
    IMPLEMENTING: [...continuation(runId, uncertain), cancel],
    VERIFYING: [`vestra task resume --run-id ${runId}`, cancel],
    HUMAN_REVIEW: [
      `vestra task review --run-id ${runId} --outcome accepted|rejected --surface-digest <sha256:…>`,
      cancel
    ]
  };
  return byState[state] ?? [cancel];
}

async function checkpointStages(checkpoints: RunCheckpoints, executor: ExecutorCheckpoint | undefined) {
  const repair = await checkpoints.repair();
  return {
    executor: executor?.stage ?? "none",
    gate: checkpoints.gate()?.stage ?? "none",
    repair: repair?.stage ?? "none",
    toolReceipts: executor?.toolReceiptRefs.length ?? 0,
    budget: budgetStatus(repair?.budgetLedger)
  };
}

function orNull(value: unknown): unknown {
  return value ?? null;
}

async function evidence(plan: TaskPlanRecord, runRecord: RunRecord) {
  const commit = await runRecord.loadCommit();
  const report = await runRecord.loadReport();
  const review = await runRecord.loadReview();
  const grant = await runRecord.loadGrant();
  return {
    packageId: plan.packageId,
    contextManifestDigest: plan.contextManifestDigest,
    approvalId: plan.approvalRequest.approvalId,
    grantId: orNull(grant?.grantId),
    commitId: orNull(commit?.commitId),
    branch: commit === undefined ? null : branchName(plan),
    gateEvidenceRefs: commit?.gateEvidenceRefs ?? [],
    verificationVerdict: orNull(report?.verdict),
    reviewOutcome: orNull(review?.outcome)
  };
}

// why: SSI-32. A suspended run shows its suspension, the provider's window,
// and the reset time the provider reported, until it is resumed or ended.
function suspensionOf(state: RunState, outcome: Awaited<ReturnType<RunRecord["loadOutcome"]>>) {
  if (outcome?.status !== "SUSPENDED" || (TERMINAL_WORKFLOW_STATES as readonly string[]).includes(state)) return null;
  return outcome.suspension;
}

export async function statusTask(io: TaskCommandIo, options: { readonly runId: unknown }) {
  const runId = parseRunId(options.runId);
  const workspace = await openTaskWorkspace(io);
  const runRecord = openRunRecord(workspace, runId);
  const plan = await runRecord.loadPlan();
  const runtime = openRuntime(workspace);
  try {
    const snapshot = currentRun(runtime, runId);
    const driven = (await runRecord.activeProcess()) !== undefined;
    const outcome = await runRecord.loadOutcome();
    const surface =
      snapshot.state === "HUMAN_REVIEW"
        ? (await reviewSurface(workspace.repositoryRoot, plan, runRecord)).digest
        : null;
    const checkpoints = runRecord.checkpoints(runtime, plan.request.task.taskId);
    const executor = await checkpoints.executor();
    const coordination = isCoordinatedPlan(plan)
      ? await coordinationStatus(plan, runRecord, executor, worktreeAdapter(workspace))
      : null;
    return {
      runId,
      state: snapshot.state,
      version: snapshot.version,
      activeProcess: driven,
      bindingDigest: plan.approvalRequest.bindingDigest,
      lastOutcome: outcome?.status ?? null,
      lastReason: reasonOf(outcome),
      suspension: suspensionOf(snapshot.state, outcome),
      checkpoints: await checkpointStages(checkpoints, executor),
      coordination,
      evidence: await evidence(plan, runRecord),
      capsuleId: runtime.getRunCapsuleSeal(runId)?.capsuleId ?? null,
      surfaceDigest: surface,
      next: nextActions(snapshot.state, runId, driven, coordination?.uncertain ?? [])
    };
  } finally {
    runtime.close();
  }
}

async function waitForStop(runRecord: RunRecord, runtime: RuntimeStore): Promise<boolean> {
  const deadline = Date.now() + CANCEL_WAIT_MS;
  while (Date.now() < deadline) {
    if ((await runRecord.activeProcess()) === undefined) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  return (TERMINAL_WORKFLOW_STATES as readonly string[]).includes(currentRun(runtime, runRecord.runId).state);
}

// why: a worktree that is already gone leaves nothing to cancel. Every other
// refusal (an unreadable marker, an escaped root, history that is not one
// verified task commit, a failed git command) stops the cancel before the
// abort is recorded, instead of reporting a stop that left the worktree behind.
function worktreeAlreadyGone(error: unknown): void {
  if ((error as { readonly code?: unknown }).code !== "VES_GIT_WORKTREE_NOT_FOUND") throw error;
}

// invariant: the worktree an idle run left behind is named only by the handle
// in its marker; the worktree module removes it from that handle alone.
export async function removeIdleWorktree(
  workspace: { readonly repositoryRoot: string; readonly layout: { readonly worktreesRoot: string } },
  runRecord: Pick<RunRecord, "loadWorktreeRef" | "loadCommit">
): Promise<void> {
  const worktreeRef = await runRecord.loadWorktreeRef();
  if (worktreeRef === undefined || (await runRecord.loadCommit()) !== undefined) return;
  await worktreeAdapter(workspace).cleanupHandle(worktreeRef).catch(worktreeAlreadyGone);
}

function worktreeAdapter(workspace: {
  readonly repositoryRoot: string;
  readonly layout: { readonly worktreesRoot: string };
}): NodeGitWorktreeAdapter {
  return new NodeGitWorktreeAdapter({
    repositoryRoot: workspace.repositoryRoot,
    worktreesRoot: workspace.layout.worktreesRoot,
    anchorTaskCommits: true
  });
}

// why: with no process driving the run, cancel itself ends it: the
// uncommitted worktree is removed (an anchored task branch is kept), the
// writer lease is released, and the human abort is recorded.
async function abortIdle(workspace: TaskWorkspace, runtime: RuntimeStore, runRecord: RunRecord) {
  const runId = runRecord.runId;
  await removeIdleWorktree(workspace, runRecord);
  try {
    runtime.releaseLease(workspace.workspaceId, runId);
  } catch {
    // why: a lease another run holds is not this run's to release.
  }
  applyWorkflow(runtime, runId, {
    type: "ABORT",
    actorRole: "human",
    actorId: HUMAN_ACTOR,
    evidence: ["cancel-request"]
  });
}

export async function cancelTask(io: TaskCommandIo, options: { readonly runId: unknown }) {
  const runId = parseRunId(options.runId);
  const workspace = await openTaskWorkspace(io);
  const runRecord = openRunRecord(workspace, runId);
  await runRecord.loadPlan();
  const runtime = openRuntime(workspace);
  try {
    const state = currentRun(runtime, runId).state;
    if ((TERMINAL_WORKFLOW_STATES as readonly string[]).includes(state))
      throw taskError("VES_TASK_TRANSITION_REFUSED", { state, command: "cancel" }, "The run has already ended");
    const driver = await runRecord.activeProcess();
    if (driver !== undefined) {
      await runRecord.requestCancel(HUMAN_ACTOR);
      const stopped = await waitForStop(runRecord, runtime);
      if (stopped || driver !== UNVERIFIED_DRIVER)
        return { runId, state: currentRun(runtime, runId).state, cancelRequested: true, stopped };
      // invariant: a user can always stop a run. An active marker that does
      // not verify names no process to wait for. A driver that was alive has
      // had the whole wait to answer the request and release the marker; none
      // did, so the marker is cleared and the run is ended here, as an idle
      // one. A marker that verifies and names a live process never gets here.
      await runRecord.releaseActive();
    }
    await abortIdle(workspace, runtime, runRecord);
    return { runId, state: currentRun(runtime, runId).state, cancelRequested: true, stopped: true };
  } finally {
    runtime.close();
  }
}

// why: a failed or an aborted run's outcome names a reason, and a suspended
// one the code of the signal it stopped on.
function reasonOf(outcome: Awaited<ReturnType<RunRecord["loadOutcome"]>>): string | null {
  if (outcome?.status === "SUSPENDED") return outcome.suspension.reason;
  return outcome?.status === "FAILED" || outcome?.status === "ABORTED" ? outcome.reason : null;
}
