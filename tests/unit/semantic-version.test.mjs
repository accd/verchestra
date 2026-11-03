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
  for (let index = 1; index < CHAIN.length; index += 1)
    assert.equal(compareSemanticVersions(CHAIN[index - 1], CHAIN[index]), -1, `${CHAIN[index - 1]} < ${CHAIN[index]}`);
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
  for (const left of CHAIN) {
    assert.equal(compareSemanticVersions(left, left), 0);
    for (const right of CHAIN)
      assert.equal(compareSemanticVersions(left, right), -compareSemanticVersions(right, left) || 0);
  }
});

test("refuses a version outside the grammar", () => {
  for (const value of ["", "1.0", "v1.0.0", "01.0.0", "1.0.0-", "1.0.0-a..b"]) {
    assert.throws(() => compareSemanticVersions(value, "1.0.0"), refusing(), `left ${JSON.stringify(value)}`);
    assert.throws(() => compareSemanticVersions("1.0.0", value), refusing(), `right ${JSON.stringify(value)}`);
  }
});
