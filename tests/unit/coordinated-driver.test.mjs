// invariant: the coordinated driver (AD-068) runs a coordination plan behind
// the executor's driver port and enforces, itself, what no engine is trusted
// with: node order and destinations, the single writer, write-scope
// narrowing, every limit, an explicit end, and the node ledger. Engines and
// node sessions here are labelled in-memory fakes.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertStructuredAnswer,
  COORDINATION_COMPLETE,
  NativeAgentEngine
} from "../../packages/application/src/index.ts";
import {
  aborted,
  control,
  coordinatedDriver,
  coordinatedRequest,
  DONE,
  driverRequest,
  MemoryPayloads,
  MemoryRecords,
  rejectsWith,
  resultBytes,
  scriptedEngine,
  twoIndependent,
  WORKTREE
} from "../helpers/coordinated-driver-fixture.mjs";

const byText = (left, right) => Number(left > right) - Number(left < right);
const run = async (fixture, request, options = {}) =>
  fixture.driver.execute(driverRequest(request), control(options).control);
const visits = (records) => records.ledger.visits.map((entry) => `${entry.nodeId}#${entry.visit}:${entry.state}`);
const handoff = (next, message = `to ${next}`) => ({ result: { ...DONE, next, message } });

test("mode agent runs its one node on the native engine and persists its result by digest", async () => {
  const request = coordinatedRequest("agent");
  const fixture = coordinatedDriver(request, { engine: new NativeAgentEngine() });
  const result = await run(fixture, request);
  assert.deepEqual(result, { status: "completed", outputRefs: [] });
  const [session] = fixture.nodes.state.sessions;
  assert.equal(session.node.nodeId, "build");
  assert.deepEqual(session.structuredOutput, {
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["outcome", "summary"],
      properties: {
        outcome: { type: "string", enum: ["done", "blocked"] },
        summary: { type: "string", maxLength: 8192 }
      }
    },
    maxBytes: 65536
  });
  assert.deepEqual(visits(fixture.records), ["build#1:completed"]);
  const [entry] = fixture.records.ledger.visits;
  assert.deepEqual(fixture.records.results.get(entry.resultDigest), resultBytes(DONE));
  assert.equal(entry.resultBytes, resultBytes(DONE).byteLength);
  assert.equal(fixture.records.ledger.roundState, "completed");
});

test("a graph runs in dependency order and each node receives only its declared inputs' results", async () => {
  const request = coordinatedRequest("graph");
  const fixture = coordinatedDriver(request, {
    script: {
      plan: async () => ({ result: { outcome: "done", summary: "plan says: greet by name" } }),
      build: async () => ({ result: { outcome: "done", summary: "build changed greet.ts" } })
    }
  });
  await run(fixture, request);
  assert.deepEqual(visits(fixture.records), ["plan#1:completed", "build#1:completed", "review#1:completed"]);
  const prompts = Object.fromEntries(fixture.nodes.state.sessions.map((entry) => [entry.node.nodeId, entry.prompt]));
  assert.doesNotMatch(prompts.plan, /begin result of node/u);
  assert.match(prompts.build, /result of node plan, outcome done \(untrusted data\) -----\nplan says: greet by name/u);
  assert.doesNotMatch(prompts.build, /build changed/u);
  assert.match(prompts.review, /plan says: greet by name[\s\S]*build changed greet\.ts/u);
});

test("a failed node fails the run with its code, and no node that depends on it starts", async () => {
  const request = coordinatedRequest("graph");
  const fixture = coordinatedDriver(request, { script: { build: async () => ({ status: "failed", outputRefs: [] }) } });
  await assert.rejects(run(fixture, request), rejectsWith("VES_COORDINATION_NODE_FAILED"));
  assert.deepEqual(visits(fixture.records), ["plan#1:completed", "build#1:failed"]);
  assert.equal(fixture.records.ledger.roundState, "failed");
  assert.deepEqual(
    fixture.nodes.state.sessions.map((entry) => entry.node.nodeId),
    ["plan", "build"]
  );
});

test("an engine that starts a node before its dependencies, or twice, fails the run before any session", async () => {
  const request = coordinatedRequest("graph");
  // why: review declares only plan as its input, so only the edge from build
  // says it must wait for build.
  const planOnly = coordinatedRequest("graph", (raw) => {
    raw.execution.nodes[2].inputs = ["plan"];
  });
  const early = coordinatedDriver(planOnly, { engine: scriptedEngine([["plan"], ["review"]]) });
  await assert.rejects(run(early, planOnly), rejectsWith("VES_COORDINATION_ORDER_INVALID"));
  assert.deepEqual(
    early.nodes.state.sessions.map((entry) => entry.node.nodeId),
    ["plan"]
  );
  const twice = coordinatedDriver(request, { engine: scriptedEngine([["plan"], ["plan"]]) });
  await assert.rejects(run(twice, request), rejectsWith("VES_COORDINATION_LIMIT"));
  assert.equal(twice.nodes.state.sessions.length, 1);
  const outside = coordinatedDriver(request, { engine: scriptedEngine([["intruder"]]) });
  await assert.rejects(run(outside, request), rejectsWith("VES_COORDINATION_ORDER_INVALID"));
  assert.equal(outside.nodes.state.sessions.length, 0);
});

test("more nodes at once than the concurrency limit fail the run with VES_COORDINATION_LIMIT", async () => {
  const request = twoIndependent(coordinatedRequest("graph"), false, 1);
  const slow = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { result: DONE };
  };
  const fixture = coordinatedDriver(request, {
    engine: scriptedEngine([["left", "right"]]),
    script: { left: slow, right: slow }
  });
  await assert.rejects(run(fixture, request), rejectsWith("VES_COORDINATION_LIMIT"));
  assert.equal(fixture.nodes.state.maximumActive, 1);
});

test("two writers made ready at once never run together: the writer mutex serializes them", async () => {
  const request = twoIndependent(coordinatedRequest("graph"), true, 2);
  const fixture = coordinatedDriver(request, {
    engine: scriptedEngine([["left", "right"]]),
    script: Object.fromEntries(
      ["left", "right"].map((nodeId) => [
        nodeId,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { result: DONE };
        }
      ])
    )
  });
  await run(fixture, request);
  assert.equal(fixture.nodes.state.sessions.length, 2);
  assert.equal(fixture.nodes.state.maximumWriters, 1);
});

test("a node writes only inside its own write scope; the refusal comes before the executor", async () => {
  const request = coordinatedRequest("graph");
  const attempts = {};
  const tryWrite =
    (nodeId, path, operation = "write") =>
    async ({ control: nodeControl }) => {
      try {
        await nodeControl.invokeTool({
          requestId: `${nodeId}:${path}`,
          taskId: request.task.taskId,
          capabilityGrantRef: "grant:writer:001",
          operation,
          targetPaths: [path],
          payloadRef: "payload:none"
        });
        attempts[`${nodeId}:${path}`] = "passed";
      } catch (error) {
        attempts[`${nodeId}:${path}`] = error.code;
      }
      return { result: DONE };
    };
  const fixture = coordinatedDriver(request, {
    script: {
      plan: tryWrite("plan", "packages/app/src/greet.ts"),
      build: async (context) => {
        await tryWrite("build", "packages/app/test/greet.test.ts")(context);
        await tryWrite("build", "packages/app/src//greet.ts", "delete")(context);
        return tryWrite("build", "packages/app/src/greet.ts")(context);
      }
    }
  });
  const executor = control();
  await fixture.driver.execute(driverRequest(request), executor.control);
  assert.deepEqual(attempts, {
    "plan:packages/app/src/greet.ts": "VES_COORDINATION_SCOPE_DENIED",
    "build:packages/app/test/greet.test.ts": "VES_COORDINATION_SCOPE_DENIED",
    "build:packages/app/src//greet.ts": "passed",
    "build:packages/app/src/greet.ts": "passed"
  });
  assert.deepEqual(
    executor.state.tools.map((entry) => entry.targetPaths[0]),
    ["packages/app/src//greet.ts", "packages/app/src/greet.ts"]
  );
  assert.equal(fixture.records.ledger.visits.find((entry) => entry.nodeId === "build").receiptCount, 2);
});

test("a result over the node limit, or over the run limit, is refused before anything is persisted", async () => {
  const big = { outcome: "done", summary: "x".repeat(200) };
  const small = coordinatedRequest("graph", (raw) => {
    raw.execution.limits = { nodeResultBytes: 100 };
  });
  const node = coordinatedDriver(small, { script: { plan: async () => ({ result: big }) } });
  await assert.rejects(run(node, small), rejectsWith("VES_COORDINATION_RESULT_TOO_LARGE"));
  assert.equal(node.records.results.size, 0);
  assert.deepEqual(visits(node.records), ["plan#1:failed"]);
  assert.equal(node.records.ledger.visits[0].failureCode, "VES_COORDINATION_RESULT_TOO_LARGE");
  const total = coordinatedRequest("graph", (raw) => {
    raw.execution.limits = { runResultBytes: 450 };
  });
  const runLimit = coordinatedDriver(total, {
    script: { plan: async () => ({ result: big }), build: async () => ({ result: big }) }
  });
  await assert.rejects(run(runLimit, total), rejectsWith("VES_COORDINATION_RESULT_TOO_LARGE"));
  assert.equal(runLimit.records.results.size, 1);
  assert.deepEqual(visits(runLimit.records), ["plan#1:completed", "build#1:failed"]);
});

test("a malformed result fails its node with VES_COORDINATION_RESULT_INVALID and nothing is persisted", async () => {
  const request = coordinatedRequest("graph");
  const fixture = coordinatedDriver(request, {
    script: { plan: async () => ({ bytes: new TextEncoder().encode('{"outcome":"done"}') }) }
  });
  await assert.rejects(run(fixture, request), rejectsWith("VES_COORDINATION_RESULT_INVALID"));
  assert.equal(fixture.records.results.size, 0);
  const missing = coordinatedDriver(request, {
    script: { plan: async () => ({ status: "completed", outputRefs: [] }) }
  });
  await assert.rejects(run(missing, request), rejectsWith("VES_COORDINATION_RESULT_INVALID"));
});

// invariant: SSI-46 and SSI-47 at the node adapters' seam. A failed session
// whose driver could not hand on a structured result fails its node with the
// coordination code; any other ending is left to the adapter.
test("a failed session's structured-output code becomes the coordination refusal, and nothing else does", () => {
  for (const [codes, expected] of [
    [["VES_CLAUDE_STRUCTURED_OUTPUT_MISSING"], "VES_COORDINATION_RESULT_INVALID"],
    [["VES_CODEX_STRUCTURED_OUTPUT_MISSING"], "VES_COORDINATION_RESULT_INVALID"],
    [["VES_CODEX_STRUCTURED_OUTPUT_INVALID"], "VES_COORDINATION_RESULT_INVALID"],
    [["VES_CLAUDE_STRUCTURED_OUTPUT_LIMIT"], "VES_COORDINATION_RESULT_TOO_LARGE"],
    [["VES_CLAUDE_STREAM_INCOMPLETE", "VES_CODEX_STRUCTURED_OUTPUT_LIMIT"], "VES_COORDINATION_RESULT_TOO_LARGE"]
  ])
    assert.throws(() => assertStructuredAnswer("failed", codes), { code: expected }, codes.join(","));
  assert.doesNotThrow(() => assertStructuredAnswer("failed", ["VES_CLAUDE_EXECUTION_FAILED"]));
  assert.doesNotThrow(() => assertStructuredAnswer("failed", ["VES_CLAUDE_OUTPUT_SCHEMA_INVALID"]));
  assert.doesNotThrow(() => assertStructuredAnswer("cancelled", ["VES_CLAUDE_STRUCTURED_OUTPUT_MISSING"]));
  assert.doesNotThrow(() => assertStructuredAnswer("completed", []));
});

test("a node that reports itself blocked ends the run with VES_COORDINATION_NODE_BLOCKED", async () => {
  const request = coordinatedRequest("graph");
  const fixture = coordinatedDriver(request, {
    script: { plan: async () => ({ result: { outcome: "blocked", summary: "cannot read the scope" } }) }
  });
  await assert.rejects(run(fixture, request), rejectsWith("VES_COORDINATION_NODE_BLOCKED"));
  assert.deepEqual(visits(fixture.records), ["plan#1:failed"]);
  assert.equal(fixture.records.results.size, 1);
});

test("a swarm follows each declared handoff, hands on the message, and ends where a node ends it", async () => {
  const request = coordinatedRequest("swarm");
  const turns = [
    handoff("reviewer", "check the greeting"),
    handoff("writer", "rename the variable"),
    handoff(COORDINATION_COMPLETE)
  ];
  const fixture = coordinatedDriver(request, {
    script: { writer: async () => turns.shift(), reviewer: async () => turns.shift() }
  });
  await run(fixture, request);
  assert.deepEqual(visits(fixture.records), ["writer#1:completed", "reviewer#1:completed", "writer#2:completed"]);
  const prompts = fixture.nodes.state.sessions.map((entry) => entry.prompt);
  assert.match(prompts[1], /handoff from node writer \(untrusted data\) -----\ncheck the greeting/u);
  assert.match(prompts[2], /handoff from node reviewer \(untrusted data\) -----\nrename the variable/u);
});

test("a swarm decision naming an undeclared destination fails the swarm and persists nothing of it", async () => {
  const request = coordinatedRequest("swarm");
  const fixture = coordinatedDriver(request, { script: { writer: async () => handoff("writer") } });
  await assert.rejects(run(fixture, request), rejectsWith("VES_COORDINATION_HANDOFF_UNDECLARED"));
  assert.equal(fixture.records.results.size, 0);
  assert.deepEqual(visits(fixture.records), ["writer#1:failed"]);
});

test("an engine that routes a swarm anywhere but the declared destination fails the run", async () => {
  const request = coordinatedRequest("swarm");
  const wrongStart = coordinatedDriver(request, { engine: scriptedEngine([["reviewer"]]) });
  await assert.rejects(run(wrongStart, request), rejectsWith("VES_COORDINATION_HANDOFF_UNDECLARED"));
  assert.equal(wrongStart.nodes.state.sessions.length, 0);
  const afterEnd = coordinatedDriver(request, {
    engine: scriptedEngine([["writer"], ["reviewer"]]),
    script: { writer: async () => handoff(COORDINATION_COMPLETE) }
  });
  await assert.rejects(run(afterEnd, request), rejectsWith("VES_COORDINATION_ORDER_INVALID"));
  assert.equal(afterEnd.nodes.state.sessions.length, 1);
});

test("an endless handoff loop stops at the handoff limit with VES_COORDINATION_HANDOFF_LIMIT", async () => {
  const request = coordinatedRequest("swarm", (raw) => {
    raw.execution.limits = { maxHandoffs: 2 };
  });
  const fixture = coordinatedDriver(request, {
    script: { writer: async () => handoff("reviewer"), reviewer: async () => handoff("writer") }
  });
  await assert.rejects(run(fixture, request), rejectsWith("VES_COORDINATION_HANDOFF_LIMIT"));
  assert.deepEqual(visits(fixture.records), ["writer#1:completed", "reviewer#1:completed", "writer#2:failed"]);
  assert.equal(fixture.nodes.state.sessions.length, 3);
});

test("an engine that claims completion before the plan's end fails the run with VES_COORDINATION_INCOMPLETE", async () => {
  const graph = coordinatedRequest("graph");
  const short = coordinatedDriver(graph, { engine: scriptedEngine([["plan"], ["build"]]) });
  await assert.rejects(run(short, graph), rejectsWith("VES_COORDINATION_INCOMPLETE"));
  const swarm = coordinatedRequest("swarm");
  const pending = coordinatedDriver(swarm, {
    engine: scriptedEngine([["writer"]]),
    script: { writer: async () => handoff("reviewer") }
  });
  await assert.rejects(run(pending, swarm), rejectsWith("VES_COORDINATION_INCOMPLETE"));
  assert.equal(pending.records.ledger.roundState, "failed");
});

test("a resumed round replays its completed visits without a session and runs the rest", async () => {
  const request = coordinatedRequest("graph");
  const records = new MemoryRecords();
  const payloads = new MemoryPayloads();
  const interrupted = coordinatedDriver(request, {
    records,
    payloads,
    engine: scriptedEngine([["plan"]], { outcome: { status: "cancelled" } }),
    script: { plan: async () => ({ result: { outcome: "done", summary: "the plan" } }) }
  });
  assert.equal((await run(interrupted, request)).status, "cancelled");
  assert.equal(records.ledger.roundState, "running");
  const resumed = coordinatedDriver(request, { records, payloads });
  await run(resumed, request);
  assert.deepEqual(
    resumed.nodes.state.sessions.map((entry) => entry.node.nodeId),
    ["build", "review"]
  );
  assert.match(
    resumed.nodes.state.sessions[0].prompt,
    /result of node plan, outcome done \(untrusted data\) -----\nthe plan/u
  );
  assert.deepEqual(visits(records), ["plan#1:completed", "build#1:completed", "review#1:completed"]);
  assert.equal(records.ledger.round, 1);
});

test("a resumed swarm replays its handoffs in order and continues from the pending destination", async () => {
  const request = coordinatedRequest("swarm");
  const records = new MemoryRecords();
  const payloads = new MemoryPayloads();
  const first = coordinatedDriver(request, {
    records,
    payloads,
    engine: scriptedEngine([["writer"]], { outcome: { status: "cancelled" } }),
    script: { writer: async () => handoff("reviewer", "review it") }
  });
  await run(first, request);
  const resumed = coordinatedDriver(request, {
    records,
    payloads,
    script: { reviewer: async () => handoff(COORDINATION_COMPLETE) }
  });
  await run(resumed, request);
  assert.deepEqual(
    resumed.nodes.state.sessions.map((entry) => entry.node.nodeId),
    ["reviewer"]
  );
  assert.match(resumed.nodes.state.sessions[0].prompt, /handoff from node writer \(untrusted data\) -----\nreview it/u);
});

test("a visit that started and never ended is uncertain: nothing runs again", async () => {
  const request = coordinatedRequest("graph");
  const records = new MemoryRecords();
  records.ledger = {
    schemaVersion: 1,
    mode: "graph",
    round: 1,
    roundState: "running",
    visits: [
      { round: 1, nodeId: "plan", visit: 1, state: "started", startedAt: "2026-10-03T11:00:00.000Z", receiptCount: 0 }
    ]
  };
  const fixture = coordinatedDriver(request, { records });
  await assert.rejects(run(fixture, request), rejectsWith("VES_TASK_NODE_UNCERTAIN"));
  assert.equal(fixture.nodes.state.sessions.length, 0);
  assert.deepEqual(visits(records), ["plan#1:uncertain"]);
});

test("a finished round is followed by a new one for the next attempt, which receives the gate feedback", async () => {
  const request = coordinatedRequest("agent");
  const records = new MemoryRecords();
  await run(coordinatedDriver(request, { records, engine: new NativeAgentEngine() }), request);
  const repair = coordinatedDriver(request, { records, engine: new NativeAgentEngine(), feedback: "gate:unit failed" });
  await run(repair, request);
  assert.equal(records.ledger.round, 2);
  assert.deepEqual(
    records.ledger.visits.map((entry) => `${entry.round}:${entry.nodeId}`),
    ["1:build", "2:build"]
  );
  assert.match(
    repair.nodes.state.sessions[0].prompt,
    /gate failure of the previous attempt \(untrusted data\) -----\ngate:unit failed/u
  );
});

test("cancel reaches every running node: their signal aborts and each node driver is cancelled", async () => {
  const request = twoIndependent(coordinatedRequest("graph"), false, 2);
  let started = 0;
  const allStarted = Promise.withResolvers();
  const waitForCancel = async ({ control: nodeControl }) => {
    started += 1;
    if (started === 2) allStarted.resolve();
    await aborted(nodeControl.signal);
    return { status: "cancelled", outputRefs: [] };
  };
  const fixture = coordinatedDriver(request, {
    engine: scriptedEngine([["left", "right"]]),
    script: { left: waitForCancel, right: waitForCancel }
  });
  const pending = run(fixture, request);
  await allStarted.promise;
  await fixture.driver.cancel(WORKTREE);
  assert.deepEqual(await pending, { status: "cancelled", outputRefs: [] });
  assert.deepEqual(fixture.nodes.state.cancels.map((entry) => entry.nodeId).sort(byText), ["left", "right"]);
});

test("the executor's own signal stops every node as well", async () => {
  const request = coordinatedRequest("agent");
  const caller = new AbortController();
  const fixture = coordinatedDriver(request, {
    engine: new NativeAgentEngine(),
    script: {
      build: async ({ control: nodeControl }) => {
        caller.abort("user cancel");
        await aborted(nodeControl.signal);
        return { status: "cancelled", outputRefs: [] };
      }
    }
  });
  const result = await fixture.driver.execute(driverRequest(request), control({ signal: caller.signal }).control);
  assert.equal(result.status, "cancelled");
});

test("usage and checkpoints of every node reach the executor's control, filed under the node", async () => {
  const request = coordinatedRequest("graph");
  const nodeWork =
    (tokens) =>
    async ({ session, control: nodeControl }) => {
      nodeControl.reportUsage({ model: session.node.driver.model, inputTokens: tokens, outputTokens: 1 });
      await nodeControl.checkpoint("driver-finished", { outcome: "completed" });
      return { result: DONE };
    };
  const fixture = coordinatedDriver(request, {
    script: { plan: nodeWork(10), build: nodeWork(20), review: nodeWork(30) }
  });
  const executor = control();
  await fixture.driver.execute(driverRequest(request), executor.control);
  assert.deepEqual(
    executor.state.usage.map((event) => event.inputTokens),
    [10, 20, 30]
  );
  assert.deepEqual(
    executor.state.checkpoints.map((entry) => entry.stage),
    ["node:plan:1:driver-finished", "node:build:1:driver-finished", "node:review:1:driver-finished"]
  );
});

test("the ledger records only identifiers, counts, instants, digests, and codes", async () => {
  const request = coordinatedRequest("graph");
  const digest = `sha256:${"7".repeat(64)}`;
  const fixture = coordinatedDriver(request, {
    changeDigest: async () => digest,
    script: { review: async () => ({ result: { outcome: "done", summary: "token sk-ant-secret in /Users/owner" } }) }
  });
  await run(fixture, request);
  const text = JSON.stringify(fixture.records.ledger);
  assert.doesNotMatch(text, /sk-ant|\/Users|summary|prompt|session/u);
  for (const entry of fixture.records.ledger.visits) {
    assert.deepEqual(Object.keys(entry).sort(byText), [
      "changeDigestBefore",
      "endedAt",
      "nodeId",
      "receiptCount",
      "resultBytes",
      "resultDigest",
      "round",
      "startedAt",
      "state",
      "visit"
    ]);
    assert.equal(entry.changeDigestBefore, digest);
  }
});
