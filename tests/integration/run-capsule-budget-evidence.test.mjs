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

// invariant: a run on subscriptions carries no dollar figure (SPA-18). The
// billing member and the two members it governs must agree, and a block
// without it is the per-token one, read exactly as before.
const subscriptionEvidence = (overrides = {}) => {
  const { costUsd: omitted, ...consumed } = budgetEvidence({ stopReason: null }).consumed;
  assert.equal(omitted, 22.5);
  return {
    ...budgetEvidence({ stopReason: null }),
    consumed: { ...consumed, unbilledTokens: consumed.tokens, ...overrides.consumed },
    billing: overrides.billing ?? "subscription"
  };
};

test("subscription budget evidence seals without a cost and survives verification", async () => {
  const input = { ...capsuleInput("COMPLETED"), budgetEvidence: subscriptionEvidence() };
  const { builder, trust } = capsuleHarness();
  const sealed = await builder.build(input);
  assert.deepEqual(sealed.payload.budgetEvidence, subscriptionEvidence());
  assert.equal(Object.hasOwn(sealed.payload.budgetEvidence.consumed, "costUsd"), false);
  assert.equal(sealed.payload.budgetEvidence.billing, "subscription");
  assert.equal((await builder.verify(sealed, trust, capsuleExpectation(input))).ok, true);
});

test("mixed budget evidence carries the billed cost and the unbilled tokens", async () => {
  const evidence = subscriptionEvidence({ billing: "mixed", consumed: { costUsd: 1.25, unbilledTokens: 900_000 } });
  const sealed = await capsuleHarness().builder.build({ ...capsuleInput("COMPLETED"), budgetEvidence: evidence });
  assert.deepEqual(sealed.payload.budgetEvidence, evidence);
});

for (const [label, corrupt] of [
  ["a cost on subscription billing", subscriptionEvidence({ consumed: { costUsd: 0 } })],
  ["subscription billing with billed tokens left over", subscriptionEvidence({ consumed: { unbilledTokens: 1 } })],
  ["subscription billing without unbilled tokens", subscriptionEvidence({ consumed: { unbilledTokens: undefined } })],
  ["mixed billing without a cost", subscriptionEvidence({ billing: "mixed", consumed: { unbilledTokens: 5 } })],
  ["mixed billing with every token unbilled", subscriptionEvidence({ billing: "mixed", consumed: { costUsd: 1 } })],
  [
    "mixed billing with no token unbilled",
    subscriptionEvidence({ billing: "mixed", consumed: { costUsd: 1, unbilledTokens: 0 } })
  ],
  ["an unknown billing", subscriptionEvidence({ billing: "free" })],
  ["unbilled tokens without billing", budgetEvidence({ consumed: { unbilledTokens: 10 } })],
  [
    "a missing cost without billing",
    { ...budgetEvidence(), consumed: { tokens: 1_400_000, durationMs: 1_812_000, usageEvents: 41 } }
  ]
]) {
  test(`budget evidence with ${label} is rejected`, async () => {
    const input = { ...capsuleInput("COMPLETED"), budgetEvidence: corrupt };
    await assert.rejects(capsuleHarness().builder.build(input), { code: "VES_RUN_CAPSULE_INVALID" });
  });
}
