import assert from "node:assert/strict";
import { test } from "node:test";

import { suiteCases } from "../helpers/suite-cases.mjs";

// SonarCloud S2187 (T8): driver spike files register a shared suite's cases
// with their own `test`. This pins that collecting a suite keeps every case,
// in order, with its name, options and body untouched.

test("a suite's cases are collected in order with their exact arguments", () => {
  const body = async () => {};
  const options = { timeout: 30_000 };
  const suite = (register, label, rows) => {
    for (const row of rows) register(`${label}: ${row}`, options, body);
    if (rows.length > 1) register(`${label}: all`, body);
  };
  const cases = suiteCases(suite, "codex", ["first", "second"]);
  assert.deepEqual(cases, [
    ["codex: first", options, body],
    ["codex: second", options, body],
    ["codex: all", body]
  ]);
  assert.equal(cases[0][1], options);
  assert.equal(cases[0][2], body);
});

test("collecting a suite runs none of its case bodies", () => {
  let ran = 0;
  const cases = suiteCases((register) => register("case", () => (ran += 1)));
  assert.equal(cases.length, 1);
  assert.equal(ran, 0);
});
