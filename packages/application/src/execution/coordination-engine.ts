import type { CoordinationPlan } from "./coordination-plan.ts";

// invariant: the engine port (AD-068). An engine only orders the nodes of an
// approved plan; it never runs a provider, reads a credential, or touches the
// worktree. Every node it starts goes through the coordinated driver's runner,
// which owns the ledger, the scopes, the writer rule, and every limit.

export interface CoordinationNodeCall {
  readonly nodeId: string;
}

export interface CoordinationNodeAnswer {
  readonly nodeId: string;
  // invariant: a token naming the node result's payload reference, never
  // provider output text (SSI-07).
  readonly resultToken: string;
  // invariant: present exactly on a swarm node's answer. `next` is a declared
  // target or COORDINATION_COMPLETE; the message is bounded and untrusted.
  readonly handoff?: { readonly next: string; readonly message: string };
}

export interface CoordinationNodeRunner {
  run(call: CoordinationNodeCall): Promise<CoordinationNodeAnswer>;
}

export type CoordinationEngineOutcome =
  | { readonly status: "completed" }
  | { readonly status: "failed"; readonly code: string }
  | { readonly status: "cancelled" };

export interface CoordinationEngineInput {
  readonly plan: CoordinationPlan;
  readonly runner: CoordinationNodeRunner;
  readonly signal: AbortSignal;
  // invariant: the run's remaining duration budget, finite and positive; an
  // engine bounds its whole run and every node by it (SSI-09).
  readonly timeoutMs: number;
}

export interface CoordinationEngine {
  run(input: CoordinationEngineInput): Promise<CoordinationEngineOutcome>;
}

const STABLE_CODE = /^VES_[A-Z0-9_]{1,96}$/u;

// invariant: the stable code an error carries, as its `code` or, for an error
// an engine raised with only a message, as that message; nothing else.
export function stableErrorCode(error: unknown): string | undefined {
  const code = (error as { readonly code?: unknown } | undefined)?.code;
  if (typeof code === "string" && STABLE_CODE.test(code)) return code;
  const message = (error as { readonly message?: unknown } | undefined)?.message;
  return typeof message === "string" && STABLE_CODE.test(message) ? message : undefined;
}

export function coordinationErrorCode(error: unknown): string {
  return stableErrorCode(error) ?? "VES_COORDINATION_ENGINE_FAILED";
}

// why: decision D5. Strands adds no coordination to a single node, so mode
// `agent` runs here, and the SDK is loaded only for Graph and Swarm.
export class NativeAgentEngine implements CoordinationEngine {
  async run(input: CoordinationEngineInput): Promise<CoordinationEngineOutcome> {
    const [node] = input.plan.nodes;
    if (input.plan.mode !== "agent" || node === undefined)
      return { status: "failed", code: "VES_COORDINATION_ENGINE_FAILED" };
    if (input.signal.aborted) return { status: "cancelled" };
    try {
      await input.runner.run({ nodeId: node.nodeId });
      return { status: "completed" };
    } catch (error) {
      return input.signal.aborted ? { status: "cancelled" } : { status: "failed", code: coordinationErrorCode(error) };
    }
  }
}
