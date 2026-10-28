import { PublicErrorException, PublicErrorRegistry, type PublicErrorDefinition } from "@verchestra/domain";

import { publicError as taskPublicError } from "../task/task-public-error.ts";

// invariant: every `vestra extension` refusal surfaces as one of these
// envelopes, a task envelope it shares (confirmation, credentials), or the
// owning package's public error. The two probe host codes are the ones
// `SpawnedProbeWorker` raises, so a refusal here names the rule the host
// would apply.
export const EXTENSION_PUBLIC_ERROR_DEFINITIONS = Object.freeze([
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
