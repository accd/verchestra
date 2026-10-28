import assert from "node:assert/strict";
import { test } from "node:test";

import { ProhibitedContentScanner } from "../../packages/evidence/src/support-bundle/support-bundle.ts";
import { redactSecretShapes } from "../../packages/policy/src/explanation.ts";

// SonarCloud S5869, S6019 (T8): the support-bundle bearer token class drops
// its duplicate a-z range (the pattern is case-insensitive), and the policy
// private-key shape drops its reluctant quantifier (it is anchored at the end
// of input, so it always reaches the end). These pin both on boundary inputs.

const scanner = new ProhibitedContentScanner();
const prohibited = { code: "VES_SUPPORT_CONTENT_PROHIBITED" };

test("a bearer token of eight class characters is prohibited in any letter case", () => {
  for (const value of [
    "bearer abcdefgh",
    "Bearer ABCDEFGH",
    "BEARER aBcD1234",
    "bearer    ._~+/-09",
    "auth: Bearer zzzzzzzzzzzz",
    // why: under case-insensitive Unicode matching the long s and the Kelvin
    // sign fold into the Latin range, whichever case the range names.
    `bearer ${String.fromCodePoint(0x17f).repeat(8)}`,
    `bearer ${String.fromCodePoint(0x212a).repeat(8)}`
  ]) {
    assert.throws(() => scanner.assertSafe(value), prohibited, value);
  }
});

test("a bearer word without eight class characters after it is allowed", () => {
  const accented = `bearer ${String.fromCodePoint(0xe9).repeat(8)}`;
  for (const value of ["bearer abcdefg", "Bearer abc!defgh", accented, "bearerabcdefgh", "the bearer"]) {
    assert.doesNotThrow(() => scanner.assertSafe(value), value);
  }
});

test("a private key marker redacts everything after it, once", () => {
  assert.deepEqual(redactSecretShapes("before BEGIN RSA PRIVATE KEY\nline one\nline two"), {
    value: "before [redacted]",
    redactions: 1
  });
  assert.deepEqual(redactSecretShapes("a BEGIN PRIVATE KEY x BEGIN OPENSSH PRIVATE KEY y\n"), {
    value: "a [redacted]",
    redactions: 1
  });
  assert.deepEqual(redactSecretShapes("BEGIN PRIVATE KEY"), { value: "[redacted]", redactions: 1 });
  assert.deepEqual(redactSecretShapes("BEGIN PRIVATE KEYS and more"), {
    value: "BEGIN PRIVATE KEYS and more",
    redactions: 0
  });
});
