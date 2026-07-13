import {
  PublicErrorRegistry,
  type ErrorCategory,
  type PublicErrorDefinition,
  type Retryability
} from "@verchestra/domain";

export class BootstrapError extends Error {
  readonly code: string;

  constructor(
    code: string,
    message: string,
    safeFields: Readonly<Record<string, string | number>> = {},
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "BootstrapError";
    this.code = code;
    Object.assign(this, safeFields);
  }
}

const define = (
  code: string,
  category: ErrorCategory,
  retryability: Retryability,
  recovery: string
): PublicErrorDefinition =>
  Object.freeze({
    code,
    category,
    component: "machine-bootstrap",
    retryability,
    recovery,
    documentationVersion: "1",
    safeDetails: Object.freeze({})
  });

export const BOOTSTRAP_PUBLIC_ERROR_DEFINITIONS = Object.freeze([
  define(
    "VES_BOOTSTRAP_CONFIG_INCOMPATIBLE",
    "state",
    "after-change",
    "Install the minimum compatible Verchestra release or run the declared migration path."
  ),
  define(
    "VES_BOOTSTRAP_DISCOVERY_FAILED",
    "external",
    "safe",
    "Repair the local Driver installation and run bootstrap again."
  ),
  define("VES_BOOTSTRAP_INPUT_INVALID", "validation", "never", "Correct the canonical bootstrap metadata."),
  define(
    "VES_BOOTSTRAP_PROFILE_FAILED",
    "state",
    "safe",
    "Repair the Workspace-local runtime state or secret-store binding, then retry."
  )
]);

export const bootstrapPublicErrorRegistry = new PublicErrorRegistry(BOOTSTRAP_PUBLIC_ERROR_DEFINITIONS);
