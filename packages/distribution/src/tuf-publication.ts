import { createHash } from "node:crypto";
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

export interface TufPublicationInput {
  readonly schemaVersion: 1;
  readonly candidate: ReleaseCandidate;
  readonly componentBytes: readonly TufPublicationComponentBytes[];
  readonly metadataVersion: number;
  readonly expires: string;
  readonly threshold: number;
  readonly signers: readonly TufSigningKey[];
  readonly consistentSnapshot: boolean;
}

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

const validateMetadataInputs = (input: TufPublicationInput): void => {
  if (input.schemaVersion !== 1) fail("VES_TUF_PUBLICATION_INPUT_INVALID", "schemaVersion must be 1");
  validateSigners(input.signers);
  if (!Number.isSafeInteger(input.metadataVersion) || input.metadataVersion <= 0)
    fail("VES_TUF_PUBLICATION_INPUT_INVALID", "metadataVersion must be a positive integer");
  if (!INSTANT.test(input.expires) || Date.parse(input.expires) <= Date.now())
    fail("VES_TUF_PUBLICATION_INPUT_INVALID", "expires must be a future UTC instant");
  if (!Number.isSafeInteger(input.threshold) || input.threshold <= 0 || input.threshold > input.signers.length)
    fail("VES_TUF_PUBLICATION_THRESHOLD_INVALID", "signature threshold is invalid");
  if (typeof input.consistentSnapshot !== "boolean")
    fail("VES_TUF_PUBLICATION_INPUT_INVALID", "consistentSnapshot must be boolean");
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
  const names = input.signers;
  const trustedRootSigned: Record<string, unknown> = {
    _type: "root",
    spec_version: "1.0.0",
    version: 1,
    expires: input.expires,
    keys: keyMap(names),
    roles: {
      root: role(names, input.threshold),
      timestamp: role(names, input.threshold),
      snapshot: role(names, input.threshold),
      targets: role(names, input.threshold)
    },
    consistent_snapshot: input.consistentSnapshot
  };
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
    expires: input.expires,
    targets: delegatedTargets
  };
  const topTargetsSigned: Record<string, unknown> = {
    _type: "targets",
    spec_version: "1.0.0",
    version: input.metadataVersion,
    expires: input.expires,
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
      keys: keyMap(names),
      roles: [
        {
          name: "components",
          keyids: names.map((signer) => signer.keyId),
          threshold: input.threshold,
          terminating: true,
          paths: ["components/*", "bin/*", "licenses/*", "evidence/*"]
        }
      ]
    }
  };
  const delegatedBytes = signedEnvelope(delegatedSigned, names);
  const topTargetsBytes = signedEnvelope(topTargetsSigned, names);
  const snapshotSigned: Record<string, unknown> = {
    _type: "snapshot",
    spec_version: "1.0.0",
    version: input.metadataVersion,
    expires: input.expires,
    meta: {
      "targets.json": metadataFile(topTargetsBytes, input.metadataVersion),
      "components.json": metadataFile(delegatedBytes, input.metadataVersion)
    }
  };
  const snapshotBytes = signedEnvelope(snapshotSigned, names);
  const timestampSigned: Record<string, unknown> = {
    _type: "timestamp",
    spec_version: "1.0.0",
    version: input.metadataVersion,
    expires: input.expires,
    meta: { "snapshot.json": metadataFile(snapshotBytes, input.metadataVersion) }
  };
  const timestampBytes = signedEnvelope(timestampSigned, names);
  const rootBytes = signedEnvelope(trustedRootSigned, names);
  const metadata = new Map<string, Uint8Array>([
    ["root.json", rootBytes],
    ["timestamp.json", timestampBytes],
    [input.consistentSnapshot ? `${input.metadataVersion}.snapshot.json` : "snapshot.json", snapshotBytes],
    [input.consistentSnapshot ? `${input.metadataVersion}.targets.json` : "targets.json", topTargetsBytes],
    [input.consistentSnapshot ? `${input.metadataVersion}.components.json` : "components.json", delegatedBytes]
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
