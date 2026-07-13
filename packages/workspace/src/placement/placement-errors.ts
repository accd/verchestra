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
    component: "artifact-placement",
    retryability,
    recovery,
    documentationVersion: "1",
    safeDetails: Object.freeze({})
  });

export const PLACEMENT_PUBLIC_ERROR_DEFINITIONS = Object.freeze([
  define("VES_PLACEMENT_ADDRESS_INVALID", "validation", "never", "Correct the logical artifact address and metadata."),
  define(
    "VES_PLACEMENT_IGNORED_TARGET",
    "security",
    "after-change",
    "Use centralized placement or correct Git ownership policy."
  ),
  define(
    "VES_PLACEMENT_NESTED_AUTH_REQUIRED",
    "policy",
    "after-change",
    "Authorize the exact nested Git owner or use centralized placement."
  ),
  define(
    "VES_PLACEMENT_OWNER_REQUIRED",
    "integrity",
    "after-change",
    "Bind an active Git owner or use centralized placement."
  ),
  define(
    "VES_PLACEMENT_PROJECT_NOT_FOUND",
    "state",
    "after-change",
    "Refresh the Workspace registry and use an active Project ID."
  ),
  define("VES_PLACEMENT_SNAPSHOT_INVALID", "integrity", "never", "Correct the canonical placement snapshot."),
  define(
    "VES_PLACEMENT_TARGET_COLLISION",
    "conflict",
    "after-change",
    "Give incompatible artifacts distinct logical addresses."
  )
]);

export const placementPublicErrorRegistry = new PublicErrorRegistry(PLACEMENT_PUBLIC_ERROR_DEFINITIONS);
