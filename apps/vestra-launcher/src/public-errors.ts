// The closed public error contract of the `vestra` bootstrap (NPX-07).
//
// This package renders errors to a user who has no repository, so a message may
// carry only a stable code and an actionable sentence. Nothing here interpolates
// a filesystem path, an environment value, a URL credential, or a stack trace.

export const LAUNCHER_ERROR_CODES = Object.freeze([
  "VES_VESTRA_ACTIVATION_UNAVAILABLE",
  "VES_VESTRA_HOST_UNSUPPORTED",
  "VES_VESTRA_INPUTS_INVALID",
  "VES_VESTRA_INPUTS_MISSING",
  "VES_VESTRA_TRUST_ROOT_INVALID"
] as const);

export type LauncherErrorCode = (typeof LAUNCHER_ERROR_CODES)[number];

export const LAUNCHER_EXIT_CODES: Readonly<Record<LauncherErrorCode, number>> = Object.freeze({
  VES_VESTRA_ACTIVATION_UNAVAILABLE: 70,
  VES_VESTRA_HOST_UNSUPPORTED: 64,
  VES_VESTRA_INPUTS_INVALID: 78,
  VES_VESTRA_INPUTS_MISSING: 78,
  VES_VESTRA_TRUST_ROOT_INVALID: 78
});

export const LAUNCHER_RECOVERY: Readonly<Record<LauncherErrorCode, string>> = Object.freeze({
  VES_VESTRA_ACTIVATION_UNAVAILABLE: "Install a published vestra release that carries its activation closure.",
  VES_VESTRA_HOST_UNSUPPORTED: "Run vestra on a platform and architecture this release qualifies.",
  VES_VESTRA_INPUTS_INVALID: "Reinstall vestra; its pinned public release configuration is not usable.",
  VES_VESTRA_INPUTS_MISSING: "Reinstall vestra; its pinned public release configuration is absent.",
  VES_VESTRA_TRUST_ROOT_INVALID: "Reinstall vestra; its pinned trust root does not match its configuration."
});

export class LauncherBootstrapError extends Error {
  readonly code: LauncherErrorCode;

  constructor(code: LauncherErrorCode, message: string) {
    super(message);
    this.name = "LauncherBootstrapError";
    this.code = code;
  }
}

/** Renders one stable line: code, what happened, and what the user can do. */
export function renderPublicError(error: unknown): string {
  if (error instanceof LauncherBootstrapError)
    return `${error.code}: ${error.message}. ${LAUNCHER_RECOVERY[error.code]}`;
  return (
    "VES_VESTRA_ACTIVATION_UNAVAILABLE: vestra could not complete its bootstrap. " +
    `${LAUNCHER_RECOVERY.VES_VESTRA_ACTIVATION_UNAVAILABLE}`
  );
}

/** The deterministic process status for a bootstrap failure. */
export function exitCodeFor(error: unknown): number {
  return error instanceof LauncherBootstrapError ? LAUNCHER_EXIT_CODES[error.code] : 70;
}
