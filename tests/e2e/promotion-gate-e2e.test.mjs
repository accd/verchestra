// T74 (#15, PROM-07): the sealed-holdout evaluator end to end — a clean
// candidate is PROMOTED, and each block condition yields BLOCKED with its exact
// code. The promotion report validates against promotion-report@1.
import assert from "node:assert/strict";
import { test } from "node:test";

import { SchemaRegistry } from "../../packages/contracts/src/schema-registry.ts";
import { runPromotion, sealHoldout, EVALUATOR_KEY_ID } from "../../apps/vestra-cli/src/promotion-composition.ts";

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
function result(id, overrides = {}) {
  return { id, samples: 100, passes: 100, passRate: 1, lowerConfidenceBound: 1, verdict: "PASS", ...overrides };
}
function candidate(overrides = {}) {
  return {
    candidateDigestAtSeal: digest("c"),
    candidateDigestNow: digest("c"),
    candidateKeyId: "candidate-driver",
    contaminated: false,
    results: [result("camp-a"), result("camp-b")],
    ...overrides
  };
}

test("a clean candidate is PROMOTED with no blocks", async () => {
  const outcome = await runPromotion(oracle(), candidate());
  assert.equal(outcome.decision.verdict, "PROMOTED");
  assert.deepEqual([...outcome.decision.blocks], []);
});

for (const [name, overrides, expected] of [
  ["contamination", { contaminated: true }, "VES_PROMOTION_CONTAMINATED"],
  ["candidate mutation", { candidateDigestNow: digest("d") }, "VES_PROMOTION_CANDIDATE_MUTATED"],
  ["a shared identity", { candidateKeyId: EVALUATOR_KEY_ID }, "VES_PROMOTION_SHARED_IDENTITY"],
  [
    "insufficient repetition",
    { results: [result("camp-a"), result("camp-b", { samples: 2 })] },
    "VES_PROMOTION_INSUFFICIENT_REPETITION"
  ],
  ["a missing campaign", { results: [result("camp-a")] }, "VES_PROMOTION_INSUFFICIENT_REPETITION"],
  [
    "a failing campaign",
    { results: [result("camp-a"), result("camp-b", { lowerConfidenceBound: 0.1 })] },
    "VES_PROMOTION_CAMPAIGN_FAILED"
  ]
]) {
  test(`${name} yields BLOCKED with the exact code`, async () => {
    const outcome = await runPromotion(oracle(), candidate(overrides));
    assert.equal(outcome.decision.verdict, "BLOCKED");
    assert.deepEqual([...outcome.decision.blocks], [expected]);
  });
}

test("multiple block conditions accumulate", async () => {
  const outcome = await runPromotion(oracle(), candidate({ contaminated: true, candidateDigestNow: digest("d") }));
  assert.deepEqual([...outcome.decision.blocks], ["VES_PROMOTION_CANDIDATE_MUTATED", "VES_PROMOTION_CONTAMINATED"]);
});

test("the report verdict agrees with the decision verdict", async () => {
  for (const overrides of [{}, { contaminated: true }]) {
    const outcome = await runPromotion(oracle(), candidate(overrides));
    assert.equal(outcome.report.verdict, outcome.decision.verdict);
  }
});

test("two clean runs promote deterministically with the same report body digest", async () => {
  const first = await runPromotion(oracle(), candidate());
  const second = await runPromotion(oracle(), candidate());
  assert.equal(first.decision.verdict, "PROMOTED");
  assert.equal(second.report.bodyDigest, first.report.bodyDigest);
});

test("the promotion report validates against promotion-report@1", async () => {
  for (const overrides of [{}, { contaminated: true }]) {
    const outcome = await runPromotion(oracle(), candidate(overrides));
    assert.doesNotThrow(() => registry.validate("promotion-report", "1", outcome.report));
  }
});

test("a campaign exactly at its threshold promotes", async () => {
  const outcome = await runPromotion(
    oracle(),
    candidate({ results: [result("camp-a"), result("camp-b", { lowerConfidenceBound: 0.85 })] })
  );
  assert.equal(outcome.decision.verdict, "PROMOTED");
});

test("the holdout digest in the report equals the sealed oracle digest", async () => {
  const outcome = await runPromotion(oracle(), candidate());
  assert.equal(outcome.report.holdoutDigest, sealHoldout(oracle()));
});

// T74 finding F2, at the composition root: the sealed artifact's source state
// must rest on the oracle AND the admitted evidence. Binding the oracle alone
// let two runs on materially different evidence share a sourceStateDigest, so
// the signed artifact could not distinguish which evidence authorized it.
test("materially different passing evidence produces a distinguishable sealed artifact", async () => {
  const oracle = {
    policyId: "release-policy",
    entries: [{ campaignId: "alpha", threshold: 0.8, repetitionCount: 50 }]
  };
  const candidate = (samples, passes, lowerConfidenceBound) => ({
    candidateDigestAtSeal: `sha256:${"a".repeat(64)}`,
    candidateDigestNow: `sha256:${"a".repeat(64)}`,
    candidateKeyId: "candidate-key",
    contaminated: false,
    results: [{ id: "alpha", samples, passes, passRate: passes / samples, lowerConfidenceBound, verdict: "PASSED" }]
  });

  const strong = await runPromotion(oracle, candidate(100, 99, 0.99));
  const weak = await runPromotion(oracle, candidate(90, 81, 0.81));

  assert.equal(strong.decision.verdict, "PROMOTED");
  assert.equal(weak.decision.verdict, "PROMOTED");
  assert.notEqual(strong.report.evidenceDigest, weak.report.evidenceDigest);
  assert.notEqual(strong.report.bodyDigest, weak.report.bodyDigest);
  assert.notEqual(strong.artifact.sourceStateDigest, weak.artifact.sourceStateDigest);
  assert.notEqual(strong.artifact.payloadDigest, weak.artifact.payloadDigest);
});
