// T74 (#15, PROM-07): the sealed-holdout evaluator end to end — a clean
// candidate is PROMOTED, and each block condition yields BLOCKED with its exact
// code. The promotion report validates against promotion-report@1.
import assert from "node:assert/strict";
import { test } from "node:test";

import { SchemaRegistry } from "../../packages/contracts/src/schema-registry.ts";
import { EVALUATOR_KEY_ID, runPromotion, sealHoldout } from "../../apps/vestra-cli/src/promotion-composition.ts";

const registry = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));
const digest = (character) => `sha256:${character.repeat(64)}`;

function oracle() {
  return {
    policyId: "release-policy",
    entries: [
      { campaignId: "camp-a", threshold: 0.9, repetitionCount: 1 },
      { campaignId: "camp-b", threshold: 0.85, repetitionCount: 50 }
    ]
  };
}
function candidate(overrides = {}) {
  return {
    candidateDigestAtSeal: digest("c"),
    candidateDigestNow: digest("c"),
    candidateKeyId: "candidate-driver",
    contaminated: false,
    ...overrides
  };
}
function observationPort(overrides = {}) {
  const outcomes = {
    "camp-a": Array(100).fill(true),
    "camp-b": Array(100).fill(true),
    ...overrides
  };
  return { observe: (campaignId) => outcomes[campaignId] ?? [] };
}
const promote = (candidateOverrides = {}, observationOverrides = {}) =>
  runPromotion(oracle(), candidate(candidateOverrides), observationPort(observationOverrides));

test("a clean candidate is PROMOTED with no blocks", async () => {
  const outcome = await promote();
  assert.equal(outcome.decision.verdict, "PROMOTED");
  assert.deepEqual([...outcome.decision.blocks], []);
});

for (const [name, candidateOverrides, observationOverrides, expected] of [
  ["contamination", { contaminated: true }, {}, "VES_PROMOTION_CONTAMINATED"],
  ["candidate mutation", { candidateDigestNow: digest("d") }, {}, "VES_PROMOTION_CANDIDATE_MUTATED"],
  ["a shared identity", { candidateKeyId: EVALUATOR_KEY_ID }, {}, "VES_PROMOTION_SHARED_IDENTITY"],
  ["insufficient repetition", {}, { "camp-b": Array(2).fill(true) }, "VES_PROMOTION_INSUFFICIENT_REPETITION"],
  ["a missing campaign", {}, { "camp-b": [] }, "VES_PROMOTION_INSUFFICIENT_REPETITION"],
  ["a failing campaign", {}, { "camp-b": Array(100).fill(false) }, "VES_PROMOTION_CAMPAIGN_FAILED"]
]) {
  test(`${name} yields BLOCKED with the exact code`, async () => {
    const outcome = await promote(candidateOverrides, observationOverrides);
    assert.equal(outcome.decision.verdict, "BLOCKED");
    assert.deepEqual([...outcome.decision.blocks], [expected]);
  });
}

test("multiple block conditions accumulate", async () => {
  const outcome = await promote({ contaminated: true, candidateDigestNow: digest("d") });
  assert.deepEqual([...outcome.decision.blocks], ["VES_PROMOTION_CANDIDATE_MUTATED", "VES_PROMOTION_CONTAMINATED"]);
});

test("the report verdict agrees with the decision verdict", async () => {
  for (const candidateOverrides of [{}, { contaminated: true }]) {
    const outcome = await promote(candidateOverrides);
    assert.equal(outcome.report.verdict, outcome.decision.verdict);
  }
});

test("two clean runs promote deterministically with the same report body digest", async () => {
  const first = await promote();
  const second = await promote();
  assert.equal(first.decision.verdict, "PROMOTED");
  assert.equal(second.report.bodyDigest, first.report.bodyDigest);
});

test("the promotion report validates against promotion-report@1", async () => {
  for (const candidateOverrides of [{}, { contaminated: true }]) {
    const outcome = await promote(candidateOverrides);
    assert.doesNotThrow(() => registry.validate("promotion-report", "1", outcome.report));
  }
});

test("a campaign at or above its sealed threshold promotes", async () => {
  const outcome = await promote();
  assert.equal(outcome.decision.verdict, "PROMOTED");
});

test("the holdout digest in the report equals the sealed oracle digest", async () => {
  const outcome = await promote();
  assert.equal(outcome.report.holdoutDigest, sealHoldout(oracle()));
});

// T74 finding F2/F3: the sealed artifact must bind evaluator-observed raw
// outcomes, not candidate-provided aggregate metrics.
test("materially different passing observations produce a distinguishable sealed artifact", async () => {
  const holdout = {
    policyId: "release-policy",
    entries: [{ campaignId: "alpha", threshold: 0.8, repetitionCount: 50 }]
  };
  const candidateFacts = candidate({ candidateKeyId: "candidate-key" });
  const strong = await runPromotion(
    holdout,
    candidateFacts,
    observationPort({ alpha: [...Array(99).fill(true), false] })
  );
  const weak = await runPromotion(
    holdout,
    candidateFacts,
    observationPort({ alpha: [...Array(95).fill(true), ...Array(5).fill(false)] })
  );

  assert.equal(strong.decision.verdict, "PROMOTED");
  assert.equal(weak.decision.verdict, "PROMOTED");
  assert.notEqual(strong.report.evidenceDigest, weak.report.evidenceDigest);
  assert.notEqual(strong.report.bodyDigest, weak.report.bodyDigest);
  assert.notEqual(strong.artifact.sourceStateDigest, weak.artifact.sourceStateDigest);
  assert.notEqual(strong.artifact.payloadDigest, weak.artifact.payloadDigest);
});

test("the sealed source state binds the oracle as well as the observations", async () => {
  const candidateFacts = candidate({ candidateKeyId: "candidate-key" });
  const outcomes = observationPort({ alpha: [...Array(99).fill(true), false] });
  const first = await runPromotion(
    { policyId: "release-policy", entries: [{ campaignId: "alpha", threshold: 0.8, repetitionCount: 50 }] },
    candidateFacts,
    outcomes
  );
  const relaxedOracle = await runPromotion(
    { policyId: "release-policy", entries: [{ campaignId: "alpha", threshold: 0.5, repetitionCount: 50 }] },
    candidateFacts,
    outcomes
  );
  assert.notEqual(
    first.artifact.sourceStateDigest,
    relaxedOracle.artifact.sourceStateDigest,
    "the same observations under a different oracle must not share a source state"
  );
});
