// invariant: SSI-28. The approval binds the whole normalized execution
// descriptor: a change of any executable element of a v2 request (mode, node
// identifier, driver, model, instructions, description, scope, input, edge,
// start, handoff target, or limit) changes the binding digest the human types
// back. Each case below changes one element of a request that still plans.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { planSurface } from "../../apps/vestra-cli/src/task/task-plan.ts";
import { normalizeTaskRequest } from "../../packages/application/src/index.ts";
import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import { boundPlan } from "../helpers/task-plan-fixture.mjs";
import { validTaskRequestV2 } from "../helpers/task-request-fixture.mjs";
import { contextManifest, planRecord } from "../helpers/task-run-record-fixture.mjs";

const sha256 = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const nodeOf = (request, nodeId) => request.execution.nodes.find((node) => node.nodeId === nodeId);

// why: a swarm of three, so a handoff can be redirected to another declared
// node and the request still plans.
function swarmOfThree() {
  const request = validTaskRequestV2("swarm");
  request.execution.nodes.push({ ...structuredClone(nodeOf(request, "reviewer")), nodeId: "tester" });
  return request;
}

function changed(base, change) {
  const request = structuredClone(base());
  change(request);
  return request;
}

const graph = () => validTaskRequestV2("graph");
const elements = [
  ["the mode", () => validTaskRequestV2("agent"), (r) => Object.assign(r.execution, { mode: "graph", edges: [] })],
  [
    "a node identifier",
    graph,
    (r) => {
      nodeOf(r, "review").nodeId = "check";
      r.execution.edges[1].to = "check";
    }
  ],
  ["a node driver", graph, (r) => (nodeOf(r, "review").driver = { driverId: "claude-code", model: "claude-sonnet-5" })],
  ["a node model", graph, (r) => (nodeOf(r, "build").driver.model = "claude-opus-5")],
  ["node instructions", graph, (r) => (nodeOf(r, "build").instructions = "Do the build step another way.")],
  ["a node description", graph, (r) => (nodeOf(r, "build").description = "Writes the greeting change")],
  ["a read scope", graph, (r) => (nodeOf(r, "plan").readScope = ["packages/app/src"])],
  ["a write scope", graph, (r) => (nodeOf(r, "build").writeScope = ["packages/app/src", "packages/app/test"])],
  ["an input", graph, (r) => (nodeOf(r, "review").inputs = ["build"])],
  ["an edge", graph, (r) => r.execution.edges.push({ from: "plan", to: "review" })],
  ["the swarm start", swarmOfThree, (r) => (r.execution.start = "reviewer")],
  ["a handoff target", swarmOfThree, (r) => (r.execution.handoffs[0].to = ["tester"])],
  ...Object.entries({
    concurrency: 2,
    maxNodes: 65,
    maxEdges: 129,
    maxSwarmAgents: 9,
    maxHandoffs: 33,
    nodeResultBytes: 65_537,
    runResultBytes: 262_145
  }).map(([name, value]) => [`the ${name} limit`, graph, (r) => (r.execution.limits = { [name]: value })])
];

const bindingOf = async (request) => (await boundPlan(normalizeTaskRequest(request))).approvalRequest.bindingDigest;

for (const [name, base, change] of elements) {
  test(`changing ${name} of a v2 request changes the binding digest`, async () => {
    assert.notEqual(await bindingOf(changed(base, change)), await bindingOf(base()));
  });
}

test("each change binds a digest of its own", async () => {
  const digests = await Promise.all(elements.map(([, base, change]) => bindingOf(changed(base, change))));
  assert.equal(new Set(digests).size, elements.length);
});

// why: SSI-29's plan-time half. The descriptor a later start executes is the
// one the Execution Package seals as its execution contract, and the approval
// binds that package.
test("the Execution Package seals the whole normalized v2 request as its execution contract", async () => {
  const request = normalizeTaskRequest(validTaskRequestV2("graph"));
  const { pkg, approvalRequest } = await boundPlan(request);
  assert.equal(pkg.payload.executionContractDigest, sha256(canonicalizeJsonV2(request)));
  assert.deepEqual(pkg.payload.decisions, [
    { artifactId: "decision:task-request", digest: sha256(canonicalizeJsonV2(request)) }
  ]);
  assert.equal(approvalRequest.review.packageDigest, `sha256:${pkg.payloadDigest}`);
  assert.equal(approvalRequest.binding.packageDigest, `sha256:${pkg.payloadDigest}`);
});

test("a v2 review names one passport per node and the verifier, both providers, and the writer capability", async () => {
  const { approvalRequest } = await boundPlan(normalizeTaskRequest(validTaskRequestV2("graph")));
  assert.deepEqual(approvalRequest.review.selectedPassports, [
    "codex:gpt-5.2-codex",
    "claude-code:claude-sonnet-5",
    "codex:gpt-5.2-codex",
    "codex:gpt-5.2-codex"
  ]);
  assert.deepEqual(approvalRequest.review.destinations, ["provider:anthropic", "provider:openai"]);
  assert.deepEqual(approvalRequest.review.capabilities, ["worktree-write"]);
});

test("a v2 plan presents its whole descriptor, every limit explicit, in place of a single implementer", async () => {
  const request = normalizeTaskRequest(validTaskRequestV2("swarm"));
  const { intent, approvalRequest } = await boundPlan(request);
  const surface = planSurface(
    { ...planRecord({ request }), approvalIntent: intent, approvalRequest },
    contextManifest(),
    true,
    { implementer: "subscription", verifier: "subscription" }
  );
  assert.equal(Object.hasOwn(surface, "implementer"), false);
  assert.deepEqual(surface.execution, {
    ...validTaskRequestV2("swarm").execution,
    limits: {
      concurrency: 1,
      maxNodes: 64,
      maxEdges: 128,
      maxSwarmAgents: 8,
      maxHandoffs: 32,
      nodeResultBytes: 65_536,
      runResultBytes: 262_144
    }
  });
  assert.deepEqual(surface.verifier, { driverId: "codex", model: "gpt-5.2-codex" });
  assert.equal(surface.bindingDigest, approvalRequest.bindingDigest);
  assert.deepEqual(surface.review.selectedPassports, [
    "claude-code:claude-sonnet-5",
    "codex:gpt-5.2-codex",
    "codex:gpt-5.2-codex"
  ]);
});
