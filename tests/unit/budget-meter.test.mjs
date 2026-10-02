import assert from "node:assert/strict";
import { test } from "node:test";

import { budgetBilling, createBudgetMeter } from "../../packages/application/src/execution/budget-meter.ts";

const PRICES = Object.freeze({
  version: "test.1",
  models: Object.freeze({
    // 1 USD per million input tokens, 2 per million output: chosen so costs
    // are exact decimal fractions and the math below stays readable.
    "priced-model": Object.freeze({ inputPerMToken: 1, outputPerMToken: 2 })
  })
});

const meterWith = ({ budgets, ...rest } = {}) =>
  createBudgetMeter({
    budgets: { maximumCostUsd: 10, maximumTokens: 1_000_000, maximumDurationMs: 60_000, ...budgets },
    priceTable: PRICES,
    ...rest
  });

test("accumulates cost and tokens across usage events", () => {
  const meter = meterWith();
  meter.recordUsage({ model: "priced-model", inputTokens: 500_000, outputTokens: 0 });
  meter.recordUsage({ model: "priced-model", inputTokens: 0, outputTokens: 250_000 });
  const snapshot = meter.snapshot();
  assert.equal(snapshot.consumedCostUsd, 0.5 + 0.5);
  assert.equal(snapshot.consumedTokens, 750_000);
  assert.equal(snapshot.usageEvents, 2);
  assert.equal(snapshot.priceTableVersion, "test.1");
  assert.deepEqual(meter.shouldStop(), { stop: false });
});

test("stops exactly at the cost threshold and not one token before", () => {
  // Ceiling 10 USD, threshold 90% -> stop at 9 USD. Input tokens cost 1/M, so
  // 9,000,000 input tokens are exactly 9 USD and 8,999,999 are just below.
  const below = meterWith({ budgets: { maximumTokens: 100_000_000 } });
  below.recordUsage({ model: "priced-model", inputTokens: 8_999_999, outputTokens: 0 });
  assert.deepEqual(below.shouldStop(), { stop: false });

  const at = meterWith({ budgets: { maximumTokens: 100_000_000 } });
  at.recordUsage({ model: "priced-model", inputTokens: 9_000_000, outputTokens: 0 });
  assert.deepEqual(at.shouldStop(), { stop: true, reason: "cost-threshold" });
  assert.equal(at.snapshot().stopReason, "cost-threshold");
});

test("stops at the token threshold independently of cost", () => {
  const meter = meterWith({ budgets: { maximumCostUsd: 1_000_000, maximumTokens: 1_000 } });
  meter.recordUsage({ model: "priced-model", inputTokens: 899, outputTokens: 0 });
  assert.deepEqual(meter.shouldStop(), { stop: false });
  meter.recordUsage({ model: "priced-model", inputTokens: 1, outputTokens: 0 });
  assert.deepEqual(meter.shouldStop(), { stop: true, reason: "token-threshold" });
});

test("stops at the duration threshold without any usage event", () => {
  let clock = 0;
  const meter = meterWith({ budgets: { maximumDurationMs: 1_000 }, now: () => clock });
  assert.deepEqual(meter.shouldStop(), { stop: false });
  clock = 899;
  assert.deepEqual(meter.shouldStop(), { stop: false });
  clock = 900;
  assert.deepEqual(meter.shouldStop(), { stop: true, reason: "duration-threshold" });
  assert.equal(meter.snapshot().consumedDurationMs, 900);
});

test("the first stop reason is retained rather than overwritten", () => {
  let clock = 0;
  const meter = meterWith({ budgets: { maximumTokens: 100, maximumDurationMs: 1_000 }, now: () => clock });
  meter.recordUsage({ model: "priced-model", inputTokens: 100, outputTokens: 0 });
  assert.deepEqual(meter.shouldStop(), { stop: true, reason: "token-threshold" });
  clock = 5_000;
  assert.deepEqual(meter.shouldStop(), { stop: true, reason: "token-threshold" });
});

test("an unknown model fails closed instead of running for free", () => {
  const meter = meterWith();
  assert.throws(() => meter.recordUsage({ model: "unpriced-model", inputTokens: 1, outputTokens: 1 }), {
    code: "VES_BUDGET_MODEL_UNKNOWN"
  });
});

for (const [label, event] of [
  ["negative input tokens", { model: "priced-model", inputTokens: -1, outputTokens: 0 }],
  ["fractional output tokens", { model: "priced-model", inputTokens: 0, outputTokens: 1.5 }],
  ["a NaN count", { model: "priced-model", inputTokens: Number.NaN, outputTokens: 0 }],
  ["a string count", { model: "priced-model", inputTokens: "10", outputTokens: 0 }],
  ["an empty model name", { model: "", inputTokens: 1, outputTokens: 1 }],
  ["a null event", null]
]) {
  test(`usage with ${label} is rejected as a bypass attempt`, () => {
    const meter = meterWith();
    assert.throws(() => meter.recordUsage(event), { code: "VES_BUDGET_USAGE_INVALID" });
    assert.equal(meter.snapshot().usageEvents, 0);
  });
}

test("a zero-usage run stays well below every threshold", () => {
  const meter = meterWith();
  const snapshot = meter.snapshot();
  assert.equal(snapshot.consumedCostUsd, 0);
  assert.equal(snapshot.consumedTokens, 0);
  assert.equal(snapshot.stopReason, null);
});

for (const [label, budgets] of [
  ["a zero cost ceiling", { maximumCostUsd: 0 }],
  ["a negative token ceiling", { maximumTokens: -1 }],
  ["an infinite duration ceiling", { maximumDurationMs: Number.POSITIVE_INFINITY }]
]) {
  test(`${label} is rejected at construction`, () => {
    assert.throws(() => meterWith({ budgets }), { code: "VES_BUDGET_INVALID" });
  });
}

test("the snapshot is frozen evidence, not a live view", () => {
  const meter = meterWith();
  const snapshot = meter.snapshot();
  assert.ok(Object.isFrozen(snapshot));
  meter.recordUsage({ model: "priced-model", inputTokens: 10, outputTokens: 0 });
  assert.equal(snapshot.usageEvents, 0);
  assert.equal(meter.snapshot().usageEvents, 1);
});

// invariant: usage on a subscription has tokens and duration but no cost
// (SPA-17). A model named as unbilled is never priced; every other model keeps
// the priced path and still fails closed without a price.
const subscription = (overrides = {}) =>
  createBudgetMeter({
    budgets: { maximumCostUsd: 1, maximumTokens: 1_000, maximumDurationMs: 60_000 },
    priceTable: PRICES,
    unbilledModels: ["plan-model"],
    ...overrides
  });

test("usage of an unbilled model counts tokens and events and adds no cost", () => {
  const meter = subscription();
  meter.recordUsage({ model: "plan-model", inputTokens: 100, outputTokens: 50 });
  const ledger = meter.ledger();
  assert.equal(ledger.consumedCostUsd, 0);
  assert.equal(ledger.consumedTokens, 150);
  assert.equal(ledger.unbilledTokens, 150);
  assert.equal(ledger.usageEvents, 1);
  assert.equal(meter.snapshot().unbilledTokens, 150);
  assert.equal(budgetBilling(ledger), "subscription");
  assert.equal(meter.shouldStop().stop, false);
});

test("an unbilled model still stops at the token and duration thresholds, never at the cost one", () => {
  const tokens = subscription();
  tokens.recordUsage({ model: "plan-model", inputTokens: 500, outputTokens: 400 });
  assert.deepEqual(tokens.shouldStop(), { stop: true, reason: "token-threshold" });
  assert.equal(tokens.ledger().consumedCostUsd, 0);
  let now = 0;
  const duration = subscription({ now: () => now });
  duration.recordUsage({ model: "plan-model", inputTokens: 1, outputTokens: 1 });
  now = 54_000;
  assert.deepEqual(duration.shouldStop(), { stop: true, reason: "duration-threshold" });
});

test("an unbilled model needs no price, while a billed unknown model still fails closed", () => {
  const meter = subscription({ unbilledModels: ["other-plan-model"] });
  meter.recordUsage({ model: "other-plan-model", inputTokens: 10, outputTokens: 10 });
  assert.equal(meter.ledger().unbilledTokens, 20);
  assert.throws(() => meter.recordUsage({ model: "unpriced-model", inputTokens: 1, outputTokens: 1 }), {
    code: "VES_BUDGET_MODEL_UNKNOWN"
  });
  // invariant: without the mode's declaration the same model is billed, and
  // a billed model without a price never runs for free.
  for (const unbilledModels of [undefined, []])
    assert.throws(
      () => subscription({ unbilledModels }).recordUsage({ model: "plan-model", inputTokens: 1, outputTokens: 1 }),
      { code: "VES_BUDGET_MODEL_UNKNOWN" }
    );
});

test("billed and unbilled usage in one run is mixed, and only the billed part has a cost", () => {
  const meter = subscription();
  meter.recordUsage({ model: "plan-model", inputTokens: 100, outputTokens: 0 });
  meter.recordUsage({ model: "priced-model", inputTokens: 100, outputTokens: 0 });
  const ledger = meter.ledger();
  assert.equal(ledger.consumedTokens, 200);
  assert.equal(ledger.unbilledTokens, 100);
  assert.equal(ledger.consumedCostUsd, (100 * PRICES.models["priced-model"].inputPerMToken) / 1_000_000);
  assert.equal(budgetBilling(ledger), "mixed");
});

test("a ledger of billed usage alone carries no unbilled member, exactly as before", () => {
  const meter = subscription({ unbilledModels: undefined });
  meter.recordUsage({ model: "priced-model", inputTokens: 10, outputTokens: 10 });
  assert.deepEqual(Object.keys(meter.ledger()), [
    "consumedCostUsd",
    "consumedTokens",
    "consumedDurationMs",
    "usageEvents",
    "stopReason"
  ]);
  assert.equal(Object.hasOwn(meter.snapshot(), "unbilledTokens"), false);
  assert.equal(budgetBilling(meter.ledger()), "per-token");
});

test("unbilled tokens survive a resume and a tampered count is refused", () => {
  const first = subscription();
  first.recordUsage({ model: "plan-model", inputTokens: 100, outputTokens: 50 });
  const resumed = subscription({ resume: first.ledger() });
  resumed.recordUsage({ model: "plan-model", inputTokens: 10, outputTokens: 0 });
  assert.equal(resumed.ledger().unbilledTokens, 160);
  assert.equal(resumed.ledger().consumedTokens, 160);
  for (const unbilledTokens of [151, -1, 1.5, "150"])
    assert.throws(() => subscription({ resume: { ...first.ledger(), unbilledTokens } }), {
      code: "VES_BUDGET_INVALID"
    });
  for (const unbilledModels of ["plan-model", [""], [1]])
    assert.throws(() => subscription({ unbilledModels }), { code: "VES_BUDGET_INVALID" });
});

test("a run metered for a subscription reports no dollar figure even before its first usage", () => {
  const meter = subscription();
  assert.equal(meter.ledger().unbilledTokens, 0);
  assert.equal(budgetBilling(meter.ledger()), "subscription");
  const resumed = meterWith({ resume: meter.ledger() });
  assert.equal(resumed.ledger().unbilledTokens, 0);
  // invariant: once billed usage arrives with none unbilled, the run is
  // billed per token, not mixed.
  resumed.recordUsage({ model: "priced-model", inputTokens: 10, outputTokens: 0 });
  assert.equal(budgetBilling(resumed.ledger()), "per-token");
});
