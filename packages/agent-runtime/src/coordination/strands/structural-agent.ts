import type { AgentNodeOptions, SwarmNodeDefinition } from "@strands-agents/sdk/multiagent";
import {
  COORDINATION_COMPLETE,
  coordinationErrorCode,
  type CoordinationNode,
  type CoordinationNodeAnswer,
  type CoordinationNodeRunner,
  type CoordinationPlan
} from "@verchestra/application";

import { handoffDecisionSchema } from "./handoff-schema.ts";

// why: the SDK's own agent types are exported from its root entry only, which
// this adapter never imports (F1); they are read off the subpath's node types.
type InvokableAgent = Exclude<SwarmNodeDefinition, AgentNodeOptions>;
type InvokeOptions = NonNullable<Parameters<InvokableAgent["invoke"]>[1]>;
type AgentResult = Awaited<ReturnType<InvokableAgent["invoke"]>>;
type SdkHandoff = { readonly agentId?: string; readonly message: string };

const UNDECLARED = "VES_COORDINATION_HANDOFF_UNDECLARED";

// invariant: SSI-43, SSI-44. A swarm decision reaches the SDK only after the
// node's own destination check and the check of the schema the SDK passed.
function sdkHandoff(
  answer: CoordinationNodeAnswer,
  decision: ReturnType<typeof handoffDecisionSchema>,
  options: InvokeOptions | undefined
): SdkHandoff {
  const checked = decision.safeParse(answer.handoff);
  if (!checked.success) throw new Error(UNDECLARED);
  const { next, message } = checked.data;
  const handoff: SdkHandoff = next === COORDINATION_COMPLETE ? { message } : { agentId: next, message };
  if (options?.structuredOutputSchema?.safeParse(handoff).success === false) throw new Error(UNDECLARED);
  return handoff;
}

// invariant: SSI-07. What the SDK receives is one text block naming the node
// result's payload reference, never provider output text.
function agentResult(token: string, structuredOutput: SdkHandoff | undefined, options: InvokeOptions | undefined) {
  return {
    type: "agentResult",
    stopReason: "endTurn",
    lastMessage: { role: "assistant", content: [{ type: "textBlock", text: token }] },
    invocationState: options?.invocationState ?? {},
    ...(structuredOutput === undefined ? {} : { structuredOutput })
  } as unknown as AgentResult;
}

// why: a structural agent streams no events of its own; its stream ends at
// once with the node's result.
async function* withoutEvents(result: Promise<AgentResult>): AsyncGenerator<never, AgentResult> {
  yield* [];
  return await result;
}

// invariant: SSI-03, SSI-04, SSI-05. A structural agent satisfies the SDK's
// invokable-agent shape and is never a Strands `Agent`: it has no model, no
// tools, no session, and no context to preserve. It ignores the input the SDK
// assembled (SSI-06) and asks Verchestra's node runner to run its node; a
// failure reaches the SDK as an error carrying only a stable code (SSI-08).
export function structuralAgent(
  plan: CoordinationPlan,
  node: CoordinationNode,
  runner: CoordinationNodeRunner
): InvokableAgent {
  const decision = plan.mode === "swarm" ? handoffDecisionSchema(plan, node.nodeId) : undefined;
  const invoke = async (_assembled: unknown, options?: InvokeOptions): Promise<AgentResult> => {
    try {
      const answer = await runner.run({ nodeId: node.nodeId });
      const handoff = decision === undefined ? undefined : sdkHandoff(answer, decision, options);
      return agentResult(answer.resultToken, handoff, options);
    } catch (error) {
      throw new Error(coordinationErrorCode(error));
    }
  };
  return {
    id: node.nodeId,
    invoke,
    stream: (assembled: unknown, options?: InvokeOptions) => withoutEvents(invoke(assembled, options))
  };
}
