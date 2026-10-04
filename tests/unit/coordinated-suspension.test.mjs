// invariant: SSI-59..61 (AD-071). A provider's usage signal from any node
// suspends a coordinated run instead of failing it: no further node starts,
// every running node is stopped and recorded, the round stays open for a
// resume, and the suspension names only the signal's code, the provider, the
// time, and the window and reset the provider reported. Node sessions and
// engines are labelled in-memory fakes.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aborted,
  control,
  coordinatedDriver,
  coordinatedRequest,
  driverRequest,
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
