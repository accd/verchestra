export const packageName = "@verchestra/platform-node" as const;
export {
  DEFAULT_RUNTIME_MIGRATIONS,
  RuntimeStore,
  inspectRuntimeDatabase,
  type ExecutionCheckpointKind,
  type RunCapsuleSeal,
  type RunEvent,
  type RuntimeMigration,
  type StoredAuthorityRecord,
  type StoredExecutionCheckpoint,
  type StoredPolicyView
} from "./runtime-store/runtime-store.ts";
export { CheckpointStoreError, RuntimeCheckpointStore } from "./checkpoint-store-adapter.ts";
export { RUNTIME_PUBLIC_ERROR_DEFINITIONS, runtimePublicErrorRegistry } from "./runtime-store/runtime-errors.ts";
export {
  PLATFORM_SECURITY_PUBLIC_ERROR_DEFINITIONS,
  PlatformSecurityError,
  platformSecurityPublicErrorRegistry
} from "./platform-security-errors.ts";
export { ProtectedPathBroker, type ProtectedPathHandle } from "./protected-path.ts";
export {
  MockSecretAdapter,
  OS_CREDENTIAL_CONTROLS,
  QualifiedOsCredentialAdapter,
  QualifiedOsSecretAdapter,
  SecretBroker,
  isValidLogicalSecretName,
  osSecretNamespace,
  type OsSecretBackend,
  type OsSecretLocator,
  type OsSecretQualificationEvidence,
  type SecretAdapter,
  type SecretBinding,
  type SecretHandle
} from "./secret-broker.ts";
export {
  DARWIN_KEYCHAIN_CREDENTIAL_QUALIFICATION,
  LINUX_SECRET_SERVICE_CREDENTIAL_QUALIFICATION,
  WINDOWS_CREDENTIAL_MANAGER_QUALIFICATION,
  createOsCredentialStore,
  type OsCredentialStore
} from "./os-secret-backends/credential-store.ts";
export {
  CredentialToolUnavailableError,
  PRESENCE_TIMEOUT_MS,
  READ_TIMEOUT_MS,
  WRITE_TIMEOUT_MS,
  isValidCredentialValue,
  MAX_CREDENTIAL_VALUE_BYTES,
  type CredentialProvisioner,
  type CredentialToolInvocation,
  type CredentialToolResult,
  type CredentialToolRunner
} from "./os-secret-backends/credential-tool.ts";
export {
  DBUS_SEND_EXECUTABLE,
  LinuxSecretServiceBackend,
  SECRET_TOOL_EXECUTABLE,
  searchItemsArguments,
  nodeSecretServiceRunner,
  secretToolChildEnvironment,
  sessionBusReachable
} from "./os-secret-backends/linux-secret-service.ts";
export {
  CREDENTIAL_PERSISTENCE,
  LOGGING_POLICY_GUARD,
  POWERSHELL_ARGUMENTS,
  WindowsCredentialManagerBackend,
  cmdkeyExecutable,
  credentialProgram,
  credentialTarget,
  nodeCredentialManagerRunner,
  powershellChildEnvironment,
  powershellExecutable
} from "./os-secret-backends/windows-credential-manager.ts";
export {
  DarwinKeychainBackend,
  KEYCHAIN_VALUE_BUDGET_BYTES,
  SECURITY_EXECUTABLE,
  SECURITY_INTERACTIVE_LINE_LIMIT,
  nodeSecurityRunner,
  securityChildEnvironment,
  type SecurityInvocation,
  type SecurityResult,
  type SecurityRunner
} from "./os-secret-backends/darwin-keychain.ts";
export {
  ensureWorkspaceState,
  resolveStateRoot,
  resolveWorkspaceState,
  type WorkspaceStateLayout
} from "./state-root.ts";
export { SystemClock } from "./system-clock.ts";
export { EncryptedFileKeyProvider } from "./encrypted-file-key-provider.ts";
export { RuntimeMachineProfileStore, SecretBrokerBindingInspector } from "./machine-bootstrap-adapters.ts";
export { NodeContentDigest, RuntimeSyncStateStore } from "./sync-adapters.ts";
export { RuntimePolicyViewStore } from "./policy-store-adapter.ts";
export { RuntimeAuthorityStore } from "./authority-store-adapter.ts";
export { RuntimeLocalLease } from "./coordination-adapters.ts";
export {
  GitWorktreeError,
  NodeGitWorktreeAdapter,
  scratchWorktreeHandle,
  type GitWorktreeErrorCode,
  type NodeGitWorktreeAdapterOptions
} from "./git-worktree-adapter.ts";
export {
  isGitObjectId,
  parseTaskCommitTrailers,
  refTarget,
  runGit,
  runGitBytes,
  taskBranchName,
  taskBranchRef,
  type GitOutput,
  type GitRunner,
  type TaskCommitTrailers
} from "./task-worktree.ts";
export {
  GitContextError,
  NodeGitContextSource,
  type GitContextErrorCode,
  type GitTreeFile,
  type NodeGitContextSourceOptions
} from "./git-context-source.ts";
export {
  NodeWorktreeToolAdapter,
  WorktreeToolError,
  type NodeWorktreeToolAdapterOptions,
  type WorktreeToolErrorCode
} from "./worktree-tool-adapter.ts";
export {
  GateAdapterError,
  NodeAtomicGitCommitAdapter,
  NodeGateProcessRunner,
  type GateCommandProfile,
  type NodeAtomicGitCommitAdapterOptions,
  type NodeGateProcessRunnerOptions
} from "./gate-commit-adapters.ts";
export {
  ACTIVATION_LAUNCHER_ERROR_CODES,
  ACTIVATION_LAUNCHER_PUBLIC_ERROR_DEFINITIONS,
  ActivationLauncherError,
  activationLauncherPublicErrorRegistry,
  type ActivationLauncherErrorCode
} from "./activation-launcher-errors.ts";
export {
  ACTIVATION_HEALTH_ARGUMENT,
  NodeActivationHealthGate,
  NodeVerifiedLauncherHandoff,
  supportedLauncherHost,
  type ActivationHealthBundleView,
  type ActivationHealthCheckName,
  type ActivationHealthComponentView,
  type CanonicalLauncherId,
  type NodeActivationHealthGateOptions,
  type ObservedActivationCheck,
  type ObservedActivationHealth,
  type ObservedLauncherHealth,
  type SupportedLauncherArch,
  type SupportedLauncherHost,
  type SupportedLauncherPlatform,
  type VerifiedLauncherHandoffRequest,
  type VerifiedLauncherHandoffResult
} from "./activation-launcher-adapters.ts";
export { terminateProcessTree } from "./process-tree-terminator.ts";
export {
  SpawnedProbeWorker,
  SpawnedProbeWorkerError,
  type ProbeTransportListener,
  type SpawnedProbeWorkerDiagnostics,
  type SpawnedProbeWorkerLimits,
  type SpawnedProbeWorkerOptions
} from "./spawned-probe-worker.ts";
