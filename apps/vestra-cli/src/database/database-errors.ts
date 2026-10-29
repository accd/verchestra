import { PublicErrorException, PublicErrorRegistry, type PublicErrorDefinition } from "@verchestra/domain";

import { familyErrorDefinitions, familyPublicError, type PublicErrorFamily } from "../task/task-family-errors.ts";

const databaseDefinition = familyErrorDefinitions("database");

// invariant: every `vestra database` refusal surfaces as one of these
// envelopes, a task envelope it shares (Workspace, credentials), or the
// owning package's public error. The first five codes are the ones the
// data-probe registration, policy and registry raise, so a refusal here names
// the rule a probe plan would apply.
export const DATABASE_PUBLIC_ERROR_DEFINITIONS = Object.freeze([
  databaseDefinition(
    "VES_DATABASE_REGISTRATION_INVALID",
    "validation",
    "after-change",
    "Correct the database in the definition, with a credential name `vestra secret set` accepts, and add it again; nothing was written."
  ),
  databaseDefinition(
    "VES_DATABASE_ENGINE_UNSUPPORTED",
    "validation",
    "after-change",
    "Name an engine the probe supports in the definition and add it again; nothing was written."
  ),
  databaseDefinition(
    "VES_PROBE_POLICY_INVALID",
    "validation",
    "after-change",
    "Correct the access policy in the definition and add it again; nothing was written."
  ),
  databaseDefinition(
    "VES_DATABASE_REGISTRATION_CONFLICT",
    "conflict",
    "after-change",
    "Another registration is on record for this database and is never rewritten; remove it with `vestra database remove`, then add the definition; nothing was changed."
  ),
  databaseDefinition(
    "VES_DATABASE_NOT_FOUND",
    "state",
    "after-change",
    "No registration is on record for this database; see `vestra database list`."
  ),
  databaseDefinition(
    "VES_DATABASE_DIRECTORY_INVALID",
    "integrity",
    "after-change",
    "Make .verchestra/databases a real directory of the Workspace, reached through no link, then retry; nothing was changed."
  ),
  databaseDefinition(
    "VES_DATABASE_FAILED",
    "external",
    "after-change",
    "Inspect the named reason, remediate, and retry.",
    { reason: "string" }
  )
] as const satisfies readonly PublicErrorDefinition[]);

export const databasePublicErrorRegistry = new PublicErrorRegistry(DATABASE_PUBLIC_ERROR_DEFINITIONS);

type DatabaseErrorCode = (typeof DATABASE_PUBLIC_ERROR_DEFINITIONS)[number]["code"];

export function databaseError(
  code: DatabaseErrorCode,
  details: Readonly<Record<string, unknown>>,
  message: string,
  options?: ErrorOptions
): PublicErrorException {
  return new PublicErrorException(databasePublicErrorRegistry.create(code, details), message, options);
}

// invariant: what any database command shows for an error: a public refusal
// as it is, a data-probe or database code as its own envelope, and anything
// else as VES_DATABASE_FAILED with its stable code as the reason.
const DATABASE_ERRORS: PublicErrorFamily = Object.freeze({
  registry: databasePublicErrorRegistry,
  failed: "VES_DATABASE_FAILED",
  message: "Database command failed"
});

export function databasePublicError(error: unknown): PublicErrorException {
  return familyPublicError(DATABASE_ERRORS, error);
}
