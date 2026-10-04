// invariant: SSI-15's independent test. A coordinated run is one
// TaskExecutionCoordinator.execute call: a writer node's request outside its
// node scope is refused before the executor, one inside its node scope but on
// a protected path is refused by the executor, and the usage of every node is
// metered once on the run's one budget meter. Node sessions are labelled fakes.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CoordinatedDriver,
  TaskExecutionSuspended,
  createBudgetMeter,
  modelPriceTable
} from "../../packages/application/src/index.ts";
import {
  DONE,
  MemoryPayloads,
  MemoryRecords,
  coordinatedRequest,
  scriptedNodes,
  sequentialEngine
} from "../helpers/coordinated-driver-fixture.mjs";
import { executor, executorInput, executorPorts } from "../helpers/task-executor-fixture.mjs";

const SCOPE = "packages/application/src/execution";

// why: the fixture spreads a driver override into its own fake, so a class
// instance is handed over as the two methods of the port.
const port = (driver) => ({
  execute: (request, control) => driver.execute(request, control),
  cancel: (worktreeRef) => driver.cancel(worktreeRef)
});

function coordinatedFor(input) {
  const request = coordinatedRequest("graph");
  const [plan, build] = request.execution.nodes;
  return {
    ...request,
    task: input.task,
    execution: {
      ...request.execution,
      nodes: [
        { ...plan, readScope: [SCOPE], writeScope: [] },
        // why: a write scope covering a protected path is refused at
        // normalization; it is handed over here to show the executor still
        // refuses the effect (defence in depth).
        { ...build, readScope: [SCOPE], writeScope: [SCOPE], inputs: ["plan"] },
        { ...request.execution.nodes[2], readScope: [SCOPE], writeScope: [], inputs: ["plan", "build"] }
      ]
    }
  };
}

function write(input, path) {
  return {
    requestId: `request:${path}`,
    taskId: input.task.taskId,
    capabilityGrantRef: "grant:writer:001",
    operation: "write",
    targetPaths: [path],
    payloadRef: "payload:001"
  };
}

test("every node runs inside the one executor run, under its authority, scope, and budget", async () => {
  const input = {
    ...executorInput(),
    task: { ...executorInput().task, protectedPaths: [".git", `${SCOPE}/secret`] },
    budgets: { maximumCostUsd: 5, maximumTokens: 1_000, maximumDurationMs: 60_000 }
  };
  const request = coordinatedFor(input);
  const outcomes = {};
  const attempt = async (nodeControl, path) => {
    try {
      await nodeControl.invokeTool(write(input, path));
      outcomes[path] = "written";
    } catch (error) {
      outcomes[path] = error.code;
    }
  };
  const payloads = new MemoryPayloads();
  const records = new MemoryRecords();
  const nodes = scriptedNodes(payloads, {
    plan: async ({ control }) => {
      control.reportUsage({ model: "gpt-5.2-codex", inputTokens: 100, outputTokens: 10 });
      return { result: DONE };
    },
    build: async ({ control }) => {
      await attempt(control, "tests/integration/task-executor.test.mjs");
      await attempt(control, `${SCOPE}/secret/key.ts`);
      await attempt(control, `${SCOPE}/task-executor.ts`);
      control.reportUsage({ model: "claude-sonnet-5", inputTokens: 200, outputTokens: 20 });
      return { result: DONE };
    }
  });
  const meter = createBudgetMeter({ budgets: input.budgets, priceTable: modelPriceTable });
  const { state, ports } = executorPorts({
    driver: port(
      new CoordinatedDriver({
        request,
        engine: async () => sequentialEngine,
        nodes,
        payloads,
        records,
        context: "",
        remainingDurationMs: () => meter.remainingDurationMs()
      })
    )
  });
  const result = await executor(ports).execute(input, { budgetMeter: meter });
  assert.equal(result.status, "AWAITING_GATE");
  assert.deepEqual(outcomes, {
    "tests/integration/task-executor.test.mjs": "VES_COORDINATION_SCOPE_DENIED",
    [`${SCOPE}/secret/key.ts`]: "VES_EXECUTOR_PROTECTED_PATH",
    [`${SCOPE}/task-executor.ts`]: "written"
  });
  assert.deepEqual(
    state.toolRequests.map((entry) => entry.targetPaths[0]),
    [`${SCOPE}/task-executor.ts`]
  );
  assert.equal(state.calls.filter((call) => call === "authority:start").length, 1);
  assert.equal(state.calls.filter((call) => call === "worktree:create").length, 1);
  assert.equal(state.calls.filter((call) => call === "authority:tool-effect").length, 1);
  assert.equal(meter.snapshot().consumedTokens, 330);
  assert.equal(records.ledger.roundState, "completed");
  assert.deepEqual(
    state.checkpoints.map((entry) => entry.stage),
    ["awaiting-gate"]
  );
});

test("a node failure fails the executor run with the node's code and the worktree is cleaned up", async () => {
  const input = executorInput();
  const request = coordinatedFor(input);
  const payloads = new MemoryPayloads();
  const { state, ports } = executorPorts({
    driver: port(
      new CoordinatedDriver({
        request,
        engine: async () => sequentialEngine,
        nodes: scriptedNodes(payloads, {
          plan: async () => ({ result: { outcome: "done", summary: "x".repeat(70_000) } })
        }),
        payloads,
        records: new MemoryRecords(),
        context: "",
        remainingDurationMs: () => 60_000
      })
    )
  });
  await assert.rejects(executor(ports).execute(input), (error) => error.code === "VES_COORDINATION_RESULT_TOO_LARGE");
  assert.equal(state.cleaned, true);
  assert.equal(state.released, true);
});

// invariant: SSI-59, SSI-60 (AD-071). The independent test's first half inside
// the real executor: a quota signal in the second of three graph nodes
// suspends the run. The first node's result is persisted and replayable, the
// worktree it shares with every node is kept (never cleaned), the suspended
// checkpoint names the change and the suspension, the writer coordination is
// released, and no later node starts.
test("a quota signal mid-graph suspends the executor run and keeps its worktree and the first node's result", async () => {
  const input = executorInput();
  const request = coordinatedFor(input);
  const payloads = new MemoryPayloads();
  const records = new MemoryRecords();
  const nodes = scriptedNodes(payloads, {
    build: async () => {
      throw Object.assign(new Error("quota"), {
        code: "VES_DRIVER_QUOTA_EXHAUSTED",
        quota: { scope: "five_hour", resetsAt: "2026-10-03T17:00:00.000Z" }
      });
    }
  });
  const { state, ports } = executorPorts({
    driver: port(
      new CoordinatedDriver({
        request,
        engine: async () => sequentialEngine,
        nodes,
        payloads,
        records,
        context: "",
        remainingDurationMs: () => 60_000,
        now: () => new Date("2026-10-03T12:00:00.000Z")
      })
    )
  });
  const suspension = {
    reason: "VES_DRIVER_QUOTA_EXHAUSTED",
    provider: "claude-code",
    at: "2026-10-03T12:00:00.000Z",
    scope: "five_hour",
    resetsAt: "2026-10-03T17:00:00.000Z"
  };
  await assert.rejects(executor(ports).execute(input), (error) => {
    assert.ok(error instanceof TaskExecutionSuspended);
    assert.equal(error.code, "VES_EXECUTOR_SUSPENDED");
    assert.deepEqual(error.suspension, suspension);
    return true;
  });
  assert.equal(state.cleaned, false, "the suspended worktree was removed");
  assert.equal(state.released, true, "the writer coordination is still held");
  assert.equal(state.calls.includes("driver:cancel"), false);
  assert.deepEqual(
    nodes.state.sessions.map((entry) => entry.node.nodeId),
    ["plan", "build"]
  );
  const suspended = state.checkpoints.at(-1);
  assert.equal(suspended.stage, "suspended");
  assert.deepEqual(suspended.data, {
    changeDigest: `sha256:${"5".repeat(64)}`,
    changedPaths: ["packages/application/src/execution/task-executor.ts"],
    toolReceiptRefs: [],
    suspension
  });
  assert.equal(records.ledger.roundState, "running");
  const [plan, build] = records.ledger.visits;
  assert.equal(plan.state, "completed");
  assert.deepEqual(await records.loadResult(plan.resultDigest), await payloads.get(`payload:${plan.resultDigest}`));
  assert.equal(build.state, "failed");
});

// invariant: the executor trusts no driver's suspension: a record outside its
// grammar or with a member it may not hold, a suspension on another status,
// and a suspended status without a record all fail the driver, and the
// failure cleans up as any failure does.
for (const [label, result] of [
  [
    "a record with provider text",
    {
      status: "suspended",
      outputRefs: [],
      suspension: {
        reason: "VES_DRIVER_QUOTA_EXHAUSTED",
        provider: "claude-code",
        at: "2026-10-03T12:00:00.000Z",
        scope: "Five hours, buy more at claude.ai"
      }
    }
  ],
  [
    "a record with an account member",
    {
      status: "suspended",
      outputRefs: [],
      suspension: {
        reason: "VES_DRIVER_QUOTA_EXHAUSTED",
        provider: "codex",
        at: "2026-10-03T12:00:00.000Z",
        email: "owner@example.invalid"
      }
    }
  ],
  [
    "a record whose reason is not a code",
    {
      status: "suspended",
      outputRefs: [],
      suspension: { reason: "quota", provider: "codex", at: "2026-10-03T12:00:00.000Z" }
    }
  ],
  ["a suspended status without a record", { status: "suspended", outputRefs: [] }],
  [
    "a record on a completed run",
    {
      status: "completed",
      outputRefs: [],
      suspension: { reason: "VES_DRIVER_QUOTA_EXHAUSTED", provider: "codex", at: "2026-10-03T12:00:00.000Z" }
    }
  ]
])
  test(`the executor refuses ${label} and cleans up as for any driver failure`, async () => {
    const { state, ports } = executorPorts({ driver: { execute: async () => result } });
    await assert.rejects(
      executor(ports).execute(executorInput()),
      (error) => error.code === "VES_EXECUTOR_DRIVER_FAILED"
    );
    assert.equal(state.cleaned, true);
    assert.deepEqual(
      state.checkpoints.map((entry) => entry.stage),
      ["failed"]
    );
  });

test("a cancel of the caller wins over a driver's suspension", async () => {
  const caller = new AbortController();
  const { state, ports } = executorPorts({
    driver: {
      execute: async () => {
        caller.abort("cancelled by the owner");
        return {
          status: "suspended",
          outputRefs: [],
          suspension: { reason: "VES_DRIVER_QUOTA_EXHAUSTED", provider: "codex", at: "2026-10-03T12:00:00.000Z" }
        };
      }
    }
  });
  await assert.rejects(
    executor(ports).execute(executorInput(), { signal: caller.signal }),
    (error) => error.code === "VES_EXECUTOR_CANCELLED"
  );
  assert.equal(state.cleaned, true);
});
