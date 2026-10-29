// invariant: every `vestra database` refusal is a public envelope. The
// data-probe codes a definition can fail with become their own envelopes, so
// a refusal names the rule a probe plan would apply; anything else is
// VES_DATABASE_FAILED with its stable code as the only detail.
import assert from "node:assert/strict";
import { test } from "node:test";

import { DatabaseProbeError } from "../../packages/data-probe/src/index.ts";
import { PublicErrorException } from "../../packages/domain/src/index.ts";
import { PlatformSecurityError } from "../../packages/platform-node/src/index.ts";
import {
  DATABASE_PUBLIC_ERROR_DEFINITIONS,
  databaseError,
  databasePublicError,
  databasePublicErrorRegistry
} from "../../apps/vestra-cli/src/database/database-errors.ts";
import { taskError } from "../../apps/vestra-cli/src/task/task-errors.ts";

function coded(code) {
  return Object.assign(new Error("internal detail that never reaches an envelope"), { code });
}

test("the database error definitions name the database component", () => {
  assert.deepEqual(databasePublicErrorRegistry.codes, [
    "VES_DATABASE_DIRECTORY_INVALID",
    "VES_DATABASE_ENGINE_UNSUPPORTED",
    "VES_DATABASE_FAILED",
    "VES_DATABASE_NOT_FOUND",
    "VES_DATABASE_REGISTRATION_CONFLICT",
    "VES_DATABASE_REGISTRATION_INVALID",
    "VES_PROBE_POLICY_INVALID"
  ]);
  assert.ok(Object.isFrozen(DATABASE_PUBLIC_ERROR_DEFINITIONS));
  for (const definition of DATABASE_PUBLIC_ERROR_DEFINITIONS) {
    assert.deepEqual(Object.keys(definition), [
      "code",
      "category",
      "component",
      "retryability",
      "recovery",
      "documentationVersion",
      "safeDetails"
    ]);
    assert.equal(definition.component, "database", definition.code);
    assert.equal(definition.documentationVersion, "1", definition.code);
    assert.ok(definition.recovery.length > 0, definition.code);
  }
  const failed = databaseError("VES_DATABASE_FAILED", { reason: "VES_SOMETHING" }, "message").envelope;
  assert.deepEqual(failed.safeDetails, { reason: "VES_SOMETHING" });
  assert.equal(failed.category, "external");
});

test("a database command error leaves as one public envelope", () => {
  // A public refusal stays as it is.
  const refusal = taskError("VES_TASK_NOT_CONFIGURED", { requirement: "evidence-signing-passphrase" }, "missing");
  assert.equal(databasePublicError(refusal), refusal);

  // A data-probe or database code becomes its own envelope.
  for (const code of [
    "VES_DATABASE_REGISTRATION_INVALID",
    "VES_DATABASE_ENGINE_UNSUPPORTED",
    "VES_PROBE_POLICY_INVALID",
    "VES_DATABASE_REGISTRATION_CONFLICT",
    "VES_DATABASE_NOT_FOUND"
  ]) {
    const cause = new DatabaseProbeError(code, "internal detail that never reaches an envelope");
    const mapped = databasePublicError(cause);
    assert.ok(mapped instanceof PublicErrorException);
    assert.equal(mapped.envelope.code, code);
    assert.equal(mapped.envelope.component, "database");
    assert.deepEqual(mapped.envelope.safeDetails, {});
    assert.equal(mapped.cause, cause);
  }

  // A code another public registry owns keeps that owner's envelope.
  const escaped = databasePublicError(new PlatformSecurityError("VES_STATE_ROOT_ESCAPE", "escaped"));
  assert.equal(escaped.envelope.code, "VES_STATE_ROOT_ESCAPE");

  // Anything else is VES_DATABASE_FAILED, with the stable code (or the
  // internal marker) as its only detail.
  for (const [error, reason] of [
    [coded("VES_DATABASE_FAILED"), "VES_DATABASE_FAILED"],
    [coded("VES_PROBE_PLAN_INVALID"), "VES_PROBE_PLAN_INVALID"],
    [coded("EACCES"), "VES_TASK_INTERNAL"],
    [new Error("no code"), "VES_TASK_INTERNAL"],
    [null, "VES_TASK_INTERNAL"]
  ]) {
    const mapped = databasePublicError(error);
    assert.equal(mapped.envelope.code, "VES_DATABASE_FAILED", String(reason));
    assert.deepEqual(mapped.envelope.safeDetails, { reason });
    assert.doesNotMatch(JSON.stringify(mapped.envelope), /internal detail/u);
  }
});
