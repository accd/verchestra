import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { SchemaRegistry } from "../../packages/contracts/src/schema-registry.ts";
import { canonicalTaskRequest, normalizeTaskRequest, TaskRequestError } from "../../packages/application/src/index.ts";
import { validTaskRequestV2 } from "../helpers/task-request-fixture.mjs";

const registry = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));
const schemaText = (version) =>
  readFile(new URL(`../../schemas/task-request/${version}.schema.json`, import.meta.url), "utf8");
const [v1, v2] = [JSON.parse(await schemaText(1)), JSON.parse(await schemaText(2))];

function schemaAccepts(request) {
  try {
    registry.validate("task-request", "2", request);
    return true;
  } catch (error) {
    assert.equal(error.code, "VES_SCHEMA_VALIDATION_FAILED");
    return false;
  }
}

test("task-request@2 is registered beside version 1 and accepts one example per mode", () => {
  assert.ok(registry.list().includes("task-request@1"));
  assert.ok(registry.list().includes("task-request@2"));
  for (const mode of ["agent", "graph", "swarm"]) assert.equal(schemaAccepts(validTaskRequestV2(mode)), true, mode);
});

test("version 2 keeps every version 1 member except the single driver, and adds the execution descriptor", () => {
  assert.equal(v2.$id, "ves://task-request/2");
  assert.equal(v2.title, "TaskRequestV2");
  assert.equal(v2.additionalProperties, false);
  for (const member of ["sourceRevision", "task", "gates", "budgets", "onGateFailure", "verifier", "instructions"])
    assert.deepEqual(v2.properties[member], v1.properties[member], member);
  assert.equal(Object.hasOwn(v2.properties, "driver"), false);
  assert.deepEqual(v2.required, [...v1.required.filter((member) => member !== "driver"), "execution"]);
  assert.deepEqual(
    Object.keys(v2.properties).sort((left, right) => Number(left > right) - Number(left < right)),
    [
      "budgets",
      "execution",
      "gates",
      "instructions",
      "onGateFailure",
      "schemaVersion",
      "sourceRevision",
      "task",
      "verifier"
    ]
  );
});

// why: the descriptor is a vendor-neutral contract (SSI-11). Naming an SDK, a
// schema library, or a provider SDK would tie the approved shape to one.
test("the version 2 contract names no SDK, schema library, or provider SDK", async () => {
  const text = (await schemaText(2)).toLowerCase();
  for (const name of ["strands", "zod", "ajv", "@anthropic-ai", "openai", "bedrock", "@modelcontextprotocol"])
    assert.equal(text.includes(name), false, name);
});

test("the generated contracts carry a TaskRequestV2 type named by the schema title", async () => {
  const generated = await readFile(new URL("../../packages/contracts/src/generated.ts", import.meta.url), "utf8");
  assert.match(generated, /^export interface TaskRequest \{$/mu);
  assert.match(generated, /^export interface TaskRequestV2 \{\n {2}schemaVersion: 2;$/mu);
  assert.ok(
    generated.indexOf("export interface TaskRequestV2 {") > generated.indexOf("export interface TaskRequest {")
  );
});

// why: the defaults and hard ceilings SSI-37 and SSI-38 state, spelled out
// here from the specification rather than read from the module under test.
const DEFAULT_LIMITS = Object.freeze({
  concurrency: 1,
  maxNodes: 64,
  maxEdges: 128,
  maxSwarmAgents: 8,
  maxHandoffs: 32,
  nodeResultBytes: 64 * 1024,
  runResultBytes: 256 * 1024
});
const CEILINGS = Object.freeze({
  concurrency: 4,
  maxNodes: 256,
  maxEdges: 512,
  maxSwarmAgents: 16,
  maxHandoffs: 128,
  nodeResultBytes: 256 * 1024,
  runResultBytes: 1024 * 1024
});
const MODES = ["agent", "graph", "swarm"];

function mutated(mode, mutate) {
  const request = structuredClone(validTaskRequestV2(mode));
  mutate(request);
  return request;
}

const nodeOf = (request, nodeId) => request.execution.nodes.find((node) => node.nodeId === nodeId);

function rejectedWith(request, code) {
  assert.throws(
    () => normalizeTaskRequest(request),
    (error) => {
      assert.ok(error instanceof TaskRequestError);
      assert.equal(error.code, code);
      return true;
    }
  );
}

// why: a reader node beside one writer; enough of them builds the large
// descriptors the count limits need without tripping another rule.
function reader(nodeId) {
  return { ...structuredClone(validTaskRequestV2("graph").execution.nodes[0]), nodeId };
}

function sized(mode, count, limits, edges = []) {
  return mutated(mode, (request) => {
    const writer = { ...structuredClone(validTaskRequestV2("agent").execution.nodes[0]), nodeId: "n0" };
    request.execution.nodes = [writer, ...Array.from({ length: count - 1 }, (_, index) => reader(`n${index + 1}`))];
    if (mode === "graph") request.execution.edges = edges;
    if (mode === "swarm") {
      request.execution.start = "n0";
      request.execution.handoffs = [{ from: "n0", to: ["n1"] }];
    }
    if (limits !== undefined) request.execution.limits = limits;
  });
}

// why: the first `count` edges of the complete acyclic graph on n0..n17, in
// which n0 (the one writer) precedes every other node.
function forwardEdges(count) {
  const edges = [];
  for (let from = 0; from < 18; from += 1)
    for (let to = from + 1; to < 18; to += 1) edges.push({ from: `n${from}`, to: `n${to}` });
  return edges.slice(0, count);
}

test("the normalizer returns the complete descriptor with every limit explicit at its default", () => {
  for (const mode of MODES) {
    const input = validTaskRequestV2(mode);
    const normalized = normalizeTaskRequest(input);
    assert.equal(normalized.schemaVersion, 2, mode);
    assert.deepEqual(normalized.execution, { ...input.execution, limits: DEFAULT_LIMITS }, mode);
    assert.equal(Object.hasOwn(normalized, "driver"), false, mode);
    for (const member of ["sourceRevision", "task", "gates", "budgets", "onGateFailure", "verifier", "instructions"])
      assert.deepEqual(normalized[member], input[member], `${mode} ${member}`);
    assert.equal(Object.isFrozen(normalized.execution.nodes[0].writeScope), true, mode);
    assert.equal(Object.isFrozen(normalized.execution.limits), true, mode);
    input.execution.nodes[0].readScope.push("packages/app/src/mutated-after-normalize");
    assert.deepEqual(normalized.execution.nodes[0].readScope, ["packages/app/src", "packages/app/test"], mode);
  }
});

test("a declared limit keeps its declared value and every other limit takes its default", () => {
  const request = mutated("graph", (value) => (value.execution.limits = { concurrency: 2, runResultBytes: 4096 }));
  assert.equal(schemaAccepts(request), true);
  assert.deepEqual(normalizeTaskRequest(request).execution.limits, {
    ...DEFAULT_LIMITS,
    concurrency: 2,
    runResultBytes: 4096
  });
});

// why: a graph of one writer and no edge fits every limit down to 1, so only
// the limit's own bounds decide; a limit below a topology is refused above.
const oneNodeGraph = (limits) =>
  mutated("graph", (r) => {
    r.execution.nodes = [nodeOf(r, "build")];
    r.execution.nodes[0].inputs = [];
    r.execution.edges = [];
    r.execution.limits = limits;
  });

test("each limit is accepted at and below its ceiling, and above its default when declared", () => {
  for (const [name, ceiling] of Object.entries(CEILINGS)) {
    const fallback = DEFAULT_LIMITS[name];
    for (const value of new Set([1, Math.max(1, fallback - 1), fallback, fallback + 1, ceiling - 1, ceiling])) {
      const request = oneNodeGraph({ [name]: value });
      assert.equal(schemaAccepts(request), true, `${name}=${value}`);
      assert.equal(normalizeTaskRequest(request).execution.limits[name], value, `${name}=${value}`);
    }
  }
});

test("each limit above its ceiling, below one, or not an integer is refused by the schema and the normalizer", () => {
  for (const [name, ceiling] of Object.entries(CEILINGS))
    for (const value of [ceiling + 1, 0, 1.5, "2"]) {
      const request = oneNodeGraph({ [name]: value });
      assert.equal(schemaAccepts(request), false, `${name}=${value}`);
      rejectedWith(request, "VES_TASK_REQUEST_EXECUTION_INVALID");
    }
});

test("a topology larger than a default limit plans only when the descriptor raises that limit", () => {
  const cases = [
    ["graph nodes", (limits) => sized("graph", 65, limits), { maxNodes: 65 }, sized("graph", 64)],
    ["graph edges", (limits) => sized("graph", 18, limits, forwardEdges(129)), { maxEdges: 129 }, null],
    ["swarm agents", (limits) => sized("swarm", 9, limits), { maxSwarmAgents: 9 }, sized("swarm", 8)]
  ];
  for (const [name, build, raise, atDefault] of cases) {
    assert.equal(schemaAccepts(build(undefined)), true, name);
    rejectedWith(build(undefined), "VES_TASK_REQUEST_EXECUTION_INVALID");
    assert.equal(normalizeTaskRequest(build(raise)).execution.limits[Object.keys(raise)[0]], Object.values(raise)[0]);
    if (atDefault !== null) assert.equal(normalizeTaskRequest(atDefault).schemaVersion, 2, name);
  }
  assert.equal(normalizeTaskRequest(sized("graph", 18, undefined, forwardEdges(128))).execution.edges.length, 128);
});

test("a topology at a hard ceiling plans when declared, and one beyond it is refused by both", () => {
  assert.equal(normalizeTaskRequest(sized("graph", 256, { maxNodes: 256 })).execution.nodes.length, 256);
  assert.equal(normalizeTaskRequest(sized("swarm", 16, { maxSwarmAgents: 16 })).execution.nodes.length, 16);
  const edges = sized("graph", 33, { maxEdges: 512 }, []);
  for (let from = 0; from < 33 && edges.execution.edges.length < 512; from += 1)
    for (let to = from + 1; to < 33 && edges.execution.edges.length < 512; to += 1)
      edges.execution.edges.push({ from: `n${from}`, to: `n${to}` });
  assert.equal(normalizeTaskRequest(edges).execution.edges.length, 512);
  const beyond = [
    sized("graph", 257, { maxNodes: 256 }),
    sized("swarm", 17, { maxSwarmAgents: 16 }),
    mutated("graph", (r) => (r.execution.edges = [...edges.execution.edges, { from: "n31", to: "n32" }]))
  ];
  beyond[2].execution.nodes = edges.execution.nodes;
  beyond[2].execution.limits = { maxEdges: 512 };
  for (const request of beyond) {
    assert.equal(schemaAccepts(request), false);
    rejectedWith(request, "VES_TASK_REQUEST_EXECUTION_INVALID");
  }
});

// SSI-24: no member outside the schema, at any depth; authentication,
// credentials, billing, executables, and endpoints have no member at all.
const unknownMembers = [
  ["an API key at the top level", "graph", (r) => (r.apiKey = "value")],
  ["an authentication mode at the top level", "graph", (r) => (r.authMode = "api-key")],
  ["a billing mode at the top level", "graph", (r) => (r.billing = "extra-usage")],
  ["the v1 single driver", "graph", (r) => (r.driver = { driverId: "claude-code", model: "claude-sonnet-5" })],
  ["an endpoint on the descriptor", "graph", (r) => (r.execution.endpoint = "https://example.invalid")],
  ["an executable on a node", "graph", (r) => (r.execution.nodes[0].executable = "/usr/bin/codex")],
  ["a credential on a node", "swarm", (r) => (r.execution.nodes[0].credential = "value")],
  ["an endpoint on a node driver", "graph", (r) => (r.execution.nodes[1].driver.endpoint = "https://example.invalid")],
  ["an authentication mode on a node driver", "agent", (r) => (r.execution.nodes[0].driver.auth = "api-key")],
  ["an unknown member on an edge", "graph", (r) => (r.execution.edges[0].condition = "always")],
  ["an unknown member on a handoff", "swarm", (r) => (r.execution.handoffs[0].condition = "always")],
  ["an unknown limit", "graph", (r) => (r.execution.limits = { unlimited: true })],
  ["an authentication mode on the verifier", "graph", (r) => (r.verifier.auth = "api-key")],
  ["an unknown task member", "graph", (r) => (r.task.shell = "bash")],
  ["an executable on a gate", "graph", (r) => (r.gates[0].executable = "/bin/sh")],
  ["a billing member in the budgets", "graph", (r) => (r.budgets.billing = "extra-usage")],
  ["an unknown repair member", "graph", (r) => (r.onGateFailure.retryForever = true)],
  ["edges on an agent", "agent", (r) => (r.execution.edges = [])],
  ["handoffs on an agent", "agent", (r) => (r.execution.handoffs = [{ from: "build", to: ["build"] }])],
  ["a start on a graph", "graph", (r) => (r.execution.start = "plan")],
  ["edges on a swarm", "swarm", (r) => (r.execution.edges = [])],
  ["a graph without edges", "graph", (r) => delete r.execution.edges],
  ["a swarm without handoffs", "swarm", (r) => delete r.execution.handoffs],
  ["a node without a write scope", "graph", (r) => delete r.execution.nodes[1].writeScope],
  ["a descriptor that is not an object", "graph", (r) => (r.execution = ["graph"])],
  ["a missing descriptor", "graph", (r) => delete r.execution]
];

for (const [name, mode, mutate] of unknownMembers) {
  test(`schema and normalizer both reject ${name} with VES_TASK_REQUEST_INVALID`, () => {
    const request = mutated(mode, mutate);
    assert.equal(schemaAccepts(request), false);
    rejectedWith(request, "VES_TASK_REQUEST_INVALID");
  });
}

// Shape rules inside the descriptor: the schema and the normalizer both refuse
// them, and the normalizer reports the stable code.
const shapeRejections = [
  ["an unknown mode", "graph", (r) => (r.execution.mode = "chain"), "VES_TASK_REQUEST_EXECUTION_INVALID"],
  ["an empty node list", "graph", (r) => (r.execution.nodes = []), "VES_TASK_REQUEST_EXECUTION_INVALID"],
  [
    "two nodes on an agent",
    "agent",
    (r) => r.execution.nodes.push(reader("plan")),
    "VES_TASK_REQUEST_EXECUTION_INVALID"
  ],
  ["one node in a swarm", "swarm", (r) => r.execution.nodes.pop(), "VES_TASK_REQUEST_EXECUTION_INVALID"],
  [
    "an upper-case node ID",
    "graph",
    (r) => (r.execution.nodes[0].nodeId = "Plan"),
    "VES_TASK_REQUEST_EXECUTION_INVALID"
  ],
  [
    "a node ID of 33 characters",
    "agent",
    (r) => (r.execution.nodes[0].nodeId = `b${"x".repeat(32)}`),
    "VES_TASK_REQUEST_EXECUTION_INVALID"
  ],
  [
    "a node ID that starts with a digit",
    "agent",
    (r) => (r.execution.nodes[0].nodeId = "1build"),
    "VES_TASK_REQUEST_EXECUTION_INVALID"
  ],
  [
    "an empty description",
    "agent",
    (r) => (r.execution.nodes[0].description = ""),
    "VES_TASK_REQUEST_EXECUTION_INVALID"
  ],
  [
    "a description with a newline",
    "agent",
    (r) => (r.execution.nodes[0].description = "a\nb"),
    "VES_TASK_REQUEST_EXECUTION_INVALID"
  ],
  [
    "a description above 256 characters",
    "agent",
    (r) => (r.execution.nodes[0].description = "d".repeat(257)),
    "VES_TASK_REQUEST_EXECUTION_INVALID"
  ],
  [
    "empty node instructions",
    "agent",
    (r) => (r.execution.nodes[0].instructions = ""),
    "VES_TASK_REQUEST_EXECUTION_INVALID"
  ],
  [
    "a NUL in node instructions",
    "agent",
    (r) => (r.execution.nodes[0].instructions = "a\u0000b"),
    "VES_TASK_REQUEST_EXECUTION_INVALID"
  ],
  [
    "a bidirectional override in node instructions",
    "agent",
    (r) => (r.execution.nodes[0].instructions = "a ‮b"),
    "VES_TASK_REQUEST_EXECUTION_INVALID"
  ],
  [
    "node instructions above 8192 characters",
    "agent",
    (r) => (r.execution.nodes[0].instructions = "i".repeat(8193)),
    "VES_TASK_REQUEST_EXECUTION_INVALID"
  ],
  [
    "a parent-traversing read scope",
    "graph",
    (r) => (r.execution.nodes[0].readScope = ["../outside"]),
    "VES_TASK_REQUEST_EXECUTION_INVALID"
  ],
  [
    "an absolute write scope",
    "agent",
    (r) => (r.execution.nodes[0].writeScope = ["/etc"]),
    "VES_TASK_REQUEST_EXECUTION_INVALID"
  ],
  [
    "a duplicate scope entry",
    "agent",
    (r) => (r.execution.nodes[0].readScope = ["packages/app/src", "packages/app/src"]),
    "VES_TASK_REQUEST_EXECUTION_INVALID"
  ],
  [
    "101 read scope entries",
    "agent",
    (r) => (r.execution.nodes[0].readScope = Array.from({ length: 101 }, (_, i) => `packages/app/src/${i}`)),
    "VES_TASK_REQUEST_EXECUTION_INVALID"
  ],
  [
    "a duplicate input",
    "graph",
    (r) => (nodeOf(r, "review").inputs = ["plan", "plan"]),
    "VES_TASK_REQUEST_EXECUTION_INVALID"
  ],
  [
    "a duplicate edge",
    "graph",
    (r) => r.execution.edges.push({ from: "plan", to: "build" }),
    "VES_TASK_REQUEST_EXECUTION_INVALID"
  ],
  [
    "an edge to a malformed node ID",
    "graph",
    (r) => (r.execution.edges[0].to = "Build"),
    "VES_TASK_REQUEST_EXECUTION_INVALID"
  ],
  ["a malformed swarm start", "swarm", (r) => (r.execution.start = "Writer"), "VES_TASK_REQUEST_EXECUTION_INVALID"],
  ["an empty handoff list", "swarm", (r) => (r.execution.handoffs = []), "VES_TASK_REQUEST_EXECUTION_INVALID"],
  ["a handoff with no target", "swarm", (r) => (r.execution.handoffs[0].to = []), "VES_TASK_REQUEST_EXECUTION_INVALID"],
  [
    "a handoff naming a target twice",
    "swarm",
    (r) => (r.execution.handoffs[0].to = ["reviewer", "reviewer"]),
    "VES_TASK_REQUEST_EXECUTION_INVALID"
  ],
  [
    "a swarm node that declares inputs",
    "swarm",
    (r) => (nodeOf(r, "reviewer").inputs = ["writer"]),
    "VES_TASK_REQUEST_EXECUTION_INVALID"
  ],
  [
    "a node driver other than Claude Code or Codex",
    "graph",
    (r) => (r.execution.nodes[1].driver.driverId = "opencode"),
    "VES_TASK_REQUEST_DRIVER_UNSUPPORTED"
  ],
  [
    "a verifier model on a Claude Code node",
    "agent",
    (r) => (r.execution.nodes[0].driver.model = "gpt-5.2-codex"),
    "VES_TASK_REQUEST_DRIVER_UNSUPPORTED"
  ],
  [
    "a Claude model on a Codex node",
    "graph",
    (r) => (r.execution.nodes[0].driver.model = "claude-sonnet-5"),
    "VES_TASK_REQUEST_DRIVER_UNSUPPORTED"
  ]
];

for (const [name, mode, mutate, code] of shapeRejections) {
  test(`schema and normalizer both reject ${name}`, () => {
    const request = mutated(mode, mutate);
    assert.equal(schemaAccepts(request), false);
    rejectedWith(request, code);
  });
}

const withProtected = (path) => (r) => (r.task.protectedPaths = [...r.task.protectedPaths, path]);

// why: with no input anywhere, only the cycle rule can refuse the edge; an
// input on a node of the cycle would be refused by the input rule instead.
const withEdgeAndNoInputs = (edge) => (r) => {
  r.execution.edges.push(edge);
  for (const node of r.execution.nodes) node.inputs = [];
};

// Cross-field rules a JSON Schema cannot express (SSI-25, SSI-26, SSI-27).
// The schema admits the shape; only the normalizer, which `task plan` always
// runs before any process starts, refuses it.
const crossFieldRejections = [
  ["a cycle", "graph", withEdgeAndNoInputs({ from: "review", to: "plan" })],
  ["an edge from a node to itself", "graph", withEdgeAndNoInputs({ from: "build", to: "build" })],
  ["a node no source reaches", "graph", withEdgeAndNoInputs({ from: "review", to: "build" })],
  ["an edge naming an unknown node", "graph", (r) => r.execution.edges.push({ from: "plan", to: "deploy" })],
  ["an input naming an unknown node", "graph", (r) => (nodeOf(r, "build").inputs = ["deploy"])],
  ["an input that is a descendant, not an ancestor", "graph", (r) => (nodeOf(r, "build").inputs = ["review"])],
  ["an input naming the node itself", "graph", (r) => (nodeOf(r, "build").inputs = ["build"])],
  ["an input on an agent", "agent", (r) => (r.execution.nodes[0].inputs = ["plan"])],
  ["a read scope outside the change scope", "graph", (r) => (nodeOf(r, "plan").readScope = ["packages/other"])],
  ["a write scope outside the change scope", "graph", (r) => (nodeOf(r, "build").writeScope = ["packages/app/lib"])],
  [
    "a letter-case variant of the change scope",
    "agent",
    (r) => (r.execution.nodes[0].writeScope = ["packages/App/src"])
  ],
  ["a write scope that contains a protected path", "graph", withProtected("packages/app/src/keys")],
  ["a write scope inside a protected path", "agent", withProtected("packages/app")],
  ["a write scope over a case variant of a protected path", "agent", withProtected("PACKAGES/APP/SRC")],
  ["a write scope naming Git metadata", "agent", (r) => (r.execution.nodes[0].writeScope = ["packages/app/src/.git"])],
  ["a Codex node with a write scope", "graph", (r) => (nodeOf(r, "review").writeScope = ["packages/app/test"])],
  [
    "a Codex node with a write scope in a swarm",
    "swarm",
    (r) => (nodeOf(r, "reviewer").writeScope = ["packages/app/test"])
  ],
  [
    "two writers not ordered by a path",
    "graph",
    (r) => {
      r.execution.nodes.push({
        ...structuredClone(nodeOf(r, "build")),
        nodeId: "tests",
        writeScope: ["packages/app/test"]
      });
      r.execution.edges.push({ from: "plan", to: "tests" });
    }
  ],
  ["a graph in which no node writes", "graph", (r) => (nodeOf(r, "build").writeScope = [])],
  ["an agent that does not write", "agent", (r) => (r.execution.nodes[0].writeScope = [])],
  ["a swarm in which no node writes", "swarm", (r) => (nodeOf(r, "writer").writeScope = [])],
  ["a duplicate node ID", "graph", (r) => (nodeOf(r, "review").nodeId = "plan")],
  ["a swarm start naming an unknown node", "swarm", (r) => (r.execution.start = "deploy")],
  ["a handoff to an unknown node", "swarm", (r) => (r.execution.handoffs[0].to = ["deploy"])],
  ["a handoff from an unknown node", "swarm", (r) => (r.execution.handoffs[1].from = "deploy")],
  ["a handoff from a node to itself", "swarm", (r) => (r.execution.handoffs[0].to = ["reviewer", "writer"])],
  [
    "a node listed twice as a handoff source",
    "swarm",
    (r) => r.execution.handoffs.push({ from: "writer", to: ["reviewer"] })
  ],
  ["node instructions above 16384 UTF-8 bytes", "agent", (r) => (r.execution.nodes[0].instructions = "€".repeat(8192))]
];

for (const [name, mode, mutate] of crossFieldRejections) {
  test(`the normalizer rejects ${name} that the schema shape admits`, () => {
    const request = mutated(mode, mutate);
    assert.equal(schemaAccepts(request), true);
    rejectedWith(request, "VES_TASK_REQUEST_EXECUTION_INVALID");
  });
}

test("the normalizer rejects an unpriced node model that the schema shape admits", () => {
  const request = mutated("graph", (r) => (nodeOf(r, "build").driver.model = "claude-unpriced-9"));
  assert.equal(schemaAccepts(request), true);
  rejectedWith(request, "VES_TASK_REQUEST_MODEL_UNPRICED");
});

test("two writers ordered by a path plan, and a swarm may hold several writers", () => {
  const ordered = mutated("graph", (r) => {
    r.execution.nodes.push({
      ...structuredClone(nodeOf(r, "build")),
      nodeId: "tests",
      writeScope: ["packages/app/test"]
    });
    r.execution.edges.push({ from: "build", to: "tests" });
  });
  assert.deepEqual(
    normalizeTaskRequest(ordered).execution.nodes.map((node) => node.writeScope),
    [[], ["packages/app/src"], [], ["packages/app/test"]]
  );
  const writers = mutated("swarm", (r) => {
    r.execution.nodes.push({
      ...structuredClone(nodeOf(r, "writer")),
      nodeId: "tester",
      writeScope: ["packages/app/test"]
    });
    r.execution.handoffs[1].to = ["writer", "tester"];
  });
  assert.equal(normalizeTaskRequest(writers).execution.nodes.length, 3);
});

test("the canonical encoding of a v2 request carries its whole descriptor", () => {
  const canonical = JSON.parse(canonicalTaskRequest(validTaskRequestV2("swarm")));
  assert.deepEqual(canonical.execution, { ...validTaskRequestV2("swarm").execution, limits: DEFAULT_LIMITS });
});
