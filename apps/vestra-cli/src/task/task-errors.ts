import { PublicErrorException, PublicErrorRegistry, type PublicErrorDefinition } from "@verchestra/domain";

// invariant: every `vestra task` refusal surfaces as one of these envelopes or
// as the owning package's own public error; an internal code travels only as
// the `reason` safe detail, never as free text.
export const TASK_PUBLIC_ERROR_DEFINITIONS = Object.freeze([
  {
    code: "VES_TASK_NOT_CONFIGURED",
    category: "external",
    component: "task",
    retryability: "after-change",
    recovery: "Provision the named requirement (see docs/quick-start.md) and retry; nothing was changed.",
    documentationVersion: "1",
    safeDetails: { requirement: "string" }
  },
  {
    code: "VES_TASK_REQUEST_REJECTED",
    category: "validation",
    component: "task",
    retryability: "after-change",
    recovery: "Correct the task request file and plan again.",
    documentationVersion: "1",
    safeDetails: { reason: "string" }
  },
  {
    code: "VES_TASK_STATE_INVALID",
    category: "integrity",
    component: "task",
    retryability: "never",
    recovery: "The run's durable state failed validation; inspect it with `vestra task status` and plan a new run.",
    documentationVersion: "1",
    safeDetails: { reason: "string" }
  },
  {
    code: "VES_TASK_RUN_NOT_FOUND",
    category: "state",
    component: "task",
    retryability: "after-change",
    recovery: "Check the run ID printed by `vestra task plan` in this Workspace.",
    documentationVersion: "1",
    safeDetails: {}
  },
  {
    code: "VES_TASK_TRANSITION_REFUSED",
    category: "state",
    component: "task",
    retryability: "after-change",
    recovery: "Run `vestra task status` and use one of the next allowed actions it lists.",
    documentationVersion: "1",
    safeDetails: { state: "string", command: "string" }
  },
  {
    code: "VES_TASK_BINDING_MISMATCH",
    category: "conflict",
    component: "task",
    retryability: "after-change",
    recovery: "Re-read the approval surface and pass the exact binding digest it prints.",
    documentationVersion: "1",
    safeDetails: {}
  },
  {
    code: "VES_TASK_SURFACE_MISMATCH",
    category: "conflict",
    component: "task",
    retryability: "after-change",
    recovery: "Re-read the review surface with `vestra task status` and pass its current surface digest.",
    documentationVersion: "1",
    safeDetails: {}
  },
  {
    code: "VES_TASK_CONFIRMATION_REQUIRED",
    category: "security",
    component: "task",
    retryability: "after-change",
    recovery:
      "Confirm from an interactive terminal by typing the digest, or pass --confirm-stdin with the digest on stdin.",
    documentationVersion: "1",
    safeDetails: {}
  },
  {
    code: "VES_TASK_RUN_ACTIVE",
    category: "conflict",
    component: "task",
    retryability: "safe",
    recovery: "Another process is driving this run; wait for it, or run `vestra task cancel`.",
    documentationVersion: "1",
    safeDetails: {}
  },
  {
    code: "VES_TASK_FAILED",
    category: "external",
    component: "task",
    retryability: "after-change",
    recovery: "Inspect `vestra task status` for the recorded reason, remediate, and retry or plan a new run.",
    documentationVersion: "1",
    safeDetails: { reason: "string" }
  }
] as const satisfies readonly PublicErrorDefinition[]);

export const taskPublicErrorRegistry = new PublicErrorRegistry(TASK_PUBLIC_ERROR_DEFINITIONS);

export function taskError(
  code: (typeof TASK_PUBLIC_ERROR_DEFINITIONS)[number]["code"],
  details: Readonly<Record<string, unknown>>,
  message: string,
  options?: ErrorOptions
): PublicErrorException {
  return new PublicErrorException(taskPublicErrorRegistry.create(code, details), message, options);
}

export function stableCode(error: unknown): string {
  const code = (error as { readonly code?: unknown } | undefined)?.code;
  return typeof code === "string" && /^VES_[A-Z0-9_]{1,96}$/u.test(code) ? code : "VES_TASK_INTERNAL";
}

export function notConfigured(requirement: string, message: string, options?: ErrorOptions): PublicErrorException {
  return taskError("VES_TASK_NOT_CONFIGURED", { requirement }, message, options);
}

export function stateInvalid(reason: string, message: string, options?: ErrorOptions): PublicErrorException {
  return taskError("VES_TASK_STATE_INVALID", { reason }, message, options);
}
