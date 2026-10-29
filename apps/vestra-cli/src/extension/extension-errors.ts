import { PublicErrorException, PublicErrorRegistry, type PublicErrorDefinition } from "@verchestra/domain";

import { familyErrorDefinitions, familyPublicError, type PublicErrorFamily } from "../task/task-family-errors.ts";

// why: every extension definition names the same component and documentation
// version, and no safe detail unless it lists one; only what differs is
// written per code, and each code stays a literal that `extensionError` takes.
const extensionDefinition = familyErrorDefinitions("extension");

// invariant: every `vestra extension` refusal surfaces as one of these
// envelopes, a task envelope it shares (confirmation, credentials), or the
// owning package's public error. The two probe host codes are the ones
// `SpawnedProbeWorker` raises, so a refusal here names the rule the host
// would apply.
export const EXTENSION_PUBLIC_ERROR_DEFINITIONS = Object.freeze([
  extensionDefinition(
    "VES_EXTENSION_ENTRY_INVALID",
    "validation",
    "after-change",
    "Name a regular file inside the Workspace, reached through no link, and add it again; nothing was changed."
  ),
  extensionDefinition(
    "VES_EXTENSION_ALREADY_REGISTERED",
    "conflict",
    "after-change",
    "The skill, extension, or approval reference is already in the skill lock; choose new ones."
  ),
  extensionDefinition(
    "VES_EXTENSION_NOT_REGISTERED",
    "state",
    "after-change",
    "Register the worker with `vestra extension add`, then approve the approval reference it carries."
  ),
  extensionDefinition(
    "VES_EXTENSION_LOCK_REFUSED",
    "integrity",
    "after-change",
    "The skill lock was refused for the named reason; restore .verchestra/skills.lock.json from version control or a kept generation, then retry.",
    { reason: "string" }
  ),
  extensionDefinition(
    "VES_EXTENSION_APPROVAL_EXISTS",
    "conflict",
    "after-change",
    "An approval is already on record for this approval reference and is never replaced; nothing was changed."
  ),
  extensionDefinition(
    "VES_EXTENSION_APPROVAL_NOT_FOUND",
    "state",
    "after-change",
    "No approval is on record for this approval reference; see `vestra extension list`."
  ),
  extensionDefinition(
    "VES_EXTENSION_APPROVAL_REVOKED",
    "state",
    "never",
    "This approval is already revoked; nothing was changed."
  ),
  extensionDefinition(
    "VES_EXTENSION_NOT_CONFIGURED",
    "external",
    "after-change",
    "Provision the named requirement and retry; nothing was changed.",
    { requirement: "string" }
  ),
  extensionDefinition(
    "VES_EXTENSION_FAILED",
    "external",
    "after-change",
    "Inspect the named reason, remediate, and retry.",
    { reason: "string" }
  ),
  extensionDefinition(
    "VES_PROBE_HOST_PLATFORM_UNSUPPORTED",
    "external",
    "never",
    "The out-of-process probe host runs on Linux and macOS only; run this command there."
  ),
  extensionDefinition(
    "VES_PROBE_HOST_ENVIRONMENT_DENIED",
    "security",
    "after-change",
    "Drop the --env variable: reserved, secret-like, and loader variables never reach a probe worker; nothing was recorded."
  ),
  extensionDefinition(
    "VES_PROBE_HOST_INPUT_INVALID",
    "validation",
    "after-change",
    "Name an executable that exists, as an absolute path, and retry; nothing was recorded."
  ),
  extensionDefinition(
    "VES_PROBE_HOST_ENTRY_DIGEST",
    "integrity",
    "after-change",
    "The entry changed since it was added; restore it as it was locked, then retry; nothing was recorded."
  )
] as const satisfies readonly PublicErrorDefinition[]);

export const extensionPublicErrorRegistry = new PublicErrorRegistry(EXTENSION_PUBLIC_ERROR_DEFINITIONS);

type ExtensionErrorCode = (typeof EXTENSION_PUBLIC_ERROR_DEFINITIONS)[number]["code"];

export function extensionError(
  code: ExtensionErrorCode,
  details: Readonly<Record<string, unknown>>,
  message: string,
  options?: ErrorOptions
): PublicErrorException {
  return new PublicErrorException(extensionPublicErrorRegistry.create(code, details), message, options);
}

// invariant: what any extension command shows for an error. A public refusal
// stays as it is; an extension or probe host code becomes its own envelope; a
// refusal of the skill registry names its code as the reason; anything else is
// mapped as a task command maps it, with VES_EXTENSION_FAILED in place of
// VES_TASK_FAILED.
const EXTENSION_ERRORS: PublicErrorFamily = Object.freeze({
  registry: extensionPublicErrorRegistry,
  failed: "VES_EXTENSION_FAILED",
  message: "Extension command failed",
  refine: (code: string, error: unknown) =>
    /^VES_SKILL_[A-Z0-9_]{1,80}$/u.test(code)
      ? extensionError("VES_EXTENSION_LOCK_REFUSED", { reason: code }, "The skill lock was refused", { cause: error })
      : undefined
});

export function extensionPublicError(error: unknown): PublicErrorException {
  return familyPublicError(EXTENSION_ERRORS, error);
}
