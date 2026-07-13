export const packageName = "@verchestra/application" as const;
export {
  type CliCommand,
  type CommandBus,
  type CommandResult,
  type InvocationContext
} from "./commands/command-bus.ts";
export {
  BOOTSTRAP_PUBLIC_ERROR_DEFINITIONS,
  BootstrapError,
  bootstrapPublicErrorRegistry
} from "./bootstrap/bootstrap-errors.ts";
export {
  MachineBootstrapService,
  type BootstrapResult,
  type CanonicalBootstrapConfig,
  type CanonicalDatabaseRegistration,
  type CanonicalSecretRequirement,
  type DriverDiscoveryPort,
  type LocalDriverCandidate,
  type LocalModelPassport,
  type MachineProfile,
  type MachineProfileSaveReceipt,
  type MachineProfileStorePort,
  type MissingBinding,
  type RoleBindingResult,
  type RoleRequirement,
  type SecretBindingInspectorPort,
  type SecretBindingRequest
} from "./bootstrap/machine-bootstrap.ts";
export { SyncError } from "./sync/sync-errors.ts";
export {
  WorkspaceReconcileService,
  type CanonicalSyncConfiguration,
  type ContentDigestPort,
  type GenerationSnapshot,
  type IngestionManifestRef,
  type LocalRebuildRequirement,
  type PersistedSyncState,
  type PlannedEffect,
  type ProjectRegistration,
  type ProjectionMapping,
  type ReconcileOperation,
  type ReconciliationDirection,
  type SyncStateStorePort,
  type UncertainEffect,
  type WorkspaceReconcileInput,
  type WorkspaceReconcileResult
} from "./sync/workspace-reconcile.ts";
