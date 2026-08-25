// The closed public error contract of the `vestra` bootstrap (NPX-07).
//
// This package renders errors to a user who has no repository, so a message may
// carry only a stable code and an actionable sentence. Nothing here interpolates
// a filesystem path, an environment value, a URL credential, or a stack trace.
//
// An activation failure originates in the qualified TUF and activation code,
// which raises its own canonical codes. Those codes are diagnostic, not public,
// so the public set stays closed and the canonical code travels as a bounded
// detail: only the `code` property is read, only when it matches a strict
// pattern, and the upstream message is never rendered.

export const LAUNCHER_ERROR_CODES = Object.freeze([
  "VES_VESTRA_ACTIVATION_UNAVAILABLE",
  "VES_VESTRA_HOST_UNSUPPORTED",
  "VES_VESTRA_INPUTS_INVALID",
  "VES_VESTRA_INPUTS_MISSING",
  "VES_VESTRA_LAUNCH_FAILED",
  "VES_VESTRA_TRUST_ROOT_INVALID"
] as const);

export type LauncherErrorCode = (typeof LAUNCHER_ERROR_CODES)[number];

export const LAUNCHER_EXIT_CODES: Readonly<Record<LauncherErrorCode, number>> = Object.freeze({
  VES_VESTRA_ACTIVATION_UNAVAILABLE: 70,
  VES_VESTRA_HOST_UNSUPPORTED: 64,
  VES_VESTRA_INPUTS_INVALID: 78,
  VES_VESTRA_INPUTS_MISSING: 78,
  VES_VESTRA_LAUNCH_FAILED: 70,
  VES_VESTRA_TRUST_ROOT_INVALID: 78
});

export const LAUNCHER_RECOVERY: Readonly<Record<LauncherErrorCode, string>> = Object.freeze({
  VES_VESTRA_ACTIVATION_UNAVAILABLE: "Retry vestra; if it repeats, reinstall it and remove the managed install state.",
  VES_VESTRA_HOST_UNSUPPORTED: "Run vestra on a platform and architecture this release qualifies.",
  VES_VESTRA_INPUTS_INVALID: "Reinstall vestra; its pinned public release configuration is not usable.",
  VES_VESTRA_INPUTS_MISSING: "Reinstall vestra; its pinned public release configuration is absent.",
  VES_VESTRA_LAUNCH_FAILED: "Retry vestra; the verified release activated but its launcher did not start.",
  VES_VESTRA_TRUST_ROOT_INVALID: "Reinstall vestra; its pinned trust root does not match its configuration."
});

/** A diagnostic code may travel only if it is a bare, bounded `VES_` code. */
const DIAGNOSTIC_CODE = /^VES_[A-Z0-9_]{1,64}$/u;

export class LauncherBootstrapError extends Error {
  readonly code: LauncherErrorCode;
  readonly diagnosticCode: string | undefined;

  constructor(code: LauncherErrorCode, message: string, diagnosticCode?: string) {
    super(message);
    this.name = "LauncherBootstrapError";
    this.code = code;
    this.diagnosticCode =
      typeof diagnosticCode === "string" && DIAGNOSTIC_CODE.test(diagnosticCode) ? diagnosticCode : undefined;
  }
}

/**
 * Extracts the canonical code of an upstream failure. Only a `code` property is
 * read, and only when it is a bare `VES_` code, so no upstream message, path,
 * URL, or stack can reach the rendered line through this function.
 */
export function diagnosticCodeOf(error: unknown): string | undefined {
  const code = (error as { readonly code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && DIAGNOSTIC_CODE.test(code) ? code : undefined;
}

/** Renders one stable line: code, what happened, and what the user can do. */
export function renderPublicError(error: unknown): string {
  if (error instanceof LauncherBootstrapError) {
    const detail = error.diagnosticCode === undefined ? "" : ` (${error.diagnosticCode})`;
    return `${error.code}: ${error.message}${detail}. ${LAUNCHER_RECOVERY[error.code]}`;
  }
  return (
    "VES_VESTRA_ACTIVATION_UNAVAILABLE: vestra could not complete its bootstrap. " +
    `${LAUNCHER_RECOVERY.VES_VESTRA_ACTIVATION_UNAVAILABLE}`
  );
}

/** The deterministic process status for a bootstrap failure. */
export function exitCodeFor(error: unknown): number {
  return error instanceof LauncherBootstrapError ? LAUNCHER_EXIT_CODES[error.code] : 70;
}
