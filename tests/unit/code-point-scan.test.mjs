import assert from "node:assert/strict";
import { test } from "node:test";

import { assertCanonicalJsonValue } from "../../packages/domain/src/canonical/canonical-guard.ts";
import { codeUnitCompare } from "../../packages/domain/src/index.ts";
import { canonicalizeJson } from "../../packages/evidence/src/index.ts";

// SonarCloud S7758 (T8): the two surrogate guards now scan by code point, and
// the TUF publication sorts with the shared code-unit comparator. These pin
// that both keep the outcome the code-unit scans gave.

// The scan the guards used before: a high surrogate must be followed by a
// low one, and a low surrogate may only follow a high one.
function codeUnitScan(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return "Unpaired high surrogate";
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return "Unpaired low surrogate";
    }
  }
  return "accepted";
}

const outcome = (check, value) => {
  try {
    check(value);
    return "accepted";
  } catch (error) {
    return error.message;
  }
};

// Every string of up to four of these pieces: plain text, both ends of each
// surrogate range, and a well-formed astral pair.
const PIECES = ["a", "\ud800", "\udbff", "\udc00", "\udfff", "\u{1f600}", "￿"];
const samples = [""];
let level = [""];
for (let length = 1; length <= 4; length += 1) {
  level = level.flatMap((prefix) => PIECES.map((piece) => prefix + piece));
  samples.push(...level);
}

test("both surrogate guards give the code-unit scan's outcome on every short mix of pieces", () => {
  assert.equal(samples.length, 1 + 7 + 49 + 343 + 2_401);
  for (const sample of samples) {
    const expected = codeUnitScan(sample);
    assert.equal(outcome(assertCanonicalJsonValue, sample), expected, JSON.stringify(sample));
    assert.equal(outcome(canonicalizeJson, sample), expected, JSON.stringify(sample));
  }
});

test("the surrogate guards reject the first unpaired surrogate and accept well-formed pairs", () => {
  assert.equal(outcome(assertCanonicalJsonValue, "\u{1f600}\u{10ffff}"), "accepted");
  assert.equal(outcome(assertCanonicalJsonValue, "\udc00\ud800"), "Unpaired low surrogate");
  assert.equal(outcome(canonicalizeJson, "x\ud800𐀀"), "Unpaired high surrogate");
  assert.equal(outcome(canonicalizeJson, "x\ud800"), "Unpaired high surrogate");
});

test("the shared comparator orders by UTF-16 code unit, not by code point", () => {
  const difference = (left, right) => {
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      const step = left.charCodeAt(index) - right.charCodeAt(index);
      if (step !== 0) return step;
    }
    return left.length - right.length;
  };
  const words = ["", "a", "ab", "b", "￿", "\u{1f600}", "\u{10000}", "", "a\u{1f600}", "a￿"];
  for (const left of words) {
    for (const right of words) {
      assert.equal(Math.sign(codeUnitCompare(left, right)), Math.sign(difference(left, right)), `${left} ${right}`);
    }
  }
  assert.ok(codeUnitCompare("\u{1f600}", "￿") < 0);
});
