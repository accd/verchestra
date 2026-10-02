import { TERMINAL_WORKFLOW_STATES, type RunState } from "@verchestra/domain";
import {
  NodeGitWorktreeAdapter,
  RuntimeCheckpointStore,
  RuntimeLocalLease,
  type RuntimeStore
} from "@verchestra/platform-node";

import { budgetStatus } from "./task-budget.ts";
import { taskError } from "./task-errors.ts";
import type { TaskCommandIo } from "./task-io.ts";
import { HUMAN_ACTOR, type TaskPlanRecord } from "./task-plan-record.ts";
import { openRunRecord, type RunRecord } from "./task-run-record.ts";
import { branchName, reviewSurface } from "./task-surface.ts";
import { applyWorkflow, currentRun } from "./task-workflow.ts";
import { openRuntime, openTaskWorkspace, parseRunId, type TaskWorkspace } from "./task-workspace.ts";

const CANCEL_WAIT_MS = 60_000;

function nextActions(state: RunState, runId: string, driven: boolean): readonly string[] {
  const cancel = `vestra task cancel --run-id ${runId}`;
  if ((TERMINAL_WORKFLOW_STATES as readonly string[]).includes(state)) return [];
  if (driven) return [cancel];
  const byState: Partial<Record<RunState, readonly string[]>> = {
    AWAITING_EXECUTION_APPROVAL: [`vestra task approve --run-id ${runId} --binding-digest <sha256:…>`, cancel],
    EXECUTION_AUTHORIZED: [`vestra task start --run-id ${runId}`, cancel],
    IMPLEMENTING: [`vestra task resume --run-id ${runId}`, cancel],
    VERIFYING: [`vestra task resume --run-id ${runId}`, cancel],
    HUMAN_REVIEW: [
      `vestra task review --run-id ${runId} --outcome accepted|rejected --surface-digest <sha256:…>`,
      cancel
    ]
  };
  return byState[state] ?? [cancel];
}

function stageOf(value: unknown): string {
  const stage = (value as { readonly stage?: unknown } | undefined)?.stage;
  return typeof stage === "string" ? stage : "none";
}

async function checkpointStages(runtime: RuntimeStore, plan: TaskPlanRecord) {
  const store = new RuntimeCheckpointStore(runtime);
  const ids = [plan.workspaceId, plan.runId, plan.request.task.taskId] as const;
  const executor = await store.executorCheckpoints().load(...ids);
  const repair = (await store.repairState(...ids).loadState()) as Readonly<Record<string, unknown>> | undefined;
  const receipts = (executor?.data as { readonly toolReceiptRefs?: unknown } | undefined)?.toolReceiptRefs;
  return {
    executor: stageOf(executor),
    gate: stageOf(store.inspectGate(...ids)),
    repair: stageOf(repair),
    toolReceipts: Array.isArray(receipts) ? receipts.length : 0,
    budget: budgetStatus(repair?.["budgetLedger"])
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
    grantId: orNull(grant?.["grantId"]),
    commitId: orNull(commit?.commitId),
    branch: commit === undefined ? null : branchName(plan),
    gateEvidenceRefs: commit?.gateEvidenceRefs ?? [],
    verificationVerdict: orNull(report?.["verdict"]),
    reviewOutcome: orNull(review?.["outcome"])
  };
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
    return {
      runId,
      state: snapshot.state,
      version: snapshot.version,
      activeProcess: driven,
      bindingDigest: plan.approvalRequest.bindingDigest,
      lastOutcome: outcome?.["status"] ?? null,
      lastReason: outcome?.["reason"] ?? null,
      checkpoints: await checkpointStages(runtime, plan),
      evidence: await evidence(plan, runRecord),
      capsuleId: runtime.getRunCapsuleSeal(runId)?.["capsuleId"] ?? null,
      surfaceDigest: surface,
      next: nextActions(snapshot.state, runId, driven)
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
  const worktrees = new NodeGitWorktreeAdapter({
    repositoryRoot: workspace.repositoryRoot,
    worktreesRoot: workspace.layout.worktreesRoot,
    anchorTaskCommits: true
  });
  await worktrees.cleanupHandle(worktreeRef).catch(worktreeAlreadyGone);
}

// why: with no process driving the run, cancel itself ends it: the
// uncommitted worktree is removed (an anchored task branch is kept), the
// writer lease is released, and the human abort is recorded.
async function abortIdle(workspace: TaskWorkspace, runtime: RuntimeStore, runRecord: RunRecord) {
  const runId = runRecord.runId;
  await removeIdleWorktree(workspace, runRecord);
  try {
    new RuntimeLocalLease(runtime).release(workspace.workspaceId, runId);
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
    if ((await runRecord.activeProcess()) !== undefined) {
      await runRecord.requestCancel(HUMAN_ACTOR);
      const stopped = await waitForStop(runRecord, runtime);
      return { runId, state: currentRun(runtime, runId).state, cancelRequested: true, stopped };
    }
    await abortIdle(workspace, runtime, runRecord);
    return { runId, state: currentRun(runtime, runId).state, cancelRequested: true, stopped: true };
  } finally {
    runtime.close();
  }
}
