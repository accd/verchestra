// why: the credential surface a composition root imports without the package
// root, which re-exports runtime-store and so loads node:sqlite (and its
// stderr warning) on import. Every entry is a named re-export;
// tests/architecture/platform-node-secrets-subpath.test.mjs proves this
// file's import closure never reaches node:sqlite.
export {
  DARWIN_KEYCHAIN_CREDENTIAL_QUALIFICATION,
  LINUX_SECRET_SERVICE_CREDENTIAL_QUALIFICATION,
  WINDOWS_CREDENTIAL_MANAGER_QUALIFICATION,
  createOsCredentialStore,
  type OsCredentialStore
} from "./os-secret-backends/credential-store.ts";
export {
  isValidCredentialValue,
  type CredentialToolInvocation,
  type CredentialToolResult,
  type CredentialToolRunner
} from "./os-secret-backends/credential-tool.ts";
export {
  MAX_CREDENTIAL_VALUE_BYTES,
  SECURITY_INTERACTIVE_LINE_LIMIT,
  type SecurityInvocation,
  type SecurityResult,
  type SecurityRunner
} from "./os-secret-backends/darwin-keychain.ts";
export { PlatformSecurityError, platformSecurityPublicErrorRegistry } from "./platform-security-errors.ts";
export { type SecretAdapter, isValidLogicalSecretName } from "./secret-broker.ts";
// why: which credential a provider uses is a setting under the Workspace state
// root, and the credential check that needs it must not load the runtime
// store. Both are pure path functions; the writer `ensureWorkspaceState` stays
// behind the package root.
export { resolveStateRoot, resolveWorkspaceState } from "./state-root.ts";
