import assert from "node:assert/strict";
import test from "node:test";

import lighthouserc from "../../lighthouserc.cjs";

// PR #139 review point 1: a top-level `assert.aggregationMethod` weakens
// every assertion, not just `categories:performance`, because lhci's own
// default ("optimistic") is MORE lenient than "median" for a minScore
// assertion — it resolves to Math.max across runs. This test asserts the
// per-assertion split directly (LPB-08), so a future edit that reintroduces
// a global default or drops an explicit override fails here first.

const { assertions } = lighthouserc.ci.assert;

const TOLERANT_ASSERTION = "categories:performance";
const STRICT_ASSERTIONS = [
  "categories:accessibility",
  "categories:best-practices",
  "categories:seo",
  "largest-contentful-paint",
  "cumulative-layout-shift"
];

test("no top-level default aggregation method is set", () => {
  assert.equal(
    lighthouserc.ci.assert.aggregationMethod,
    undefined,
    "a global aggregationMethod would silently apply to every assertion, including the five the spec declares out of scope"
  );
});

test("categories:performance is the only assertion deliberately tolerant of one bad run in three", () => {
  const [, options] = assertions[TOLERANT_ASSERTION];
  assert.equal(options.aggregationMethod, "median");
});

for (const key of STRICT_ASSERTIONS) {
  test(`${key} stays as strict as the pre-change numberOfRuns: 1 baseline`, () => {
    const [, options] = assertions[key];
    assert.equal(
      options.aggregationMethod,
      "pessimistic",
      `${key} must fail on any single bad run among the 3 samples, matching N=1 strictness`
    );
  });
}

test("every assertion declares its aggregation method explicitly", () => {
  for (const [key, [, options]] of Object.entries(assertions)) {
    assert.ok(
      options.aggregationMethod === "median" || options.aggregationMethod === "pessimistic",
      `${key} has no explicit aggregationMethod and would silently inherit lhci's "optimistic" default`
    );
  }
});
