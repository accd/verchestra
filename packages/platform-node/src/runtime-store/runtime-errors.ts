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
    component: "runtime-store",
    retryability,
    recovery,
    documentationVersion: "1",
    safeDetails: Object.freeze({})
  });

export const RUNTIME_PUBLIC_ERROR_DEFINITIONS = Object.freeze([
  define("VES_RUNTIME_BACKUP_INVALID", "integrity", "safe", "Retry into a new destination and inspect storage health."),
  define(
    "VES_RUNTIME_BACKUP_PUBLISH_FAILED",
    "external",
    "safe",
    "Correct destination permissions or space, then retry."
  ),
  define("VES_RUNTIME_BUSY", "conflict", "safe", "Retry within the bounded SQLite busy policy."),
  define(
    "VES_RUNTIME_CLAIM_CONFLICT",
    "conflict",
    "after-change",
    "Wait for, release, or explicitly take over the work claim."
  ),
  define("VES_RUNTIME_CLAIM_OWNER_MISMATCH", "security", "never", "Release the claim only through its current owner."),
  define("VES_RUNTIME_CLOSED", "state", "after-change", "Open the runtime store before using its repositories."),
  define("VES_RUNTIME_CONSTRAINT", "integrity", "never", "Correct the record or referenced canonical entity."),
  define("VES_RUNTIME_CORRUPT", "integrity", "after-change", "Stop writers and follow verified backup recovery."),
  define("VES_RUNTIME_DOWNGRADE_UNSUPPORTED", "state", "never", "Restore a backup compatible with the older release."),
  define(
    "VES_RUNTIME_EXTENSION_ENABLED",
    "security",
    "never",
    "Disable SQLite extension loading and reopen the store."
  ),
  define("VES_RUNTIME_LEASE_CONFLICT", "conflict", "after-change", "Wait for lease expiry or coordinate a takeover."),
  define("VES_RUNTIME_LEASE_OWNER_MISMATCH", "security", "never", "Release the lease only through its current owner."),
  define("VES_RUNTIME_MIGRATION_DRIFT", "integrity", "never", "Restore the exact release migration set."),
  define(
    "VES_RUNTIME_MIGRATION_INCOMPATIBLE",
    "state",
    "after-change",
    "Use a release compatible with the migration ledger."
  ),
  define("VES_RUNTIME_NOT_FOUND", "state", "after-change", "Refresh canonical state and use an existing reference."),
  define(
    "VES_RUNTIME_TRANSITION_INVALID",
    "validation",
    "never",
    "Persist only an accepted consistent workflow decision."
  ),
  define(
    "VES_RUNTIME_VERSION_CONFLICT",
    "conflict",
    "after-change",
    "Reload the run and decide against its current version."
  )
]);

export const runtimePublicErrorRegistry = new PublicErrorRegistry(RUNTIME_PUBLIC_ERROR_DEFINITIONS);
