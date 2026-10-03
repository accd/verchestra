import { Graph, Swarm, type MultiAgentResult } from "@strands-agents/sdk/multiagent";
import {
  coordinationErrorCode,
  type CoordinationEngine,
  type CoordinationEngineInput,
  type CoordinationEngineOutcome,
  type CoordinationNodeRunner,
  type CoordinationPlan
} from "@verchestra/application";

import { structuralAgent } from "./structural-agent.ts";

type GraphPlan = Extract<CoordinationPlan, { readonly mode: "graph" }>;
type SwarmPlan = Extract<CoordinationPlan, { readonly mode: "swarm" }>;

const ORCHESTRATOR_ID = "verchestra";
// why: every node is handed the run's input, and a structural agent ignores
// it (SSI-06), so it names nothing.
const ENGINE_INPUT = "verchestra coordinated run";
// why: the executor's own duration stop is what ends a run that runs out of
// time; the SDK's timers are a backstop just past it, never the cause.
const TIMEOUT_GRACE_MS = 1_000;

// invariant: SSI-09. Concurrency and steps come from the approved plan and its
// limits; the run and node timeouts from the remaining duration budget. None
// is left at the SDK's default of no limit.
function graphOf(plan: GraphPlan, runner: CoordinationNodeRunner, timeout: number): Graph {
  return new Graph({
    id: ORCHESTRATOR_ID,
    nodes: plan.nodes.map((node) => structuralAgent(plan, node, runner)),
    edges: plan.edges.map((edge): [string, string] => [edge.from, edge.to]),
    maxConcurrency: plan.limits.concurrency,
    maxSteps: plan.nodes.length,
    timeout,
    nodeTimeout: timeout
  });
}

// invariant: SSI-09 and SSI-45. A swarm takes at most its handoff limit plus
// its first node in steps; repetitive-handoff detection stays off, so the
// handoff limit is the only stop the plan did not choose.
function swarmOf(plan: SwarmPlan, runner: CoordinationNodeRunner, timeout: number): Swarm {
  return new Swarm({
    id: ORCHESTRATOR_ID,
    nodes: plan.nodes.map((node) => structuralAgent(plan, node, runner)),
    start: plan.start,
    maxSteps: plan.limits.maxHandoffs + 1,
    timeout,
    nodeTimeout: timeout,
    repetitiveHandoffDetectionWindow: 0,
    repetitiveHandoffMinUniqueAgents: 0
  });
}

// invariant: the SDK orchestrator of a graph or swarm plan, bounded by the
// remaining duration budget plus the grace; mode `agent` never reaches it.
export function strandsOrchestrator(
  plan: CoordinationPlan,
  runner: CoordinationNodeRunner,
  remainingMs: number
): Graph | Swarm {
  const timeout = Math.max(1, Math.ceil(remainingMs)) + TIMEOUT_GRACE_MS;
  if (plan.mode === "graph") return graphOf(plan, runner, timeout);
  if (plan.mode === "swarm") return swarmOf(plan, runner, timeout);
  throw new Error("VES_COORDINATION_ENGINE_FAILED");
}

// invariant: SSI-10. An SDK status is compared as a literal and becomes an
// engine outcome; `INTERRUPTED`, resumable in the SDK, is a coordination
// failure here and never a workflow state.
export function strandsOutcome(
  result: Pick<MultiAgentResult, "status" | "results">,
  signal: AbortSignal
): CoordinationEngineOutcome {
  const status: string = result.status;
  if (status === "COMPLETED") return { status: "completed" };
  if (signal.aborted) return { status: "cancelled" };
  if (status === "INTERRUPTED") return { status: "failed", code: "VES_COORDINATION_INTERRUPTED" };
  const failed = result.results.find((entry) => (entry.status as string) === "FAILED");
  return { status: "failed", code: coordinationErrorCode(failed?.error) };
}

// why: the SDK throws, rather than returns, when it reaches a step limit or a
// timeout; the message is the only thing that tells them apart.
function thrown(error: unknown, signal: AbortSignal): CoordinationEngineOutcome {
  if (signal.aborted) return { status: "cancelled" };
  const message = error instanceof Error ? error.message : "";
  if (message.includes("swarm reached step limit")) return { status: "failed", code: "VES_COORDINATION_HANDOFF_LIMIT" };
  if (message.includes("max steps reached") || message.includes("wall-clock budget"))
    return { status: "failed", code: "VES_COORDINATION_LIMIT" };
  return { status: "failed", code: coordinationErrorCode(error) };
}

// invariant: AD-068. The engine for `graph` and `swarm`: the SDK orders the
// nodes and nothing else. Every node is a structural agent over the
// coordinated driver's runner, which enforces order, destinations, scopes,
// the single writer, and every limit itself.
export class StrandsCoordinationEngine implements CoordinationEngine {
  async run(input: CoordinationEngineInput): Promise<CoordinationEngineOutcome> {
    let built: Graph | Swarm;
    try {
      built = strandsOrchestrator(input.plan, input.runner, input.timeoutMs);
    } catch {
      return { status: "failed", code: "VES_COORDINATION_ENGINE_FAILED" };
    }
    if (input.signal.aborted) return { status: "cancelled" };
    try {
      return strandsOutcome(await built.invoke(ENGINE_INPUT, { cancelSignal: input.signal }), input.signal);
    } catch (error) {
      return thrown(error, input.signal);
    }
  }
}
