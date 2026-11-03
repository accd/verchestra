import assert from "node:assert/strict";
import { test } from "node:test";

import { DomainValueError, compareSemanticVersions } from "../../packages/domain/src/index.ts";

// why: the specification's own example of precedence (semver 2.0.0, section 11), lowest first.
const CHAIN = Object.freeze([
  "1.0.0-alpha",
  "1.0.0-alpha.1",
  "1.0.0-alpha.beta",
  "1.0.0-beta",
  "1.0.0-beta.2",
  "1.0.0-beta.11",
  "1.0.0-rc.1",
  "1.0.0"
]);

const refusing = () => (error) => {
  assert.ok(error instanceof DomainValueError);
  assert.equal(error.code, "VES_SEMVER_INVALID");
  return true;
};

test("orders the numeric core by value", () => {
  assert.equal(compareSemanticVersions("0.0.0", "0.1.0"), -1);
  assert.equal(compareSemanticVersions("0.1.0", "1.0.0"), -1);
  assert.equal(compareSemanticVersions("1.0.0", "0.1.0"), 1);
  // why: by value, not by text: "10" sorts before "9" as text.
  assert.equal(compareSemanticVersions("0.9.0", "0.10.0"), -1);
  assert.equal(compareSemanticVersions("0.0.9", "0.0.10"), -1);
});

test("a pre-release is older than its release", () => {
  assert.equal(compareSemanticVersions("0.0.0-qualification.9", "0.0.0"), -1);
  assert.equal(compareSemanticVersions("0.0.0", "0.0.0-qualification.9"), 1);
});

test("orders the semver 2.0.0 precedence chain", () => {
  // why: every ordered pair, not only the neighbours, so a comparator that is not transitive fails.
  for (let low = 0; low < CHAIN.length; low += 1)
    for (let high = low + 1; high < CHAIN.length; high += 1)
      assert.equal(compareSemanticVersions(CHAIN[low], CHAIN[high]), -1, `${CHAIN[low]} < ${CHAIN[high]}`);
});

test("orders the qualification line against the 0.x boundary", () => {
  // why: numeric identifiers by value, so `.9` is older than `.10`; text order would reverse them.
  assert.equal(compareSemanticVersions("0.0.0-qualification.9", "0.0.0-qualification.10"), -1);
  assert.equal(compareSemanticVersions("0.0.0-qualification.10", "0.0.0-qualification.9"), 1);
  assert.equal(compareSemanticVersions("0.0.0-qualification.10", "0.1.0-rc.1"), -1);
  assert.equal(compareSemanticVersions("0.1.0-rc.1", "0.1.0"), -1);
  assert.equal(compareSemanticVersions("0.0.0", "0.1.0-rc.1"), -1);
});

test("is reflexive and antisymmetric over the chain", () => {
  for (let left = 0; left < CHAIN.length; left += 1)
    for (let right = 0; right < CHAIN.length; right += 1) {
      const expected = left === right ? 0 : left < right ? -1 : 1;
      assert.equal(
        compareSemanticVersions(CHAIN[left], CHAIN[right]),
        expected,
        `${CHAIN[left]} against ${CHAIN[right]}`
      );
    }
});

test("refuses a version outside the grammar", () => {
  // why: includes what the CLI's own SEMVER pattern still accepts (a leading-zero or an empty
  // identifier), because the comparison is stricter and must fail closed on it, and build metadata.
  for (const value of [
    "",
    "1.0",
    "v1.0.0",
    "01.0.0",
    "1.0.0-",
    "1.0.0-a..b",
    "1.0.0-01",
    "1.0.0-00",
    "1.0.0-.a",
    "1.0.0-a.",
    "1.0.0+build"
  ]) {
    assert.throws(() => compareSemanticVersions(value, "1.0.0"), refusing(), `left ${JSON.stringify(value)}`);
    assert.throws(() => compareSemanticVersions("1.0.0", value), refusing(), `right ${JSON.stringify(value)}`);
  }
});

test("refuses a value that is not a string", () => {
  for (const value of [undefined, null, 1, {}, ["1.0.0"]]) {
    assert.throws(() => compareSemanticVersions(value, "1.0.0"), refusing());
    assert.throws(() => compareSemanticVersions("1.0.0", value), refusing());
  }
});

test("orders alphanumeric identifiers by code unit, not by locale", () => {
  assert.equal(compareSemanticVersions("1.0.0-Alpha", "1.0.0-alpha"), -1);
  assert.equal(compareSemanticVersions("1.0.0-alpha", "1.0.0-Alpha"), 1);
  assert.equal(compareSemanticVersions("1.0.0-a-b", "1.0.0-a-c"), -1);
});

test("orders numeric identifiers beyond 2^53 by value", () => {
  assert.equal(compareSemanticVersions("1.0.0-9007199254740992", "1.0.0-9007199254740993"), -1);
  assert.equal(compareSemanticVersions("1.0.0-9007199254740993", "1.0.0-9007199254740992"), 1);
  assert.equal(compareSemanticVersions("9007199254740993.0.0", "9007199254740992.0.0"), 1);
});
