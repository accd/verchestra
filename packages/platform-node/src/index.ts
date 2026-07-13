export const packageName = "@verchestra/platform-node" as const;
export {
  DEFAULT_RUNTIME_MIGRATIONS,
  RuntimeStore,
  inspectRuntimeDatabase,
  type RuntimeMigration
} from "./runtime-store/runtime-store.ts";
export { RUNTIME_PUBLIC_ERROR_DEFINITIONS, runtimePublicErrorRegistry } from "./runtime-store/runtime-errors.ts";
export {
  PLATFORM_SECURITY_PUBLIC_ERROR_DEFINITIONS,
  PlatformSecurityError,
  platformSecurityPublicErrorRegistry
} from "./platform-security-errors.ts";
export { ProtectedPathBroker, type ProtectedPathHandle } from "./protected-path.ts";
export {
  MockSecretAdapter,
  QualifiedOsSecretAdapter,
  SecretBroker,
  type SecretAdapter,
  type SecretBinding,
  type SecretHandle
} from "./secret-broker.ts";
export {
  ensureWorkspaceState,
  resolveStateRoot,
  resolveWorkspaceState,
  type WorkspaceStateLayout
} from "./state-root.ts";
export { SystemClock } from "./system-clock.ts";
