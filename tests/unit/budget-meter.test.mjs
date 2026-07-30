import assert from "node:assert/strict";
import { test } from "node:test";

import { createBudgetMeter } from "../../packages/application/src/execution/budget-meter.ts";

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
