import {
  PublicErrorException,
  PublicErrorRegistry,
  type ErrorCategory,
  type PublicErrorDefinition,
  type Retryability,
  type SafeDetailType
} from "@verchestra/domain";

import { publicError as taskPublicError } from "../task/task-public-error.ts";

// why: every extension definition names the same component and documentation
// version, and no safe detail unless it lists one; only what differs is
// written per code, and each code stays a literal that `extensionError` takes.
function extensionDefinition<const Code extends string>(
  code: Code,
  category: ErrorCategory,
  retryability: Retryability,
  recovery: string,
  safeDetails: Readonly<Record<string, SafeDetailType>> = {}
) {
  return {
    code,
    category,
    component: "extension",
    retryability,
    recovery,
    documentationVersion: "1",
    safeDetails
  } as const;
}

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

function codeOf(error: unknown): string | undefined {
  const code = (error as { readonly code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

// invariant: what any extension command shows for an error. A public refusal
// stays as it is; an extension or probe host code becomes its own envelope; a
// refusal of the skill registry names its code as the reason; anything else is
// mapped as a task command maps it, with VES_EXTENSION_FAILED in place of
// VES_TASK_FAILED.
export function extensionPublicError(error: unknown): PublicErrorException {
  if (error instanceof PublicErrorException) return error;
  const code = codeOf(error);
  const definition = EXTENSION_PUBLIC_ERROR_DEFINITIONS.find((entry) => entry.code === code);
  if (definition !== undefined && Object.keys(definition.safeDetails).length === 0)
    return extensionError(definition.code, {}, "Extension command failed", { cause: error });
  if (code !== undefined && /^VES_SKILL_[A-Z0-9_]{1,80}$/u.test(code))
    return extensionError("VES_EXTENSION_LOCK_REFUSED", { reason: code }, "The skill lock was refused", {
      cause: error
    });
  const mapped = taskPublicError(error);
  if (mapped.envelope.code !== "VES_TASK_FAILED") return mapped;
  return extensionError("VES_EXTENSION_FAILED", { ...mapped.envelope.safeDetails }, "Extension command failed", {
    cause: error
  });
}
