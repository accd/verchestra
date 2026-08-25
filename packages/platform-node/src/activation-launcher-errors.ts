import {
  PublicErrorRegistry,
  type ErrorCategory,
  type PublicErrorDefinition,
  type Retryability
} from "@verchestra/domain";

// NPX-07: the observed activation health gate and the verified launcher handoff
// share one closed public error contract. Every message this module's adapters
// raise is a fixed sentence plus bundle-owned identity (component IDs, logical
// paths, platform-arch); no absolute path, environment value, or credential can
// reach it, which is what makes these codes safe to render to a user of the
// public `vestra` launcher.
export const ACTIVATION_LAUNCHER_ERROR_CODES = Object.freeze([
  "VES_LAUNCHER_ARGUMENT_INVALID",
  "VES_LAUNCHER_EXIT_NONZERO",
  "VES_LAUNCHER_HEALTH_CHECK_FAILED",
  "VES_LAUNCHER_HEALTH_DIVERGED",
  "VES_LAUNCHER_HEALTH_RELEASE_MISMATCH",
  "VES_LAUNCHER_HEALTH_REPORT_INVALID",
  "VES_LAUNCHER_HOST_UNSUPPORTED",
  "VES_LAUNCHER_OUTPUT_EXCEEDED",
  "VES_LAUNCHER_PATH_INVALID",
  "VES_LAUNCHER_PROCESS_FAILED",
  "VES_LAUNCHER_RELEASE_INVALID",
  "VES_LAUNCHER_SIGNAL_TERMINATED",
  "VES_LAUNCHER_TERMINATION_INCOMPLETE",
  "VES_LAUNCHER_TIMEOUT"
] as const);

export type ActivationLauncherErrorCode = (typeof ACTIVATION_LAUNCHER_ERROR_CODES)[number];

export class ActivationLauncherError extends Error {
  readonly code: ActivationLauncherErrorCode;

  constructor(code: ActivationLauncherErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ActivationLauncherError";
    this.code = code;
  }
}

const define = (
  code: ActivationLauncherErrorCode,
  category: ErrorCategory,
  retryability: Retryability,
  recovery: string
): PublicErrorDefinition =>
  Object.freeze({
    code,
    category,
    component: "activation-launcher",
    retryability,
    recovery,
    documentationVersion: "1",
    safeDetails: Object.freeze({})
  });

export const ACTIVATION_LAUNCHER_PUBLIC_ERROR_DEFINITIONS = Object.freeze([
  define("VES_LAUNCHER_ARGUMENT_INVALID", "validation", "never", "Pass launcher arguments as a clean argument vector."),
  define("VES_LAUNCHER_EXIT_NONZERO", "state", "after-change", "Inspect the activated release before retrying."),
  define(
    "VES_LAUNCHER_HEALTH_CHECK_FAILED",
    "integrity",
    "never",
    "Publish a release whose migration, native, and driver checks pass."
  ),
  define(
    "VES_LAUNCHER_HEALTH_DIVERGED",
    "integrity",
    "never",
    "Publish canonical launchers that observe identical behavior."
  ),
  define(
    "VES_LAUNCHER_HEALTH_RELEASE_MISMATCH",
    "integrity",
    "never",
    "Activate a release whose launchers report their own identity."
  ),
  define(
    "VES_LAUNCHER_HEALTH_REPORT_INVALID",
    "integrity",
    "never",
    "Publish launchers that emit the versioned activation health report."
  ),
  define("VES_LAUNCHER_HOST_UNSUPPORTED", "state", "never", "Use a platform and architecture this release qualifies."),
  define("VES_LAUNCHER_OUTPUT_EXCEEDED", "security", "never", "Publish a launcher whose health report is bounded."),
  define("VES_LAUNCHER_PATH_INVALID", "security", "never", "Activate a release whose components stay in their root."),
  define("VES_LAUNCHER_PROCESS_FAILED", "external", "after-change", "Repair the activated release and run it again."),
  define(
    "VES_LAUNCHER_RELEASE_INVALID",
    "integrity",
    "never",
    "Activate a release carrying one runtime and both canonical launchers."
  ),
  define("VES_LAUNCHER_SIGNAL_TERMINATED", "state", "after-change", "Investigate why the launcher was terminated."),
  define(
    "VES_LAUNCHER_TERMINATION_INCOMPLETE",
    "security",
    "never",
    "Terminate the remaining launcher process group before retrying."
  ),
  define("VES_LAUNCHER_TIMEOUT", "state", "after-change", "Raise the health budget or repair the slow launcher.")
]);

export const activationLauncherPublicErrorRegistry = new PublicErrorRegistry(
  ACTIVATION_LAUNCHER_PUBLIC_ERROR_DEFINITIONS
);
