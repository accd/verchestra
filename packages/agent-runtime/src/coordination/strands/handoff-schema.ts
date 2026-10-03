import {
  COORDINATION_COMPLETE,
  HANDOFF_MESSAGE_CHARACTERS,
  NODE_RESULT_SUMMARY_CHARACTERS,
  handoffTargets,
  type CoordinationPlan
} from "@verchestra/application";
import { z } from "zod";

// invariant: the application's node-result schema (`nodeResultSchema`) in
// Zod, so the provider CLIs, the application, and the SDK check one shape; a
// contract test holds the draft-7 projection of each equal to it.
export function nodeResultZod(plan: CoordinationPlan, nodeId: string) {
  const base = {
    outcome: z.enum(["done", "blocked"]),
    summary: z.string().max(NODE_RESULT_SUMMARY_CHARACTERS)
  };
  if (plan.mode !== "swarm") return z.strictObject(base);
  return z.strictObject({
    ...base,
    next: z.enum(destinations(plan, nodeId)),
    message: z.string().max(HANDOFF_MESSAGE_CHARACTERS)
  });
}

// invariant: never empty, because the completion value always ends the list.
function destinations(plan: CoordinationPlan, nodeId: string): [string, ...string[]] {
  const list: string[] = [...handoffTargets(plan, nodeId), COORDINATION_COMPLETE];
  return list as [string, ...string[]];
}

// invariant: SSI-43. The destination check a structural agent applies before
// it answers the SDK: `next` is one of the node's declared targets or the
// completion value, and nothing else is in the decision. The message was
// already bounded by the application's validator, by characters.
export function handoffDecisionSchema(plan: CoordinationPlan, nodeId: string) {
  return z.strictObject({ next: z.enum(destinations(plan, nodeId)), message: z.string() });
}
