import assert from "node:assert/strict";
import { test } from "node:test";

import { LINEAR_GROWTH_LIMIT, growth } from "../helpers/linear-growth.mjs";

// The growth helper is the sensor behind every linearity assertion, so it must
// keep telling linear from quadratic work.

const linear = (text) => {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) if (text.charCodeAt(index) === 97) count += 1;
  return count;
};

const quadratic = (text) => {
  let count = 0;
  for (let left = 0; left < text.length; left += 1)
    for (let right = left; right < text.length; right += 1) if (text.charCodeAt(right) === 97) count += 1;
  return count;
};

test("linear work measures under the limit", () => {
  assert.ok(growth(linear, (size) => "a".repeat(size)) < LINEAR_GROWTH_LIMIT);
});

test("quadratic work measures over the limit in every round", () => {
  assert.ok(growth(quadratic, (size) => "a".repeat(size), { base: 400 }) > LINEAR_GROWTH_LIMIT);
});
