import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  assertPromotionReport,
  assertReportUntampered,
  buildPromotionReport,
  canonicalizeCampaignEvidence,
  canonicalizeOracle,
  evaluatePromotion,
  PROMOTION_REPORT_FIELDS
} from "../../packages/application/src/index.ts";

const hash = (input) => createHash("sha256").update(input, "utf8").digest("hex");

// T74 finding F2: the signed promotion decision bound candidate, oracle, policy
// and evaluator identity but NOT the admitted campaign evidence — so the same
// candidate promoted on materially different evidence produced byte-identical
// reports. These tests are written from the finding, not from the fix.

const oracle = {
  policyId: "release-policy",
  entries: [
    { campaignId: "alpha", threshold: 0.8, repetitionCount: 50 },
    { campaignId: "beta", threshold: 0.8, repetitionCount: 50 }
  ]
};

const result = (id, samples, passes, lowerConfidenceBound) => ({
  id,
  samples,
  passes,
  passRate: passes / samples,
  lowerConfidenceBound,
  verdict: "PASSED"
});

const input = (results) => ({
  oracle,
  sealedHoldoutDigest: `sha256:${hash(canonicalizeOracle(oracle))}`,
  candidateDigestAtSeal: `sha256:${"a".repeat(64)}`,
  candidateDigestNow: `sha256:${"a".repeat(64)}`,
  evaluatorKeyId: "evaluator-key",
  candidateKeyId: "candidate-key",
  contaminated: false,
  results
});

const report = (results) => {
  const built = input(results);
  return buildPromotionReport(built, evaluatePromotion(built, hash), hash);
};

const STRONG = [result("alpha", 100, 99, 0.99), result("beta", 100, 99, 0.99)];
const WEAK = [result("alpha", 90, 81, 0.81), result("beta", 90, 81, 0.81)];

test("the report carries an evidence digest", () => {
  assert.ok(PROMOTION_REPORT_FIELDS.includes("evidenceDigest"));
  assert.match(report(STRONG).evidenceDigest, /^sha256:[a-f0-9]{64}$/u);
});

test("two different passing evidence sets no longer produce the same signed decision", () => {
  // The exact experiment the T74 verifier ran: same candidate, same oracle, two
  // materially different passing evidence sets. Both promote — and before the
  // fix both produced identical reports, bodyDigest and payloadDigest, so the
  // artifact could not say which evidence authorized it.
  const strong = report(STRONG);
  const weak = report(WEAK);
  assert.equal(strong.verdict, "PROMOTED");
  assert.equal(weak.verdict, "PROMOTED");
  assert.notEqual(strong.evidenceDigest, weak.evidenceDigest, "the evidence digest must distinguish them");
  assert.notEqual(strong.bodyDigest, weak.bodyDigest, "the evidence must reach the integrity digest");
});

for (const [field, mutate] of [
  ["samples", (r) => ({ ...r, samples: r.samples + 1 })],
  ["passes", (r) => ({ ...r, passes: r.passes - 1 })],
  ["passRate", (r) => ({ ...r, passRate: r.passRate - 0.01 })],
  ["lowerConfidenceBound", (r) => ({ ...r, lowerConfidenceBound: r.lowerConfidenceBound - 0.01 })],
  ["verdict", (r) => ({ ...r, verdict: "FAILED" })],
  ["campaign identity", (r) => ({ ...r, id: "gamma" })]
]) {
  test(`changing ${field} changes the bound evidence digest`, () => {
    const changed = [mutate(STRONG[0]), STRONG[1]];
    assert.notEqual(
      report(STRONG).evidenceDigest,
      report(changed).evidenceDigest,
      `${field} must reach the evidence digest`
    );
  });
}

test("reordering the same evidence is identity-preserving", () => {
  // SPEC_DEVIATION from F2's literal text, asserted deliberately. Results are a
  // declared set keyed by campaign id, exactly as the oracle entries and block
  // codes already are. A digest that moved with iteration order would make the
  // same evidence sign differently on different machines — the opposite of the
  // reproducibility the binding exists to protect.
  assert.equal(canonicalizeCampaignEvidence(STRONG), canonicalizeCampaignEvidence([...STRONG].reverse()));
  assert.equal(report(STRONG).evidenceDigest, report([...STRONG].reverse()).evidenceDigest);
  assert.equal(report(STRONG).bodyDigest, report([...STRONG].reverse()).bodyDigest);
});

test("the evidence digest covers every campaign, not just the first", () => {
  const changedSecond = [STRONG[0], { ...STRONG[1], passes: STRONG[1].passes - 5 }];
  assert.notEqual(report(STRONG).evidenceDigest, report(changedSecond).evidenceDigest);
});

// Gaps an independent verifier's sensor found: three fields could leave the
// signed body or the source state undetected. Each is asserted per field rather
// than through a single composite comparison, because a composite passes as
// long as *something* differs.
test("every field of the signed body reaches its integrity digest", () => {
  const base = report(STRONG);
  for (const [field, value] of [
    ["candidateDigest", `sha256:${"9".repeat(64)}`],
    ["holdoutDigest", `sha256:${"8".repeat(64)}`],
    ["policyId", "other-policy"],
    ["evaluatorKeyId", "other-evaluator"],
    ["evidenceDigest", `sha256:${"7".repeat(64)}`]
  ]) {
    const altered = { ...base, [field]: value };
    assert.throws(() => assertReportUntampered(altered, hash), { code: "VES_PROMOTION_REPORT_TAMPERED" }, field);
  }

  // `verdict` is refused earlier and harder: a PROMOTED report carrying no
  // blocks cannot be flipped to BLOCKED at all, so the disagreement is caught
  // before the digest is ever recomputed. Asserting the tamper code here would
  // have been asserting the weaker of two guarantees.
  assert.throws(() => assertReportUntampered({ ...base, verdict: "BLOCKED" }, hash), {
    code: "VES_PROMOTION_REPORT_INVALID"
  });
});

test("the report rejects a malformed evidence digest at the application layer", () => {
  // Ajv catches this at the schema boundary, but the composition root builds and
  // asserts reports without going through the registry.
  assert.throws(() => assertPromotionReport({ ...report(STRONG), evidenceDigest: "not-a-digest" }), {
    code: "VES_PROMOTION_REPORT_INVALID"
  });
});
