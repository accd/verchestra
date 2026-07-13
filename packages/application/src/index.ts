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
  ApprovalService,
  AuthorityError,
  CapabilityBroker,
  type ApprovalAction,
  type ApprovalArtifactPort,
  type ApprovalBinding,
  type ApprovalGrantPayload,
  type ApprovalIntent,
  type ApprovalRecord,
  type ApprovalRequest,
  type ApprovalReviewSurface,
  type AuthorityStorePort,
  type AuthorizedIdentity,
  type CapabilityGrant,
  type CapabilityRequest,
  type EntityRef,
  type PolicyAuthorizationPort,
  type SignedApprovalArtifact
} from "./authority/authority.ts";
export {
  CoordinationError,
  WorkClaimService,
  changeScopesOverlap,
  normalizeChangeScope,
  type ChangeTarget,
  type ClaimSignaturePort,
  type LocalLeasePort,
  type LocalLeaseRef,
  type NormalizedChangeScope,
  type RemoteClaimPort,
  type RunOwner,
  type WorkClaim
} from "./coordination/work-claims.ts";
export {
  DataEgressFirewall,
  EgressError,
  TrustEnvelopeService,
  type DeclassificationEvidence,
  type DeclassificationVerifierPort,
  type DestinationProfile,
  type EgressAuthorityPort,
  type EgressPolicyPort,
  type SourceIdentity,
  type TrustClass,
  type TrustEnvelope
} from "./egress/trust-egress.ts";
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
