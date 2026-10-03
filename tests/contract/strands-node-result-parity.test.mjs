// invariant: SSI-43. The Strands adapter's Zod node-result schemas and the
// application's closed draft-07 schemas are one shape: for every node of every
// mode, the draft-7 projection of the Zod schema equals the application's
// schema, apart from the `$schema` header Zod adds. The provider CLIs, the
// application validator, and the SDK therefore check the same thing.
import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "../../packages/agent-runtime/node_modules/zod/index.js";
import { handoffDecisionSchema, nodeResultZod } from "../../packages/agent-runtime/src/coordination/strands/index.ts";
import { nodeResultSchema, readNodeResult } from "../../packages/application/src/index.ts";
import { coordinatedRequest, resultBytes, withExecution } from "../helpers/coordinated-driver-fixture.mjs";

function projection(schema) {
  const { $schema, ...rest } = z.toJSONSchema(schema, { target: "draft-7" });
  assert.equal($schema, "http://json-schema.org/draft-07/schema#");
  return rest;
}

const plans = () => {
  const swarm = coordinatedRequest("swarm");
  return [
    coordinatedRequest("agent").execution,
    coordinatedRequest("graph").execution,
    swarm.execution,
    // why: a swarm node with no handoff entry may only end the swarm.
    withExecution(swarm, { handoffs: [{ from: "writer", to: ["reviewer"] }] }).execution
  ];
};

test("every node's Zod schema projects to exactly the application's schema", () => {
  let compared = 0;
  for (const plan of plans())
    for (const node of plan.nodes) {
      assert.deepEqual(projection(nodeResultZod(plan, node.nodeId)), nodeResultSchema(plan, node.nodeId), node.nodeId);
      compared += 1;
    }
  assert.equal(compared, 8);
});

test("the Zod schemas and the application validator accept and refuse the same answers", () => {
  const swarm = coordinatedRequest("swarm").execution;
  const graph = coordinatedRequest("graph").execution;
  const cases = [
    [graph, "plan", { outcome: "done", summary: "ok" }, true],
    [graph, "plan", { outcome: "done", summary: "ok", extra: 1 }, false],
    [graph, "plan", { outcome: "maybe", summary: "ok" }, false],
    [graph, "plan", { outcome: "done", summary: "x".repeat(8193) }, false],
    [swarm, "writer", { outcome: "done", summary: "ok", next: "reviewer", message: "m" }, true],
    [swarm, "writer", { outcome: "done", summary: "ok", next: "<complete>", message: "m" }, true],
    [swarm, "writer", { outcome: "done", summary: "ok", next: "writer", message: "m" }, false],
    [swarm, "writer", { outcome: "done", summary: "ok", next: "reviewer", message: "m".repeat(4097) }, false],
    [swarm, "writer", { outcome: "done", summary: "ok", message: "m" }, false]
  ];
  for (const [plan, nodeId, answer, valid] of cases) {
    assert.equal(nodeResultZod(plan, nodeId).safeParse(answer).success, valid, JSON.stringify(answer));
    let accepted = true;
    try {
      readNodeResult(resultBytes(answer), plan, nodeId);
    } catch {
      accepted = false;
    }
    assert.equal(accepted, valid, JSON.stringify(answer));
  }
});

test("the runtime destination check lists exactly the node's declared targets and the completion value", () => {
  const swarm = coordinatedRequest("swarm").execution;
  const decision = handoffDecisionSchema(swarm, "reviewer");
  assert.deepEqual(projection(decision).properties.next, { type: "string", enum: ["writer", "<complete>"] });
  assert.equal(decision.safeParse({ next: "writer", message: "m" }).success, true);
  assert.equal(decision.safeParse({ next: "reviewer", message: "m" }).success, false);
  assert.equal(decision.safeParse({ next: "writer", message: "m", agentId: "writer" }).success, false);
});
