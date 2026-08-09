import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  assertPromotionReport,
  assertReportUntampered,
  buildPromotionReport,
  canonicalizeOracle,
  evaluatePromotion
} from "../../packages/application/src/index.ts";

const sha = (value) => createHash("sha256").update(value).digest("hex");
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

function input(overrides = {}) {
  const holdout = overrides.oracle ?? oracle();
  return {
    oracle: holdout,
    sealedHoldoutDigest: `sha256:${sha(canonicalizeOracle(holdout))}`,
    candidateDigestAtSeal: digest("c"),
    candidateDigestNow: digest("c"),
    evaluatorKeyId: "holdout-evaluator",
    candidateKeyId: "candidate-driver",
    contaminated: false,
    results: [result("camp-a"), result("camp-b")],
    ...overrides
  };
}

const decide = (overrides) => evaluatePromotion(input(overrides), sha);

test("a clean, sealed, sufficiently repeated candidate is PROMOTED", () => {
  const decision = decide();
  assert.equal(decision.verdict, "PROMOTED");
  assert.deepEqual([...decision.blocks], []);
});

test("a tampered oracle digest blocks promotion", () => {
  assert.deepEqual([...decide({ sealedHoldoutDigest: digest("f") }).blocks], ["VES_PROMOTION_ORACLE_TAMPERED"]);
});

test("a drifted threshold changes the oracle digest and blocks promotion", () => {
  const drifted = oracle();
  const sealed = `sha256:${sha(canonicalizeOracle(drifted))}`;
  drifted.entries[0].threshold = 0.5; // change after sealing
  assert.deepEqual(
    [...decide({ oracle: drifted, sealedHoldoutDigest: sealed }).blocks],
    ["VES_PROMOTION_ORACLE_TAMPERED"]
  );
});

test("a mutated candidate digest blocks promotion", () => {
  assert.deepEqual([...decide({ candidateDigestNow: digest("d") }).blocks], ["VES_PROMOTION_CANDIDATE_MUTATED"]);
});

test("a shared evaluator and candidate identity blocks promotion", () => {
  assert.deepEqual([...decide({ candidateKeyId: "holdout-evaluator" }).blocks], ["VES_PROMOTION_SHARED_IDENTITY"]);
});

test("a contamination fact blocks promotion even with all-pass results", () => {
  assert.deepEqual([...decide({ contaminated: true }).blocks], ["VES_PROMOTION_CONTAMINATED"]);
});

test("insufficient repetition blocks promotion", () => {
  const results = [result("camp-a"), result("camp-b", { samples: 10 })];
  assert.deepEqual([...decide({ results }).blocks], ["VES_PROMOTION_INSUFFICIENT_REPETITION"]);
});

test("a missing campaign result counts as insufficient repetition", () => {
  assert.deepEqual([...decide({ results: [result("camp-a")] }).blocks], ["VES_PROMOTION_INSUFFICIENT_REPETITION"]);
});

test("a campaign lower bound below its threshold blocks promotion", () => {
  const results = [result("camp-a"), result("camp-b", { lowerConfidenceBound: 0.5 })];
  assert.deepEqual([...decide({ results }).blocks], ["VES_PROMOTION_CAMPAIGN_FAILED"]);
});

test("multiple block conditions accumulate, sorted and deduplicated", () => {
  const decision = decide({ contaminated: true, candidateDigestNow: digest("d") });
  assert.deepEqual([...decision.blocks], ["VES_PROMOTION_CANDIDATE_MUTATED", "VES_PROMOTION_CONTAMINATED"]);
});

test("a promoted report is well-formed and verifies untampered", () => {
  const request = input();
  const report = buildPromotionReport(request, evaluatePromotion(request, sha), sha);
  assert.equal(report.verdict, "PROMOTED");
  assert.deepEqual([...report.blocks], []);
  assert.doesNotThrow(() => assertReportUntampered(report, sha));
});

test("a blocked report records its block codes", () => {
  const request = input({ contaminated: true });
  const report = buildPromotionReport(request, evaluatePromotion(request, sha), sha);
  assert.equal(report.verdict, "BLOCKED");
  assert.deepEqual([...report.blocks], ["VES_PROMOTION_CONTAMINATED"]);
});

test("altering a report field is detected as tamper", () => {
  const request = input();
  const report = buildPromotionReport(request, evaluatePromotion(request, sha), sha);
  // A different but well-formed candidate digest passes the allowlist yet no
  // longer reproduces the sealed body digest.
  assert.throws(() => assertReportUntampered({ ...report, candidateDigest: digest("e") }, sha), {
    code: "VES_PROMOTION_REPORT_TAMPERED"
  });
});

for (const [name, mutate] of [
  ["an unknown field", (report) => ({ ...report, extra: 1 })],
  ["a bad verdict", (report) => ({ ...report, verdict: "MAYBE" })],
  ["a non-digest candidate", (report) => ({ ...report, candidateDigest: "nope" })],
  ["an unregistered block code", (report) => ({ ...report, blocks: ["VES_PROMOTION_UNKNOWN"] })],
  ["a verdict that disagrees with its blocks", (report) => ({ ...report, verdict: "PROMOTED", blocks: ["x"] })]
]) {
  test(`the report allowlist rejects ${name}`, () => {
    const request = input();
    const report = buildPromotionReport(request, evaluatePromotion(request, sha), sha);
    assert.throws(() => assertPromotionReport(mutate(report)), { code: "VES_PROMOTION_REPORT_INVALID" });
  });
}

for (const [name, overrides] of [
  ["a non-digest sealed holdout", { sealedHoldoutDigest: "nope" }],
  ["an invalid evaluator id", { evaluatorKeyId: "Bad_Id" }],
  ["a non-boolean contamination fact", { contaminated: "no" }]
]) {
  test(`promotion input validation rejects ${name}`, () => {
    assert.throws(() => decide(overrides), { code: "VES_PROMOTION_INPUT_INVALID" });
  });
}

// CJ4-03/CJ4-07: canonicalizeOracle orders entries by code unit, not by
// whatever order the caller happened to declare them or by ambient locale.
test("canonicalizeOracle orders entries by campaignId regardless of declaration order", () => {
  const forward = oracle();
  const reversed = { policyId: forward.policyId, entries: [...forward.entries].reverse() };
  assert.equal(canonicalizeOracle(forward), canonicalizeOracle(reversed));
});

test("canonicalizeOracle produces byte-identical output under two different ambient locales", () => {
  const value = {
    policyId: "release-policy",
    entries: [
      { campaignId: "camp-z", threshold: 0.9, repetitionCount: 1 },
      { campaignId: "camp-a", threshold: 0.85, repetitionCount: 50 }
    ]
  };
  const priorLang = process.env.LANG;
  const priorLcAll = process.env.LC_ALL;
  try {
    process.env.LANG = "en_US.UTF-8";
    process.env.LC_ALL = "en_US.UTF-8";
    const first = canonicalizeOracle(value);
    process.env.LANG = "fr_FR.UTF-8";
    process.env.LC_ALL = "fr_FR.UTF-8";
    const second = canonicalizeOracle(value);
    assert.equal(first, second);
  } finally {
    if (priorLang === undefined) delete process.env.LANG;
    else process.env.LANG = priorLang;
    if (priorLcAll === undefined) delete process.env.LC_ALL;
    else process.env.LC_ALL = priorLcAll;
  }
});
