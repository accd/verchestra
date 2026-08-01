import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { CANONICAL_JSON_V2, parseCanonicalJsonVersion } from "../../packages/contracts/src/canonical-json.ts";
import { inspectSource } from "../../scripts/architecture.mjs";

test("CANONICAL_JSON_V2 names the v2 version token", () => {
  assert.equal(CANONICAL_JSON_V2, "v2");
});

test("parseCanonicalJsonVersion returns v2 for a v2:sha256: identity", () => {
  assert.equal(parseCanonicalJsonVersion(`v2:sha256:${"a".repeat(64)}`), "v2");
});

test("parseCanonicalJsonVersion returns v1 for a bare sha256: identity", () => {
  assert.equal(parseCanonicalJsonVersion(`sha256:${"a".repeat(64)}`), "v1");
});

test("parseCanonicalJsonVersion throws for an unrecognized identity", () => {
  assert.throws(() => parseCanonicalJsonVersion("md5:deadbeef"));
});

test("parseCanonicalJsonVersion throws for an empty identity", () => {
  assert.throws(() => parseCanonicalJsonVersion(""));
});

test("canonical-json contract module carries no third-party import beyond the ajv carve-out", async () => {
  const source = await readFile(new URL("../../packages/contracts/src/canonical-json.ts", import.meta.url), "utf8");
  assert.deepEqual(inspectSource("contracts", source), []);
});
