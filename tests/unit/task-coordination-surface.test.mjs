// invariant: SSI-30, SSI-32, and D4 at the presentation's own interface. The
// topology of a coordinated run names, for each node in plan order, the
// passport the approval admits, whether it writes under the coordination
// plan's own rule, and where its work goes next; a swarm also names its start.
// A run stopped in IMPLEMENTING goes on by one action: a plain resume, the
// resume that reconciles its one uncertain node, or none when several are
// uncertain, since a resume reconciles one node and refuses the others.
import assert from "node:assert/strict";
import { test } from "node:test";

import { continuation, coordinationTopology } from "../../apps/vestra-cli/src/task/task-coordination-surface.ts";
import { normalizeTaskRequest } from "../../packages/application/src/index.ts";
import { validTaskRequestV2 } from "../helpers/task-request-fixture.mjs";

const RUN = "run_018f0b6d-7b1a-7abc-8def-612345678901";
const CLAUDE = "claude-code:claude-sonnet-5";
const CODEX = "codex:gpt-5.2-codex";
const digest = (letter) => `sha256:${letter.repeat(64)}`;

const topologyOf = (request) => coordinationTopology(normalizeTaskRequest(request));

test("a graph's topology names each node's passport, role, and the nodes its edges lead to, in plan order", () => {
  assert.deepEqual(topologyOf(validTaskRequestV2("graph")), {
    mode: "graph",
    nodes: [
      { nodeId: "plan", passport: CODEX, role: "reader", to: ["build"] },
      { nodeId: "build", passport: CLAUDE, role: "writer", to: ["review"] },
      { nodeId: "review", passport: CODEX, role: "reader", to: [] }
    ]
  });
});

test("a swarm's topology names its start and each node's declared handoff destinations", () => {
  assert.deepEqual(topologyOf(validTaskRequestV2("swarm")), {
    mode: "swarm",
    start: "writer",
    nodes: [
      { nodeId: "writer", passport: CLAUDE, role: "writer", to: ["reviewer"] },
      { nodeId: "reviewer", passport: CODEX, role: "reader", to: ["writer"] }
    ]
  });
});

test("an agent's topology is its one node, which hands nothing on", () => {
  assert.deepEqual(topologyOf(validTaskRequestV2("agent")), {
    mode: "agent",
    nodes: [{ nodeId: "build", passport: CLAUDE, role: "writer", to: [] }]
  });
});

// why: the role follows the coordination plan's writer rule, not the driver
// alone: a Claude Code node with an empty write scope only reads.
test("a Claude Code node with no write scope is a reader", () => {
  const request = validTaskRequestV2("graph");
  request.execution.nodes.push({ ...structuredClone(request.execution.nodes[1]), nodeId: "check", writeScope: [] });
  request.execution.edges.push({ from: "build", to: "check" });
  const check = topologyOf(request).nodes.find((node) => node.nodeId === "check");
  assert.deepEqual(check, { nodeId: "check", passport: CLAUDE, role: "reader", to: [] });
  assert.deepEqual(topologyOf(request).nodes[1].to, ["review", "check"]);
});

test("a run with no uncertain node goes on by a plain resume", () => {
  assert.deepEqual(continuation(RUN, []), [`vestra task resume --run-id ${RUN}`]);
});

test("a run with one uncertain node goes on only by the resume that reconciles it", () => {
  assert.deepEqual(continuation(RUN, [{ digest: digest("c") }]), [
    `vestra task resume --run-id ${RUN} --reconcile ${digest("c")}`
  ]);
});

test("a run with several uncertain nodes has no resume that would be accepted", () => {
  assert.deepEqual(continuation(RUN, [{ digest: digest("c") }, { digest: digest("d") }]), []);
});
