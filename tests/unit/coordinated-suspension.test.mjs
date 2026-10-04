// invariant: SSI-59..61 and SSI-65..67 (AD-071, D4). A provider's usage
// signal from any node suspends a coordinated run instead of failing it: no
// further node starts, every running node is stopped and recorded, the round
// stays open for a resume, and the suspension names only the signal's code,
// the provider, the time, and the window and reset the provider reported. A
// resume replays completed visits, runs again on its own a visit that left no
// effect, and runs again a visit that may have left one only when the owner
// typed back the digest of its uncertainty record. Node sessions and engines
// are labelled in-memory fakes.
import assert from "node:assert/strict";
import { test } from "node:test";

import { uncertaintyRecord, unsettledVisits } from "../../packages/application/src/index.ts";
import {
  aborted,
  canonicalRecordDigest,
  control,
  coordinatedDriver,
  coordinatedRequest,
  DONE,
  driverRequest,
  MemoryPayloads,
  MemoryRecords,
  rejectsWith,
  resultBytes,
  twoIndependent,
  withExecution
} from "../helpers/coordinated-driver-fixture.mjs";

const byText = (left, right) => Number(left > right) - Number(left < right);
const AT = "2026-10-03T12:00:00.000Z";
const RESET = "2026-10-03T17:00:00.000Z";
const run = (fixture, request, options = {}) =>
  fixture.driver.execute(driverRequest(request), control(options).control);
const states = (records) =>
  records.ledger.visits.map((entry) => `${entry.nodeId}:${entry.state}:${entry.failureCode}`).sort(byText);

// why: the shape the Claude Code and Codex node adapters raise (T4): the code,
// and the window and reset the provider reported, already in their grammar;
// `null` stands for a reset the provider did not report.
function quota(scope = "five_hour", resetsAt = RESET) {
  return Object.assign(new Error("quota"), {
    code: "VES_DRIVER_QUOTA_EXHAUSTED",
    quota: resetsAt === null ? { scope } : { scope, resetsAt }
  });
}

test("a quota signal suspends the run: no further node starts and the nodes still running stop", async () => {
  const base = twoIndependent(coordinatedRequest("graph"), false, 2);
  const request = withExecution(base, {
    nodes: [...base.execution.nodes, { ...base.execution.nodes[0], nodeId: "after" }]
  });
  const otherStarted = Promise.withResolvers();
  let otherSignal;
  let refusedLater;
  // why: an engine that keeps scheduling after a node stopped, as a careless
  // one might; the runner must refuse it.
  const persistent = {
    async run({ runner }) {
      await Promise.allSettled([runner.run({ nodeId: "left" }), runner.run({ nodeId: "right" })]);
      refusedLater = await runner.run({ nodeId: "after" }).then(
        () => "ran",
        (error) => error.code
      );
      return { status: "failed", code: "VES_TEST_ENGINE" };
    }
  };
  const fixture = coordinatedDriver(request, {
    engine: persistent,
    script: {
      left: async () => {
        await otherStarted.promise;
        throw quota();
      },
      right: async ({ control: nodeControl }) => {
        otherSignal = nodeControl.signal;
        otherStarted.resolve();
        await aborted(nodeControl.signal);
        return { status: "cancelled", outputRefs: [] };
      }
    }
  });
  const result = await run(fixture, request);
  assert.deepEqual(result, {
    status: "suspended",
    outputRefs: [],
    suspension: {
      reason: "VES_DRIVER_QUOTA_EXHAUSTED",
      provider: request.execution.nodes[0].driver.driverId,
      at: AT,
      scope: "five_hour",
      resetsAt: RESET
    }
  });
  assert.equal(Object.isFrozen(result.suspension), true);
  assert.equal(otherSignal.aborted, true);
  assert.equal(refusedLater, "VES_DRIVER_QUOTA_EXHAUSTED");
  assert.deepEqual(fixture.nodes.state.sessions.map((entry) => entry.node.nodeId).sort(byText), ["left", "right"]);
  assert.deepEqual(states(fixture.records), [
    "left:failed:VES_DRIVER_QUOTA_EXHAUSTED",
    "right:failed:VES_EXECUTOR_CANCELLED"
  ]);
  // invariant: the round stays open, so a resume continues it.
  assert.equal(fixture.records.ledger.roundState, "running");
});

test("a suspension waits for every node still running, even under an engine that returns at once", async () => {
  const request = twoIndependent(coordinatedRequest("graph"), false, 2);
  const settled = [];
  const hasty = {
    async run({ runner }) {
      void runner.run({ nodeId: "left" }).catch(() => undefined);
      void runner.run({ nodeId: "right" }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { status: "failed", code: "VES_TEST_ENGINE" };
    }
  };
  const fixture = coordinatedDriver(request, {
    engine: hasty,
    script: {
      left: async () => {
        throw quota();
      },
      right: async ({ control: nodeControl }) => {
        await aborted(nodeControl.signal);
        await new Promise((resolve) => setTimeout(resolve, 30));
        settled.push("right");
        return { status: "cancelled", outputRefs: [] };
      }
    }
  });
  assert.equal((await run(fixture, request)).status, "suspended");
  assert.deepEqual(settled, ["right"], "the driver returned while a node session was still running");
  assert.deepEqual(states(fixture.records), [
    "left:failed:VES_DRIVER_QUOTA_EXHAUSTED",
    "right:failed:VES_EXECUTOR_CANCELLED"
  ]);
});

test("two quota signals from concurrent readers suspend the run once, recording the first", async () => {
  const request = twoIndependent(coordinatedRequest("graph"), false, 2);
  const firstThrown = Promise.withResolvers();
  const fixture = coordinatedDriver(request, {
    engine: {
      async run({ runner }) {
        await Promise.allSettled([runner.run({ nodeId: "left" }), runner.run({ nodeId: "right" })]);
        return { status: "failed", code: "VES_TEST_ENGINE" };
      }
    },
    script: {
      left: async () => {
        setTimeout(() => firstThrown.resolve(), 0);
        throw quota("five_hour", RESET);
      },
      right: async () => {
        await firstThrown.promise;
        throw quota("seven_day", "2026-10-09T00:00:00.000Z");
      }
    }
  });
  const result = await run(fixture, request);
  assert.equal(result.suspension.scope, "five_hour");
  assert.equal(result.suspension.resetsAt, RESET);
});

test("a writer stopped after one of its writes landed is recorded partial, not failed", async () => {
  const request = coordinatedRequest("agent");
  const fixture = coordinatedDriver(request, {
    script: {
      build: async ({ control: nodeControl, request: nodeRequest }) => {
        await nodeControl.invokeTool({
          requestId: "request:1",
          taskId: nodeRequest.task.taskId,
          capabilityGrantRef: "grant:writer:001",
          operation: "write",
          targetPaths: ["packages/app/src/value.ts"],
          payloadRef: "payload:001"
        });
        throw quota("seven_day", null);
      }
    }
  });
  const result = await run(fixture, request);
  assert.deepEqual(result.suspension, {
    reason: "VES_DRIVER_QUOTA_EXHAUSTED",
    provider: "claude-code",
    at: AT,
    scope: "seven_day"
  });
  assert.deepEqual(
    fixture.records.ledger.visits.map((entry) => [entry.nodeId, entry.state, entry.receiptCount]),
    [["build", "partial", 1]]
  );
});

test("Codex credits on a node's account suspend the run as D3b, with no window or reset", async () => {
  const request = coordinatedRequest("graph");
  const fixture = coordinatedDriver(request, {
    script: {
      plan: async () => {
        throw Object.assign(new Error("credits"), { code: "VES_CODEX_CREDITS_PRESENT" });
      }
    }
  });
  const result = await run(fixture, request);
  assert.deepEqual(result.suspension, { reason: "VES_CODEX_CREDITS_PRESENT", provider: "codex", at: AT });
  assert.deepEqual(
    fixture.nodes.state.sessions.map((entry) => entry.node.nodeId),
    ["plan"]
  );
});

test("any other node failure still fails the run, and closes its round", async () => {
  const request = coordinatedRequest("graph");
  const fixture = coordinatedDriver(request, {
    script: {
      plan: async () => {
        throw Object.assign(new Error("auth"), { code: "VES_CODEX_AUTH_METHOD_MISMATCH" });
      }
    }
  });
  await assert.rejects(run(fixture, request), (error) => error.code === "VES_CODEX_AUTH_METHOD_MISMATCH");
  assert.equal(fixture.records.ledger.roundState, "failed");
});

// invariant: SSI-61 and SSI-81. Whatever a signal carries beside its window and
// reset, and whatever of those is outside its grammar, never reaches the record.
test("a suspension keeps only the closed members of a signal, each in its grammar", async () => {
  const request = coordinatedRequest("agent");
  const fixture = coordinatedDriver(request, {
    script: {
      build: async () => {
        throw Object.assign(new Error("quota for owner@example.invalid"), {
          code: "VES_DRIVER_QUOTA_EXHAUSTED",
          quota: {
            scope: "Five hours for owner@example.invalid",
            resetsAt: "tomorrow",
            email: "owner@example.invalid",
            sessionId: "private-session-id"
          },
          canUserPurchaseCredits: true
        });
      }
    }
  });
  const result = await run(fixture, request);
  assert.deepEqual(result.suspension, { reason: "VES_DRIVER_QUOTA_EXHAUSTED", provider: "claude-code", at: AT });
  assert.equal(JSON.stringify(fixture.records.ledger).includes("example.invalid"), false);
});

test("a cancel that comes first is a cancel: a later quota signal suspends nothing", async () => {
  const request = coordinatedRequest("agent");
  const caller = new AbortController();
  const fixture = coordinatedDriver(request, {
    script: {
      build: async ({ control: nodeControl }) => {
        caller.abort("cancelled by the owner");
        await aborted(nodeControl.signal);
        throw quota();
      }
    }
  });
  const result = await run(fixture, request, { signal: caller.signal });
  assert.equal(result.status, "cancelled");
});

const BEFORE = `sha256:${"a".repeat(64)}`;
const AFTER = `sha256:${"b".repeat(64)}`;
const RUN = driverRequest(coordinatedRequest("graph")).runId;
const at = (seconds) => `2026-10-03T11:00:${String(seconds).padStart(2, "0")}.000Z`;

function entry(nodeId, state, change = {}) {
  return {
    round: 1,
    nodeId,
    visit: 1,
    state,
    startedAt: at(0),
    receiptCount: 0,
    changeDigestBefore: BEFORE,
    ...change
  };
}

function running(visits, mode = "graph") {
  return { schemaVersion: 1, mode, round: 1, roundState: "running", visits };
}

const digestOf = (visit) => canonicalRecordDigest(uncertaintyRecord(RUN, visit));
const sessions = (fixture) => fixture.nodes.state.sessions.map((session) => session.node.nodeId);
const ledgerOf = (records) =>
  records.ledger.visits.map((visit) => `${visit.nodeId}#${visit.visit}:${visit.state}${visit.rerunOf ? "+rerun" : ""}`);

test("a visit settles by its effect: only a failed one with no receipt on an unchanged worktree left none", () => {
  const completed = entry("plan", "completed", { resultDigest: AFTER, resultBytes: 10, endedAt: at(1) });
  const cases = [
    [entry("build", "failed", { endedAt: at(2), failureCode: "VES_DRIVER_QUOTA_EXHAUSTED" }), BEFORE, "none"],
    [entry("build", "failed", { endedAt: at(2) }), AFTER, "possible"],
    [entry("build", "failed", { endedAt: at(2) }), undefined, "possible"],
    [entry("build", "failed", { endedAt: at(2), changeDigestBefore: undefined }), BEFORE, "possible"],
    [entry("build", "partial", { endedAt: at(2), receiptCount: 1 }), BEFORE, "possible"],
    [entry("build", "failed", { endedAt: at(2), receiptCount: 1 }), BEFORE, "possible"],
    [entry("build", "started"), BEFORE, "possible"],
    [entry("build", "uncertain"), BEFORE, "possible"]
  ];
  for (const [visit, current, effect] of cases) {
    const unsettled = unsettledVisits(running([completed, visit]), current);
    assert.deepEqual(
      unsettled.map((item) => [item.visit.nodeId, item.effect]),
      [["build", effect]],
      `${visit.state} r${visit.receiptCount} ${String(current)}`
    );
  }
  assert.deepEqual(unsettledVisits({ ...running([entry("build", "failed")]), roundState: "failed" }, BEFORE), []);
  assert.deepEqual(unsettledVisits(undefined, BEFORE), []);
});

test("a visit a re-run replaced is history: only the latest entry of a node and visit is settled", () => {
  const replaced = entry("build", "partial", { receiptCount: 1, endedAt: at(2) });
  const rerun = entry("build", "failed", { startedAt: at(3), endedAt: at(4), rerunOf: digestOf(replaced) });
  const unsettled = unsettledVisits(running([replaced, rerun]), BEFORE);
  assert.deepEqual(
    unsettled.map((item) => item.visit),
    [rerun]
  );
  const completed = { ...rerun, state: "completed", resultDigest: AFTER, resultBytes: 10 };
  assert.deepEqual(unsettledVisits(running([replaced, completed]), BEFORE), []);
});

test("an uncertainty record names the run and every fact of the visit except its state", () => {
  const visit = entry("build", "started");
  const record = uncertaintyRecord(RUN, visit);
  assert.deepEqual(record, {
    schemaVersion: 1,
    runId: RUN,
    round: 1,
    nodeId: "build",
    visit: 1,
    startedAt: at(0),
    receiptCount: 0,
    changeDigestBefore: BEFORE
  });
  assert.equal(digestOf(visit), digestOf({ ...visit, state: "uncertain" }));
  assert.notEqual(digestOf(visit), canonicalRecordDigest(uncertaintyRecord("run_other", visit)));
});

// why: a suspended graph as commit 2 leaves it: the planner completed with a
// persisted result, the builder stopped by a quota signal.
async function suspendedGraph(build) {
  const request = coordinatedRequest("graph");
  const records = new MemoryRecords();
  const payloads = new MemoryPayloads();
  const bytes = resultBytes({ outcome: "done", summary: "the plan" });
  const plan = await records.saveResult(bytes);
  records.ledger = running([
    entry("plan", "completed", { endedAt: at(1), resultDigest: plan, resultBytes: bytes.byteLength }),
    entry("build", build.state, { startedAt: at(2), ...build })
  ]);
  return { request, records, payloads };
}

test("SSI-65, SSI-67: a resume replays the completed node and runs again, recorded, a node that left no effect", async () => {
  const graph = await suspendedGraph({ state: "failed", endedAt: at(3), failureCode: "VES_DRIVER_QUOTA_EXHAUSTED" });
  const [, failed] = graph.records.ledger.visits;
  const fixture = coordinatedDriver(graph.request, { ...graph, changeDigest: async () => BEFORE });
  assert.equal((await run(fixture, graph.request)).status, "completed");
  assert.deepEqual(sessions(fixture), ["build", "review"], "the completed planner started a session again");
  assert.deepEqual(ledgerOf(fixture.records), [
    "plan#1:completed",
    "build#1:failed",
    "build#1:completed+rerun",
    "review#1:completed"
  ]);
  assert.equal(fixture.records.ledger.visits[2].rerunOf, digestOf(failed));
  assert.equal(fixture.records.ledger.roundState, "completed");
  assert.match(fixture.nodes.state.sessions[0].prompt, /the plan/u, "the replayed result was not handed on");
});

test("SSI-66: a node whose worktree moved since it started is uncertain, and nothing runs", async () => {
  const graph = await suspendedGraph({ state: "failed", endedAt: at(3) });
  const fixture = coordinatedDriver(graph.request, { ...graph, changeDigest: async () => AFTER });
  await assert.rejects(run(fixture, graph.request), rejectsWith("VES_TASK_NODE_UNCERTAIN"));
  assert.deepEqual(sessions(fixture), []);
  assert.equal(fixture.records.ledger.roundState, "running");
});

test("SSI-66, D4: a partial node is refused until its digest is typed back, then that one node runs again", async () => {
  const graph = await suspendedGraph({ state: "partial", endedAt: at(3), receiptCount: 1 });
  const [, partial] = graph.records.ledger.visits;
  const refusedFixture = coordinatedDriver(graph.request, { ...graph, changeDigest: async () => AFTER });
  await assert.rejects(run(refusedFixture, graph.request), rejectsWith("VES_TASK_NODE_UNCERTAIN"));
  assert.deepEqual(sessions(refusedFixture), []);
  assert.deepEqual(ledgerOf(graph.records), ["plan#1:completed", "build#1:partial"]);
  const wrong = coordinatedDriver(graph.request, { ...graph, changeDigest: async () => AFTER, reconcile: AFTER });
  await assert.rejects(run(wrong, graph.request), rejectsWith("VES_TASK_NODE_UNCERTAIN"));
  const reconciled = coordinatedDriver(graph.request, {
    ...graph,
    changeDigest: async () => AFTER,
    reconcile: digestOf(partial)
  });
  assert.equal((await run(reconciled, graph.request)).status, "completed");
  assert.deepEqual(sessions(reconciled), ["build", "review"]);
  assert.equal(graph.records.ledger.visits[2].rerunOf, digestOf(partial));
});

test("a node with no recorded end is marked uncertain, keeps its digest, and runs again once reconciled", async () => {
  const graph = await suspendedGraph({ state: "started" });
  const [, started] = graph.records.ledger.visits;
  const refused = coordinatedDriver(graph.request, { ...graph, changeDigest: async () => BEFORE });
  await assert.rejects(run(refused, graph.request), rejectsWith("VES_TASK_NODE_UNCERTAIN"));
  assert.deepEqual(ledgerOf(graph.records), ["plan#1:completed", "build#1:uncertain"]);
  assert.equal(graph.records.ledger.roundState, "running");
  const reconciled = coordinatedDriver(graph.request, {
    ...graph,
    changeDigest: async () => BEFORE,
    reconcile: digestOf(started)
  });
  assert.equal((await run(reconciled, graph.request)).status, "completed");
  assert.deepEqual(sessions(reconciled), ["build", "review"]);
});

test("without a digest port no unsettled node runs again, not even one that left no effect", async () => {
  const graph = await suspendedGraph({ state: "failed", endedAt: at(3) });
  const fixture = coordinatedDriver(graph.request, { ...graph, changeDigest: async () => BEFORE, digest: null });
  await assert.rejects(run(fixture, graph.request), rejectsWith("VES_TASK_NODE_UNCERTAIN"));
  assert.deepEqual(sessions(fixture), []);
});

test("a run suspended twice settles only its latest visit: a re-run that failed again runs again", async () => {
  const graph = await suspendedGraph({ state: "failed", endedAt: at(3) });
  const first = coordinatedDriver(graph.request, {
    ...graph,
    changeDigest: async () => BEFORE,
    script: {
      build: async () => {
        throw Object.assign(new Error("quota"), { code: "VES_DRIVER_QUOTA_EXHAUSTED", quota: { scope: "five_hour" } });
      }
    }
  });
  assert.equal((await run(first, graph.request)).status, "suspended");
  const second = coordinatedDriver(graph.request, { ...graph, changeDigest: async () => BEFORE });
  assert.equal((await run(second, graph.request)).status, "completed");
  assert.deepEqual(ledgerOf(graph.records), [
    "plan#1:completed",
    "build#1:failed",
    "build#1:failed+rerun",
    "build#1:completed+rerun",
    "review#1:completed"
  ]);
  assert.equal(graph.records.ledger.visits[3].rerunOf, digestOf(graph.records.ledger.visits[2]));
});

test("a resumed swarm runs again the reviewer the quota stopped, after replaying the writer's handoff", async () => {
  const request = coordinatedRequest("swarm");
  const records = new MemoryRecords();
  const payloads = new MemoryPayloads();
  const handoff = { ...DONE, next: "reviewer", message: "review it" };
  const bytes = resultBytes(handoff);
  const written = await records.saveResult(bytes);
  records.ledger = running(
    [
      entry("writer", "completed", { endedAt: at(1), resultDigest: written, resultBytes: bytes.byteLength }),
      entry("reviewer", "failed", { startedAt: at(2), endedAt: at(3), failureCode: "VES_DRIVER_QUOTA_EXHAUSTED" })
    ],
    "swarm"
  );
  const fixture = coordinatedDriver(request, {
    records,
    payloads,
    changeDigest: async () => BEFORE,
    script: { reviewer: async () => ({ result: { ...DONE, next: "<complete>", message: "done" } }) }
  });
  assert.equal((await run(fixture, request)).status, "completed");
  assert.deepEqual(sessions(fixture), ["reviewer"]);
  assert.match(fixture.nodes.state.sessions[0].prompt, /review it/u);
});

test("a node already run again and completed is replayed from that completion, never from the visit it replaced", async () => {
  const graph = await suspendedGraph({ state: "failed", endedAt: at(3) });
  const [plan, replaced] = graph.records.ledger.visits;
  const bytes = resultBytes({ outcome: "done", summary: "the build" });
  const built = await graph.records.saveResult(bytes);
  graph.records.ledger = running([
    plan,
    replaced,
    {
      ...replaced,
      state: "completed",
      startedAt: at(4),
      endedAt: at(5),
      resultDigest: built,
      resultBytes: bytes.byteLength,
      rerunOf: digestOf(replaced)
    },
    entry("review", "failed", { startedAt: at(6), endedAt: at(7), failureCode: "VES_DRIVER_QUOTA_EXHAUSTED" })
  ]);
  const fixture = coordinatedDriver(graph.request, { ...graph, changeDigest: async () => BEFORE });
  assert.equal((await run(fixture, graph.request)).status, "completed");
  assert.deepEqual(sessions(fixture), ["review"], "a node that completed on its re-run started again");
  assert.match(fixture.nodes.state.sessions[0].prompt, /the build/u);
});
