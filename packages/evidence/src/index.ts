export const packageName = "@verchestra/evidence" as const;
export { ArtifactSealer, createTrustRoot } from "./integrity/artifact-sealer.ts";
export { IntegrityError, canonicalizeJson, sha256Digest, type IntegrityErrorCode } from "./integrity/canonical.ts";
export { NodeEd25519Signer, type SignerOptions } from "./integrity/signer.ts";
export {
  KEY_LIFECYCLE_ERROR_CODES,
  type EvidenceSigner,
  type KeyLifecycleErrorCode,
  type KeyProviderPort,
  type KeyProviderRequest,
  type KeyRotation,
  type KeyRotationRequest
} from "./integrity/key-provider.ts";
export type * from "./integrity/types.ts";
export {
  FileRunCapsuleStore,
  RUN_TERMINAL_STATUSES,
  RunCapsuleBuilder,
  RunCapsuleError,
  RunCapsuleRecoveryCoordinator,
  type RunCapsuleBuildInput,
  type RunCapsuleEvidence,
  type RunCapsuleHandoff,
  type RunCapsuleInputResolver,
  type RunCapsuleJournalPort,
  type RunCapsulePayload,
  type RunCapsuleRef,
  type RunCapsuleTerminalTransition,
  type RunCapsuleErrorCode,
  type RunRiskTier,
  type RunTerminalStatus,
  type SignedRunCapsule,
  type UnsealedRunCapsuleIntent
} from "./run-capsule/run-capsule.ts";
export {
  ExecutionPackageBuilder,
  ExecutionPackageError,
  FileExecutionPackageStore,
  derivePendingTasks,
  type ExecutionPackageArtifactRef,
  type ExecutionPackageBindings,
  type ExecutionPackageBuildInput,
  type ExecutionPackageCurrentState,
  type ExecutionPackageInvalidation,
  type ExecutionPackagePayload,
  type ExecutionPackageVerification,
  type ExecutionRequirement,
  type ExecutionTask,
  type PendingTask,
  type SignedExecutionPackage,
  type TaskCompletionEvidence
} from "./execution-package/execution-package.ts";
export {
  ConsistentSnapshotCoordinator,
  FileRecoveryBundleStore,
  RecoveryBundleBuilder,
  RecoveryBundleError,
  RecoveryRestoreCoordinator,
  type RecoveryBundleErrorCode,
  type RecoveryBundleManifest,
  type RecoveryBundlePlan,
  type RecoveryObjectInput,
  type RecoveryObjectRef,
  type RecoveryRecipientInput,
  type RecoveryRecipientRef,
  type SignedRecoveryBundle,
  type SnapshotSource
} from "./recovery-bundle/recovery-bundle.ts";
export {
  HmacPathPseudonymizer,
  ProhibitedContentScanner,
  StableErrorDiagnosticAdapter,
  SupportCodeRegistry,
  SupportBundleBuilder,
  SupportBundleError,
  SupportExportCoordinator,
  type SignedSupportBundle,
  type SupportApprovalPort,
  type SupportBundleErrorCode,
  type SupportBundleInspection,
  type SupportBundleManifest,
  type SupportBundlePlan,
  type SupportDiagnostic,
  type SupportEgressPort,
  type SupportExportSinkPort,
  type SupportRecipientInput,
  type SupportRecipientRef
} from "./support-bundle/support-bundle.ts";
