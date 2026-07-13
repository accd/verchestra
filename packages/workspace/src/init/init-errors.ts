import {
  PublicErrorRegistry,
  type ErrorCategory,
  type PublicErrorDefinition,
  type Retryability
} from "@verchestra/domain";

const define = (
  code: string,
  category: ErrorCategory,
  retryability: Retryability,
  recovery: string
): PublicErrorDefinition =>
  Object.freeze({
    code,
    category,
    component: "workspace-init",
    retryability,
    recovery,
    documentationVersion: "1",
    safeDetails: Object.freeze({})
  });

export const INIT_PUBLIC_ERROR_DEFINITIONS = Object.freeze([
  define("VES_INIT_APPLY_FAILED", "state", "safe", "Inspect the Workspace, then retry the rolled-back init plan."),
  define(
    "VES_INIT_GITIGNORE_AMBIGUOUS",
    "integrity",
    "after-change",
    "Repair the Verchestra managed delimiters without changing user-owned rules."
  ),
  define(
    "VES_INIT_GITIGNORE_NEWLINE_AMBIGUOUS",
    "integrity",
    "after-change",
    "Normalize the user-owned gitignore newline style, then preview init again."
  ),
  define("VES_INIT_INPUT_INVALID", "validation", "never", "Correct the canonical portable init input."),
  define("VES_INIT_PREVIEW_INVALID", "security", "never", "Create a fresh preview with the applying service."),
  define("VES_INIT_PREVIEW_STALE", "conflict", "safe", "Create and review a fresh init preview."),
  define(
    "VES_INIT_RECOVERY_CONFLICT",
    "integrity",
    "after-change",
    "Preserve the interrupted transaction and resolve the conflicting target before recovery."
  ),
  define(
    "VES_INIT_RECOVERY_REQUIRED",
    "state",
    "safe",
    "Recover the interrupted init transaction before creating another preview."
  ),
  define(
    "VES_INIT_TARGET_CONFLICT",
    "conflict",
    "after-change",
    "Reconcile the existing human-owned canonical file before initialization."
  ),
  define(
    "VES_INIT_TARGET_IGNORED",
    "security",
    "after-change",
    "Remove the broad ignore rule or choose an authorized centralized placement."
  )
]);

export const initPublicErrorRegistry = new PublicErrorRegistry(INIT_PUBLIC_ERROR_DEFINITIONS);
