import assert from "node:assert/strict";
import { test } from "node:test";

import { capsuleExpectation, capsuleHarness, capsuleInput } from "../helpers/run-capsule-fixture.mjs";

const budgetEvidence = (overrides = {}) => ({
  declared: { maximumCostUsd: 25, maximumTokens: 2_000_000, maximumDurationMs: 3_600_000, ...overrides.declared },
  consumed: { costUsd: 22.5, tokens: 1_400_000, durationMs: 1_812_000, usageEvents: 41, ...overrides.consumed },
  priceTableVersion: overrides.priceTableVersion ?? "2026.7.0",
  stopReason: overrides.stopReason === undefined ? "cost-threshold" : overrides.stopReason
});

test("declared-versus-consumed budget evidence seals and survives verification", async () => {
  const input = { ...capsuleInput("FAILED"), budgetEvidence: budgetEvidence() };
  const { builder, trust } = capsuleHarness();
  const sealed = await builder.build(input);
  assert.deepEqual(sealed.payload.budgetEvidence, budgetEvidence());
  const verdict = await builder.verify(sealed, trust, capsuleExpectation(input));
  assert.equal(verdict.ok, true);
});

test("a completed run may seal budget evidence with no stop reason", async () => {
  const input = { ...capsuleInput("COMPLETED"), budgetEvidence: budgetEvidence({ stopReason: null }) };
  const { builder } = capsuleHarness();
  const sealed = await builder.build(input);
  assert.equal(sealed.payload.budgetEvidence.stopReason, null);
});

test("a capsule without budget evidence still seals, so older runs stay valid", async () => {
  const { builder } = capsuleHarness();
  const sealed = await builder.build(capsuleInput("COMPLETED"));
  assert.equal(sealed.payload.budgetEvidence, undefined);
});

for (const [label, corrupt] of [
  ["a negative consumed cost", budgetEvidence({ consumed: { costUsd: -1 } })],
  ["a zero declared ceiling", budgetEvidence({ declared: { maximumCostUsd: 0 } })],
  ["an infinite consumed duration", budgetEvidence({ consumed: { durationMs: Number.POSITIVE_INFINITY } })],
  ["a non-string stop reason", budgetEvidence({ stopReason: 42 })],
  ["an unknown field", { ...budgetEvidence(), currency: "USD" }],
  ["a missing consumed block", { declared: budgetEvidence().declared, priceTableVersion: "2026.7.0", stopReason: null }]
]) {
  test(`budget evidence with ${label} is rejected`, async () => {
    const input = { ...capsuleInput("FAILED"), budgetEvidence: corrupt };
    const { builder } = capsuleHarness();
    await assert.rejects(builder.build(input), { code: "VES_RUN_CAPSULE_INVALID" });
  });
}
