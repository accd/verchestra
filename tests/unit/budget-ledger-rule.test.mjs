// invariant: ARQ-007 (#597). One rule validates a budget ledger, whether the
// meter resumes it or a task command reads it from a stored repair
// checkpoint, so the two can never disagree about the same ledger again. A
// missing stop reason used to be resumed by the meter as null while the
// stored-ledger reader refused it.
import assert from "node:assert/strict";
import { test } from "node:test";

import { storedBudgetLedger } from "../../apps/vestra-cli/src/task/task-budget.ts";
import { budgetLedgerProblem, createBudgetMeter } from "../../packages/application/src/execution/budget-meter.ts";

const PRICES = Object.freeze({
  version: "test.1",
  models: Object.freeze({ "priced-model": Object.freeze({ inputPerMToken: 1, outputPerMToken: 2 }) })
});

const VALID = Object.freeze({
  consumedCostUsd: 0.25,
  consumedTokens: 100,
  consumedDurationMs: 1_500,
  usageEvents: 2,
  stopReason: null
});

const resumes = (ledger) => {
  try {
    createBudgetMeter({
      budgets: { maximumCostUsd: 10, maximumTokens: 1_000_000, maximumDurationMs: 60_000 },
      priceTable: PRICES,
      resume: ledger
    });
    return true;
  } catch (error) {
    assert.equal(error.code, "VES_BUDGET_INVALID");
    return false;
  }
};

const isStored = (ledger) => {
  try {
    return storedBudgetLedger(ledger) !== undefined;
  } catch (error) {
    assert.equal(error.envelope.code, "VES_TASK_STATE_INVALID");
    assert.equal(error.envelope.safeDetails.reason, "VES_TASK_STATE_MALFORMED");
    return false;
  }
};

const CASES = Object.freeze([
  ["a valid ledger", VALID, undefined],
  ["a stopped ledger", { ...VALID, stopReason: "token-threshold" }, undefined],
  ["unbilled tokens within the total", { ...VALID, unbilledTokens: 100 }, undefined],
  ["no stop reason", (({ stopReason, ...rest }) => rest)(VALID), "stopReason"],
  ["an unknown stop reason", { ...VALID, stopReason: "mood" }, "stopReason"],
  ["negative cost", { ...VALID, consumedCostUsd: -1 }, "consumedCostUsd"],
  ["fractional tokens", { ...VALID, consumedTokens: 1.5 }, "consumedTokens"],
  ["infinite duration", { ...VALID, consumedDurationMs: Number.POSITIVE_INFINITY }, "consumedDurationMs"],
  ["negative events", { ...VALID, usageEvents: -1 }, "usageEvents"],
  ["unbilled above the total", { ...VALID, unbilledTokens: 101 }, "unbilledTokens"],
  ["not an object", "ledger", "ledger"]
]);

test("the ledger rule names the first member that breaks it", () => {
  for (const [label, ledger, problem] of CASES) assert.equal(budgetLedgerProblem(ledger), problem, label);
});

test("the meter and the stored-ledger reader accept and refuse exactly the same ledgers", () => {
  for (const [label, ledger, problem] of CASES) {
    if (typeof ledger !== "object") continue;
    assert.equal(resumes(ledger), problem === undefined, `meter: ${label}`);
    assert.equal(isStored(ledger), problem === undefined, `stored: ${label}`);
  }
});
