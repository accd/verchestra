import assert from "node:assert/strict";
import { test } from "node:test";

import { executor, executorInput, executorPorts } from "../helpers/task-executor-fixture.mjs";

const budgets = { maximumCostUsd: 1, maximumTokens: 1_000_000, maximumDurationMs: 60_000 };
const withBudgets = (input = executorInput()) => ({ ...input, budgets });

// A driver that floods usage events, the way a runaway loop would. Every event
// costs money; the executor's meter must stop it, not the driver's goodwill.
function floodingDriver(state, { model = "claude-opus-5", perEventOutputTokens = 500 } = {}) {
  return {
    execute: async (_request, control) => {
      state.calls.push("driver");
      for (let turn = 0; turn < 10_000; turn += 1) {
        control.reportUsage({ model, inputTokens: 0, outputTokens: perEventOutputTokens });
        if (state.calls.includes("driver:cancel")) return { status: "cancelled", outputRefs: [] };
      }
      return { status: "completed", outputRefs: [] };
    },
    cancel: async () => state.calls.push("driver:cancel")
  };
}

test("a usage flood stops at the cost threshold with a budget-exceeded checkpoint", async () => {
  const { state, ports } = executorPorts();
  ports.driver = floodingDriver(state);
  await assert.rejects(executor(ports).execute(withBudgets()), { code: "VES_EXECUTOR_BUDGET_EXCEEDED" });

  // The stop is evidenced, not just thrown: a budget-exceeded checkpoint with
  // the meter snapshot precedes the failure checkpoint.
  const budgetCheckpoint = state.checkpoints.find((entry) => entry.stage === "budget-exceeded");
  assert.ok(budgetCheckpoint, "expected a budget-exceeded checkpoint");
  assert.equal(budgetCheckpoint.data.reason, "cost-threshold");
  assert.equal(budgetCheckpoint.data.meter.stopReason, "cost-threshold");
  // Ceiling 1 USD at 90%: the meter stops at 0.9 USD, well before the flood's
  // theoretical 3,750 USD total.
  assert.ok(budgetCheckpoint.data.meter.consumedCostUsd < 1);
  assert.ok(state.calls.includes("driver:cancel"), "the driver must be cancelled");
  // The run remains recoverable: worktree cleaned, coordination released.
  assert.equal(state.cleaned, true);
  assert.equal(state.released, true);
});

test("the budget outcome wins over the driver's own cancellation report", async () => {
  const { state, ports } = executorPorts();
  ports.driver = floodingDriver(state);
  // Without the precedence rule this would surface as VES_EXECUTOR_CANCELLED,
  // hiding that the run died because its ceiling was reached.
  await assert.rejects(executor(ports).execute(withBudgets()), (error) => {
    assert.equal(error.code, "VES_EXECUTOR_BUDGET_EXCEEDED");
    return true;
  });
});

test("an unknown model stops the run instead of running for free", async () => {
  const { state, ports } = executorPorts();
  ports.driver = floodingDriver(state, { model: "model-nobody-priced" });
  await assert.rejects(executor(ports).execute(withBudgets()), { code: "VES_BUDGET_MODEL_UNKNOWN" });
  const budgetCheckpoint = state.checkpoints.find((entry) => entry.stage === "budget-exceeded");
  assert.equal(budgetCheckpoint.data.reason, "VES_BUDGET_MODEL_UNKNOWN");
  assert.ok(state.calls.includes("driver:cancel"));
});

test("a driver that goes silent cannot outrun the duration ceiling", async () => {
  const { state, ports } = executorPorts();
  ports.driver = {
    execute: (_request, control) =>
      new Promise((resolve) => {
        state.calls.push("driver");
        // No usage events at all; only the executor's own timer can stop this.
        // The driver self-limits after 2 seconds and reports success, so a
        // regression that drops the duration timer fails the assert.rejects
        // below instead of hanging the runner the way the #88 defect did.
        const startedAt = Date.now();
        const poll = setInterval(() => {
          if (state.calls.includes("driver:cancel")) {
            clearInterval(poll);
            resolve({ status: "cancelled", outputRefs: [] });
          } else if (Date.now() - startedAt > 2_000) {
            clearInterval(poll);
            resolve({ status: "completed", outputRefs: [] });
          }
        }, 5);
        void control;
      }),
    cancel: async () => state.calls.push("driver:cancel")
  };
  const input = { ...executorInput(), budgets: { ...budgets, maximumDurationMs: 100 } };
  await assert.rejects(executor(ports).execute(input), { code: "VES_EXECUTOR_BUDGET_EXCEEDED" });
  const budgetCheckpoint = state.checkpoints.find((entry) => entry.stage === "budget-exceeded");
  assert.equal(budgetCheckpoint.data.reason, "duration-threshold");
});

test("a run inside its budgets completes exactly as before", async () => {
  const { state, ports } = executorPorts();
  const result = await executor(ports).execute(withBudgets());
  assert.equal(result.status, "AWAITING_GATE");
  assert.equal(
    state.checkpoints.some((entry) => entry.stage === "budget-exceeded"),
    false
  );
});

test("a caller that declares no budgets keeps the pre-enforcement behavior", async () => {
  const { state, ports } = executorPorts();
  ports.driver = {
    execute: async (_request, control) => {
      // reportUsage must be callable and inert without a meter, so drivers can
      // report unconditionally.
      control.reportUsage({ model: "model-nobody-priced", inputTokens: 1, outputTokens: 1 });
      return { status: "completed", outputRefs: [] };
    },
    cancel: async () => state.calls.push("driver:cancel")
  };
  const result = await executor(ports).execute(executorInput());
  assert.equal(result.status, "AWAITING_GATE");
});

for (const [label, corrupt] of [
  ["a zero cost ceiling", { ...budgets, maximumCostUsd: 0 }],
  ["a missing duration ceiling", { maximumCostUsd: 1, maximumTokens: 1 }],
  ["an unknown extra field", { ...budgets, currency: "USD" }]
]) {
  test(`declared budgets with ${label} are rejected before any port is touched`, async () => {
    const { state, ports } = executorPorts();
    await assert.rejects(executor(ports).execute({ ...executorInput(), budgets: corrupt }), {
      code: "VES_EXECUTOR_INPUT_INVALID"
    });
    assert.equal(state.calls.includes("driver"), false);
  });
}
