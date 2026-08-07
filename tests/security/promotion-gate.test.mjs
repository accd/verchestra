// T74 security (#15, PROM-01/02/05/06): the sealed-holdout evaluator signs with
// an identity distinct from the candidate, blocks promotion on contamination,
// mutation, insufficient repetition, or a shared identity, and emits a
// tamper-resistant report that carries no path or secret.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { assertReportUntampered } from "../../packages/application/src/index.ts";
import { EVALUATOR_KEY_ID, runPromotion, sealHoldout } from "../../apps/vestra-cli/src/promotion-composition.ts";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const digest = (character) => `sha256:${character.repeat(64)}`;
const NO_PATH = /[A-Za-z]:\\Users|\/(?:Users|home)\/[^/\s]+/u;

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

test("a clean candidate is PROMOTED and its report verifies untampered", async () => {
  const outcome = await runPromotion(oracle(), candidate());
  assert.equal(outcome.decision.verdict, "PROMOTED");
  assert.ok(outcome.artifact, "a signed promotion artifact was produced");
  assert.doesNotThrow(() => assertReportUntampered(outcome.report, sha));
});

test("the promotion is signed by an evaluator identity distinct from the candidate", async () => {
  const outcome = await runPromotion(oracle(), candidate());
  assert.equal(outcome.report.evaluatorKeyId, EVALUATOR_KEY_ID);
  assert.notEqual(outcome.report.evaluatorKeyId, "candidate-driver");
});

test("a candidate reusing the evaluator identity is blocked", async () => {
  const outcome = await runPromotion(oracle(), candidate({ candidateKeyId: EVALUATOR_KEY_ID }));
  assert.equal(outcome.decision.verdict, "BLOCKED");
  assert.ok(outcome.decision.blocks.includes("VES_PROMOTION_SHARED_IDENTITY"));
});

test("a contamination fact blocks promotion even with all-pass results", async () => {
  const outcome = await runPromotion(oracle(), candidate({ contaminated: true }));
  assert.deepEqual([...outcome.decision.blocks], ["VES_PROMOTION_CONTAMINATED"]);
});

test("a mutated candidate digest blocks promotion", async () => {
  const outcome = await runPromotion(oracle(), candidate({ candidateDigestNow: digest("d") }));
  assert.ok(outcome.decision.blocks.includes("VES_PROMOTION_CANDIDATE_MUTATED"));
});

test("insufficient repetition blocks promotion", async () => {
  const outcome = await runPromotion(
    oracle(),
    candidate({ results: [result("camp-a"), result("camp-b", { samples: 5 })] })
  );
  assert.ok(outcome.decision.blocks.includes("VES_PROMOTION_INSUFFICIENT_REPETITION"));
});

test("a campaign below its sealed threshold blocks promotion", async () => {
  const outcome = await runPromotion(
    oracle(),
    candidate({ results: [result("camp-a"), result("camp-b", { lowerConfidenceBound: 0.4 })] })
  );
  assert.ok(outcome.decision.blocks.includes("VES_PROMOTION_CAMPAIGN_FAILED"));
});

test("the holdout seal is deterministic and drift-sensitive", () => {
  assert.equal(sealHoldout(oracle()), sealHoldout(oracle()));
  const drifted = oracle();
  drifted.entries[0].threshold = 0.5;
  assert.notEqual(sealHoldout(drifted), sealHoldout(oracle()));
});

test("altering the sealed report is detected as tamper", async () => {
  const outcome = await runPromotion(oracle(), candidate());
  assert.throws(() => assertReportUntampered({ ...outcome.report, candidateDigest: digest("e") }, sha), {
    code: "VES_PROMOTION_REPORT_TAMPERED"
  });
});

test("neither the report nor the sealed artifact carries an absolute path", async () => {
  const outcome = await runPromotion(oracle(), candidate({ contaminated: true }));
  assert.doesNotMatch(JSON.stringify(outcome.report), NO_PATH);
  assert.doesNotMatch(JSON.stringify(outcome.artifact), NO_PATH);
});

test("a blocked promotion still seals a report recording the exact block", async () => {
  const outcome = await runPromotion(oracle(), candidate({ contaminated: true }));
  assert.equal(outcome.report.verdict, "BLOCKED");
  assert.deepEqual([...outcome.report.blocks], ["VES_PROMOTION_CONTAMINATED"]);
  assert.ok(outcome.artifact);
});

test("the report binds the exact candidate and holdout digests", async () => {
  const outcome = await runPromotion(oracle(), candidate());
  assert.equal(outcome.report.candidateDigest, digest("c"));
  assert.equal(outcome.report.holdoutDigest, sealHoldout(oracle()));
  assert.equal(outcome.report.policyId, "release-policy");
});
