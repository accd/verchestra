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
    component: "workspace-scanner",
    retryability,
    recovery,
    documentationVersion: "1",
    safeDetails: Object.freeze({})
  });

export const WORKSPACE_PUBLIC_ERROR_DEFINITIONS = Object.freeze([
  define("VES_WORKSPACE_CONTROL_ROOT_INVALID", "validation", "never", "Run the scanner at the exact Git control root."),
  define(
    "VES_WORKSPACE_GITFILE_INVALID",
    "integrity",
    "after-change",
    "Repair or remove the malformed Git boundary file."
  ),
  define("VES_WORKSPACE_GIT_FAILED", "external", "safe", "Repair the Git repository or installation, then scan again."),
  define("VES_WORKSPACE_INVENTORY_INVALID", "integrity", "never", "Correct the non-canonical inventory input."),
  define(
    "VES_WORKSPACE_OWNER_AMBIGUOUS",
    "security",
    "after-change",
    "Resolve the Git boundary before planning writes."
  ),
  define(
    "VES_WORKSPACE_PATH_OUTSIDE_CONTROL",
    "security",
    "never",
    "Register external source through an explicit local binding."
  ),
  define(
    "VES_WORKSPACE_REMOTE_INVALID",
    "security",
    "after-change",
    "Configure a credential-free supported remote identity."
  ),
  define(
    "VES_WORKSPACE_SCAN_LIMIT",
    "security",
    "after-change",
    "Reduce the source scope or raise a reviewed bounded scan limit."
  )
]);

export const workspacePublicErrorRegistry = new PublicErrorRegistry(WORKSPACE_PUBLIC_ERROR_DEFINITIONS);
