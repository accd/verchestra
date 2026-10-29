import { PublicErrorException, PublicErrorRegistry, type PublicErrorDefinition } from "@verchestra/domain";

import { databasePublicError, databasePublicErrorRegistry } from "../database/database-errors.ts";
import { extensionPublicError, extensionPublicErrorRegistry } from "../extension/extension-errors.ts";
import { familyErrorDefinitions, familyPublicError, type PublicErrorFamily } from "../task/task-family-errors.ts";

const probeDefinition = familyErrorDefinitions("probe");

// why: one recovery for each kind of refusal, so a code says which rule
// refused and its recovery says what to do about that kind.
const STATEMENT =
  "Correct the SQL in the request file as the named rule requires: one read of main-qualified objects with anonymous binds, and no literal, comment, write or PRAGMA; no run was created.";
const PLAN =
  "Bring the request's purpose, objects, functions and bounds within the database's registration and access policy, then run it again; no run was created.";
const WORKER =
  "The probe run ended FAILED for the named rule and its grant is revoked; nothing the worker returned was kept. Correct the worker or its approval, then start a new run.";

type Category = PublicErrorDefinition["category"];

function refusals<const Code extends string>(codes: readonly Code[], category: Category, recovery: string) {
  return codes.map((code) => probeDefinition(code, category, "after-change", recovery));
}

// invariant: every `vestra probe run` refusal surfaces as one of these
// envelopes, a database or extension envelope for a code those families own
// (the registration, the platform, the worker's entry), a task envelope it
// shares (confirmation, credentials), or the owning package's public error.
// The parser, planner, supervisor, protocol and host codes have no public
// registry of their own, so a refusal here names the rule that refused
// (.specs/features/probe-run/plan.md, AC 6, AC 10, AC 11).
export const PROBE_PUBLIC_ERROR_DEFINITIONS = Object.freeze([
  probeDefinition(
    "VES_PROBE_ENGINE_UNAVAILABLE",
    "validation",
    "after-change",
    "Only a SQLite database can be probed in this release; nothing was read and no run was created."
  ),
  ...refusals(
    [
      "VES_SQLITE_ENCODING_DENIED",
      "VES_SQLITE_COMMENT_DENIED",
      "VES_SQLITE_BATCH_DENIED",
      "VES_SQLITE_DATABASE_CONTROL_DENIED",
      "VES_SQLITE_PRAGMA_DENIED",
      "VES_SQLITE_RECURSIVE_DENIED",
      "VES_SQLITE_WRITE_DENIED",
      "VES_SQLITE_LITERAL_DENIED",
      "VES_SQLITE_PARAMETERS_INVALID",
      "VES_SQLITE_READ_FORM_DENIED",
      "VES_SQLITE_OBJECT_INVALID",
      "VES_SQLITE_CATALOG_DENIED",
      "VES_SQLITE_FUNCTION_DENIED",
      "VES_SQLITE_REQUEST_INVALID"
    ] as const,
    "validation",
    STATEMENT
  ),
  ...refusals(
    [
      "VES_PROBE_REQUEST_INVALID",
      "VES_PROBE_PURPOSE_DENIED",
      "VES_PROBE_OBJECT_DENIED",
      "VES_PROBE_BOUNDS_DENIED",
      "VES_PROBE_SCHEMA_DENIED",
      "VES_PROBE_CATALOG_DENIED",
      "VES_PROBE_FUNCTION_DENIED",
      "VES_PROBE_ENGINE_POLICY_DENIED",
      "VES_PROBE_OPERATION_INVALID",
      "VES_PROBE_WRITE_DENIED",
      "VES_PROBE_MULTI_STATEMENT_DENIED",
      "VES_PROBE_POLICY_MISMATCH"
    ] as const,
    "validation",
    PLAN
  ),
  probeDefinition(
    "VES_PROBE_WORKSPACE_TRUST_APPROVAL",
    "state",
    "after-change",
    "Approve the worker's launch with `vestra extension approve`; an expired or revoked approval needs a new approval reference. `vestra extension check` names what is missing."
  ),
  probeDefinition(
    "VES_PROBE_HOST_LAUNCH_DIGEST",
    "integrity",
    "after-change",
    "The executable, its arguments, or its environment no longer measure as approved; approve the launch as it is now under a new approval reference."
  ),
  probeDefinition(
    "VES_PROBE_PLAN_CHANGED",
    "integrity",
    "after-change",
    "The database registration changed after the run was approved; nothing was read and the run ended FAILED. Review the registration, then start a new run."
  ),
  probeDefinition(
    "VES_PROBE_HOST_TERMINATION_INCOMPLETE",
    "security",
    "never",
    "A process the probe worker started may still be running; find and stop it before anything else. The run ended FAILED and its grant is revoked."
  ),
  ...refusals(
    [
      "VES_PROBE_SECRET_LEAK",
      "VES_PROBE_IDENTITY_NOT_READ_ONLY",
      "VES_PROBE_SESSION_NOT_READ_ONLY",
      "VES_PROBE_TRUST_INVALID",
      "VES_PROBE_WORKSPACE_TRUST_DENIED",
      "VES_PROBE_WORKSPACE_TRUST_WORKSPACE",
      "VES_PROBE_WORKSPACE_TRUST_GRANT",
      "VES_PROBE_WORKSPACE_TRUST_DIGEST",
      "VES_PROBE_WORKSPACE_TRUST_LAUNCH",
      "VES_PROBE_WORKSPACE_TRUST_INVALID",
      "VES_PROBE_WORKSPACE_TRUST_NAMESPACE",
      "VES_PROBE_WORKSPACE_TRUST_CAPABILITY",
      "VES_EXECUTION_GRANT_REQUIRED",
      "VES_ISOLATION_PROFILE_UNAVAILABLE",
      "VES_STRONG_ISOLATION_UNAVAILABLE",
      "VES_PROBE_HANDSHAKE_COMPONENT",
      "VES_PROBE_HANDSHAKE_CAPABILITY"
    ] as const,
    "security",
    WORKER
  ),
  ...refusals(
    [
      "VES_PROBE_ENVELOPE_INVALID",
      "VES_PROBE_ENVELOPE_WORKSPACE",
      "VES_PROBE_ENVELOPE_DIGEST",
      "VES_PROBE_FRAME_HEADER_LIMIT",
      "VES_PROBE_FRAME_HEADER_INVALID",
      "VES_PROBE_FRAME_LENGTH_REQUIRED",
      "VES_PROBE_FRAME_LENGTH_INVALID",
      "VES_PROBE_FRAME_MESSAGE_LIMIT",
      "VES_PROBE_FRAME_JSON_INVALID",
      "VES_PROBE_SEQUENCE_GAP",
      "VES_PROBE_SEQUENCE_REPLAY",
      "VES_PROBE_MESSAGE_CONFLICT",
      "VES_PROBE_MESSAGE_UNEXPECTED",
      "VES_PROBE_PAYLOAD_SCHEMA_UNSUPPORTED",
      "VES_PROBE_HANDSHAKE_INVALID",
      "VES_PROBE_HANDSHAKE_PROTOCOL",
      "VES_PROBE_HANDSHAKE_SCHEMA",
      "VES_PROBE_IDENTITY_INVALID",
      "VES_PROBE_SESSION_INVALID",
      "VES_PROBE_RESULT_INVALID"
    ] as const,
    "integrity",
    WORKER
  ),
  ...refusals(
    [
      "VES_PROBE_WORKER_FAILURE",
      "VES_PROBE_WORKER_EXITED",
      "VES_PROBE_TIMEOUT",
      "VES_PROBE_ABORTED",
      "VES_PROBE_ROW_LIMIT",
      "VES_PROBE_BYTE_LIMIT",
      "VES_PROBE_RESULT_FAILURE",
      "VES_PROBE_CONCURRENCY_LIMIT",
      "VES_PROBE_PARAMETERS_MISSING",
      "VES_PROBE_PLAN_MISSING",
      "VES_PROBE_HOST_STDOUT_LIMIT",
      "VES_PROBE_HOST_STDERR_LIMIT",
      "VES_PROBE_HOST_SPAWN_FAILED",
      "VES_PROBE_HOST_CHANNEL_CLOSED"
    ] as const,
    "external",
    WORKER
  ),
  probeDefinition("VES_PROBE_FAILED", "external", "after-change", "Inspect the named reason, remediate, and retry.", {
    reason: "string"
  })
] as const satisfies readonly PublicErrorDefinition[]);

export const probePublicErrorRegistry = new PublicErrorRegistry(PROBE_PUBLIC_ERROR_DEFINITIONS);

// why: a refusal the probe family raises under the code of the rule that
// refused, which may be another family's (the worker's entry); probePublicError
// turns it into that code's envelope.
export class ProbeRefusal extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProbeRefusal";
    this.code = code;
  }
}

type ProbeErrorCode = (typeof PROBE_PUBLIC_ERROR_DEFINITIONS)[number]["code"];

export function probeError(
  code: ProbeErrorCode,
  details: Readonly<Record<string, unknown>>,
  message: string,
  options?: ErrorOptions
): PublicErrorException {
  return new PublicErrorException(probePublicErrorRegistry.create(code, details), message, options);
}

// invariant: what `vestra probe run` shows for an error. A public refusal
// stays as it is; a probe code becomes its own envelope; a code the database
// or extension family owns, a skill registry code included, becomes that
// family's envelope; anything else is mapped as a task command maps it, with
// VES_PROBE_FAILED in place of VES_TASK_FAILED.
const PROBE_ERRORS: PublicErrorFamily = Object.freeze({
  registry: probePublicErrorRegistry,
  failed: "VES_PROBE_FAILED",
  message: "Probe command failed",
  refine: (code: string, error: unknown) => {
    if (databasePublicErrorRegistry.codes.includes(code)) return databasePublicError(error);
    if (extensionPublicErrorRegistry.codes.includes(code) || code.startsWith("VES_SKILL_"))
      return extensionPublicError(error);
    return undefined;
  }
});

export function probePublicError(error: unknown): PublicErrorException {
  return familyPublicError(PROBE_ERRORS, error);
}
