import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { LauncherBootstrapError } from "./public-errors.ts";

// NPX-02. Release authority is packaged, pinned, and reviewed: the TUF trust
// root travels inside the tarball, the source URLs are fixed HTTPS locations,
// and no environment variable may select a different root, repository, or
// release. Anything that could smuggle authority in at runtime — a credential
// in a URL, a query string, a `${...}` substitution, a non-HTTPS scheme — is
// refused here rather than resolved.

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9:._@+/-]{0,255}$/u;
// Schema version 2 pins a per-host map of source locations instead of one
// global pair, because the one published tarball must resolve every fleet
// platform (win32-x64, linux-x64, linux-arm64, darwin-x64, darwin-arm64).
// No version-1 file was ever published, so there is no compatibility path to
// maintain: the launcher accepts version 2 only, and the version bump is the
// migration.
const TARGET_KEY = /^(?:win32|linux|darwin)-(?:x64|arm64)$/u;
const SOURCE_KEYS = Object.freeze([
  "schemaVersion",
  "sourceId",
  "releaseId",
  "semanticVersion",
  "rootDigest",
  "targets"
]);
const TARGET_SOURCE_KEYS = Object.freeze(["metadataBaseUrl", "targetBaseUrl"]);

/** The pinned source locations for exactly one `<platform>-<arch>` host. */
export interface PinnedTargetSource {
  readonly metadataBaseUrl: string;
  readonly targetBaseUrl: string;
}

export interface PinnedReleaseSource {
  readonly schemaVersion: 2;
  readonly sourceId: string;
  readonly releaseId: string;
  readonly semanticVersion: string;
  readonly rootDigest: string;
  readonly targets: Readonly<Record<string, PinnedTargetSource>>;
}

export interface PinnedLauncherInputs {
  readonly source: PinnedReleaseSource;
  readonly trustedRoot: Uint8Array;
}

const invalid = (message: string): never => {
  throw new LauncherBootstrapError("VES_VESTRA_INPUTS_INVALID", message);
};

const missing = (message: string): never => {
  throw new LauncherBootstrapError("VES_VESTRA_INPUTS_MISSING", message);
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const hasExactKeys = (value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean =>
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

async function readPinnedFile(root: string, name: string): Promise<Buffer> {
  try {
    return await readFile(join(root, "config", name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return missing(`the packaged release configuration ${name} is not present`);
    return invalid(`the packaged release configuration ${name} cannot be read`);
  }
}

function parsePinnedLocation(value: unknown, label: string): URL {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024 || value.includes("${"))
    invalid(`${label} is not a fixed public location`);
  try {
    return new URL(value as string);
  } catch {
    return invalid(`${label} is not a fixed public location`);
  }
}

/**
 * A pinned public location: HTTPS, no user information, no query, no fragment,
 * no substitution marker, and a directory-style base path.
 */
export function assertPinnedHttpsBase(value: unknown, label: string): string {
  const url = parsePinnedLocation(value, label);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !url.pathname.endsWith("/")
  )
    invalid(`${label} is not a credential-free HTTPS base location`);
  return url.href;
}

function assertTargetSource(value: unknown, key: string): PinnedTargetSource {
  if (!isRecord(value) || !hasExactKeys(value, TARGET_SOURCE_KEYS))
    invalid(`the packaged release configuration target ${key} has missing or unknown fields`);
  const record = value as Readonly<Record<string, unknown>>;
  return Object.freeze({
    metadataBaseUrl: assertPinnedHttpsBase(record["metadataBaseUrl"], `targets.${key}.metadataBaseUrl`),
    targetBaseUrl: assertPinnedHttpsBase(record["targetBaseUrl"], `targets.${key}.targetBaseUrl`)
  });
}

function assertTargets(value: unknown): Readonly<Record<string, PinnedTargetSource>> {
  if (!isRecord(value)) invalid("the packaged release configuration field targets is not a target map");
  const record = value as Readonly<Record<string, unknown>>;
  const entries = Object.entries(record);
  if (entries.length === 0) invalid("the packaged release configuration names no target platform");
  const targets: Record<string, PinnedTargetSource> = {};
  for (const [key, entry] of entries) {
    if (!TARGET_KEY.test(key))
      invalid(`the packaged release configuration target ${key} is not a supported platform-arch key`);
    targets[key] = assertTargetSource(entry, key);
  }
  return Object.freeze(targets);
}

function assertSourceShape(value: unknown): PinnedReleaseSource {
  if (!isRecord(value) || !hasExactKeys(value, SOURCE_KEYS))
    invalid("the packaged release configuration has missing or unknown fields");
  const record = value as Readonly<Record<string, unknown>>;
  if (record["schemaVersion"] !== 2) invalid("the packaged release configuration is not version 2");
  for (const [key, pattern] of [
    ["sourceId", SAFE_ID],
    ["releaseId", SAFE_ID],
    ["semanticVersion", SEMVER],
    ["rootDigest", DIGEST]
  ] as const) {
    if (typeof record[key] !== "string" || !pattern.test(record[key] as string))
      invalid(`the packaged release configuration field ${key} is invalid`);
  }
  return Object.freeze({
    schemaVersion: 2 as const,
    sourceId: record["sourceId"] as string,
    releaseId: record["releaseId"] as string,
    semanticVersion: record["semanticVersion"] as string,
    rootDigest: record["rootDigest"] as string,
    targets: assertTargets(record["targets"])
  });
}

function assertTrustedRoot(bytes: Buffer, expectedDigest: string): Uint8Array {
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (digest !== expectedDigest)
    throw new LauncherBootstrapError(
      "VES_VESTRA_TRUST_ROOT_INVALID",
      "the packaged trust root does not match the pinned release configuration"
    );
  let document: unknown;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new LauncherBootstrapError("VES_VESTRA_TRUST_ROOT_INVALID", "the packaged trust root is not a TUF document");
  }
  const signed = isRecord(document) ? document["signed"] : undefined;
  if (!isRecord(document) || !Array.isArray(document["signatures"]) || !isRecord(signed) || signed["_type"] !== "root")
    throw new LauncherBootstrapError("VES_VESTRA_TRUST_ROOT_INVALID", "the packaged trust root is not a TUF root role");
  return new Uint8Array(bytes);
}

/** Loads and validates the pinned public inputs that travel inside the tarball. */
export async function loadPinnedInputs(packageRoot: string): Promise<PinnedLauncherInputs> {
  const sourceBytes = await readPinnedFile(packageRoot, "release-source.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(sourceBytes.toString("utf8"));
  } catch {
    return invalid("the packaged release configuration is not JSON");
  }
  const source = assertSourceShape(parsed);
  const trustedRoot = assertTrustedRoot(await readPinnedFile(packageRoot, "root.json"), source.rootDigest);
  return Object.freeze({ source, trustedRoot });
}
