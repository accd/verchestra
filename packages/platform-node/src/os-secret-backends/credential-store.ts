import { StableId } from "@verchestra/domain";

import { PlatformSecurityError } from "../platform-security-errors.ts";
import {
  OS_CREDENTIAL_CONTROLS,
  type OsSecretBackend,
  type OsSecretLocator,
  type OsSecretQualificationEvidence,
  QualifiedOsCredentialAdapter,
  type SecretAdapter,
  isValidLogicalSecretName,
  osSecretNamespace
} from "../secret-broker.ts";
import type { CredentialToolRunner } from "./credential-tool.ts";
import { DarwinKeychainBackend } from "./darwin-keychain.ts";
import { LinuxSecretServiceBackend } from "./linux-secret-service.ts";
import { WindowsCredentialManagerBackend } from "./windows-credential-manager.ts";

// invariant: `digest` is the SHA-256 of the committed qualification report
// named by `report`; tests/security/os-secret-backend-security.test.mjs
// recomputes it, so editing the report without re-qualifying fails closed.
export const DARWIN_KEYCHAIN_CREDENTIAL_QUALIFICATION: OsSecretQualificationEvidence & { readonly report: string } =
  Object.freeze({
    report: "docs/qualification/os-secret-backend-darwin.md",
    digest: "cb5867e2c2de3f3aaa372378e7e22a704bfbe46a97ad355aba7c00279b8e1e5f",
    controls: OS_CREDENTIAL_CONTROLS.darwin.controls
  });

// invariant: bound by digest to its report exactly as the darwin evidence is.
export const LINUX_SECRET_SERVICE_CREDENTIAL_QUALIFICATION: OsSecretQualificationEvidence & {
  readonly report: string;
} = Object.freeze({
  report: "docs/qualification/os-secret-backend-linux.md",
  digest: "c4887ffe04346f77b44ba09379ed73af22648251877a3aab0a7575db703bd393",
  controls: OS_CREDENTIAL_CONTROLS.linux.controls
});

// invariant: bound by digest to its report exactly as the darwin evidence is.
export const WINDOWS_CREDENTIAL_MANAGER_QUALIFICATION: OsSecretQualificationEvidence & { readonly report: string } =
  Object.freeze({
    report: "docs/qualification/os-secret-backend-windows.md",
    digest: "17927fcd4ce0e1e2f2ba50648402d451f46ac5bb11f73005c9beda497e26a5c8",
    controls: OS_CREDENTIAL_CONTROLS.win32.controls
  });

export interface OsCredentialStore {
  readonly storeId: string;
  readonly keychain: "default" | "explicit";
  readonly adapter: SecretAdapter;
  verify(): Promise<void>;
  store(workspaceId: string, logicalName: string, value: Uint8Array): Promise<void>;
  delete(workspaceId: string, logicalName: string): Promise<boolean>;
}

function locator(workspaceId: string, logicalName: string): Readonly<OsSecretLocator> {
  try {
    StableId.parse(workspaceId, "workspace");
  } catch (error) {
    throw new PlatformSecurityError("VES_WORKSPACE_ID_INVALID", "Workspace ID is invalid", {}, { cause: error });
  }
  if (!isValidLogicalSecretName(logicalName)) {
    throw new PlatformSecurityError("VES_SECRET_BINDING_INVALID", "Logical secret name is invalid");
  }
  return Object.freeze({ namespace: osSecretNamespace(workspaceId), logicalName });
}

interface ProvisioningBackend extends OsSecretBackend {
  store(locator: Readonly<OsSecretLocator>, value: Uint8Array): Promise<void>;
  delete(locator: Readonly<OsSecretLocator>): Promise<boolean>;
}

interface PlatformBinding {
  readonly evidence: OsSecretQualificationEvidence;
  readonly backend: ProvisioningBackend;
  readonly keychain: "default" | "explicit";
  readonly verify: () => Promise<void>;
}

function withRunner(runner: CredentialToolRunner | undefined): { readonly runner?: CredentialToolRunner } {
  return runner === undefined ? {} : { runner };
}

function bindPlatform(options: {
  readonly platform: string;
  readonly keychainPath?: string;
  readonly runner?: CredentialToolRunner;
}): PlatformBinding {
  if (options.platform === "darwin") {
    const backend = new DarwinKeychainBackend({
      ...withRunner(options.runner),
      ...(options.keychainPath === undefined ? {} : { keychainPath: options.keychainPath })
    });
    return {
      evidence: DARWIN_KEYCHAIN_CREDENTIAL_QUALIFICATION,
      backend,
      keychain: backend.keychain,
      verify: () => backend.verifyKeychain()
    };
  }
  if (options.platform !== "linux" && options.platform !== "win32") {
    throw new PlatformSecurityError(
      "VES_SECRET_STORE_UNQUALIFIED",
      "No OS credential store is qualified on this platform"
    );
  }
  // invariant: a keychain file is a macOS concept. Elsewhere the flag is
  // refused rather than ignored, so it never silently selects the default store.
  if (options.keychainPath !== undefined) {
    throw new PlatformSecurityError("VES_SECRET_KEYCHAIN_INVALID", "A keychain path applies only on macOS");
  }
  const linux = options.platform === "linux";
  return {
    evidence: linux ? LINUX_SECRET_SERVICE_CREDENTIAL_QUALIFICATION : WINDOWS_CREDENTIAL_MANAGER_QUALIFICATION,
    backend: linux
      ? new LinuxSecretServiceBackend(withRunner(options.runner))
      : new WindowsCredentialManagerBackend(withRunner(options.runner)),
    keychain: "default",
    verify: async () => undefined
  };
}

// why: the one place a platform is mapped to a qualified credential backend.
// Each of darwin, linux, and win32 has its own qualification report; any other
// platform is refused here, so its caller reports "not configured" rather
// than a fake store.
export function createOsCredentialStore(options: {
  readonly platform: string;
  readonly keychainPath?: string;
  readonly runner?: CredentialToolRunner;
}): OsCredentialStore {
  const { evidence, backend, keychain, verify } = bindPlatform(options);
  const adapter = new QualifiedOsCredentialAdapter({ platform: options.platform, evidence, backend });
  return Object.freeze({
    storeId: adapter.adapterId,
    keychain,
    adapter,
    verify,
    store: (workspaceId: string, logicalName: string, value: Uint8Array) =>
      backend.store(locator(workspaceId, logicalName), value),
    delete: (workspaceId: string, logicalName: string) => backend.delete(locator(workspaceId, logicalName))
  });
}
