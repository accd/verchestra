import assert from "node:assert/strict";
import { test } from "node:test";

import { sensitiveValueRedactor } from "../../packages/drivers/src/driver-redaction.ts";

// why: the redactor is asserted here once. That each driver passes its
// provider text through it stays pinned by the driver's own redaction cases.

test("every occurrence of every sensitive value is replaced", () => {
  const redact = sensitiveValueRedactor(["alpha-secret", "beta-secret"]);
  assert.equal(
    redact("alpha-secret then beta-secret then alpha-secret again"),
    "[REDACTED] then [REDACTED] then [REDACTED] again"
  );
});

test("a value that contains another is replaced whole, whatever the order they were given in", () => {
  for (const values of [
    ["token", "token-with-suffix"],
    ["token-with-suffix", "token"]
  ]) {
    const redacted = sensitiveValueRedactor(values)("value:token-with-suffix and token");
    assert.equal(redacted, "value:[REDACTED] and [REDACTED]");
    assert.equal(redacted.includes("suffix"), false);
  }
});

test("an empty value is ignored instead of matching everywhere", () => {
  assert.equal(sensitiveValueRedactor([""])("plain text"), "plain text");
  assert.equal(sensitiveValueRedactor(["", "secret"])("a secret"), "a [REDACTED]");
});

test("a repeated value and a frozen list are accepted", () => {
  const values = Object.freeze(["secret", "secret"]);
  assert.equal(sensitiveValueRedactor(values)("secret"), "[REDACTED]");
  assert.deepEqual(values, ["secret", "secret"]);
});

test("a value that is not text is redacted as its text form", () => {
  const redact = sensitiveValueRedactor(["234"]);
  assert.equal(redact(12345), "1[REDACTED]5");
  assert.equal(redact({ toString: () => "id-234" }), "id-[REDACTED]");
  assert.equal(redact(undefined), "undefined");
});

test("with nothing to redact the text is returned unchanged", () => {
  assert.equal(sensitiveValueRedactor([])("nothing sensitive"), "nothing sensitive");
});

test("one redactor can be applied to any number of texts", () => {
  const redact = sensitiveValueRedactor(["secret"]);
  assert.deepEqual(["a secret", "no match", "secret secret"].map(redact), [
    "a [REDACTED]",
    "no match",
    "[REDACTED] [REDACTED]"
  ]);
});
