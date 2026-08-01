import assert from "node:assert/strict";
import { test } from "node:test";

import { buildInventoryFingerprint, buildInventoryFingerprintV2 } from "../../packages/workspace/src/index.ts";
import { parseCanonicalJsonVersion } from "../../packages/contracts/src/index.ts";

const fixture = { schemaVersion: 1, repositories: [{ logicalPath: "b" }, { logicalPath: "a" }], projects: [] };

test("buildInventoryFingerprintV2 returns a v2:sha256: identity", () => {
  assert.match(buildInventoryFingerprintV2(fixture), /^v2:sha256:[a-f0-9]{64}$/u);
});

test("buildInventoryFingerprintV2 is deterministic for the same input", () => {
  assert.equal(buildInventoryFingerprintV2(fixture), buildInventoryFingerprintV2(fixture));
});

test("buildInventoryFingerprintV2 changes when the input value changes", () => {
  const other = { schemaVersion: 1, repositories: [{ logicalPath: "c" }], projects: [] };
  assert.notEqual(buildInventoryFingerprintV2(fixture), buildInventoryFingerprintV2(other));
});

test("V1 buildInventoryFingerprint remains byte-identical to its pinned pre-slice value", () => {
  assert.equal(
    buildInventoryFingerprint(fixture),
    "sha256:413ab5f8da9c4af07db973c34260c36a21f027735083897356a6d945f3795d37"
  );
});

test("V1 and V2 return different strings for the same input", () => {
  assert.notEqual(buildInventoryFingerprint(fixture), buildInventoryFingerprintV2(fixture));
});

test("a V1 identity parses as version v1", () => {
  assert.equal(parseCanonicalJsonVersion(buildInventoryFingerprint(fixture)), "v1");
});

test("a V2 identity parses as version v2", () => {
  assert.equal(parseCanonicalJsonVersion(buildInventoryFingerprintV2(fixture)), "v2");
});

test("a guard rejection for an undefined value surfaces as WorkspaceScanError", () => {
  assert.throws(() => buildInventoryFingerprintV2({ a: undefined }), { code: "VES_WORKSPACE_INVENTORY_INVALID" });
});

test("a guard rejection for a cyclic value surfaces as WorkspaceScanError", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => buildInventoryFingerprintV2(cyclic), { code: "VES_WORKSPACE_INVENTORY_INVALID" });
});

test("reordering an array changes the V2 fingerprint but not the V1 fingerprint", () => {
  const first = { items: [1, 2] };
  const second = { items: [2, 1] };
  assert.notEqual(buildInventoryFingerprintV2(first), buildInventoryFingerprintV2(second));
  assert.equal(buildInventoryFingerprint(first), buildInventoryFingerprint(second));
});
