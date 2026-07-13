import assert from "node:assert/strict";
import { test } from "node:test";

import { SchemaRegistry } from "../../packages/contracts/src/index.ts";
import { initPublicErrorRegistry } from "../../packages/workspace/src/index.ts";

test("init public errors are exact and schema-valid", async () => {
  assert.deepEqual(initPublicErrorRegistry.codes, [
    "VES_INIT_APPLY_FAILED",
    "VES_INIT_GITIGNORE_AMBIGUOUS",
    "VES_INIT_GITIGNORE_NEWLINE_AMBIGUOUS",
    "VES_INIT_INPUT_INVALID",
    "VES_INIT_PREVIEW_INVALID",
    "VES_INIT_PREVIEW_STALE",
    "VES_INIT_RECOVERY_CONFLICT",
    "VES_INIT_RECOVERY_REQUIRED",
    "VES_INIT_TARGET_CONFLICT",
    "VES_INIT_TARGET_IGNORED"
  ]);
  const schemas = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));
  for (const code of initPublicErrorRegistry.codes) {
    assert.equal(schemas.validate("public-error", "1", initPublicErrorRegistry.create(code, {})).code, code);
  }
});
