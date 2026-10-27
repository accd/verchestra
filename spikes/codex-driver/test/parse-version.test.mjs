import assert from "node:assert/strict";
import { test } from "node:test";

import { GROWTH_SCALE, LINEAR_GROWTH_LIMIT, growth } from "../../../tests/helpers/linear-growth.mjs";
import { parseVersion } from "../src/codex-driver.mjs";

// The version expression lost an optional `codex-cli ` prefix and gained a
// digit-run lookbehind (SonarCloud S8786). The former expression, kept as text,
// is the oracle: the same x.y.z wins on every input.
const legacy = new RegExp(String.raw`(?:codex-cli\s+)?(\d+)\.(\d+)\.(\d+)`, "");
const oracle = (value) => legacy.exec(value.trim())?.slice(1).map(Number);

function* strings(alphabet, maxLength) {
  let layer = [""];
  yield "";
  for (let length = 1; length <= maxLength; length += 1) {
    layer = layer.flatMap((prefix) => alphabet.map((character) => prefix + character));
    yield* layer;
  }
}

test("codex version parsing picks the same x.y.z as the former expression", () => {
  for (const value of ["codex-cli 0.115.0", "codex-cli 0.115.0 (fixture)\n", "v12.3.4-beta", "1.2", "11.22.33.44", ""])
    assert.deepEqual(parseVersion(value), oracle(value), JSON.stringify(value));
  for (const value of strings(["1", "2", ".", " ", "a"], 7))
    assert.deepEqual(parseVersion(value), oracle(value), JSON.stringify(value));
});

test("codex version parsing stays linear on a long digit run", { timeout: 60_000 }, () => {
  const ratio = growth(parseVersion, (size) => "1".repeat(size));
  assert.ok(ratio < LINEAR_GROWTH_LIMIT, `a ${GROWTH_SCALE}x larger input took ${ratio.toFixed(1)}x as long`);
});
