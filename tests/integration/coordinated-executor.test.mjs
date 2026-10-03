// invariant: SSI-15's independent test. A coordinated run is one
// TaskExecutionCoordinator.execute call: a writer node's request outside its
// node scope is refused before the executor, one inside its node scope but on
// a protected path is refused by the executor, and the usage of every node is
// metered once on the run's one budget meter. Node sessions are labelled fakes.
import assert from "node:assert/strict";
import { test } from "node:test";

import { CoordinatedDriver, createBudgetMeter, modelPriceTable } from "../../packages/application/src/index.ts";
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
