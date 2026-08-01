export const packageName = "@verchestra/workspace" as const;
export {
  WorkspaceScanError,
  buildInventoryFingerprint,
  buildInventoryFingerprintV2,
  detectProjectMarker,
  parseGitFile,
  sanitizeRemoteUrl,
  type ProjectMarker
} from "./scanner/scanner-primitives.ts";
export {
  scanWorkspace,
  type LinkInventory,
  type ProjectInventory,
  type RepositoryInventory,
  type WorkspaceInventory
} from "./scanner/workspace-scanner.ts";
export { WORKSPACE_PUBLIC_ERROR_DEFINITIONS, workspacePublicErrorRegistry } from "./scanner/workspace-errors.ts";
export {
  createWritePlan,
  effectivePlacement,
  resolveArtifact,
  type DesiredArtifact,
  type EffectivePlacement,
  type LogicalArtifactAddress,
  type PlacementProject,
  type PlacementSnapshot,
  type PlannedWrite,
  type ProjectArtifactClass,
  type ProjectPlacement,
  type ResolvedArtifact,
  type WorkspacePlacementMode,
  type WritePlan
} from "./placement/artifact-placement.ts";
export { PLACEMENT_PUBLIC_ERROR_DEFINITIONS, placementPublicErrorRegistry } from "./placement/placement-errors.ts";
export { MANAGED_GITIGNORE_LINES, editManagedGitignore, type ManagedGitignoreEdit } from "./init/managed-gitignore.ts";
export { INIT_PUBLIC_ERROR_DEFINITIONS, initPublicErrorRegistry } from "./init/init-errors.ts";
export {
  SafeInitService,
  buildCanonicalInitFiles,
  type InitChange,
  type InitHookContext,
  type InitPreview,
  type InitRecoveryReceipt,
  type InitTransactionHooks
} from "./init/safe-init.ts";
