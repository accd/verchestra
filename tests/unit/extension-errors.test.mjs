// invariant: every `vestra extension` refusal is a public envelope. The
// definitions are published values a caller acts on, so building them through
// a factory must leave every value, and the order of every key, as they were
// written out; the mapper turns any error an extension command throws into
// one envelope.
import assert from "node:assert/strict";
import { test } from "node:test";

import { PublicErrorException } from "../../packages/domain/src/index.ts";
import {
  EXTENSION_PUBLIC_ERROR_DEFINITIONS,
  extensionError,
  extensionPublicError,
  extensionPublicErrorRegistry
} from "../../apps/vestra-cli/src/extension/extension-errors.ts";
import { taskError } from "../../apps/vestra-cli/src/task/task-errors.ts";

// why: the definitions exactly as slice 1 published them, before the factory.
const PUBLISHED = [
  {
    code: "VES_EXTENSION_ENTRY_INVALID",
    category: "validation",
    component: "extension",
    retryability: "after-change",
    recovery:
      "Name a regular file inside the Workspace, reached through no link, and add it again; nothing was changed.",
    documentationVersion: "1",
    safeDetails: {}
  },
  {
    code: "VES_EXTENSION_ALREADY_REGISTERED",
    category: "conflict",
    component: "extension",
    retryability: "after-change",
    recovery: "The skill, extension, or approval reference is already in the skill lock; choose new ones.",
    documentationVersion: "1",
    safeDetails: {}
  },
  {
    code: "VES_EXTENSION_NOT_REGISTERED",
    category: "state",
    component: "extension",
    retryability: "after-change",
    recovery: "Register the worker with `vestra extension add`, then approve the approval reference it carries.",
    documentationVersion: "1",
    safeDetails: {}
  },
  {
    code: "VES_EXTENSION_LOCK_REFUSED",
    category: "integrity",
    component: "extension",
    retryability: "after-change",
    recovery:
      "The skill lock was refused for the named reason; restore .verchestra/skills.lock.json from version control or a kept generation, then retry.",
    documentationVersion: "1",
    safeDetails: { reason: "string" }
  },
  {
    code: "VES_EXTENSION_APPROVAL_EXISTS",
    category: "conflict",
    component: "extension",
    retryability: "after-change",
    recovery:
      "An approval is already on record for this approval reference and is never replaced; nothing was changed.",
    documentationVersion: "1",
    safeDetails: {}
  },
  {
    code: "VES_EXTENSION_APPROVAL_NOT_FOUND",
    category: "state",
    component: "extension",
    retryability: "after-change",
    recovery: "No approval is on record for this approval reference; see `vestra extension list`.",
    documentationVersion: "1",
    safeDetails: {}
  },
  {
    code: "VES_EXTENSION_APPROVAL_REVOKED",
    category: "state",
    component: "extension",
    retryability: "never",
    recovery: "This approval is already revoked; nothing was changed.",
    documentationVersion: "1",
    safeDetails: {}
  },
  {
    code: "VES_EXTENSION_NOT_CONFIGURED",
    category: "external",
    component: "extension",
    retryability: "after-change",
    recovery: "Provision the named requirement and retry; nothing was changed.",
    documentationVersion: "1",
    safeDetails: { requirement: "string" }
  },
  {
    code: "VES_EXTENSION_FAILED",
    category: "external",
    component: "extension",
    retryability: "after-change",
    recovery: "Inspect the named reason, remediate, and retry.",
    documentationVersion: "1",
    safeDetails: { reason: "string" }
  },
  {
    code: "VES_PROBE_HOST_PLATFORM_UNSUPPORTED",
    category: "external",
    component: "extension",
    retryability: "never",
    recovery: "The out-of-process probe host runs on Linux and macOS only; run this command there.",
    documentationVersion: "1",
    safeDetails: {}
  },
  {
    code: "VES_PROBE_HOST_ENVIRONMENT_DENIED",
    category: "security",
    component: "extension",
    retryability: "after-change",
    recovery:
      "Drop the --env variable: reserved, secret-like, and loader variables never reach a probe worker; nothing was recorded.",
    documentationVersion: "1",
    safeDetails: {}
  },
  {
    code: "VES_PROBE_HOST_INPUT_INVALID",
    category: "validation",
    component: "extension",
    retryability: "after-change",
    recovery: "Name an executable that exists, as an absolute path, and retry; nothing was recorded.",
    documentationVersion: "1",
    safeDetails: {}
  },
  {
    code: "VES_PROBE_HOST_ENTRY_DIGEST",
    category: "integrity",
    component: "extension",
    retryability: "after-change",
    recovery: "The entry changed since it was added; restore it as it was locked, then retry; nothing was recorded.",
    documentationVersion: "1",
    safeDetails: {}
  }
];

function coded(code) {
  return Object.assign(new Error("internal detail that never reaches an envelope"), { code });
}

test("the extension error definitions keep their published values", () => {
  assert.deepStrictEqual([...EXTENSION_PUBLIC_ERROR_DEFINITIONS], PUBLISHED);
  // why: deep equality ignores key order; the serialized bytes do not.
  assert.equal(JSON.stringify(EXTENSION_PUBLIC_ERROR_DEFINITIONS), JSON.stringify(PUBLISHED));
  assert.ok(Object.isFrozen(EXTENSION_PUBLIC_ERROR_DEFINITIONS));
  assert.deepEqual(
    extensionPublicErrorRegistry.codes,
    PUBLISHED.map((definition) => definition.code).sort((left, right) => Number(left > right) - Number(left < right))
  );
  const envelope = extensionError("VES_EXTENSION_NOT_CONFIGURED", { requirement: "git-origin" }, "message").envelope;
  assert.equal(envelope.component, "extension");
  assert.deepEqual(envelope.safeDetails, { requirement: "git-origin" });
});

test("an extension command error leaves as one public envelope", () => {
  // A public refusal stays as it is.
  const refusal = taskError("VES_TASK_CONFIRMATION_REQUIRED", {}, "not confirmed");
  assert.equal(extensionPublicError(refusal), refusal);

  // An extension or probe host code with no safe detail becomes its own envelope.
  for (const code of ["VES_EXTENSION_APPROVAL_EXISTS", "VES_PROBE_HOST_ENTRY_DIGEST"]) {
    const cause = coded(code);
    const mapped = extensionPublicError(cause);
    assert.ok(mapped instanceof PublicErrorException);
    assert.equal(mapped.envelope.code, code);
    assert.deepEqual(mapped.envelope.safeDetails, {});
    assert.equal(mapped.cause, cause);
  }

  // A refusal of the skill registry names its code as the reason.
  const registry = extensionPublicError(coded("VES_SKILL_SIGNATURE_INVALID"));
  assert.equal(registry.envelope.code, "VES_EXTENSION_LOCK_REFUSED");
  assert.deepEqual(registry.envelope.safeDetails, { reason: "VES_SKILL_SIGNATURE_INVALID" });

  // A code another public registry owns keeps that owner's envelope.
  const owned = extensionPublicError(coded("VES_INIT_WORKSPACE_MISSING"));
  assert.equal(owned.envelope.code, "VES_INIT_WORKSPACE_MISSING");

  // Anything else is VES_EXTENSION_FAILED, never VES_TASK_FAILED, with the
  // stable code (or the internal marker) as its only detail.
  for (const [error, reason] of [
    [coded("VES_EXTENSION_LOCK_REFUSED"), "VES_EXTENSION_LOCK_REFUSED"],
    [coded("VES_SOMETHING_ELSE"), "VES_SOMETHING_ELSE"],
    [new Error("no code"), "VES_TASK_INTERNAL"],
    [null, "VES_TASK_INTERNAL"],
    ["a thrown string", "VES_TASK_INTERNAL"]
  ]) {
    const mapped = extensionPublicError(error);
    assert.equal(mapped.envelope.code, "VES_EXTENSION_FAILED", String(reason));
    assert.deepEqual(mapped.envelope.safeDetails, { reason });
    assert.doesNotMatch(JSON.stringify(mapped.envelope), /internal detail/u);
  }
});
