export const packageName = "@verchestra/evidence" as const;
export { ArtifactSealer, createTrustRoot } from "./integrity/artifact-sealer.ts";
export { IntegrityError, canonicalizeJson, sha256Digest, type IntegrityErrorCode } from "./integrity/canonical.ts";
export { NodeEd25519Signer, type SignerOptions } from "./integrity/signer.ts";
export type * from "./integrity/types.ts";
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
