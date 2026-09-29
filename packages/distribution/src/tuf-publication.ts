import { createHash, createPublicKey, verify } from "node:crypto";
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { canonicalize } from "@tufjs/canonical-json";

import { verifyHermeticDistributionBundle, type HermeticDistributionBundle } from "./hermetic-bundle.ts";
import { verifyReleaseCandidate, type ReleaseCandidate } from "./release-candidate.ts";

const KEY_ID = /^[a-f0-9]{64}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SAFE_PATH = /^[A-Za-z0-9._@+/-]+$/u;

export interface TufSigningKey {
  readonly keyId: string;
  readonly publicKeyPem: string;
  readonly sign: (payload: Uint8Array) => Uint8Array;
}

export interface TufPublicationComponentBytes {
  readonly logicalPath: string;
  readonly bytes: Uint8Array;
}

// A TUF role's own signing authority. Separating them (#18, F1) is TUF's
// central value: an online timestamp/snapshot key that rotates fast, and an
// offline root/targets key that does not, so compromise of the online key can
// neither swap the release nor rewrite the root.
export interface TufRoleSigners {
  readonly threshold: number;
  readonly signers: readonly TufSigningKey[];
}

export interface TufPublicationRoles {
  readonly root: TufRoleSigners;
  readonly timestamp: TufRoleSigners;
  readonly snapshot: TufRoleSigners;
  readonly targets: TufRoleSigners;
}

// Per-role metadata expiry (#18, F2). The online timestamp/snapshot metadata
// must expire no later than the offline targets/root horizon, so the standard
// short-timestamp freeze-attack defense no longer forces the root to expire too.
export interface TufRoleExpiries {
  readonly root: string;
  readonly timestamp: string;
  readonly snapshot: string;
  readonly targets: string;
}

// invariant: per-role metadata versions (#382). A release signs every role at its one
// metadataVersion; an online refresh re-signs only timestamp and snapshot at a
// higher version and leaves the offline-signed targets at the version they carry.
export interface TufRoleVersions {
  readonly targets: number;
  readonly snapshot: number;
  readonly timestamp: number;
}

export interface TufPublicationInput {
  readonly schemaVersion: 1;
  readonly candidate: ReleaseCandidate;
  readonly componentBytes: readonly TufPublicationComponentBytes[];
  readonly metadataVersion: number;
  readonly rootVersion: number;
  readonly expires: TufRoleExpiries;
  readonly roles: TufPublicationRoles;
  readonly consistentSnapshot: boolean;
}

// why: exactly the inputs the trusted root is derived from, so a publisher can
// learn the pinned root digest before any release metadata is signed (#387).
export type TufTrustedRootInput = Pick<TufPublicationInput, "rootVersion" | "expires" | "roles" | "consistentSnapshot">;

export interface TufReleasePublication {
  readonly schemaVersion: 1;
  readonly releaseId: string;
  readonly releaseDigest: string;
  readonly candidateDigest: string;
  readonly manifestPath: string;
  readonly consistentSnapshot: boolean;
  readonly trustedRoot: Uint8Array;
  readonly metadata: ReadonlyMap<string, Uint8Array>;
  readonly targets: ReadonlyMap<string, Uint8Array>;
  readonly bundle: HermeticDistributionBundle;
}

// invariant: the online roles an offline-signed publication delegates to (#382).
export interface TufOnlineRoles {
  readonly timestamp: TufRoleSigners;
  readonly snapshot: TufRoleSigners;
}

export interface TufOnlineRoleRefreshInput {
  readonly schemaVersion: 1;
  // invariant: the published, offline-signed metadata, byte for byte. None is re-signed.
  readonly trustedRoot: Uint8Array;
  readonly targets: Uint8Array;
  readonly components: Uint8Array;
  readonly versions: Pick<TufRoleVersions, "snapshot" | "timestamp">;
  readonly expires: Pick<TufRoleExpiries, "snapshot" | "timestamp">;
  readonly roles: TufOnlineRoles;
}

export interface TufPublishedRoleKeys {
  readonly keyids: readonly string[];
  readonly threshold: number;
}

export interface TufOnlineRoleRefresh {
  readonly schemaVersion: 1;
  readonly rootDigest: string;
  readonly consistentSnapshot: boolean;
  readonly versions: TufRoleVersions;
  readonly expires: TufRoleExpiries;
  // why: the keys the verified root declares, so a caller can bind them to its own
  // reviewed anchors: role name to key ids, and key id to its public PEM.
  readonly rootRoles: Readonly<Record<"root" | "timestamp" | "snapshot" | "targets", TufPublishedRoleKeys>>;
  readonly rootKeys: ReadonlyMap<string, string>;
  readonly releaseTargets: Readonly<Record<string, unknown>>;
  // invariant: exactly timestamp.json and the new snapshot; never root, targets, or components.
  readonly metadata: ReadonlyMap<string, Uint8Array>;
}

export interface TufReleasePublicationDirectory {
  readonly directory: string;
  readonly metadataDirectory: string;
  readonly targetsDirectory: string;
}

export class TufPublicationError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TufPublicationError";
    this.code = code;
  }
}

type RecordValue = Readonly<Record<string, unknown>>;

const fail = (code: string, message: string, cause?: unknown): never => {
  throw new TufPublicationError(code, message, cause === undefined ? undefined : { cause });
};

const sha256Hex = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex");
const sha256 = (value: Uint8Array | string): string => `sha256:${sha256Hex(value)}`;
const canonicalBytes = (value: unknown): Buffer => Buffer.from(canonicalize(value), "utf8");

const text = (value: unknown, label: string, pattern: RegExp): string => {
  if (typeof value !== "string" || !pattern.test(value))
    fail("VES_TUF_PUBLICATION_INPUT_INVALID", `${label} is invalid`);
  return value as string;
};

const object = (value: unknown, label: string): RecordValue => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("VES_TUF_PUBLICATION_INPUT_INVALID", `${label} must be an object`);
  return value as RecordValue;
};

const cloneBytes = (value: Uint8Array, label: string): Uint8Array => {
  if (!(value instanceof Uint8Array) || value.byteLength === 0)
    fail("VES_TUF_PUBLICATION_BYTES_INVALID", `${label} must contain non-empty bytes`);
  return Buffer.from(value);
};

const codeUnitCompare = (left: string, right: string): number => {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
};

const safeRelativePath = (value: unknown, label: string): string => {
  const path =
    typeof value === "string"
      ? value
      : fail("VES_TUF_PUBLICATION_PATH_INVALID", `${label} is not a safe relative path`);
  if (
    !SAFE_PATH.test(path) ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("//") ||
    path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  )
    fail("VES_TUF_PUBLICATION_PATH_INVALID", `${label} is not a safe relative path`);
  return path;
};

const assertWithin = (root: string, candidate: string): void => {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  if (normalizedCandidate !== normalizedRoot && !normalizedCandidate.startsWith(`${normalizedRoot}${sep}`))
    fail("VES_TUF_PUBLICATION_PATH_INVALID", "publication path escapes its destination");
};

const sortedEntries = (
  values: ReadonlyMap<string, Uint8Array>,
  label: string
): readonly (readonly [string, Uint8Array])[] =>
  [...values.entries()]
    .map(([path, bytes]) => [safeRelativePath(path, `${label} path`), cloneBytes(bytes, `${label} ${path}`)] as const)
    .sort(([left], [right]) => codeUnitCompare(left, right));

const writePublicationTree = async (
  root: string,
  values: readonly (readonly [string, Uint8Array])[],
  label: string
): Promise<void> => {
  assertWithin(root, root);
  for (const [relativePath, bytes] of values) {
    const target = resolve(root, ...relativePath.split("/"));
    assertWithin(root, target);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    try {
      await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    } catch (error) {
      return fail("VES_TUF_PUBLICATION_WRITE_FAILED", `unable to write ${label} ${relativePath}`, error);
    }
  }
};

const ensureDestinationAbsent = async (root: string): Promise<void> => {
  try {
    await lstat(root);
    fail("VES_TUF_PUBLICATION_DESTINATION_EXISTS", "publication destination already exists");
  } catch (error) {
    if (error instanceof TufPublicationError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      return fail("VES_TUF_PUBLICATION_WRITE_FAILED", "publication destination cannot be inspected", error);
  }
};

const assertMatchingTrustedRoot = (publication: TufReleasePublication): void => {
  const rootBytes = publication.metadata.get("root.json");
  if (rootBytes === undefined || Buffer.compare(Buffer.from(rootBytes), Buffer.from(publication.trustedRoot)) !== 0)
    fail("VES_TUF_PUBLICATION_ROOT_MISMATCH", "trusted root does not match root metadata");
};

const commitPublicationDirectory = async (
  root: string,
  metadata: readonly (readonly [string, Uint8Array])[],
  targets: readonly (readonly [string, Uint8Array])[]
): Promise<TufReleasePublicationDirectory> => {
  const parent = dirname(root);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(parent, ".vestra-tuf-publication-"));
  let published = false;
  try {
    await writePublicationTree(join(staging, "metadata"), metadata, "metadata");
    await writePublicationTree(join(staging, "targets"), targets, "target");
    await rename(staging, root);
    published = true;
    return Object.freeze({
      directory: root,
      metadataDirectory: join(root, "metadata"),
      targetsDirectory: join(root, "targets")
    });
  } catch (error) {
    if (error instanceof TufPublicationError) throw error;
    return fail("VES_TUF_PUBLICATION_WRITE_FAILED", "publication could not be committed", error);
  } finally {
    if (!published) await rm(staging, { recursive: true, force: true });
  }
};

const validateSigner = (signer: TufSigningKey, index: number): void => {
  if (signer === null || typeof signer !== "object")
    fail("VES_TUF_PUBLICATION_SIGNER_INVALID", `signer ${index} is invalid`);
  text(signer.keyId, `signer ${index} keyId`, KEY_ID);
  if (typeof signer.publicKeyPem !== "string" || signer.publicKeyPem.length === 0)
    fail("VES_TUF_PUBLICATION_SIGNER_INVALID", `signer ${index} public key is invalid`);
  if (typeof signer.sign !== "function") fail("VES_TUF_PUBLICATION_SIGNER_INVALID", `signer ${index} is not callable`);
};

const validateSigners = (signers: readonly TufSigningKey[]): void => {
  if (!Array.isArray(signers) || signers.length === 0)
    fail("VES_TUF_PUBLICATION_SIGNER_INVALID", "at least one signer is required");
  signers.forEach((signer, index) => validateSigner(signer, index));
  if (new Set(signers.map((signer) => signer.keyId)).size !== signers.length)
    fail("VES_TUF_PUBLICATION_SIGNER_INVALID", "signer key identities are duplicated");
};

const ROLE_NAMES = ["root", "timestamp", "snapshot", "targets"] as const;
// The expiry ordering the freeze-attack defense requires, soonest first.
const ROLE_EXPIRY_ORDER = ["timestamp", "snapshot", "targets", "root"] as const;

const validateRole = (value: unknown, name: string): void => {
  const record = object(value, `${name} role`);
  const signers = record["signers"] as readonly TufSigningKey[];
  validateSigners(signers);
  const threshold = record["threshold"];
  if (!Number.isSafeInteger(threshold) || (threshold as number) <= 0 || (threshold as number) > signers.length)
    fail("VES_TUF_PUBLICATION_THRESHOLD_INVALID", `${name} signature threshold is invalid`);
};

const futureInstant = (value: unknown, label: string): number => {
  const parsed = Date.parse(text(value, label, INSTANT));
  if (!(parsed > Date.now())) fail("VES_TUF_PUBLICATION_INPUT_INVALID", `${label} must be a future UTC instant`);
  return parsed;
};

const positiveInteger = (value: unknown, label: string): void => {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    fail("VES_TUF_PUBLICATION_INPUT_INVALID", `${label} must be a positive integer`);
};

// Freeze-attack containment (F2): a short online-metadata window must not drag
// the offline root's expiry down with it, so the four role expiries must be
// ordered timestamp <= snapshot <= targets <= root.
const validateRoleExpiries = (value: unknown): void => {
  const expires = object(value, "expires");
  const ordered = ROLE_EXPIRY_ORDER.map((name) => futureInstant(expires[name], `${name} expires`));
  const inOrder = ordered.every((instant, index) => index === 0 || ordered[index - 1]! <= instant);
  if (!inOrder)
    fail(
      "VES_TUF_PUBLICATION_EXPIRY_ORDER_INVALID",
      "role expiries must be ordered timestamp <= snapshot <= targets <= root"
    );
};

const validateRootInputs = (input: TufTrustedRootInput): void => {
  const roles = object(input.roles, "roles");
  for (const name of ROLE_NAMES) validateRole(roles[name], name);
  positiveInteger(input.rootVersion, "rootVersion");
  validateRoleExpiries(input.expires);
  if (typeof input.consistentSnapshot !== "boolean")
    fail("VES_TUF_PUBLICATION_INPUT_INVALID", "consistentSnapshot must be boolean");
};

const validateMetadataInputs = (input: TufPublicationInput): void => {
  if (input.schemaVersion !== 1) fail("VES_TUF_PUBLICATION_INPUT_INVALID", "schemaVersion must be 1");
  validateRootInputs(input);
  positiveInteger(input.metadataVersion, "metadataVersion");
};

// A key id that appears under two roles (root and targets share the offline key
// in the two-key split) must carry the SAME public key, or the root would
// declare one key id with two different public keys.
const unionKeys = (signers: readonly TufSigningKey[]): readonly TufSigningKey[] => {
  const byKeyId = new Map<string, TufSigningKey>();
  for (const signer of signers) {
    const existing = byKeyId.get(signer.keyId);
    if (existing !== undefined && existing.publicKeyPem !== signer.publicKeyPem)
      fail("VES_TUF_PUBLICATION_SIGNER_INVALID", "one key id declares two different public keys across roles");
    if (existing === undefined) byKeyId.set(signer.keyId, signer);
  }
  return [...byKeyId.values()];
};

const validateComponentBytes = (
  bundle: HermeticDistributionBundle,
  values: readonly TufPublicationComponentBytes[]
): ReadonlyMap<string, Uint8Array> => {
  if (!Array.isArray(values) || values.length !== bundle.components.length)
    fail("VES_TUF_PUBLICATION_BYTES_INCOMPLETE", "component bytes must cover the bundle exactly once");
  const byPath = new Map<string, Uint8Array>();
  for (const [index, entry] of values.entries()) {
    const item = object(entry, `component bytes ${index}`);
    const logicalPath = text(item["logicalPath"], `component bytes ${index} logicalPath`, SAFE_PATH);
    const bytes = cloneBytes(item["bytes"] as Uint8Array, `component bytes ${index}`);
    if (byPath.has(logicalPath)) fail("VES_TUF_PUBLICATION_BYTES_DUPLICATE", "component logical path is duplicated");
    byPath.set(logicalPath, bytes);
  }
  for (const component of bundle.components) {
    const bytes =
      byPath.get(component.logicalPath) ??
      fail("VES_TUF_PUBLICATION_BYTES_INCOMPLETE", `component bytes are missing: ${component.logicalPath}`);
    if (bytes.byteLength !== component.sizeBytes || sha256(bytes) !== component.contentDigest)
      fail("VES_TUF_PUBLICATION_BYTES_MISMATCH", `component bytes do not match: ${component.componentId}`);
  }
  return byPath;
};

const role = (signers: readonly TufSigningKey[], threshold: number) => ({
  keyids: signers.map((signer) => signer.keyId),
  threshold
});

const keyMap = (signers: readonly TufSigningKey[]) =>
  Object.fromEntries(
    signers.map((signer) => [
      signer.keyId,
      { keytype: "ed25519", scheme: "ed25519", keyval: { public: signer.publicKeyPem } }
    ])
  );

const signedEnvelope = (signed: Record<string, unknown>, signers: readonly TufSigningKey[]): Buffer => {
  const payload = canonicalBytes(signed);
  const signatures = signers.map((signer, index) => {
    const signature = (() => {
      try {
        return cloneBytes(signer.sign(payload), `signature ${index}`);
      } catch (error) {
        return fail("VES_TUF_PUBLICATION_SIGNING_FAILED", `signer ${index} failed`, error);
      }
    })();
    return { keyid: signer.keyId, sig: Buffer.from(signature).toString("hex") };
  });
  return Buffer.from(JSON.stringify({ signatures, signed }), "utf8");
};

const metadataFile = (bytes: Uint8Array, version: number) => ({
  version,
  length: bytes.byteLength,
  hashes: { sha256: sha256Hex(bytes) }
});

const targetFile = (bytes: Uint8Array, custom: Record<string, unknown>) => ({
  length: bytes.byteLength,
  hashes: { sha256: sha256Hex(bytes) },
  custom
});

const consistentTargetPath = (path: string, bytes: Uint8Array, consistentSnapshot: boolean): string => {
  if (!consistentSnapshot) return path;
  const slash = path.lastIndexOf("/");
  const directory = slash < 0 ? "" : path.slice(0, slash + 1);
  const name = slash < 0 ? path : path.slice(slash + 1);
  return `${directory}${sha256Hex(bytes)}.${name}`;
};

const releaseRoleVersions = (metadataVersion: number): TufRoleVersions =>
  Object.freeze({ targets: metadataVersion, snapshot: metadataVersion, timestamp: metadataVersion });

const consistentMetadataName = (role: string, version: number, consistentSnapshot: boolean): string =>
  consistentSnapshot ? `${version}.${role}.json` : `${role}.json`;

// invariant: the only code that signs snapshot and timestamp metadata, shared by
// a release and an online refresh, so both emit the same shape. The snapshot
// pins the offline-signed targets and components at versions.targets.
const signOnlineRoles = (
  offline: { readonly targets: Uint8Array; readonly components: Uint8Array },
  versions: TufRoleVersions,
  expires: Pick<TufRoleExpiries, "snapshot" | "timestamp">,
  roles: TufOnlineRoles
): { readonly snapshot: Buffer; readonly timestamp: Buffer } => {
  const snapshotSigned: Record<string, unknown> = {
    _type: "snapshot",
    spec_version: "1.0.0",
    version: versions.snapshot,
    expires: expires.snapshot,
    meta: {
      "targets.json": metadataFile(offline.targets, versions.targets),
      "components.json": metadataFile(offline.components, versions.targets)
    }
  };
  const snapshot = signedEnvelope(snapshotSigned, roles.snapshot.signers);
  const timestampSigned: Record<string, unknown> = {
    _type: "timestamp",
    spec_version: "1.0.0",
    version: versions.timestamp,
    expires: expires.timestamp,
    meta: { "snapshot.json": metadataFile(snapshot, versions.snapshot) }
  };
  return { snapshot, timestamp: signedEnvelope(timestampSigned, roles.timestamp.signers) };
};

const manifestPath = (bundle: HermeticDistributionBundle): string =>
  `releases/${bundle.target.platform}-${bundle.target.arch}/release.json`;

const requireCandidateBundle = (candidate: ReleaseCandidate): HermeticDistributionBundle => {
  const verifiedCandidate = (() => {
    try {
      return verifyReleaseCandidate(candidate);
    } catch (error) {
      return fail("VES_TUF_PUBLICATION_CANDIDATE_INVALID", "candidate closure is invalid", error);
    }
  })();
  try {
    return verifyHermeticDistributionBundle(verifiedCandidate.bundle);
  } catch (error) {
    return fail("VES_TUF_PUBLICATION_CANDIDATE_INVALID", "candidate bundle is invalid", error);
  }
};

const signedTrustedRoot = (input: TufTrustedRootInput): Buffer => {
  const { root: rootRole, timestamp: timestampRole, snapshot: snapshotRole, targets: targetsRole } = input.roles;
  const trustedRootSigned: Record<string, unknown> = {
    _type: "root",
    spec_version: "1.0.0",
    version: input.rootVersion,
    expires: input.expires.root,
    // The root declares every role's keys; each role delegates only to its own,
    // so an online timestamp/snapshot key cannot sign root or targets metadata.
    keys: keyMap(
      unionKeys([...rootRole.signers, ...timestampRole.signers, ...snapshotRole.signers, ...targetsRole.signers])
    ),
    roles: {
      root: role(rootRole.signers, rootRole.threshold),
      timestamp: role(timestampRole.signers, timestampRole.threshold),
      snapshot: role(snapshotRole.signers, snapshotRole.threshold),
      targets: role(targetsRole.signers, targetsRole.threshold)
    },
    consistent_snapshot: input.consistentSnapshot
  };
  return signedEnvelope(trustedRootSigned, rootRole.signers);
};

/**
 * Derive the signed trusted root a publication with these inputs would carry,
 * byte for byte, without signing any timestamp, snapshot, or targets metadata.
 */
export function buildTufTrustedRoot(input: TufTrustedRootInput): Uint8Array {
  if (input === null || typeof input !== "object")
    fail("VES_TUF_PUBLICATION_INPUT_INVALID", "trusted root input must be an object");
  validateRootInputs(input);
  return signedTrustedRoot(input);
}

/**
 * Create a signed, consistent-snapshot TUF repository from an already verified
 * candidate. Signers are injected callbacks so private key custody remains
 * outside the repository and outside this module.
 */
export function buildTufReleasePublication(input: TufPublicationInput): TufReleasePublication {
  if (input === null || typeof input !== "object")
    fail("VES_TUF_PUBLICATION_INPUT_INVALID", "publication input must be an object");
  validateMetadataInputs(input);
  const bundle = requireCandidateBundle(input.candidate);
  if (input.candidate.semanticVersion !== bundle.semanticVersion)
    fail("VES_TUF_PUBLICATION_CANDIDATE_INVALID", "candidate semantic version differs from bundle");
  const bytesByPath = validateComponentBytes(bundle, input.componentBytes);
  const path = manifestPath(bundle);
  const manifestBytes = canonicalBytes(bundle);
  const { timestamp: timestampRole, snapshot: snapshotRole, targets: targetsRole } = input.roles;
  const delegatedTargets = Object.fromEntries(
    bundle.components.map((component) => [
      component.logicalPath,
      targetFile(bytesByPath.get(component.logicalPath) as Uint8Array, {
        releaseId: component.releaseId,
        componentId: component.componentId,
        contentDigest: component.contentDigest,
        sizeBytes: component.sizeBytes
      })
    ])
  );
  const delegatedSigned: Record<string, unknown> = {
    _type: "targets",
    spec_version: "1.0.0",
    version: input.metadataVersion,
    expires: input.expires.targets,
    targets: delegatedTargets
  };
  const topTargetsSigned: Record<string, unknown> = {
    _type: "targets",
    spec_version: "1.0.0",
    version: input.metadataVersion,
    expires: input.expires.targets,
    targets: {
      [path]: targetFile(manifestBytes, {
        releaseId: bundle.releaseId,
        releaseDigest: bundle.releaseDigest,
        candidateDigest: input.candidate.candidateDigest,
        platform: bundle.target.platform,
        arch: bundle.target.arch
      })
    },
    delegations: {
      // The components delegation is signed by the offline targets key, so a
      // compromised online key cannot introduce or rewrite a component target.
      keys: keyMap(targetsRole.signers),
      roles: [
        {
          name: "components",
          keyids: targetsRole.signers.map((signer) => signer.keyId),
          threshold: targetsRole.threshold,
          terminating: true,
          // Exact component paths, never wildcards. tuf-js matches delegation
          // patterns segment by segment and requires EQUAL segment counts, so
          // "components/*" can never match the nested paths a real candidate
          // carries (components/<trackedPath> runs three to seven segments),
          // and runtime/* and native/* matched no former glob at all. Literal
          // paths always match themselves, SAFE_PATH admits no minimatch
          // metacharacter, and duplicates are rejected upstream, so deriving
          // the list from the bundle makes unreachable targets impossible by
          // construction.
          paths: bundle.components.map((component) => component.logicalPath).sort(codeUnitCompare)
        }
      ]
    }
  };
  const delegatedBytes = signedEnvelope(delegatedSigned, targetsRole.signers);
  const topTargetsBytes = signedEnvelope(topTargetsSigned, targetsRole.signers);
  const versions = releaseRoleVersions(input.metadataVersion);
  const online = signOnlineRoles({ targets: topTargetsBytes, components: delegatedBytes }, versions, input.expires, {
    timestamp: timestampRole,
    snapshot: snapshotRole
  });
  const rootBytes = signedTrustedRoot(input);
  const metadata = new Map<string, Uint8Array>([
    ["root.json", rootBytes],
    ["timestamp.json", online.timestamp],
    [consistentMetadataName("snapshot", versions.snapshot, input.consistentSnapshot), online.snapshot],
    [consistentMetadataName("targets", versions.targets, input.consistentSnapshot), topTargetsBytes],
    [consistentMetadataName("components", versions.targets, input.consistentSnapshot), delegatedBytes]
  ]);
  const targets = new Map<string, Uint8Array>();
  targets.set(consistentTargetPath(path, manifestBytes, input.consistentSnapshot), manifestBytes);
  for (const component of bundle.components) {
    const bytes = bytesByPath.get(component.logicalPath) as Uint8Array;
    targets.set(consistentTargetPath(component.logicalPath, bytes, input.consistentSnapshot), bytes);
  }
  return Object.freeze({
    schemaVersion: 1,
    releaseId: bundle.releaseId,
    releaseDigest: bundle.releaseDigest,
    candidateDigest: input.candidate.candidateDigest,
    manifestPath: path,
    consistentSnapshot: input.consistentSnapshot,
    trustedRoot: Buffer.from(rootBytes),
    metadata,
    targets,
    bundle
  });
}

interface PublishedEnvelope {
  readonly signatures: readonly { readonly keyid: string; readonly sig: string }[];
  readonly signed: RecordValue;
}

const HEX = /^[a-f0-9]+$/u;

const unverified = (message: string, cause?: unknown): never =>
  fail("VES_TUF_PUBLICATION_REFRESH_UNVERIFIED", message, cause);

const isRecord = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const parseEnvelope = (bytes: Uint8Array, type: string, label: string): PublishedEnvelope => {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) return unverified(`${label} is empty`);
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch (error) {
    return unverified(`${label} is not JSON`, error);
  }
  if (!isRecord(value) || !isRecord(value["signed"]) || !Array.isArray(value["signatures"]))
    return unverified(`${label} is not a signed TUF envelope`);
  const signed = value["signed"];
  if (signed["_type"] !== type) unverified(`${label} is not ${type} metadata`);
  const signatures = (value["signatures"] as readonly unknown[]).map((entry) => {
    if (!isRecord(entry) || typeof entry["keyid"] !== "string" || typeof entry["sig"] !== "string")
      return unverified(`${label} carries a malformed signature`);
    return { keyid: entry["keyid"], sig: entry["sig"] };
  });
  return { signatures, signed };
};

const publishedKeys = (value: unknown, label: string): ReadonlyMap<string, string> => {
  if (!isRecord(value)) return unverified(`${label} keys are not an object`);
  const keys = new Map<string, string>();
  for (const [keyId, entry] of Object.entries(value)) {
    const keyval = isRecord(entry) ? entry["keyval"] : undefined;
    if (
      !KEY_ID.test(keyId) ||
      !isRecord(entry) ||
      entry["keytype"] !== "ed25519" ||
      entry["scheme"] !== "ed25519" ||
      !isRecord(keyval) ||
      typeof keyval["public"] !== "string"
    )
      unverified(`${label} declares a key that is not an ed25519 public key`);
    keys.set(keyId, (keyval as RecordValue)["public"] as string);
  }
  return keys;
};

const publishedRole = (value: unknown, label: string): TufPublishedRoleKeys => {
  if (!isRecord(value) || !Array.isArray(value["keyids"])) return unverified(`${label} is not a role`);
  const keyids = value["keyids"] as readonly unknown[];
  const threshold = value["threshold"];
  if (
    keyids.length === 0 ||
    keyids.some((keyId) => typeof keyId !== "string" || !KEY_ID.test(keyId)) ||
    new Set(keyids).size !== keyids.length ||
    !Number.isSafeInteger(threshold) ||
    (threshold as number) <= 0 ||
    (threshold as number) > keyids.length
  )
    unverified(`${label} declares invalid key ids or threshold`);
  return Object.freeze({ keyids: Object.freeze([...(keyids as string[])]), threshold: threshold as number });
};

const verifyEnvelope = (
  envelope: PublishedEnvelope,
  keys: ReadonlyMap<string, string>,
  role: TufPublishedRoleKeys,
  label: string
): void => {
  const payload = canonicalBytes(envelope.signed);
  const valid = new Set<string>();
  for (const { keyid, sig } of envelope.signatures) {
    const publicKey = keys.get(keyid);
    if (!role.keyids.includes(keyid) || publicKey === undefined || !HEX.test(sig) || valid.has(keyid)) continue;
    try {
      if (verify(null, payload, publicKey, Buffer.from(sig, "hex"))) valid.add(keyid);
    } catch {
      // why: an unusable declared key contributes no signature; the threshold decides.
    }
  }
  if (valid.size < role.threshold) unverified(`${label} does not meet its signature threshold`);
};

const unexpiredInstant = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !INSTANT.test(value)) return unverified(`${label} expiry is invalid`);
  // why: expired offline metadata cannot be rescued online; only the offline key can renew it.
  if (!(Date.parse(value) > Date.now())) unverified(`${label} has expired and needs an offline re-signing`);
  return value;
};

const metadataVersionOf = (envelope: PublishedEnvelope, label: string): number => {
  const version = envelope.signed["version"];
  if (!Number.isSafeInteger(version) || (version as number) <= 0) return unverified(`${label} version is invalid`);
  return version as number;
};

const spkiOf = (publicKey: string): string => {
  try {
    return createPublicKey(publicKey).export({ format: "der", type: "spki" }).toString("hex");
  } catch (error) {
    return fail("VES_TUF_PUBLICATION_SIGNER_INVALID", "a signer public key is unusable", error);
  }
};

// invariant: an online signer must be a key the verified root declares for its
// own role, and must share neither a key id nor key material with any key that
// holds root, targets, or delegated-targets authority. Compromise of the online
// key therefore still cannot swap the release or rewrite the root (#18, F1).
const assertOnlineSigners = (
  roles: TufOnlineRoles,
  rootRoles: TufOnlineRoleRefresh["rootRoles"],
  rootKeys: ReadonlyMap<string, string>,
  offlineKeys: ReadonlyMap<string, string>
): void => {
  const offlineMaterial = new Set([...offlineKeys.values()].map(spkiOf));
  for (const name of ["timestamp", "snapshot"] as const) {
    validateRole(roles[name], name);
    const declared = rootRoles[name];
    if (roles[name].signers.length < declared.threshold)
      fail("VES_TUF_PUBLICATION_THRESHOLD_INVALID", `${name} signers cannot meet the published root's threshold`);
    for (const signer of roles[name].signers) {
      const material = spkiOf(signer.publicKeyPem);
      if (offlineKeys.has(signer.keyId) || offlineMaterial.has(material))
        fail("VES_TUF_PUBLICATION_ROLE_SEPARATION", `a ${name} signer holds root or targets authority`);
      const published = rootKeys.get(signer.keyId);
      if (!declared.keyids.includes(signer.keyId) || published === undefined || spkiOf(published) !== material)
        fail("VES_TUF_PUBLICATION_SIGNER_INVALID", `a ${name} signer is not a key the published root declares for it`);
    }
  }
};

interface VerifiedOfflineMetadata {
  readonly root: PublishedEnvelope;
  readonly targets: PublishedEnvelope;
  readonly rootRoles: TufOnlineRoleRefresh["rootRoles"];
  readonly rootKeys: ReadonlyMap<string, string>;
  readonly offlineKeys: ReadonlyMap<string, string>;
  readonly targetsVersion: number;
  readonly targetsExpires: string;
}

const verifyRoot = (bytes: Uint8Array) => {
  const root = parseEnvelope(bytes, "root", "published root");
  const rootKeys = publishedKeys(root.signed["keys"], "published root");
  const roles = isRecord(root.signed["roles"]) ? root.signed["roles"] : unverified("published root has no roles");
  const rootRoles = Object.freeze(
    Object.fromEntries(ROLE_NAMES.map((name) => [name, publishedRole(roles[name], `published root ${name} role`)]))
  ) as TufOnlineRoleRefresh["rootRoles"];
  verifyEnvelope(root, rootKeys, rootRoles.root, "published root");
  metadataVersionOf(root, "published root");
  if (typeof root.signed["consistent_snapshot"] !== "boolean")
    unverified("published root does not declare consistent_snapshot");
  unexpiredInstant(root.signed["expires"], "published root");
  return { root, rootKeys, rootRoles };
};

const componentsDelegation = (targets: PublishedEnvelope) => {
  const delegations = targets.signed["delegations"];
  const roles = isRecord(delegations) && Array.isArray(delegations["roles"]) ? delegations["roles"] : [];
  if (!isRecord(delegations) || roles.length !== 1 || !isRecord(roles[0]) || roles[0]["name"] !== "components")
    return unverified("published targets does not delegate exactly the components role");
  return {
    keys: publishedKeys(delegations["keys"], "published components delegation"),
    role: publishedRole(roles[0], "published components delegation")
  };
};

// invariant: root, targets, and components are only verified here, never
// re-signed. A refresh that cannot prove all three under the published root
// refuses before any online signature exists.
const verifyOfflineMetadata = (input: TufOnlineRoleRefreshInput): VerifiedOfflineMetadata => {
  const { root, rootKeys, rootRoles } = verifyRoot(input.trustedRoot);
  const targets = parseEnvelope(input.targets, "targets", "published targets");
  verifyEnvelope(targets, rootKeys, rootRoles.targets, "published targets");
  const delegation = componentsDelegation(targets);
  const components = parseEnvelope(input.components, "targets", "published components");
  verifyEnvelope(components, delegation.keys, delegation.role, "published components");
  const targetsVersion = metadataVersionOf(targets, "published targets");
  if (metadataVersionOf(components, "published components") !== targetsVersion)
    unverified("published components and targets carry different versions");
  if (!isRecord(targets.signed["targets"])) unverified("published targets lists no targets");
  const targetsExpires = unexpiredInstant(targets.signed["expires"], "published targets");
  const componentsExpires = unexpiredInstant(components.signed["expires"], "published components");
  const offlineKeys = new Map<string, string>();
  for (const name of ["root", "targets"] as const)
    for (const keyId of rootRoles[name].keyids) {
      const publicKey = rootKeys.get(keyId);
      if (publicKey !== undefined) offlineKeys.set(keyId, publicKey);
    }
  for (const [keyId, publicKey] of delegation.keys)
    if (delegation.role.keyids.includes(keyId)) offlineKeys.set(keyId, publicKey);
  return {
    root,
    targets,
    rootRoles,
    rootKeys,
    offlineKeys,
    targetsVersion,
    targetsExpires: Date.parse(componentsExpires) < Date.parse(targetsExpires) ? componentsExpires : targetsExpires
  };
};

const refreshVersions = (value: unknown, targetsVersion: number): TufRoleVersions => {
  const versions = object(value, "versions");
  for (const name of ["snapshot", "timestamp"] as const) {
    positiveInteger(versions[name], `${name} version`);
    if ((versions[name] as number) <= targetsVersion)
      fail(
        "VES_TUF_PUBLICATION_REFRESH_VERSION_INVALID",
        `${name} version must exceed the published targets version ${targetsVersion}`
      );
  }
  return Object.freeze({
    targets: targetsVersion,
    snapshot: versions["snapshot"] as number,
    timestamp: versions["timestamp"] as number
  });
};

// invariant: re-signs only the online timestamp and snapshot metadata over an
// already published, offline-signed root, targets, and components (#382). The
// offline metadata is verified under the published root and never re-signed;
// the new online metadata is ordered timestamp <= snapshot <= targets <= root
// and verifies under the same root.
export function buildTufOnlineRoleRefresh(input: TufOnlineRoleRefreshInput): TufOnlineRoleRefresh {
  if (input === null || typeof input !== "object")
    fail("VES_TUF_PUBLICATION_INPUT_INVALID", "refresh input must be an object");
  if (input.schemaVersion !== 1) fail("VES_TUF_PUBLICATION_INPUT_INVALID", "schemaVersion must be 1");
  const offline = verifyOfflineMetadata(input);
  const versions = refreshVersions(input.versions, offline.targetsVersion);
  const requested = object(input.expires, "expires");
  const expires: TufRoleExpiries = Object.freeze({
    timestamp: requested["timestamp"] as string,
    snapshot: requested["snapshot"] as string,
    targets: offline.targetsExpires,
    root: offline.root.signed["expires"] as string
  });
  validateRoleExpiries(expires);
  const roles = object(input.roles, "roles") as unknown as TufOnlineRoles;
  assertOnlineSigners(roles, offline.rootRoles, offline.rootKeys, offline.offlineKeys);
  const consistentSnapshot = offline.root.signed["consistent_snapshot"] as boolean;
  const online = signOnlineRoles({ targets: input.targets, components: input.components }, versions, expires, roles);
  // invariant: what is emitted verifies under the very root it was checked against.
  verifyEnvelope(
    parseEnvelope(online.snapshot, "snapshot", "refreshed snapshot"),
    offline.rootKeys,
    offline.rootRoles.snapshot,
    "refreshed snapshot"
  );
  verifyEnvelope(
    parseEnvelope(online.timestamp, "timestamp", "refreshed timestamp"),
    offline.rootKeys,
    offline.rootRoles.timestamp,
    "refreshed timestamp"
  );
  return Object.freeze({
    schemaVersion: 1,
    rootDigest: sha256(input.trustedRoot),
    consistentSnapshot,
    versions,
    expires,
    rootRoles: offline.rootRoles,
    rootKeys: offline.rootKeys,
    releaseTargets: offline.targets.signed["targets"] as RecordValue,
    metadata: new Map<string, Uint8Array>([
      ["timestamp.json", online.timestamp],
      [consistentMetadataName("snapshot", versions.snapshot, consistentSnapshot), online.snapshot]
    ])
  });
}

/**
 * Persist a complete TUF publication as a new repository directory.
 *
 * The destination must not exist. Files are written below a sibling staging
 * directory and the directory is renamed into place only after every metadata
 * and target byte has been written. Private signing material never crosses
 * this boundary; signing is completed by buildTufReleasePublication before
 * this function is called.
 */
export async function writeTufReleasePublication(
  publication: TufReleasePublication,
  directory: string
): Promise<TufReleasePublicationDirectory> {
  if (publication === null || typeof publication !== "object")
    fail("VES_TUF_PUBLICATION_INPUT_INVALID", "publication must be an object");
  if (typeof directory !== "string" || directory.length === 0)
    fail("VES_TUF_PUBLICATION_INPUT_INVALID", "publication directory is invalid");

  const root = resolve(directory);
  await ensureDestinationAbsent(root);
  assertMatchingTrustedRoot(publication);
  return commitPublicationDirectory(
    root,
    sortedEntries(publication.metadata, "metadata"),
    sortedEntries(publication.targets, "target")
  );
}
