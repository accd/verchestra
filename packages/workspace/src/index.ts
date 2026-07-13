export const packageName = "@verchestra/workspace" as const;
export {
  WorkspaceScanError,
  buildInventoryFingerprint,
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
