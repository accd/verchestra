// why: SSI-33, SSI-63, SSI-66, and D4. A resume of a suspended or interrupted
// coordinated run is revalidated before any node starts, and a refusal changes
// nothing: no transition, no worktree, no ledger entry, no lease. `status`
// shows what a resume would ask for through the same computation.
import { uncertaintyRecord, unsettledVisits, type CoordinationLedger, type VisitEffect } from "@verchestra/application";
import type { NodeGitWorktreeAdapter } from "@verchestra/platform-node";

import { cliError } from "../cli-errors.ts";
import { taskError } from "./task-errors.ts";
import { canonicalDigest } from "./task-files.ts";
import type { RunRecord } from "./task-run-record.ts";

type Digest = `sha256:${string}`;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

// invariant: a visit a resume must settle, named by the digest of its
// uncertainty record; no session, path, or provider text.
export interface NodeUncertainty {
  readonly nodeId: string;
  readonly visit: number;
  readonly state: string;
  readonly receiptCount: number;
  readonly effect: VisitEffect;
  readonly digest: Digest;
}

// invariant: the one computation of the visits a resume must settle and of
// the digests that name them, for `resume` and for `status`.
export function nodeUncertainties(
  runId: string,
  ledger: CoordinationLedger | undefined,
  changeDigest: string | undefined
): readonly NodeUncertainty[] {
  return unsettledVisits(ledger, changeDigest as Digest | undefined).map(({ visit, effect }) =>
    Object.freeze({
      nodeId: visit.nodeId,
      visit: visit.visit,
      state: visit.state,
      receiptCount: visit.receiptCount,
      effect,
      digest: canonicalDigest(uncertaintyRecord(runId, visit))
    })
  );
}

export function parseReconcile(value: unknown): Digest | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !DIGEST.test(value))
    throw cliError("VES_CLI_ARGUMENT_INVALID", { argument: "--reconcile" }, "The reconcile digest is invalid");
  return value as Digest;
}

// why: the worktree a suspended or interrupted run left is named only by its
// marker. One that cannot be found or read cannot be proven unchanged, so it
// is reported as absent and a resume refuses it as drift.
export async function inspectMarkedWorktree(
  runRecord: Pick<RunRecord, "loadWorktreeRef">,
  worktrees: Pick<NodeGitWorktreeAdapter, "inspect">,
  sourceRevision: string
): Promise<{ readonly changeDigest: string; readonly commitCountSinceBase: number } | undefined> {
  const worktreeRef = await runRecord.loadWorktreeRef();
  if (worktreeRef === undefined) return undefined;
  try {
    return await worktrees.inspect({ worktreeRef, baseCommit: sourceRevision });
  } catch {
    return undefined;
  }
}

function refused(reason: string, message: string): never {
  throw taskError("VES_TASK_FAILED", { reason }, message);
}

export interface ResumeFacts {
  readonly runId: string;
  readonly coordinated: boolean;
  // invariant: the change digest of the `suspended` executor checkpoint, when
  // the run's latest executor checkpoint is one.
  readonly suspended: { readonly changeDigest: string | undefined } | undefined;
  readonly ledger: CoordinationLedger | undefined;
  readonly approval: () => Promise<{ readonly valid: boolean; readonly code?: string }>;
  readonly worktree: () => Promise<
    { readonly changeDigest: string; readonly commitCountSinceBase: number } | undefined
  >;
  readonly reconcile: Digest | undefined;
  readonly stderr: (value: string) => void;
  // invariant: present only for a run suspended at its verifier. Its worktree
  // is gone into its task commit, so what it left is that commit: whether the
  // recorded commit still stands on its base under its anchored task branch.
  readonly suspendedAtVerification?: { readonly taskCommitHolds: () => Promise<boolean> };
}

function explain(runId: string, open: readonly NodeUncertainty[]): string {
  const lines = open.map(
    (node) =>
      `  node ${node.nodeId} (visit ${node.visit}, ${node.state}, ${node.receiptCount} receipts):\n` +
      `    vestra task resume --run-id ${runId} --reconcile ${node.digest}\n`
  );
  return (
    "A node of this run started and may have changed the worktree before it stopped. Inspect the worktree; to run\n" +
    "that node again on it, resume with the command below, or end the run with `vestra task cancel`.\n" +
    lines.join("")
  );
}

// invariant: SSI-66 and D4. Every unsettled visit that may have landed an
// effect must be the one the owner reconciles; a digest that names no
// unsettled visit of this run is refused, never ignored.
function requireSettled(facts: ResumeFacts, changeDigest: string | undefined): void {
  const uncertain = nodeUncertainties(facts.runId, facts.ledger, changeDigest);
  if (facts.reconcile !== undefined && !uncertain.some((node) => node.digest === facts.reconcile))
    refused("VES_TASK_RECONCILE_UNMATCHED", "The reconcile digest names no unsettled node of this run");
  const open = uncertain.filter((node) => node.effect === "possible" && node.digest !== facts.reconcile);
  if (open.length === 0) return;
  facts.stderr(explain(facts.runId, open));
  refused("VES_TASK_NODE_UNCERTAIN", "A node of this run may have landed effects and is not reconciled");
}

// invariant: SSI-33. A suspended run resumes only on an approval that is
// still valid against the Workspace policy in force and on what it left: a
// run suspended in a node, its worktree with the same change digest and no
// commit since its base; a run suspended at its verifier, its task commit
// on its base under its anchored branch. An interrupted coordinated run
// resumes only with every unsettled node settled. The subscription
// preconditions, the extra-usage confirmation, and the workflow state were
// proven before this is asked.
export async function revalidateResume(facts: ResumeFacts): Promise<{ readonly fromSuspension: boolean }> {
  if (facts.reconcile !== undefined && !facts.coordinated)
    refused("VES_TASK_RECONCILE_UNMATCHED", "Only a coordinated run has nodes to reconcile");
  const inspects = facts.suspended !== undefined || facts.ledger?.roundState === "running";
  const current = inspects ? await facts.worktree() : undefined;
  if (facts.suspended !== undefined) await assertSuspensionHolds(facts, facts.suspended, current);
  if (facts.suspendedAtVerification !== undefined) await assertVerificationHolds(facts, facts.suspendedAtVerification);
  if (facts.coordinated) requireSettled(facts, current?.changeDigest);
  return { fromSuspension: facts.suspended !== undefined };
}

async function requireValidApproval(facts: ResumeFacts): Promise<void> {
  const approval = await facts.approval();
  if (!approval.valid)
    refused(approval.code ?? "VES_APPROVAL_STALE", "The approval is no longer valid; plan the task again");
}

async function assertSuspensionHolds(
  facts: ResumeFacts,
  suspended: NonNullable<ResumeFacts["suspended"]>,
  current: Awaited<ReturnType<ResumeFacts["worktree"]>>
): Promise<void> {
  await requireValidApproval(facts);
  if (current?.changeDigest !== suspended.changeDigest || current?.commitCountSinceBase !== 0)
    refused("VES_EXECUTOR_WORKTREE_DRIFT", "The worktree changed while the run was suspended");
}

async function assertVerificationHolds(
  facts: ResumeFacts,
  verification: NonNullable<ResumeFacts["suspendedAtVerification"]>
): Promise<void> {
  await requireValidApproval(facts);
  if (!(await verification.taskCommitHolds()))
    refused("VES_TASK_COMMIT_DRIFT", "The task commit or its branch changed while the run was suspended");
}
