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

function observations(campA = Array(100).fill(true), campB = Array(100).fill(true)) {
  return [
    { campaignId: "camp-a", outcomes: campA },
    { campaignId: "camp-b", outcomes: campB }
  ];
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
    observations: observations(),
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
  assert.deepEqual(
    [...decide({ observations: observations(Array(100).fill(true), Array(10).fill(true)) }).blocks],
    ["VES_PROMOTION_INSUFFICIENT_REPETITION"]
  );
});

test("a missing campaign result counts as insufficient repetition", () => {
  assert.deepEqual(
    [...decide({ observations: [{ campaignId: "camp-a", outcomes: Array(100).fill(true) }] }).blocks],
    ["VES_PROMOTION_INSUFFICIENT_REPETITION"]
  );
});

test("a campaign lower bound below its threshold blocks promotion", () => {
  assert.deepEqual(
    [...decide({ observations: observations(Array(100).fill(true), Array(100).fill(false)) }).blocks],
    ["VES_PROMOTION_CAMPAIGN_FAILED"]
  );
});

// VES-RLS-006 / PROM-01: the oracle sealed under the holdout digest is
// "campaign ids, thresholds, repetition counts", and PROM-04 relies on that
// digest alone to catch drift. So every one of those fields has to be inside
// the sealed bytes: a repetition count that could drift outside the digest
// would let a candidate be promoted on less evidence than the oracle
// predeclared, with nothing in the decision recording that it happened.
test("VES-RLS-006: every sealed oracle field is covered by the holdout digest", () => {
  for (const [name, drift] of [
    [
      "a lowered threshold",
      (holdout) => {
        holdout.entries[0].threshold = 0.5;
      }
    ],
    [
      // Raised, but still under the observed lower bound, so the drift itself
      // is the only thing this run can block on.
      "a raised threshold",
      (holdout) => {
        holdout.entries[1].threshold = 0.95;
      }
    ],
    [
      "a lowered repetition count",
      (holdout) => {
        holdout.entries[1].repetitionCount = 1;
      }
    ],
    [
      "a raised repetition count",
      (holdout) => {
        holdout.entries[0].repetitionCount = 5;
      }
    ],
    [
      "a changed policy id",
      (holdout) => {
        holdout.policyId = "other-policy";
      }
    ]
  ]) {
    const drifted = oracle();
    const sealed = `sha256:${sha(canonicalizeOracle(drifted))}`;
    drift(drifted); // change after sealing
    assert.notEqual(`sha256:${sha(canonicalizeOracle(drifted))}`, sealed, name);
    assert.deepEqual(
      [...decide({ oracle: drifted, sealedHoldoutDigest: sealed }).blocks],
      ["VES_PROMOTION_ORACLE_TAMPERED"],
      name
    );
  }
});

// The membership half of PROM-01. Both runs below are internally consistent —
// the oracle, its entries, and the observations all agree with each other — so
// the sealed digest is the only thing that can notice that the oracle being
// evaluated is not the oracle the candidate was bound to.
test("VES-RLS-006: an oracle that lost or gained a campaign after sealing blocks promotion", () => {
  const sealed = `sha256:${sha(canonicalizeOracle(oracle()))}`;
  const reduced = { policyId: "release-policy", entries: [oracle().entries[0]] };
  assert.deepEqual(
    [
      ...decide({
        oracle: reduced,
        sealedHoldoutDigest: sealed,
        observations: [{ campaignId: "camp-a", outcomes: Array(100).fill(true) }]
      }).blocks
    ],
    ["VES_PROMOTION_ORACLE_TAMPERED"],
    "dropping a sealed campaign is detected"
  );
  const widened = oracle();
  widened.entries.push({ campaignId: "camp-c", threshold: 0.9, repetitionCount: 1 });
  assert.deepEqual(
    [
      ...decide({
        oracle: widened,
        sealedHoldoutDigest: sealed,
        observations: [...observations(), { campaignId: "camp-c", outcomes: Array(100).fill(true) }]
      }).blocks
    ],
    ["VES_PROMOTION_ORACLE_TAMPERED"],
    "adding a campaign after sealing is detected"
  );
});

// VES-MDL-003 / PROM-07: the verdict is taken from each campaign's lower
// confidence bound, never from its point estimate. camp-b is sealed at a 0.85
// threshold; 47 of 50 is a 0.94 pass rate whose Wilson lower bound is 0.8378,
// so a gate that compared the score would promote this candidate and a gate
// that compares the distribution blocks it.
test("VES-MDL-003: a candidate whose point estimate clears every threshold is blocked on the bound", () => {
  const decision = decide({
    observations: observations(
      Array(100).fill(true),
      Array.from({ length: 50 }, (_, index) => index < 47)
    )
  });
  assert.equal(decision.verdict, "BLOCKED");
  assert.deepEqual([...decision.blocks], ["VES_PROMOTION_CAMPAIGN_FAILED"]);
});

// VES-MDL-003 / PROM-03: repetition is predeclared, so a flawless run is not a
// substitute for enough of them. The pair is asserted at the sealed boundary
// (49 versus 50) because that is where a repetition check that is present but
// off by one still looks like it works.
test("VES-MDL-003: a perfect but under-repeated run is blocked at the sealed repetition count", () => {
  const perfect = (samples) => observations(Array(100).fill(true), Array(samples).fill(true));
  assert.deepEqual(
    [...decide({ observations: perfect(49) }).blocks],
    ["VES_PROMOTION_INSUFFICIENT_REPETITION"],
    "one sample short of the sealed count is not enough evidence"
  );
  assert.equal(decide({ observations: perfect(50) }).verdict, "PROMOTED");
});

test("duplicate and extra observations fail closed instead of using last-write-wins", () => {
  assert.throws(
    () => decide({ observations: [...observations(), { campaignId: "camp-a", outcomes: Array(100).fill(true) }] }),
    { code: "VES_PROMOTION_INPUT_INVALID" }
  );
  assert.throws(() => decide({ observations: [...observations(), { campaignId: "camp-extra", outcomes: [true] }] }), {
    code: "VES_PROMOTION_INPUT_INVALID"
  });
});

test("non-boolean observations fail closed before campaign statistics are derived", () => {
  assert.throws(() => decide({ observations: observations(["true", ...Array(99).fill(true)]) }), {
    code: "VES_PROMOTION_INPUT_INVALID"
  });
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
