import { PublicErrorException } from "@verchestra/domain";
import { SecretBroker } from "@verchestra/platform-node";
import {
  createOsCredentialStore,
  platformSecurityPublicErrorRegistry,
  type SecurityRunner
} from "@verchestra/platform-node/secrets";

import { notConfigured, stableCode } from "./task-errors.ts";

// invariant: the three logical names a governed task reads, and the only ones.
// `vestra secret set --name <name>` binds each in the OS credential store.
export const IMPLEMENTER_CREDENTIAL = "anthropic-api-key";
export const VERIFIER_CREDENTIAL = "openai-api-key";
export const SIGNING_PASSPHRASE = "evidence-signing-passphrase";

export interface TaskCredentialSource {
  readonly workspaceId: string;
  readonly platform: string;
  readonly keychainPath?: string;
  readonly runner?: SecurityRunner;
}

const PURPOSES: Readonly<Record<string, { readonly purpose: string; readonly blockedCapability: string }>> =
  Object.freeze({
    [IMPLEMENTER_CREDENTIAL]: { purpose: "implementer-provider", blockedCapability: "task-implementation" },
    [VERIFIER_CREDENTIAL]: { purpose: "verifier-provider", blockedCapability: "task-verification" },
    [SIGNING_PASSPHRASE]: { purpose: "evidence-signing-key", blockedCapability: "task-evidence-signing" }
  });

function mapped(error: unknown, logicalName: string): PublicErrorException {
  if (error instanceof PublicErrorException) return error;
  const code = stableCode(error);
  if (code === "VES_SECRET_MISSING")
    return notConfigured(logicalName, `Credential ${logicalName} is not bound`, { cause: error });
  if (code === "VES_SECRET_STORE_UNQUALIFIED")
    return notConfigured("credential-store", "No OS credential store is qualified on this platform", {
      cause: error
    });
  if (platformSecurityPublicErrorRegistry.codes.includes(code))
    return new PublicErrorException(
      platformSecurityPublicErrorRegistry.create(code, {}),
      "Credential could not be read",
      { cause: error }
    );
  return notConfigured(logicalName, `Credential ${logicalName} could not be read`, { cause: error });
}

function broker(source: TaskCredentialSource, logicalName: string): SecretBroker {
  try {
    const store = createOsCredentialStore({
      platform: source.platform,
      ...(source.keychainPath === undefined ? {} : { keychainPath: source.keychainPath }),
      ...(source.runner === undefined ? {} : { runner: source.runner })
    });
    return new SecretBroker({ adapter: store.adapter, workspaceId: source.workspaceId });
  } catch (error) {
    throw mapped(error, logicalName);
  }
}

// why: every credential a command needs is proven present before any of them
// is read and before the command has any effect, so a missing one is reported
// as `not configured` with nothing to clean up.
export async function readCredentials(
  source: TaskCredentialSource,
  logicalNames: readonly string[]
): Promise<ReadonlyMap<string, string>> {
  const handles = [];
  for (const logicalName of logicalNames) {
    const secrets = broker(source, logicalName);
    const binding = PURPOSES[logicalName];
    if (binding === undefined) throw notConfigured(logicalName, "Credential name is not a task credential");
    try {
      handles.push({
        logicalName,
        secrets,
        handle: await secrets.bind({
          workspaceId: source.workspaceId,
          logicalName,
          purpose: binding.purpose,
          blockedCapability: binding.blockedCapability,
          expectedStore: "os-credential-store"
        })
      });
    } catch (error) {
      throw mapped(error, logicalName);
    }
  }
  const values = new Map<string, string>();
  for (const { logicalName, secrets, handle } of handles) {
    try {
      values.set(logicalName, await secrets.withSecret(handle, (value) => Buffer.from(value).toString("utf8")));
    } catch (error) {
      throw mapped(error, logicalName);
    }
  }
  return values;
}
