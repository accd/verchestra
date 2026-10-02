// why: which credential each provider of a governed task uses is a
// machine-local Workspace setting, read here and nowhere else. It reaches the
// state layout through the ./secrets subpath, so deep doctor's credential
// check can ask for the mode without loading the runtime store.
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveStateRoot, resolveWorkspaceState } from "@verchestra/platform-node/secrets";
import { readWorkspaceIdentity } from "@verchestra/workspace";

import { notConfigured } from "./task/task-errors.ts";

// invariant: the user writes this file beside the gate allowlist; a Task
// Request is untrusted input and can never name, or change, a credential mode.
export const PROVIDER_AUTH_FILE = "task-providers.json";
const MAXIMUM_BYTES = 16 * 1024;
const PROVIDERS = Object.freeze({ "claude-code": "implementer", codex: "verifier" } as const);
const MODES: readonly string[] = Object.freeze(["subscription", "api-key"]);

export type ProviderAuthMode = "subscription" | "api-key";

export interface ProviderAuth {
  readonly implementer: ProviderAuthMode;
  readonly verifier: ProviderAuthMode;
}

// invariant: the logical credential the implementer reads in each mode, and
// the one deep doctor observes. `vestra secret set --name <name>` binds it.
export const IMPLEMENTER_CREDENTIALS: Readonly<Record<ProviderAuthMode, string>> = Object.freeze({
  subscription: "claude-code-oauth-token",
  "api-key": "anthropic-api-key"
});

// invariant: a Workspace without the file, and a provider the file does not
// name, authenticate by subscription.
export const DEFAULT_PROVIDER_AUTH: ProviderAuth = Object.freeze({
  implementer: "subscription",
  verifier: "subscription"
});

function invalid(message: string): never {
  throw notConfigured("provider-auth", message);
}

function plainObject(value: unknown, label: string, keys: readonly string[]): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object`);
  const row = value as Readonly<Record<string, unknown>>;
  if (Object.keys(row).some((key) => !keys.includes(key))) invalid(`${label} has an unknown member`);
  return row;
}

function mode(value: unknown, provider: string): ProviderAuthMode {
  const auth = plainObject(value, `providers.${provider}`, ["auth"])["auth"];
  if (typeof auth !== "string" || !MODES.includes(auth)) invalid(`providers.${provider}.auth is not a known mode`);
  return auth as ProviderAuthMode;
}

export function normalizeProviderAuth(value: unknown): ProviderAuth {
  const row = plainObject(value, "The provider setting", ["schemaVersion", "providers"]);
  if (row["schemaVersion"] !== 1) invalid("The provider setting schemaVersion must be 1");
  const providers = plainObject(row["providers"], "providers", Object.keys(PROVIDERS));
  const selected: Record<string, ProviderAuthMode> = { ...DEFAULT_PROVIDER_AUTH };
  for (const [provider, role] of Object.entries(PROVIDERS))
    if (Object.hasOwn(providers, provider)) selected[role] = mode(providers[provider], provider);
  return Object.freeze(selected as unknown as ProviderAuth);
}

async function settingText(path: string): Promise<string | undefined> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if ((error as { readonly code?: unknown }).code === "ENOENT") return undefined;
    throw notConfigured("provider-auth", "The provider setting is unreadable", { cause: error });
  }
  // hazard: a link or an oversized file is never followed or parsed.
  if (!metadata.isFile() || metadata.size > MAXIMUM_BYTES)
    invalid("The provider setting is not a bounded regular file");
  return readFile(path, "utf8");
}

export async function loadProviderAuth(workspaceRoot: string): Promise<ProviderAuth> {
  const text = await settingText(join(workspaceRoot, PROVIDER_AUTH_FILE));
  if (text === undefined) return DEFAULT_PROVIDER_AUTH;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw notConfigured("provider-auth", "The provider setting is not valid JSON", { cause: error });
  }
  return normalizeProviderAuth(parsed);
}

export interface ProviderAuthLocation {
  readonly controlRoot: string;
  readonly platform: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory: string;
}

// why: a command that has not opened the task Workspace (deep doctor) still
// needs the mode; an uninitialized directory has no setting to read.
export async function providerAuthAt(location: ProviderAuthLocation): Promise<ProviderAuth | undefined> {
  const identity = await readWorkspaceIdentity(location.controlRoot);
  if (identity === undefined) return undefined;
  const layout = resolveWorkspaceState({
    stateRoot: resolveStateRoot(location),
    workspaceId: identity.workspaceId,
    platform: location.platform
  });
  return loadProviderAuth(layout.workspaceRoot);
}
