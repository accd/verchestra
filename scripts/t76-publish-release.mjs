// Turns a verified five-target T76 candidate closure into signed, resolvable
// TUF publications plus the reviewed pinned inputs the publishable `verchestra`
// npm package is built from (#17, #36).
//
// The candidate build workflow already seals, per supported target, a hermetic
// `bundle.json`, its `component-manifest.json`, a deterministic
// `build-info.json`, the exact `payload/` bytes, and a `target-build-evidence`
// record; `t76-target-index.json` reconciles all five. This script consumes
// exactly those artifacts, rebuilds a `ReleaseCandidate` per target, signs the
// TUF metadata with the protected release key, and writes one publication tree
// per target plus one shared `release-inputs/` directory whose pinned source
// map serves every target from the operator-supplied base URL.
//
// Authority boundaries this script does not cross:
//
//   * The private key is read only from the process environment, only under
//     `VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64`, and never from a file path or
//     a command-line argument. It is a different key with different authority
//     from the T75 evidence key and the two are never interchangeable.
//   * No decoded key byte, no base64 character of it, and no OpenSSL cause
//     chain derived from it is ever written to stdout, stderr, an emitted file,
//     or an error message. Key failures deliberately carry no `cause`.
//   * Nothing here publishes or uploads. It writes a directory and a manifest
//     naming exactly what a human must copy, preserving every relative key, to
//     the object-storage prefix the base URL serves. Uploading the tree and
//     running `npm publish` stay human steps.
//
// Fail-closed contract: a missing or malformed key, an invalid base URL, a
// closure whose targets disagree on release identity, a target count other
// than five, a rollback index that does not seal a distinct prior release for
// every target, a trust root that differs across targets, or any digest that
// contradicts the sealed bytes stops the run before a single publication byte
// is written.

import { createHash, createPrivateKey, createPublicKey, sign as signBytes } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

import { canonicalize } from "@tufjs/canonical-json";

import { canonicalizeJsonV2 } from "../packages/domain/src/index.ts";
import {
  buildReleaseCandidate,
  buildTufReleasePublication,
  verifyHermeticDistributionBundle,
  writeTufReleasePublication
} from "../packages/distribution/src/index.ts";

/** The one environment name that may carry release signing authority. */
export const KEY_ENVIRONMENT_NAME = "VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64";

/** The exact fleet a candidate closure must cover, in code-unit order. */
export const SUPPORTED_TARGET_KEYS = Object.freeze([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64"
]);

/** What a human must do with the emitted directory. Nothing here does it. */
export const MANUAL_UPLOAD_STEPS = Object.freeze([
  "Download this run's metadata and target artifacts and keep the publication/ tree intact.",
  "Upload the contents of publication/ to the object-storage prefix the base URL serves, preserving every relative key (example: rclone copy publication/ remote:bucket/prefix/ --checksum).",
  "Verify each uploaded object's sha256 against targets[].assets[].contentDigest before serving anything.",
  "Confirm the endpoint serves timestamp.json uncached, hash-named files with long-lived caching, no redirects, no content-encoding on metadata, and exact 206 byte ranges on targets.",
  "Run the verification launcher package (node bin/vestra.mjs --version) against the live endpoint before publishing anything.",
  "Build the npm package with build:vestra-launcher --release-inputs release-inputs and run npm publish by hand; no workflow publishes."
]);

const VIEW_MODES = Object.freeze(["air-gapped", "mirror", "offline", "online"]);
const TARGET_OUTPUT_DIRECTORY = "t76-target-output";
const EVIDENCE_FILE = "target-build-evidence.json";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
const BASE_URL_MAX_LENGTH = 512;
const INDEX_KEYS = Object.freeze(["schemaVersion", "revision", "targets", "digest"]);
const TARGET_KEYS = Object.freeze(["platform", "arch", "nodeVersion"]);
const EVIDENCE_KEYS = Object.freeze([
  "schemaVersion",
  "revision",
  "releaseId",
  "semanticVersion",
  "target",
  "releaseDigest",
  "componentCount",
  "gateEvidenceDigest",
  "buildInfoDigest"
]);
const BUILD_INFO_KEYS = Object.freeze([
  "schemaVersion",
  "deterministic",
  "revision",
  "releaseId",
  "semanticVersion",
  "target",
  "evidence"
]);
const COMPONENT_KEYS = Object.freeze(["componentId", "kind", "logicalPath", "contentDigest", "sizeBytes"]);
const EVIDENCE_ENTRY_KEYS = Object.freeze(["kind", "logicalPath", "contentDigest", "sizeBytes"]);

export class T76PublishError extends Error {
  code;

  constructor(code, message, options) {
    super(message, options);
    this.name = "T76PublishError";
    this.code = code;
  }
}

const fail = (code, message, cause) => {
  throw new T76PublishError(code, message, cause === undefined ? undefined : { cause });
};

const compareCodeUnits = (left, right) => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const record = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("VES_T76_PUBLISH_INPUT_INVALID", `${label} must be an object`);
  return value;
};

const exactKeys = (value, keys, label) => {
  const actual = Object.keys(value).sort(compareCodeUnits);
  const expected = [...keys].sort(compareCodeUnits);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    fail("VES_T76_PUBLISH_INPUT_INVALID", `${label} has missing or unknown fields`);
  return value;
};

const text = (value, label, pattern) => {
  if (typeof value !== "string" || !pattern.test(value)) fail("VES_T76_PUBLISH_INPUT_INVALID", `${label} is invalid`);
  return value;
};

const absolutePath = (value, label) => {
  if (typeof value !== "string" || value.length === 0) fail("VES_T76_PUBLISH_INPUT_INVALID", `${label} is required`);
  return resolve(value);
};

// ---------------------------------------------------------------------------
// Signing authority
// ---------------------------------------------------------------------------

// A key failure must never quote the value it rejected, and must never carry an
// OpenSSL `cause` that could echo decoded material into a log. Both rules are
// enforced here rather than at every call site.
const decodeProtectedPkcs8 = (environment) => {
  const encoded = record(environment ?? {}, "protected environment")[KEY_ENVIRONMENT_NAME];
  if (typeof encoded !== "string" || encoded.length === 0)
    fail("VES_T76_PUBLISH_SIGNING_KEY_MISSING", `${KEY_ENVIRONMENT_NAME} is not configured`);
  if (!BASE64.test(encoded) || encoded.length % 4 !== 0)
    fail("VES_T76_PUBLISH_SIGNING_KEY_INVALID", "the release signing key is not base64 PKCS#8 material");
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.byteLength === 0)
    fail("VES_T76_PUBLISH_SIGNING_KEY_INVALID", "the release signing key decodes to no PKCS#8 material");
  return decoded;
};

const privateKeyFrom = (der) => {
  try {
    return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  } catch {
    return fail("VES_T76_PUBLISH_SIGNING_KEY_INVALID", "the release signing key is not a PKCS#8 private key");
  }
};

/**
 * Derives the TUF signer from the protected environment. The returned object
 * exposes a public key, a public key identity, and a signing callback; the
 * private key stays inside this closure and is never serialized.
 */
export function releaseSignerFromEnvironment(environment) {
  const privateKey = privateKeyFrom(decodeProtectedPkcs8(environment));
  if (privateKey.asymmetricKeyType !== "ed25519")
    fail("VES_T76_PUBLISH_SIGNING_KEY_INVALID", "the release signing key is not an Ed25519 key");
  const publicKey = createPublicKey(privateKey);
  return Object.freeze({
    keyId: createHash("sha256")
      .update(publicKey.export({ format: "der", type: "spki" }))
      .digest("hex"),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    sign: (payload) => signBytes(null, payload, privateKey)
  });
}

// ---------------------------------------------------------------------------
// Input reading
// ---------------------------------------------------------------------------

const parseCanonical = (bytes, label) => {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    return fail("VES_T76_PUBLISH_INPUT_INVALID", `${label} is not JSON`, error);
  }
  if (canonicalizeJsonV2(value) !== bytes.toString("utf8").trim())
    fail("VES_T76_PUBLISH_INPUT_INVALID", `${label} is not the canonical JSON the build sealed`);
  return value;
};

const readCanonicalJson = async (path, label) => {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    return fail("VES_T76_PUBLISH_INPUT_MISSING", `${label} cannot be read`, error);
  }
  return parseCanonical(bytes, label);
};

const readCanonicalJsonIfPresent = async (path, label) => {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    return undefined;
  }
  return parseCanonical(bytes, label);
};

const writeExclusive = async (path, bytes, label) => {
  try {
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    fail("VES_T76_PUBLISH_OUTPUT_EXISTS", `unable to write ${label}`, error);
  }
};

const assertOutputAbsent = async (path) => {
  try {
    await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    fail("VES_T76_PUBLISH_INPUT_INVALID", "the publication output cannot be inspected", error);
    return;
  }
  fail("VES_T76_PUBLISH_OUTPUT_EXISTS", "the publication output already exists");
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

// The base URL becomes the pinned source of release authority inside the
// published tarball, so it is held to the launcher's own bar before a single
// output byte exists: HTTPS only, no credential, no query, no fragment, no
// `${...}` substitution marker, a directory-style path, and a bounded length.
const parseBaseUrl = (value) => {
  if (typeof value !== "string" || value.length === 0 || value.length > BASE_URL_MAX_LENGTH || value.includes("${"))
    fail("VES_T76_PUBLISH_BASE_URL_INVALID", "baseUrl must be a fixed location of at most 512 characters");
  try {
    return new URL(value);
  } catch {
    return fail("VES_T76_PUBLISH_BASE_URL_INVALID", "baseUrl is not a URL");
  }
};

const isPinnedHttpsBase = (url) =>
  url.protocol === "https:" &&
  url.username === "" &&
  url.password === "" &&
  url.search === "" &&
  url.hash === "" &&
  url.pathname.endsWith("/");

const validateBaseUrl = (value) => {
  const url = parseBaseUrl(value);
  if (!isPinnedHttpsBase(url))
    fail("VES_T76_PUBLISH_BASE_URL_INVALID", "baseUrl must be a credential-free https base ending in a slash");
  return url.href;
};

const validateMetadataVersion = (value) => {
  const version = value ?? 1;
  if (!Number.isSafeInteger(version) || version <= 0)
    fail("VES_T76_PUBLISH_INPUT_INVALID", "metadataVersion must be a positive integer");
  return version;
};

const validateOptions = (value) => {
  const input = record(value, "publication options");
  return Object.freeze({
    indexPath: absolutePath(input.indexPath, "indexPath"),
    targetsDirectory: absolutePath(input.targetsDirectory, "targetsDirectory"),
    outputDirectory: absolutePath(input.outputDirectory, "outputDirectory"),
    baseUrl: validateBaseUrl(input.baseUrl),
    revision: text(input.revision, "revision", REVISION),
    expires: text(input.expires, "expires", INSTANT),
    metadataVersion: validateMetadataVersion(input.metadataVersion),
    rollbackIndexPath: absolutePath(input.rollbackIndexPath, "rollbackIndexPath"),
    protectedEnvironment: record(input.protectedEnvironment ?? {}, "protectedEnvironment")
  });
};

// ---------------------------------------------------------------------------
// Closure reconciliation
// ---------------------------------------------------------------------------

const targetKeyOf = (value) => {
  const target = exactKeys(record(value, "target"), TARGET_KEYS, "target");
  return `${target.platform}-${target.arch}`;
};

const validateIndexShape = (value, label) => {
  const index = exactKeys(record(value, label), INDEX_KEYS, label);
  if (index.schemaVersion !== 1) fail("VES_T76_PUBLISH_INPUT_INVALID", `the ${label} schemaVersion must be 1`);
  if (!Array.isArray(index.targets)) fail("VES_T76_PUBLISH_INPUT_INVALID", `the ${label} targets are invalid`);
  text(index.revision, `${label} revision`, REVISION);
  if (sha256(canonicalizeJsonV2(index.targets)) !== index.digest)
    fail("VES_T76_PUBLISH_DIGEST_MISMATCH", `the ${label} digest does not cover its own targets`);
  return index;
};

const validateIndex = (value, revision) => {
  const index = validateIndexShape(value, "target index");
  if (index.revision !== revision)
    fail("VES_T76_PUBLISH_CLOSURE_INCONSISTENT", "the target index does not bind the requested revision");
  return index;
};

const validateEvidenceRecord = (value, label) => {
  const item = exactKeys(record(value, label), EVIDENCE_KEYS, label);
  text(item.revision, `${label} revision`, REVISION);
  text(item.releaseDigest, `${label} releaseDigest`, DIGEST);
  text(item.buildInfoDigest, `${label} buildInfoDigest`, DIGEST);
  if (!Number.isSafeInteger(item.componentCount) || item.componentCount <= 0)
    fail("VES_T76_PUBLISH_INPUT_INVALID", `${label} componentCount is invalid`);
  return item;
};

const validateClosureCoverage = (entries) => {
  const keys = entries.map((entry) => targetKeyOf(entry.target));
  if (keys.length !== SUPPORTED_TARGET_KEYS.length || new Set(keys).size !== keys.length)
    fail("VES_T76_PUBLISH_CLOSURE_INCOMPLETE", "the candidate closure must carry each supported target exactly once");
  if (SUPPORTED_TARGET_KEYS.some((key) => !keys.includes(key)))
    fail("VES_T76_PUBLISH_CLOSURE_INCOMPLETE", "the candidate closure does not cover every supported target");
  return keys;
};

const validateClosureIdentity = (entries, revision) => {
  const identities = new Set(
    entries.map((entry) => canonicalizeJsonV2([entry.releaseId, entry.semanticVersion, entry.revision]))
  );
  if (identities.size !== 1)
    fail("VES_T76_PUBLISH_CLOSURE_INCONSISTENT", "the candidate targets disagree on release identity");
  const first = entries[0];
  if (first.revision !== revision)
    fail("VES_T76_PUBLISH_CLOSURE_INCONSISTENT", "the candidate targets do not bind the requested revision");
  return Object.freeze({ releaseId: first.releaseId, semanticVersion: first.semanticVersion });
};

// ---------------------------------------------------------------------------
// Rollback authority
// ---------------------------------------------------------------------------

// The rollback target is never a bare digest pair passed on the command line:
// it is a complete prior `t76-target-index.json`, held to the same canonical
// shape and self-digest bar as the index being published, so the per-target
// previous release digests and the verification digest all come from one
// sealed, reconciled artifact.
const rollbackProofsFrom = (index) => {
  const proofs = new Map();
  for (const [position, value] of index.targets.entries()) {
    const entry = validateEvidenceRecord(value, `rollback index entry ${position}`);
    const key = targetKeyOf(entry.target);
    if (proofs.has(key)) fail("VES_T76_PUBLISH_INPUT_INVALID", `the rollback index seals target ${key} more than once`);
    proofs.set(
      key,
      Object.freeze({ previousReleaseDigest: entry.releaseDigest, verified: true, verificationDigest: index.digest })
    );
  }
  return proofs;
};

const validateRollbackIndex = (value, revision) => {
  const index = validateIndexShape(value, "rollback index");
  if (index.revision === revision)
    fail("VES_T76_PUBLISH_INPUT_INVALID", "the rollback index must seal a prior revision, not the published one");
  const proofs = rollbackProofsFrom(index);
  for (const key of SUPPORTED_TARGET_KEYS) {
    if (!proofs.has(key))
      fail("VES_T76_PUBLISH_ROLLBACK_INCOMPLETE", `the rollback index seals no prior release for target ${key}`);
  }
  return proofs;
};

const readTargetArtifacts = async (root) => {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    return fail("VES_T76_PUBLISH_INPUT_MISSING", "the target artifact directory cannot be read", error);
  }
  const found = new Map();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const evidence = await readCanonicalJsonIfPresent(join(root, entry.name, EVIDENCE_FILE), EVIDENCE_FILE);
    if (evidence === undefined) continue;
    const key = targetKeyOf(validateEvidenceRecord(evidence, EVIDENCE_FILE).target);
    if (found.has(key)) fail("VES_T76_PUBLISH_CLOSURE_INCONSISTENT", `target ${key} is present more than once`);
    found.set(key, Object.freeze({ evidence, buildDirectory: join(root, entry.name, TARGET_OUTPUT_DIRECTORY) }));
  }
  return found;
};

const bindTargets = (entries, discovered) => {
  const bound = entries.map((entry) => {
    const key = targetKeyOf(entry.target);
    const located = discovered.get(key);
    if (located === undefined) fail("VES_T76_PUBLISH_CLOSURE_INCOMPLETE", `target ${key} has no sealed build artifact`);
    if (canonicalizeJsonV2(located.evidence) !== canonicalizeJsonV2(entry))
      fail("VES_T76_PUBLISH_CLOSURE_INCONSISTENT", `target ${key} artifact contradicts the reconciled index`);
    return { key, evidence: entry, buildDirectory: located.buildDirectory };
  });
  if (discovered.size !== bound.length)
    fail("VES_T76_PUBLISH_CLOSURE_INCOMPLETE", "the target artifacts do not match the reconciled closure");
  return bound.sort((left, right) => compareCodeUnits(left.key, right.key));
};

// ---------------------------------------------------------------------------
// Per-target verification
// ---------------------------------------------------------------------------

const loadBundle = async (buildDirectory, evidence) => {
  const bundle = verifyHermeticDistributionBundle(
    await readCanonicalJson(join(buildDirectory, "bundle.json"), "bundle.json")
  );
  if (bundle.releaseDigest !== evidence.releaseDigest)
    fail("VES_T76_PUBLISH_DIGEST_MISMATCH", "bundle.json does not match its sealed release digest");
  if (bundle.components.length !== evidence.componentCount)
    fail("VES_T76_PUBLISH_DIGEST_MISMATCH", "bundle.json does not match its sealed component count");
  if (bundle.releaseId !== evidence.releaseId || bundle.semanticVersion !== evidence.semanticVersion)
    fail("VES_T76_PUBLISH_CLOSURE_INCONSISTENT", "bundle.json does not match its sealed release identity");
  return bundle;
};

const loadBuildInfo = async (buildDirectory, evidence) => {
  const info = exactKeys(
    record(await readCanonicalJson(join(buildDirectory, "build-info.json"), "build-info.json"), "build-info.json"),
    BUILD_INFO_KEYS,
    "build-info.json"
  );
  if (info.schemaVersion !== 1 || info.deterministic !== true)
    fail("VES_T76_PUBLISH_INPUT_INVALID", "build-info.json is not a deterministic schema-v1 record");
  if (sha256(canonicalizeJsonV2(info)) !== evidence.buildInfoDigest)
    fail("VES_T76_PUBLISH_DIGEST_MISMATCH", "build-info.json does not match its sealed digest");
  if (info.releaseId !== evidence.releaseId || info.revision !== evidence.revision)
    fail("VES_T76_PUBLISH_CLOSURE_INCONSISTENT", "build-info.json does not match its sealed release identity");
  return info;
};

const projectComponent = ({ componentId, kind, logicalPath, contentDigest, sizeBytes }) => ({
  componentId,
  kind,
  logicalPath,
  contentDigest,
  sizeBytes
});

const assertComponentManifest = async (buildDirectory, bundle) => {
  const manifest = exactKeys(
    record(
      await readCanonicalJson(join(buildDirectory, "component-manifest.json"), "component-manifest.json"),
      "component-manifest.json"
    ),
    ["schemaVersion", "components"],
    "component-manifest.json"
  );
  if (!Array.isArray(manifest.components) || manifest.components.length !== bundle.components.length)
    fail("VES_T76_PUBLISH_DIGEST_MISMATCH", "component-manifest.json does not cover the bundle closure exactly once");
  const expected = new Map(
    bundle.components.map((component) => [component.componentId, canonicalizeJsonV2(projectComponent(component))])
  );
  for (const entry of manifest.components) {
    const item = exactKeys(record(entry, "component-manifest entry"), COMPONENT_KEYS, "component-manifest entry");
    if (expected.get(item.componentId) !== canonicalizeJsonV2(item))
      fail("VES_T76_PUBLISH_DIGEST_MISMATCH", `component ${item.componentId} contradicts the sealed bundle closure`);
  }
};

const readComponentBytes = async (buildDirectory, bundle) => {
  const payloadRoot = join(buildDirectory, "payload");
  const componentBytes = [];
  for (const component of bundle.components) {
    let bytes;
    try {
      bytes = await readFile(join(payloadRoot, ...component.logicalPath.split("/")));
    } catch (error) {
      return fail("VES_T76_PUBLISH_INPUT_MISSING", `payload for ${component.componentId} is missing`, error);
    }
    if (bytes.byteLength !== component.sizeBytes || sha256(bytes) !== component.contentDigest)
      fail("VES_T76_PUBLISH_DIGEST_MISMATCH", `payload for ${component.componentId} contradicts its component digest`);
    componentBytes.push({ logicalPath: component.logicalPath, bytes });
  }
  return componentBytes;
};

// ---------------------------------------------------------------------------
// Candidate and publication
// ---------------------------------------------------------------------------

// The release manifest a TUF client fetches is exactly these bytes, so the
// candidate's per-view metadata digest is derived from them rather than from a
// synthetic value. `assertPublicationBinding` proves the derivation afterwards.
const releaseManifestBytes = (bundle) => Buffer.from(canonicalize(bundle), "utf8");

const viewsFor = (bundle, manifestBytes) => {
  const metadataDigest = sha256(manifestBytes);
  const targetDigest = sha256(
    canonicalizeJsonV2(
      bundle.components.map(({ logicalPath, contentDigest, sizeBytes }) => ({ logicalPath, contentDigest, sizeBytes }))
    )
  );
  return VIEW_MODES.map((mode) => ({
    mode,
    sourceId: `source:${mode}:r2`,
    releaseDigest: bundle.releaseDigest,
    metadataDigest,
    targetDigest
  }));
};

const candidateEvidence = (buildInfo) => {
  if (!Array.isArray(buildInfo.evidence)) fail("VES_T76_PUBLISH_INPUT_INVALID", "build-info evidence is invalid");
  return buildInfo.evidence.map((entry, index) => {
    const item = exactKeys(record(entry, `build-info evidence ${index}`), EVIDENCE_ENTRY_KEYS, `evidence ${index}`);
    return {
      kind: item.kind,
      digest: text(item.contentDigest, `build-info evidence ${index} digest`, DIGEST),
      sizeBytes: item.sizeBytes
    };
  });
};

const candidateFor = (options, bundle, buildInfo, manifestBytes, rollback) => {
  try {
    return buildReleaseCandidate({
      schemaVersion: 1,
      candidateId: `candidate:verchestra:${options.revision.slice(0, 12)}:${bundle.target.platform}-${bundle.target.arch}`,
      revision: options.revision,
      semanticVersion: bundle.semanticVersion,
      bundle,
      views: viewsFor(bundle, manifestBytes),
      evidence: candidateEvidence(buildInfo),
      rollback
    });
  } catch (error) {
    if (error instanceof T76PublishError) throw error;
    // Only sealed build bytes and the rollback proof flow into the candidate,
    // never key material, so the rejected cause is safe to carry.
    return fail("VES_T76_PUBLISH_CANDIDATE_INVALID", "the release candidate was rejected", error);
  }
};

const publicationFor = (options, signer, candidate, componentBytes) =>
  buildTufReleasePublication({
    schemaVersion: 1,
    candidate,
    componentBytes,
    metadataVersion: options.metadataVersion,
    expires: options.expires,
    threshold: 1,
    signers: [signer],
    consistentSnapshot: true
  });

const assertPublicationBinding = (publication, bundle, metadataDigest) => {
  if (publication.releaseDigest !== bundle.releaseDigest)
    fail("VES_T76_PUBLISH_DIGEST_MISMATCH", "the publication does not bind the candidate release digest");
  const published = new Set([...publication.targets.values()].map((bytes) => sha256(bytes)));
  if (!published.has(metadataDigest))
    fail("VES_T76_PUBLISH_DIGEST_MISMATCH", "the published release manifest does not match its candidate view digest");
};

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

// The per-target URL pairs mirror the emitted publication/<targetKey>/ tree
// byte for byte: uploading the contents of publication/ to the prefix the base
// URL serves, preserving every relative key, is the entire upload contract.
const urlsFor = (baseUrl, key) =>
  Object.freeze({ metadataBaseUrl: `${baseUrl}${key}/metadata/`, targetBaseUrl: `${baseUrl}${key}/targets/` });

const releaseSourceFor = (options, identity, rootDigest) => ({
  schemaVersion: 2,
  sourceId: "source:online:r2",
  releaseId: identity.releaseId,
  semanticVersion: identity.semanticVersion,
  rootDigest,
  targets: Object.fromEntries(SUPPORTED_TARGET_KEYS.map((key) => [key, urlsFor(options.baseUrl, key)]))
});

// One release-inputs/ directory serves the whole fleet: the launcher's
// schemaVersion-2 pinned source maps every supported target key to its own
// URL pair under the one shared trust root.
const writeReleaseInputs = async (options, identity, trustedRoot) => {
  const directory = join(options.outputDirectory, "release-inputs");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const rootBytes = Buffer.from(trustedRoot);
  const rootDigest = sha256(rootBytes);
  await writeExclusive(join(directory, "root.json"), rootBytes, "release-inputs/root.json");
  const source = releaseSourceFor(options, identity, rootDigest);
  await writeExclusive(
    join(directory, "release-source.json"),
    Buffer.from(`${canonicalizeJsonV2(source)}\n`, "utf8"),
    "release-inputs/release-source.json"
  );
  return rootDigest;
};

const assetsFrom = (values, area, key) =>
  [...values.entries()].map(([name, bytes]) => ({
    area,
    assetName: name,
    path: `publication/${key}/${area}/${name}`,
    remoteKey: `${key}/${area}/${name}`,
    contentDigest: sha256(bytes),
    sizeBytes: bytes.byteLength
  }));

// The candidate requires exactly one view per source mode, all naming the same
// release digest, and seals them into `candidateDigest`. Sealed is not the same
// as auditable: without the views in the emitted manifest, a reviewer holding
// only the artifacts cannot check that four-view property, and has to trust the
// digest. The manifest therefore carries the normalized views the candidate
// sealed, so the claim can be read from what the operator actually uploads.
const targetManifestEntry = (options, target, bundle, candidate, publication) => {
  const urls = urlsFor(options.baseUrl, target.key);
  const assets = [
    ...assetsFrom(publication.metadata, "metadata", target.key),
    ...assetsFrom(publication.targets, "targets", target.key)
  ].sort((left, right) => compareCodeUnits(left.path, right.path));
  return {
    targetKey: target.key,
    target: bundle.target,
    releaseId: bundle.releaseId,
    releaseDigest: bundle.releaseDigest,
    candidateDigest: candidate.candidateDigest,
    views: candidate.views.map((view) => ({ ...view })),
    manifestPath: publication.manifestPath,
    metadataBaseUrl: urls.metadataBaseUrl,
    targetBaseUrl: urls.targetBaseUrl,
    assetCount: assets.length,
    assets
  };
};

const publishOneTarget = async (options, signer, target, rollbackProofs) => {
  const bundle = await loadBundle(target.buildDirectory, target.evidence);
  const buildInfo = await loadBuildInfo(target.buildDirectory, target.evidence);
  await assertComponentManifest(target.buildDirectory, bundle);
  const componentBytes = await readComponentBytes(target.buildDirectory, bundle);
  const manifestBytes = releaseManifestBytes(bundle);
  const candidate = candidateFor(options, bundle, buildInfo, manifestBytes, rollbackProofs.get(target.key));
  const publication = publicationFor(options, signer, candidate, componentBytes);
  assertPublicationBinding(publication, bundle, sha256(manifestBytes));
  await writeTufReleasePublication(publication, join(options.outputDirectory, "publication", target.key));
  return Object.freeze({
    entry: targetManifestEntry(options, target, bundle, candidate, publication),
    trustedRoot: publication.trustedRoot
  });
};

const assertSingleTrustRoot = (published) => {
  if (new Set(published.map((item) => sha256(Buffer.from(item.trustedRoot)))).size !== 1)
    fail("VES_T76_PUBLISH_ROOT_INCONSISTENT", "the published targets do not share exactly one trust root");
};

const manifestFor = (options, signer, identity, published, rootDigest) => ({
  schemaVersion: 1,
  revision: options.revision,
  releaseId: identity.releaseId,
  semanticVersion: identity.semanticVersion,
  baseUrl: options.baseUrl,
  metadataVersion: options.metadataVersion,
  expires: options.expires,
  signingKeyId: signer.keyId,
  rootDigest,
  host: "r2",
  steps: [...MANUAL_UPLOAD_STEPS],
  targets: published
});

/**
 * Verifies a five-target candidate closure against its prior rollback index,
 * signs one TUF publication per target, writes the launcher's single shared
 * pinned release inputs, and returns the manual upload manifest. Publishing
 * itself is never performed here.
 */
export async function publishT76Release(rawOptions) {
  const options = validateOptions(rawOptions);
  const signer = releaseSignerFromEnvironment(options.protectedEnvironment);
  await assertOutputAbsent(options.outputDirectory);
  const index = validateIndex(await readCanonicalJson(options.indexPath, "target index"), options.revision);
  const entries = index.targets.map((entry, position) =>
    validateEvidenceRecord(entry, `target index entry ${position}`)
  );
  validateClosureCoverage(entries);
  const identity = validateClosureIdentity(entries, options.revision);
  const rollbackProofs = validateRollbackIndex(
    await readCanonicalJson(options.rollbackIndexPath, "rollback index"),
    options.revision
  );
  const bound = bindTargets(entries, await readTargetArtifacts(options.targetsDirectory));
  await mkdir(options.outputDirectory, { recursive: false, mode: 0o700 });
  const published = [];
  for (const target of bound) published.push(await publishOneTarget(options, signer, target, rollbackProofs));
  assertSingleTrustRoot(published);
  const rootDigest = await writeReleaseInputs(options, identity, published[0].trustedRoot);
  const manifest = manifestFor(
    options,
    signer,
    identity,
    published.map((item) => item.entry),
    rootDigest
  );
  await writeExclusive(
    join(options.outputDirectory, "publication-manifest.json"),
    Buffer.from(`${canonicalizeJsonV2(manifest)}\n`, "utf8"),
    "publication-manifest.json"
  );
  return manifest;
}

/** A key-free, asset-list-free projection safe to print to a build log. */
export function publicationSummary(manifest) {
  return {
    revision: manifest.revision,
    releaseId: manifest.releaseId,
    semanticVersion: manifest.semanticVersion,
    baseUrl: manifest.baseUrl,
    signingKeyId: manifest.signingKeyId,
    rootDigest: manifest.rootDigest,
    targets: manifest.targets.map((entry) => ({
      targetKey: entry.targetKey,
      releaseDigest: entry.releaseDigest,
      candidateDigest: entry.candidateDigest,
      assetCount: entry.assetCount
    }))
  };
}

const argument = (args, name) => {
  const index = args.indexOf(name);
  if (index < 0 || args[index + 1] === undefined) throw new Error(`missing ${name}`);
  return args[index + 1];
};

const optionalArgument = (args, name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 || args[index + 1] === undefined ? fallback : args[index + 1];
};

const runCli = async () => {
  const args = process.argv.slice(2);
  const manifest = await publishT76Release({
    indexPath: argument(args, "--index"),
    targetsDirectory: argument(args, "--targets"),
    outputDirectory: argument(args, "--out"),
    baseUrl: argument(args, "--base-url"),
    revision: argument(args, "--revision"),
    expires: argument(args, "--expires"),
    metadataVersion: Number(optionalArgument(args, "--metadata-version", "1")),
    rollbackIndexPath: argument(args, "--rollback-index"),
    protectedEnvironment: process.env
  });
  console.log(canonicalizeJsonV2(publicationSummary(manifest)));
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
