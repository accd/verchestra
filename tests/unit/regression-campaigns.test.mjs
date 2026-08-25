import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MINIMUM_CAMPAIGNS,
  assertCampaignCorpus,
  assertCampaignSummary,
  buildCampaignSummary,
  canonicalizeCorpus,
  evaluateCampaign
} from "../../packages/application/src/index.ts";

function definition(index, overrides = {}) {
  return {
    id: `campaign-${index}`,
    requirement: `CAM-0${index % 6}`,
    owner: "verchestra",
    threshold: 0.9,
    fixtureRef: `fixtures/c-${index}`,
    evidenceRef: "docs/qualification/t73-validation.md",
    sampleSize: 1,
    ...overrides
  };
}

function corpus(count = MINIMUM_CAMPAIGNS) {
  return Array.from({ length: count }, (_, index) => definition(index));
}

const DIGEST = `sha256:${"a".repeat(64)}`;

test("a corpus of at least twenty well-formed campaigns is valid", () => {
  assert.doesNotThrow(() => assertCampaignCorpus(corpus()));
});

test("a corpus below the minimum fails closed", () => {
  assert.throws(() => assertCampaignCorpus(corpus(MINIMUM_CAMPAIGNS - 1)), { code: "VES_CAMPAIGN_CORPUS_INVALID" });
});

test("a duplicated campaign id fails closed", () => {
  const defs = corpus();
  defs[1] = definition(0);
  assert.throws(() => assertCampaignCorpus(defs), { code: "VES_CAMPAIGN_CORPUS_INVALID" });
});

for (const [name, overrides] of [
  ["an invalid id", { id: "Campaign_0" }],
  ["an invalid requirement", { requirement: "cam-1" }],
  ["an empty owner", { owner: "" }],
  ["a path-shaped fixtureRef", { fixtureRef: "/home/user/.secret" }],
  ["a threshold above one", { threshold: 1.5 }],
  ["a zero sample size", { sampleSize: 0 }]
]) {
  test(`a campaign with ${name} fails closed`, () => {
    const defs = corpus();
    defs[3] = definition(3, overrides);
    assert.throws(() => assertCampaignCorpus(defs), { code: "VES_CAMPAIGN_CORPUS_INVALID" });
  });
}

test("the canonical serialization is deterministic and change-sensitive", () => {
  assert.equal(canonicalizeCorpus(corpus()), canonicalizeCorpus(corpus()));
  const edited = corpus();
  edited[5] = definition(5, { threshold: 0.5 });
  assert.notEqual(canonicalizeCorpus(edited), canonicalizeCorpus(corpus()));
});

// Issue #58: the corpus encoder moved from bare JSON.stringify to the
// qualified canonical contract (canonicalizeJsonV2, RFC 8785 JCS). Replacing
// String.prototype.localeCompare with a comparator that reverses UTF-16
// code-unit order simulates a divergent locale collation without depending on
// a particular installed ICU locale actually disagreeing today.
function withHostileLocaleCompare(fn) {
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = function hostileLocaleCompare(other) {
    const left = String(this);
    return left < other ? 1 : left > other ? -1 : 0;
  };
  try {
    return fn();
  } finally {
    String.prototype.localeCompare = original;
  }
}

test("the sealed corpus encoding is byte-identical under a divergent locale collation", () => {
  const defs = corpus();
  assert.equal(
    withHostileLocaleCompare(() => canonicalizeCorpus(defs)),
    canonicalizeCorpus(defs)
  );
});

test("the corpus encoding does not depend on the order a definition wrote its members in", () => {
  const defs = corpus();
  const reordered = defs.map((entry) => Object.fromEntries(Object.entries(entry).reverse()));
  assert.equal(canonicalizeCorpus(reordered), canonicalizeCorpus(defs));
});

// The corpus digest is published evidence, so byte-compatibility across this
// migration has to be proven rather than assumed: the projection's members
// were already in UTF-16 code-unit order, so RFC 8785 emits exactly what the
// previous JSON.stringify call emitted and the published digest does not move.
test("moving the corpus encoder onto the qualified contract did not change the sealed bytes", () => {
  const defs = corpus();
  const priorEncoding = JSON.stringify(
    defs.map((entry) => ({
      evidenceRef: entry.evidenceRef,
      fixtureRef: entry.fixtureRef,
      id: entry.id,
      owner: entry.owner,
      requirement: entry.requirement,
      sampleSize: entry.sampleSize,
      threshold: entry.threshold
    }))
  );
  assert.equal(canonicalizeCorpus(defs), priorEncoding);
});

// A campaign corpus is a declared *ordered* list, not a set, and the contract
// never reorders an array — losing that would let two different corpora seal
// to the same digest.
test("the corpus stays an ordered list the encoder never sorts", () => {
  const defs = corpus();
  assert.notEqual(canonicalizeCorpus([...defs].reverse()), canonicalizeCorpus(defs));
});

// JSON.stringify silently encoded a non-finite threshold as `null`, so a
// corpus carrying one still sealed — to a digest that claimed a threshold the
// corpus did not have. The qualified contract refuses to encode it at all.
test("a non-finite threshold cannot be sealed into the corpus digest", () => {
  const defs = corpus();
  defs[4] = definition(4, { threshold: Number.NaN });
  assert.doesNotThrow(() => assertCampaignCorpus(defs), "the range check alone does not catch NaN");
  assert.throws(() => canonicalizeCorpus(defs), { code: "VES_CANONICAL_NON_FINITE_NUMBER" });
});

test("a deterministic passing campaign has a lower bound of one", () => {
  const result = evaluateCampaign(definition(0), [true]);
  assert.equal(result.verdict, "PASS");
  assert.equal(result.lowerConfidenceBound, 1);
  assert.equal(result.samples, 1);
});

test("a deterministic failing campaign fails", () => {
  const result = evaluateCampaign(definition(0), [false]);
  assert.equal(result.verdict, "FAIL");
  assert.equal(result.lowerConfidenceBound, 0);
});

test("the verdict uses the lower confidence bound, not the point estimate", () => {
  const outcomes = Array.from({ length: 100 }, (_, index) => index >= 5);
  const strict = evaluateCampaign(definition(0, { threshold: 0.9, sampleSize: 100 }), outcomes);
  assert.equal(strict.passRate, 0.95);
  assert.ok(strict.lowerConfidenceBound < 0.9, "95/100 has a Wilson lower bound below 0.9");
  assert.equal(strict.verdict, "FAIL");
  const lenient = evaluateCampaign(definition(0, { threshold: 0.85, sampleSize: 100 }), outcomes);
  assert.equal(lenient.verdict, "PASS");
});

test("a campaign that runs fewer than its declared samples fails closed", () => {
  assert.throws(() => evaluateCampaign(definition(0, { sampleSize: 10 }), [true, true]), {
    code: "VES_CAMPAIGN_CORPUS_INVALID"
  });
});

test("a corpus summary passes only when every campaign passed", () => {
  const defs = corpus();
  const results = defs.map((def) => evaluateCampaign(def, [true]));
  const summary = buildCampaignSummary(results, DIGEST, defs);
  assert.equal(summary.verdict, "PASS");
  assert.equal(summary.campaignCount, MINIMUM_CAMPAIGNS);
  assert.deepEqual(
    [...summary.campaigns].map((entry) => entry.id),
    [...summary.campaigns].map((entry) => entry.id).sort((a, b) => a.localeCompare(b))
  );
});

test("one failing campaign fails the whole corpus summary", () => {
  const defs = corpus();
  const results = defs.map((def, index) => evaluateCampaign(def, [index === 7 ? false : true]));
  assert.equal(buildCampaignSummary(results, DIGEST, defs).verdict, "FAIL");
});

// CJ4-04/CJ4-07: the summary's campaign ordering is a property of the ids
// themselves, not of the order results were produced in or the machine's
// ambient locale — required for byte-reproducible public evidence.
test("the summary orders campaigns by id regardless of result declaration order", () => {
  const defs = corpus();
  const forward = defs.map((def) => evaluateCampaign(def, [true]));
  const reversed = [...forward].reverse();
  assert.deepEqual(
    buildCampaignSummary(forward, DIGEST, defs).campaigns,
    buildCampaignSummary(reversed, DIGEST, defs).campaigns
  );
});

test("the summary's campaign order is byte-identical under two different ambient locales", () => {
  const defs = corpus();
  const results = defs.map((def) => evaluateCampaign(def, [true]));
  const priorLang = process.env.LANG;
  const priorLcAll = process.env.LC_ALL;
  try {
    process.env.LANG = "en_US.UTF-8";
    process.env.LC_ALL = "en_US.UTF-8";
    const first = buildCampaignSummary(results, DIGEST, defs);
    process.env.LANG = "fr_FR.UTF-8";
    process.env.LC_ALL = "fr_FR.UTF-8";
    const second = buildCampaignSummary(results, DIGEST, defs);
    assert.deepEqual(first.campaigns, second.campaigns);
  } finally {
    if (priorLang === undefined) delete process.env.LANG;
    else process.env.LANG = priorLang;
    if (priorLcAll === undefined) delete process.env.LC_ALL;
    else process.env.LC_ALL = priorLcAll;
  }
});

for (const [name, mutate] of [
  [
    "an invalid corpus digest",
    (summary) => {
      summary.corpusDigest = "nope";
    }
  ],
  [
    "an out-of-range rate",
    (summary) => {
      summary.campaigns[0].passRate = 2;
    }
  ],
  [
    "a bad verdict",
    (summary) => {
      summary.campaigns[0].verdict = "MAYBE";
    }
  ]
]) {
  test(`the summary rejects ${name}`, () => {
    const defs = corpus();
    const results = defs.map((def) => evaluateCampaign(def, [true]));
    const summary = structuredClone(buildCampaignSummary(results, DIGEST, defs));
    mutate(summary);
    assert.throws(() => assertCampaignSummary(summary), { code: "VES_CAMPAIGN_SUMMARY_INVALID" });
  });
}
