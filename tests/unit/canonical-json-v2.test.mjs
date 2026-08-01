import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { canonicalizeJsonV2 } from "../../packages/domain/src/canonical/canonical-json.ts";
import { inspectSource } from "../../scripts/architecture.mjs";
import { RFC8785_VECTORS } from "../helpers/rfc8785-vectors.mjs";

for (const vector of RFC8785_VECTORS) {
  test(`RFC 8785 vector: ${vector.name}`, () => {
    assert.equal(canonicalizeJsonV2(vector.input), vector.output);
  });
}

test("object members are ordered by UTF-16 code unit, not locale", () => {
  // "Z" (0x5A) sorts before "a" (0x61) by code unit; a locale-aware compare
  // frequently treats letters case-insensitively and would invert this.
  assert.equal(canonicalizeJsonV2({ a: 1, Z: 2 }), '{"Z":2,"a":1}');
});

test("the encoder module never calls localeCompare", async () => {
  const source = await readFile(
    new URL("../../packages/domain/src/canonical/canonical-json.ts", import.meta.url),
    "utf8"
  );
  assert.equal(source.includes("localeCompare"), false);
});

test("arrays are emitted in their given order, never sorted", () => {
  assert.equal(canonicalizeJsonV2([3, 1, 2]), "[3,1,2]");
});

test("a reordered array produces different canonical bytes", () => {
  assert.notEqual(canonicalizeJsonV2([1, 2]), canonicalizeJsonV2([2, 1]));
});

test("an array of objects preserves array order while ordering each object's members", () => {
  assert.equal(canonicalizeJsonV2([{ b: 1, a: 2 }, { z: 3 }]), '[{"a":2,"b":1},{"z":3}]');
});

test("nested objects at every depth are ordered by code unit", () => {
  assert.equal(canonicalizeJsonV2({ outer: { z: 1, a: { d: 1, c: 2 } } }), '{"outer":{"a":{"c":2,"d":1},"z":1}}');
});

test("an empty object encodes as {}", () => {
  assert.equal(canonicalizeJsonV2({}), "{}");
});

test("an empty array encodes as []", () => {
  assert.equal(canonicalizeJsonV2([]), "[]");
});

test("null encodes as the literal null", () => {
  assert.equal(canonicalizeJsonV2(null), "null");
});

test("true encodes as the literal true", () => {
  assert.equal(canonicalizeJsonV2(true), "true");
});

test("false encodes as the literal false", () => {
  assert.equal(canonicalizeJsonV2(false), "false");
});

test("negative zero encodes as 0 per the JCS number rule", () => {
  assert.equal(canonicalizeJsonV2(-0), "0");
});

test("an integer encodes without a decimal point", () => {
  assert.equal(canonicalizeJsonV2(5), "5");
});

test("a very large number encodes in scientific notation matching Number::toString", () => {
  assert.equal(canonicalizeJsonV2(1e21), "1e+21");
});

test("quote, backslash, and control characters are escaped in strings", () => {
  assert.equal(canonicalizeJsonV2('a"b\\c\nd'), '"a\\"b\\\\c\\nd"');
});

test("object keys that are surrogate-pair Unicode characters sort by code unit", () => {
  // High surrogate 0xD83D (the emoji's first code unit) is numerically
  // greater than U+20AC, so the emoji key sorts after the euro-sign key.
  assert.equal(canonicalizeJsonV2({ "\u{1f602}": 1, "€": 2 }), '{"€":2,"\u{1f602}":1}');
});

test("the same input produces byte-identical output under two different ambient locales", () => {
  const value = { z: 1, a: 2, péché: 3, apple: 4 };
  const priorLang = process.env.LANG;
  const priorLcAll = process.env.LC_ALL;
  try {
    process.env.LANG = "en_US.UTF-8";
    process.env.LC_ALL = "en_US.UTF-8";
    const first = canonicalizeJsonV2(value);
    process.env.LANG = "fr_FR.UTF-8";
    process.env.LC_ALL = "fr_FR.UTF-8";
    const second = canonicalizeJsonV2(value);
    assert.equal(first, second);
  } finally {
    if (priorLang === undefined) delete process.env.LANG;
    else process.env.LANG = priorLang;
    if (priorLcAll === undefined) delete process.env.LC_ALL;
    else process.env.LC_ALL = priorLcAll;
  }
});

test("representative numbers match JSON.stringify's ECMAScript Number::toString output", () => {
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, 2e-3, 333333333.33333329]) {
    assert.equal(canonicalizeJsonV2(value), JSON.stringify(value));
  }
});

test("the domain canonical-json module has zero third-party and zero node: imports", async () => {
  const source = await readFile(
    new URL("../../packages/domain/src/canonical/canonical-json.ts", import.meta.url),
    "utf8"
  );
  assert.deepEqual(inspectSource("domain", source), []);
});
