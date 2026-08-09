import assert from "node:assert/strict";
import { test } from "node:test";

import { formatCanonicalDigestV2 } from "../../packages/domain/src/canonical/canonical-digest.ts";

const VALID_HEX = "a".repeat(64);

test("formatCanonicalDigestV2 prefixes a valid sha256 hex digest", () => {
  assert.equal(formatCanonicalDigestV2(VALID_HEX), `v2:sha256:${VALID_HEX}`);
});

test("formatCanonicalDigestV2 rejects a short hex string", () => {
  assert.throws(() => formatCanonicalDigestV2("a".repeat(63)), { code: "VES_DIGEST_V2_INVALID" });
});

test("formatCanonicalDigestV2 rejects uppercase hex", () => {
  assert.throws(() => formatCanonicalDigestV2("A".repeat(64)), { code: "VES_DIGEST_V2_INVALID" });
});

test("formatCanonicalDigestV2 rejects a non-hex character", () => {
  assert.throws(() => formatCanonicalDigestV2(`g${"a".repeat(63)}`), { code: "VES_DIGEST_V2_INVALID" });
});

test("formatCanonicalDigestV2 rejects a non-string input", () => {
  assert.throws(() => formatCanonicalDigestV2(123), { code: "VES_DIGEST_V2_INVALID" });
});
