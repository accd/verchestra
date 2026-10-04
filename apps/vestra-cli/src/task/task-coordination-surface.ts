// why: SSI-30 and SSI-32. What the task commands show of a coordinated run is
// computed here once: `plan` shows its topology, and `status`, `start`, and
// `resume` show the same nodes, the same uncertain nodes, and the same way on.
// Every value is part of the data a command returns, so its text and JSON forms
// carry the same members with the same values.
import {
  isWriterNode,
  type CoordinationLedger,
  type CoordinationPlan,
  type NodeVisit,
  type NormalizedTaskRequestV2
} from "@verchestra/application";
import type { NodeGitWorktreeAdapter } from "@verchestra/platform-node";

import type { CoordinatedPlan } from "./task-plan-record.ts";
import { inspectMarkedWorktree, nodeUncertainties, type NodeUncertainty } from "./task-resumption.ts";
import type { ExecutorCheckpoint, RunRecord } from "./task-run-record.ts";

// why: where a node's work may go next in the approved descriptor: the targets
// of its graph edges, or the destinations its swarm handoff declares. Every
// swarm node may also end the swarm, so that reserved value is not listed.
function destinations(plan: CoordinationPlan, nodeId: string): readonly string[] {
  if (plan.mode === "graph") return plan.edges.filter((edge) => edge.from === nodeId).map((edge) => edge.to);
  if (plan.mode === "swarm") return plan.handoffs.find((handoff) => handoff.from === nodeId)?.to ?? [];
  return [];
}

// invariant: one entry per node, in plan order: the passport the approval
// admits for it, whether it writes under the coordination plan's own rule,
// and where its work goes next.
function topologyNodes(plan: CoordinationPlan) {
  return plan.nodes.map((node) => ({
    nodeId: node.nodeId,
    passport: `${node.driver.driverId}:${node.driver.model}`,
    role: isWriterNode(node) ? "writer" : "reader",
    to: destinations(plan, node.nodeId)
  }));
}

// invariant: SSI-30. The topology `plan` presents beside the descriptor the
// approval binds; a swarm also names the node it starts at.
export function coordinationTopology(request: NormalizedTaskRequestV2) {
  const plan = request.execution;
  return {
    mode: plan.mode,
    ...(plan.mode === "swarm" ? { start: plan.start } : {}),
    nodes: topologyNodes(plan)
  };
}

// invariant: SSI-32. A node's state in the current round is that of its
// latest visit, `pending` before its first; its visit count counts visit
// numbers, so a node run again in place of an unsettled visit is not counted
// twice; its result is the latest it completed with.
function nodeState(nodeId: string, round: readonly NodeVisit[]) {
  const visits = round.filter((visit) => visit.nodeId === nodeId);
  return {
    state: visits.at(-1)?.state ?? "pending",
    visits: new Set(visits.map((visit) => visit.visit)).size,
    resultDigest: visits.findLast((visit) => visit.state === "completed")?.resultDigest ?? null
  };
}

function currentRound(ledger: CoordinationLedger | undefined): readonly NodeVisit[] {
  return ledger === undefined ? [] : ledger.visits.filter((visit) => visit.round === ledger.round);
}

type Worktrees = Pick<NodeGitWorktreeAdapter, "inspect">;

// why: what a resume would settle is computed against the worktree it would
// resume on: the suspended checkpoint's change, or the marked worktree of an
// interrupted run. Read only; nothing is created.
async function resumeChange(
  plan: CoordinatedPlan,
  runRecord: RunRecord,
  executor: ExecutorCheckpoint | undefined,
  ledger: CoordinationLedger | undefined,
  worktrees: Worktrees
): Promise<string | undefined> {
  if (executor?.stage === "suspended" || ledger?.roundState !== "running") return executor?.changeDigest;
  const inspected = await inspectMarkedWorktree(runRecord, worktrees, plan.request.sourceRevision);
  return inspected?.changeDigest;
}

// invariant: SSI-32. Each node of the topology with its state, visit count,
// and result digest, and every node a resume could not run again on its own,
// with the digest of its uncertainty record.
export async function coordinationStatus(
  plan: CoordinatedPlan,
  runRecord: RunRecord,
  executor: ExecutorCheckpoint | undefined,
  worktrees: Worktrees
) {
  const ledger = await runRecord.loadCoordinationLedger();
  const change = await resumeChange(plan, runRecord, executor, ledger, worktrees);
  const uncertain = nodeUncertainties(plan.runId, ledger, change)
    .filter((node) => node.effect === "possible")
    .map(({ effect, ...node }) => {
      void effect;
      return node;
    });
  const round = currentRound(ledger);
  return {
    mode: plan.request.execution.mode,
    round: ledger?.round ?? 0,
    roundState: ledger?.roundState ?? "none",
    nodes: topologyNodes(plan.request.execution).map((node) => ({ ...node, ...nodeState(node.nodeId, round) })),
    uncertain
  };
}

export type CoordinationStatus = Awaited<ReturnType<typeof coordinationStatus>>;

// why: D4 and SSI-66. How a run that stopped in IMPLEMENTING goes on. With no
// uncertain node, a plain resume. With one, the resume that reconciles it, by
// the digest the owner types back; the plain resume would be refused. With
// several, none: a resume reconciles one node and is refused while another
// stays uncertain, so only `vestra task cancel` is left.
export function continuation(runId: string, uncertain: readonly Pick<NodeUncertainty, "digest">[]): readonly string[] {
  const [only, ...others] = uncertain;
  if (only === undefined) return [`vestra task resume --run-id ${runId}`];
  return others.length === 0 ? [`vestra task resume --run-id ${runId} --reconcile ${only.digest}`] : [];
}
