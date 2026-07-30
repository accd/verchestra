// Issue #124: the budget meter was built inside one executor call while the
// repair loop calls the executor up to five times, so every attempt received a
// fresh 90% threshold and a declared run ceiling could be spent once per
// attempt. These tests pin the budget to the run.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createBudgetMeter } from "../../packages/application/src/execution/budget-meter.ts";
import { runGateRepairLoop } from "../../packages/application/src/execution/gate-repair.ts";
import { modelPriceTable } from "../../packages/application/src/execution/model-price-table.ts";

const digestOf = (index) => `sha256:${String(index).repeat(64).slice(0, 64)}`;
const failure = (attempt) => ({ failedGateId: "gate:quick", evidenceRef: `evidence:attempt-${attempt}` });

// 100k output tokens of sonnet is 1.50 USD, so a 5 USD ceiling with a 90%
// threshold (4.50) is reached partway through the third attempt.
const SPEND_PER_ATTEMPT = { model: "claude-sonnet-5", inputTokens: 0, outputTokens: 100_000 };
const COST_PER_ATTEMPT = 1.5;
const BUDGETS = Object.freeze({ maximumCostUsd: 5, maximumTokens: 10_000_000, maximumDurationMs: 3_600_000 });

// A loop harness whose attempts spend from whatever meter they are handed, and
// whose durable state is a plain object so a crash can be replayed.
function harness({ verdicts, budgets = BUDGETS, persisted = {}, clock } = {}) {
  const calls = { attempts: [], savedStages: [], metersSeen: new Set() };
  const ports = {
    attempt: async ({ attempt, budgetMeter }) => {
      calls.attempts.push(attempt);
      if (budgetMeter !== undefined) {
        calls.metersSeen.add(budgetMeter);
        budgetMeter.recordUsage(SPEND_PER_ATTEMPT);
      }
      const passed = verdicts[attempt - 1] === "pass";
      return passed ? { passed } : { passed, failure: failure(attempt) };
    },
    budget: {
      create: (resume) =>
        createBudgetMeter({
          budgets,
          priceTable: modelPriceTable,
          ...(clock === undefined ? {} : { now: clock }),
          ...(resume === undefined ? {} : { resume })
        })
    },
    buildFeedback: async (gateFailure) => ({
      feedbackRef: `feedback:${gateFailure.evidenceRef}`,
      feedbackDigest: digestOf(7),
      bytes: 512
    }),
    sealAttempt: async ({ attempt }) => ({ capsuleDigest: digestOf(attempt) }),
    loadState: async () => persisted.state,
    saveState: async (state) => {
      calls.savedStages.push(state.stage);
      persisted.state = {
        attempts: state.attempts,
        attemptCapsuleDigests: state.attemptCapsuleDigests,
        budgetLedger: state.budgetLedger
      };
    }
  };
  return { calls, ports, persisted };
}

const POLICY = { maxAttempts: 5, feedbackToDriver: true, escalateAfter: 5 };

test("five declared attempts cannot spend more than the one declared ceiling", async () => {
  const { calls, ports, persisted } = harness({ verdicts: ["fail", "fail", "fail", "fail", "fail"] });
  const outcome = await runGateRepairLoop({ onGateFailure: POLICY }, ports);

  // The defect this pins: before the fix all five attempts ran, each with its
  // own 4.50 threshold, for 7.50 USD against a declared ceiling of 5.
  assert.equal(outcome.status, "BUDGET_EXCEEDED");
  assert.equal(calls.attempts.length, 3);
  assert.ok(
    persisted.state.budgetLedger.consumedCostUsd <= BUDGETS.maximumCostUsd,
    `spent ${persisted.state.budgetLedger.consumedCostUsd} against a ceiling of ${BUDGETS.maximumCostUsd}`
  );
  assert.equal(persisted.state.budgetLedger.consumedCostUsd, COST_PER_ATTEMPT * 3);
});

test("every attempt is handed the same meter, not one each", async () => {
  const { calls, ports } = harness({ verdicts: ["fail", "fail", "fail"] });
  await runGateRepairLoop({ onGateFailure: POLICY }, ports);
  assert.equal(calls.metersSeen.size, 1);
});

test("an exhausted budget reports itself rather than the gate it never finished", async () => {
  const { ports } = harness({ verdicts: ["fail", "fail", "fail", "fail", "fail"] });
  const outcome = await runGateRepairLoop({ onGateFailure: POLICY }, ports);
  assert.equal(outcome.status, "BUDGET_EXCEEDED");
  assert.equal(outcome.stopReason, "cost-threshold");
  // The gate failure is still carried, so the reader learns both facts.
  assert.equal(outcome.failure.failedGateId, "gate:quick");
});

test("the terminal stage records budget-exceeded, not gate-failed", async () => {
  const { calls, ports } = harness({ verdicts: ["fail", "fail", "fail", "fail", "fail"] });
  await runGateRepairLoop({ onGateFailure: POLICY }, ports);
  assert.equal(calls.savedStages.at(-1), "budget-exceeded");
  assert.ok(!calls.savedStages.includes("gate-failed"));
});

test("the budget outcome wins over escalation, because escalation invites spending that is gone", async () => {
  // Escalation would fire at attempt 3; the budget is exhausted at the same
  // attempt. ESCALATED would tell a human to approve more attempts.
  const { ports } = harness({ verdicts: ["fail", "fail", "fail", "fail", "fail"] });
  const outcome = await runGateRepairLoop(
    { onGateFailure: { maxAttempts: 5, feedbackToDriver: true, escalateAfter: 3 } },
    ports
  );
  assert.equal(outcome.status, "BUDGET_EXCEEDED");
});

test("a converged attempt stays converged even when it consumed the budget doing so", async () => {
  const { ports } = harness({ verdicts: ["fail", "fail", "pass"] });
  const outcome = await runGateRepairLoop({ onGateFailure: POLICY }, ports);
  assert.equal(outcome.status, "CONVERGED");
  assert.equal(outcome.attempts, 3);
});

test("a crash between attempts resumes with the spend it already made", async () => {
  const persisted = {};
  // First run: policy allows two attempts, both fail, 3.00 USD spent.
  const first = harness({ verdicts: ["fail", "fail"], persisted });
  await runGateRepairLoop({ onGateFailure: { maxAttempts: 2, feedbackToDriver: true, escalateAfter: 2 } }, first.ports);
  assert.equal(persisted.state.budgetLedger.consumedCostUsd, COST_PER_ATTEMPT * 2);

  // The run resumes under a wider policy. A meter that reset would grant a
  // fresh 4.50 and allow three more attempts.
  const second = harness({ verdicts: ["fail", "fail", "fail"], persisted });
  const outcome = await runGateRepairLoop({ onGateFailure: POLICY }, second.ports);
  assert.equal(outcome.status, "BUDGET_EXCEEDED");
  assert.equal(second.calls.attempts.length, 1);
  assert.equal(persisted.state.budgetLedger.consumedCostUsd, COST_PER_ATTEMPT * 3);
});

test("a resumed run already over its ceiling starts no attempt at all", async () => {
  const persisted = {
    state: {
      attempts: 2,
      attemptCapsuleDigests: [digestOf(1), digestOf(2)],
      budgetLedger: {
        consumedCostUsd: 4.9,
        consumedTokens: 400_000,
        consumedDurationMs: 1000,
        usageEvents: 2,
        stopReason: null
      }
    }
  };
  const { calls, ports } = harness({ verdicts: ["fail", "fail", "fail"], persisted });
  const outcome = await runGateRepairLoop({ onGateFailure: POLICY }, ports);
  assert.equal(outcome.status, "BUDGET_EXCEEDED");
  assert.equal(calls.attempts.length, 0);
});

test("elapsed duration continues across attempts instead of restarting", async () => {
  let clockValue = 0;
  const clock = () => clockValue;
  // A 10s ceiling at 90% stops at 9s. Each attempt advances the clock 4s, so a
  // per-attempt clock would never reach the threshold.
  const budgets = { maximumCostUsd: 1000, maximumTokens: 10_000_000, maximumDurationMs: 10_000 };
  const { calls, ports } = harness({ verdicts: ["fail", "fail", "fail", "fail", "fail"], budgets, clock });
  const advancing = {
    ...ports,
    attempt: async (input) => {
      clockValue += 4000;
      return ports.attempt(input);
    }
  };
  const outcome = await runGateRepairLoop({ onGateFailure: POLICY }, advancing);
  assert.equal(outcome.status, "BUDGET_EXCEEDED");
  assert.equal(outcome.stopReason, "duration-threshold");
  assert.equal(calls.attempts.length, 3);
});

test("a loop with no budget port behaves exactly as it did before", async () => {
  const { calls, ports } = harness({ verdicts: ["fail", "fail", "fail", "fail", "fail"] });
  delete ports.budget;
  const outcome = await runGateRepairLoop({ onGateFailure: POLICY }, ports);
  assert.equal(outcome.status, "ESCALATED");
  assert.equal(calls.attempts.length, 5);
  assert.equal(calls.savedStages.at(-1), "escalated");
});

test("remaining duration shrinks as the run spends it", () => {
  let clockValue = 0;
  const meter = createBudgetMeter({
    budgets: { maximumCostUsd: 10, maximumTokens: 1000, maximumDurationMs: 10_000 },
    priceTable: modelPriceTable,
    now: () => clockValue
  });
  assert.equal(meter.remainingDurationMs(), 9000);
  clockValue = 4000;
  assert.equal(meter.remainingDurationMs(), 5000);
  clockValue = 20_000;
  assert.equal(meter.remainingDurationMs(), 0);
});

test("a resumed meter inherits elapsed time rather than a fresh clock", () => {
  let clockValue = 50_000;
  const meter = createBudgetMeter({
    budgets: { maximumCostUsd: 10, maximumTokens: 1000, maximumDurationMs: 10_000 },
    priceTable: modelPriceTable,
    now: () => clockValue,
    resume: { consumedCostUsd: 0, consumedTokens: 0, consumedDurationMs: 6000, usageEvents: 0, stopReason: null }
  });
  assert.equal(meter.consumedDurationMs(), 6000);
  assert.equal(meter.remainingDurationMs(), 3000);
  assert.equal(meter.shouldStop().stop, false);
  clockValue = 54_000;
  assert.deepEqual(meter.shouldStop(), { stop: true, reason: "duration-threshold" });
});

test("a resumed meter keeps a stop reason it already recorded", () => {
  const meter = createBudgetMeter({
    budgets: BUDGETS,
    priceTable: modelPriceTable,
    resume: {
      consumedCostUsd: 4.6,
      consumedTokens: 300_000,
      consumedDurationMs: 500,
      usageEvents: 3,
      stopReason: "cost-threshold"
    }
  });
  assert.deepEqual(meter.shouldStop(), { stop: true, reason: "cost-threshold" });
  assert.equal(meter.ledger().usageEvents, 3);
});

// A ledger that can be wound backwards on resume buys a fresh ceiling, which is
// the same bypass as a negative usage count in a live event.
for (const [label, resume] of [
  [
    "negative cost",
    { consumedCostUsd: -1, consumedTokens: 0, consumedDurationMs: 0, usageEvents: 0, stopReason: null }
  ],
  [
    "negative tokens",
    { consumedCostUsd: 0, consumedTokens: -5, consumedDurationMs: 0, usageEvents: 0, stopReason: null }
  ],
  [
    "fractional tokens",
    { consumedCostUsd: 0, consumedTokens: 1.5, consumedDurationMs: 0, usageEvents: 0, stopReason: null }
  ],
  [
    "negative elapsed time",
    { consumedCostUsd: 0, consumedTokens: 0, consumedDurationMs: -1000, usageEvents: 0, stopReason: null }
  ],
  [
    "an infinite cost",
    {
      consumedCostUsd: Number.POSITIVE_INFINITY,
      consumedTokens: 0,
      consumedDurationMs: 0,
      usageEvents: 0,
      stopReason: null
    }
  ],
  [
    "an invented stop reason",
    { consumedCostUsd: 0, consumedTokens: 0, consumedDurationMs: 0, usageEvents: 0, stopReason: "wallet-empty" }
  ],
  ["a non-object ledger", "resumed"]
]) {
  test(`a resumed ledger with ${label} is rejected`, () => {
    assert.throws(() => createBudgetMeter({ budgets: BUDGETS, priceTable: modelPriceTable, resume }), {
      code: "VES_BUDGET_INVALID"
    });
  });
}

test("a recovered repair state whose ledger is not an object is rejected", async () => {
  const persisted = { state: { attempts: 0, attemptCapsuleDigests: [], budgetLedger: 7 } };
  const { ports } = harness({ verdicts: ["fail"], persisted });
  await assert.rejects(runGateRepairLoop({ onGateFailure: POLICY }, ports), {
    code: "VES_REPAIR_STATE_INVALID"
  });
});
