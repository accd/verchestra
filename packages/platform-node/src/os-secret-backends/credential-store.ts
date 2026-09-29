import { StableId } from "@verchestra/domain";

import { PlatformSecurityError } from "../platform-security-errors.ts";
import {
  OS_CREDENTIAL_CONTROLS,
  type OsSecretLocator,
  type OsSecretQualificationEvidence,
  QualifiedOsCredentialAdapter,
  type SecretAdapter,
  isValidLogicalSecretName,
  osSecretNamespace
} from "../secret-broker.ts";
import { DarwinKeychainBackend, type SecurityRunner } from "./darwin-keychain.ts";

// invariant: `digest` is the SHA-256 of the committed qualification report
// named by `report`; tests/security/os-secret-backend-security.test.mjs
// recomputes it, so editing the report without re-qualifying fails closed.
export const DARWIN_KEYCHAIN_CREDENTIAL_QUALIFICATION: OsSecretQualificationEvidence & { readonly report: string } =
  Object.freeze({
    report: "docs/qualification/os-secret-backend-darwin.md",
    digest: "808baaec89a65297c970775e6c69cad406d9835191d6c8f4ae92597797f16d4a",
    controls: OS_CREDENTIAL_CONTROLS.darwin.controls
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

// why: the one place a platform is mapped to a qualified credential backend.
// A platform without its own qualification report is refused here, so a
// linux or win32 caller reports "not configured" rather than a fake store.
export function createOsCredentialStore(options: {
  readonly platform: string;
  readonly keychainPath?: string;
  readonly runner?: SecurityRunner;
}): OsCredentialStore {
  if (options.platform !== "darwin") {
    throw new PlatformSecurityError(
      "VES_SECRET_STORE_UNQUALIFIED",
      "No OS credential store is qualified on this platform"
    );
  }
  const backend = new DarwinKeychainBackend({
    ...(options.runner === undefined ? {} : { runner: options.runner }),
    ...(options.keychainPath === undefined ? {} : { keychainPath: options.keychainPath })
  });
  const adapter = new QualifiedOsCredentialAdapter({
    platform: options.platform,
    evidence: DARWIN_KEYCHAIN_CREDENTIAL_QUALIFICATION,
    backend
  });
  return Object.freeze({
    storeId: adapter.adapterId,
    keychain: backend.keychain,
    adapter,
    verify: () => backend.verifyKeychain(),
    store: (workspaceId: string, logicalName: string, value: Uint8Array) =>
      backend.store(locator(workspaceId, logicalName), value),
    delete: (workspaceId: string, logicalName: string) => backend.delete(locator(workspaceId, logicalName))
  });
}
