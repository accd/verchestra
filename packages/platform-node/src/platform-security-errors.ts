import {
  PublicErrorRegistry,
  type ErrorCategory,
  type PublicErrorDefinition,
  type Retryability
} from "@verchestra/domain";

export class PlatformSecurityError extends Error {
  readonly code: string;

  constructor(
    code: string,
    message: string,
    safeFields: Readonly<Record<string, string>> = {},
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "PlatformSecurityError";
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
    component: "platform-security",
    retryability,
    recovery,
    documentationVersion: "1",
    safeDetails: Object.freeze({})
  });

export const PLATFORM_SECURITY_PUBLIC_ERROR_DEFINITIONS = Object.freeze([
  define("VES_PATH_CHANGED", "security", "safe", "Resolve and open the path again after inspecting the filesystem."),
  define("VES_PATH_HANDLE_INVALID", "security", "never", "Use an active handle issued by the same path broker."),
  define("VES_PATH_LOGICAL_INVALID", "validation", "never", "Use a canonical repository-relative logical path."),
  define(
    "VES_PATH_NOT_FOUND",
    "state",
    "after-change",
    "Refresh the protected root and select an existing logical path."
  ),
  define("VES_PATH_OUTSIDE_ROOT", "security", "never", "Select a path contained by an authorized protected root."),
  define("VES_PATH_ROOT_UNKNOWN", "security", "never", "Use a root explicitly granted to this Workspace broker."),
  define(
    "VES_PATH_ROOT_INVALID",
    "validation",
    "never",
    "Declare unique canonical protected root IDs and directories."
  ),
  define("VES_PATH_WORKSPACE_MISMATCH", "security", "never", "Use the broker owned by the requesting Workspace."),
  define("VES_SECRET_BACKEND_FAILURE", "external", "safe", "Retry or repair the qualified local secret-store bridge."),
  define("VES_SECRET_BINDING_INVALID", "validation", "never", "Correct the logical secret binding metadata."),
  define(
    "VES_SECRET_HANDLE_INVALID",
    "security",
    "never",
    "Bind the secret again through the active Workspace broker."
  ),
  define("VES_SECRET_MISSING", "state", "after-change", "Bind the logical name in the expected local secret store."),
  define(
    "VES_SECRET_STORE_UNQUALIFIED",
    "security",
    "after-change",
    "Install and qualify the required OS secret-store adapter."
  ),
  define("VES_SECRET_WORKSPACE_MISMATCH", "security", "never", "Use a secret binding owned by the active Workspace."),
  define("VES_STATE_PLATFORM_UNSUPPORTED", "state", "after-change", "Use a platform qualified by this release."),
  define("VES_STATE_ROOT_INVALID", "validation", "never", "Use an absolute OS-native local state root."),
  define("VES_STATE_ROOT_ESCAPE", "security", "never", "Remove the link crossing the isolated Workspace state root."),
  define("VES_WORKSPACE_ID_INVALID", "validation", "never", "Use a canonical Workspace stable ID.")
]);

export const platformSecurityPublicErrorRegistry = new PublicErrorRegistry(PLATFORM_SECURITY_PUBLIC_ERROR_DEFINITIONS);
