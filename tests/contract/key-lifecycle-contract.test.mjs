import assert from "node:assert/strict";
import { test } from "node:test";

import { SchemaRegistry } from "../../packages/contracts/src/index.ts";
import { KEY_LIFECYCLE_ERROR_CODES } from "../../packages/evidence/src/index.ts";

test("key lifecycle publishes exactly the schema-qualified public error codes", async () => {
  assert.deepEqual(KEY_LIFECYCLE_ERROR_CODES, ["VES_KEYSTORE_INTEGRITY", "VES_KEY_REVOKED", "VES_KEY_EXPIRED"]);
  const schemas = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));
  for (const code of KEY_LIFECYCLE_ERROR_CODES) {
    assert.deepEqual(schemas.validate("key-lifecycle-error", "1", { schemaVersion: "1", code }), {
      schemaVersion: "1",
      code
    });
  }
  assert.throws(() => schemas.validate("key-lifecycle-error", "1", { schemaVersion: "1", code: "VES_KEY_UNKNOWN" }), {
    code: "VES_SCHEMA_VALIDATION_FAILED"
  });
});
