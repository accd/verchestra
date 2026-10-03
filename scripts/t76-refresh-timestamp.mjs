// why: re-signs the online TUF timestamp and snapshot metadata of an already
// published five-target T76 release, so a short freeze-attack-defense window on
// those roles stays operationally safe (#382, the follow-up to #18 F2).
//
// invariant: the input is the metadata artifact a `t76-publish-release` run emitted:
// `publication-manifest.json` plus `publication/<targetKey>/metadata/`. Its
// root, targets, and components metadata are offline-signed and are only read
// here: each is verified under the published root, the root is bound to both
// reviewed anchors, and none is re-signed or re-emitted. Only `timestamp.json`
// and the next `<version>.snapshot.json` are signed, per target, with the online
// key.
//
// invariant: authority boundaries this script does not cross:
//
//   * It holds only the online key, read from
//     `VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64`, bound to the reviewed
//     `release-timestamp-snapshot-public-key.json` anchor. It refuses to run when
//     the offline root/targets key is present in its environment, and refuses an
//     online key that holds root or targets authority.
//   * No decoded key byte, no base64 character of it, and no OpenSSL cause chain
//     derived from it is written anywhere (the shared custody module's key rules
//     apply).
//   * Nothing here publishes or uploads, and the ledger is not edited. It writes
//     the new files, an upload manifest, and the ledger entry a human appends in
//     a reviewed pull request.
//
// invariant: fail closed. An offline key in the environment, a missing or
// malformed online key or anchor, an online key that is the offline key, a root
// that differs from the one the publication pinned or that the ledger does not
// record, targets or components that do not verify or are not the newest release
// recorded for that root, a version that does not strictly exceed every version
// the ledger records for the root, or an expiry that is not ordered timestamp <=
// snapshot <= targets <= root stops the run before a single output byte exists.

import { createHash, createPublicKey } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalizeJsonV2 } from "../packages/domain/src/index.ts";
import { buildTufOnlineRoleRefresh } from "../packages/distribution/src/index.ts";
import {
  DEFAULT_RELEASE_ANCHOR,
  DEFAULT_TIMESTAMP_ANCHOR,
  KEY_ENVIRONMENT_NAME,
  RELEASE_ANCHOR_PURPOSE,
  SUPPORTED_TARGET_KEYS,
  T76PublishError,
  TIMESTAMP_ANCHOR_PURPOSE,
  TIMESTAMP_KEY_ENVIRONMENT_NAME,
  assertOutputAbsent,
  expectedAnchorKeyId,
  releaseSignerFromEnvironment,
  writeExclusive
} from "./t76-signing-custody.mjs";
import { admitRefresh, readPublicationLedger } from "./tuf-publication-ledger.mjs";

export { RELEASE_ANCHOR_PURPOSE, TIMESTAMP_ANCHOR_PURPOSE };

// why: the tracked procedure a refresh ledger entry cites as its evidence.
export const REFRESH_EVIDENCE = Object.freeze([".specs/features/tuf-role-separation/republish-v3-runbook.md"]);

// invariant: what a human must do with the emitted directory. Nothing here does it.
export const REFRESH_UPLOAD_STEPS = Object.freeze([
  "Download this run's refresh artifact and keep the publication/ tree intact.",
  "Verify each file's sha256 against targets[].assets[].contentDigest in this manifest.",
  "For every target, upload <version>.snapshot.json before timestamp.json, preserving every relative key, so no served timestamp ever names a snapshot the endpoint does not serve yet.",
  "Never upload, overwrite, or delete root.json, *.targets.json, *.components.json, or any target file; this refresh re-signs none of them.",
  "Confirm the endpoint serves timestamp.json uncached, then run the published launcher (npx verchestra@<version> --version) against the live endpoint.",
  "Append ledger-entry.json verbatim to docs/qualification/tuf-publication-ledger.json in a reviewed pull request before the next refresh or publication; if another entry landed first, rerun the refresh against main's ledger instead of editing the entry."
]);

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const RUN_ID = /^[0-9]{1,20}$/u;
const OFFLINE_FILE = Object.freeze({
  targets: /^([1-9][0-9]*)\.targets\.json$/u,
  components: /^([1-9][0-9]*)\.components\.json$/u
});
const MANIFEST_FILE = "publication-manifest.json";

const fail = (code, message, cause) => {
  throw new T76PublishError(code, message, cause === undefined ? undefined : { cause });
};

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const absolutePath = (value, label) => {
  if (typeof value !== "string" || value.length === 0) fail("VES_T76_PUBLISH_INPUT_INVALID", `${label} is required`);
  return resolve(value);
};

const optionalPath = (value, label) => (value === undefined ? undefined : absolutePath(value, label));

const matching = (value, pattern, label) => {
  if (typeof value !== "string" || !pattern.test(value)) fail("VES_T76_PUBLISH_INPUT_INVALID", `${label} is invalid`);
  return value;
};

// why: no default. The refresh version bounds every later publication for the
// root, so the operator states it, and the ledger refuses it unless it is new.
const explicitVersion = (value) => {
  if (!Number.isSafeInteger(value) || value <= 0)
    fail("VES_T76_PUBLISH_INPUT_INVALID", "metadataVersion must be an explicit positive integer");
  return value;
};

const protectedEnvironmentOf = (value) => {
  const environment = value ?? {};
  if (!isRecord(environment)) fail("VES_T76_PUBLISH_INPUT_INVALID", "protectedEnvironment must be an object");
  return environment;
};

const validateOptions = (value) => {
  if (!isRecord(value)) fail("VES_T76_PUBLISH_INPUT_INVALID", "refresh options must be an object");
  return Object.freeze({
    currentDirectory: absolutePath(value.currentDirectory, "currentDirectory"),
    outputDirectory: absolutePath(value.outputDirectory, "outputDirectory"),
    metadataVersion: explicitVersion(value.metadataVersion),
    timestampExpires: matching(value.timestampExpires, INSTANT, "timestampExpires"),
    publicationRunId:
      value.publicationRunId === undefined ? null : matching(value.publicationRunId, RUN_ID, "publicationRunId"),
    ledgerPath: optionalPath(value.ledgerPath, "ledgerPath"),
    protectedEnvironment: protectedEnvironmentOf(value.protectedEnvironment),
    releaseAnchorPath: optionalPath(value.releaseAnchorPath, "releaseAnchorPath"),
    timestampAnchorPath: optionalPath(value.timestampAnchorPath, "timestampAnchorPath")
  });
};

// invariant: the refresh process never sees the offline key. Its presence means
// the online routine was granted root/targets authority, so it stops.
const assertOfflineKeyAbsent = (environment) => {
  const value = environment[KEY_ENVIRONMENT_NAME];
  if (typeof value === "string" && value.length > 0)
    fail(
      "VES_T76_REFRESH_OFFLINE_KEY_PRESENT",
      `${KEY_ENVIRONMENT_NAME} must not be present in the online refresh environment`
    );
};

const onlineSignerFor = async (options) => {
  assertOfflineKeyAbsent(options.protectedEnvironment);
  const signer = releaseSignerFromEnvironment(options.protectedEnvironment, TIMESTAMP_KEY_ENVIRONMENT_NAME);
  const timestampAnchor = await expectedAnchorKeyId(
    options.timestampAnchorPath,
    DEFAULT_TIMESTAMP_ANCHOR,
    TIMESTAMP_ANCHOR_PURPOSE
  );
  const releaseAnchor = await expectedAnchorKeyId(
    options.releaseAnchorPath,
    DEFAULT_RELEASE_ANCHOR,
    RELEASE_ANCHOR_PURPOSE
  );
  if (timestampAnchor === releaseAnchor)
    fail("VES_T76_REFRESH_ROLE_SEPARATION", "the timestamp and release anchors name the same key");
  // why: checked before the timestamp anchor, so an offline key pasted into the
  // online secret is named as a role violation, not a generic mismatch.
  if (signer.keyId === releaseAnchor)
    fail("VES_T76_REFRESH_ROLE_SEPARATION", "the online signing key is the offline release key");
  if (signer.keyId !== timestampAnchor)
    fail("VES_T76_PUBLISH_KEY_MISMATCH", "the online signing key does not match the reviewed timestamp anchor");
  return Object.freeze({ signer, releaseAnchor, timestampAnchor });
};

const readBytes = async (path, label) => {
  try {
    return await readFile(path);
  } catch (error) {
    return fail("VES_T76_PUBLISH_INPUT_MISSING", `${label} cannot be read`, error);
  }
};

const parseCanonicalManifest = (bytes) => {
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    return fail("VES_T76_PUBLISH_INPUT_INVALID", `${MANIFEST_FILE} is not JSON`, error);
  }
  if (canonicalizeJsonV2(manifest) !== bytes.toString("utf8").trim())
    fail("VES_T76_PUBLISH_INPUT_INVALID", `${MANIFEST_FILE} is not the canonical JSON the publication emitted`);
  return manifest;
};

const isPublicationManifest = (manifest) =>
  isRecord(manifest) &&
  manifest.schemaVersion === 1 &&
  ["releaseId", "semanticVersion", "baseUrl"].every((field) => typeof manifest[field] === "string") &&
  typeof manifest.rootDigest === "string" &&
  DIGEST.test(manifest.rootDigest) &&
  Array.isArray(manifest.targets);

const readManifest = async (directory) => {
  const manifest = parseCanonicalManifest(await readBytes(join(directory, MANIFEST_FILE), MANIFEST_FILE));
  if (!isPublicationManifest(manifest))
    fail("VES_T76_PUBLISH_INPUT_INVALID", `${MANIFEST_FILE} is not a T76 publication manifest`);
  const keys = manifest.targets.map((entry) => entry?.targetKey);
  if (keys.length !== SUPPORTED_TARGET_KEYS.length || SUPPORTED_TARGET_KEYS.some((key, index) => keys[index] !== key))
    fail("VES_T76_PUBLISH_CLOSURE_INCOMPLETE", `${MANIFEST_FILE} does not cover each supported target exactly once`);
  return manifest;
};

const offlineFileName = async (directory, role) => {
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    return fail("VES_T76_PUBLISH_INPUT_MISSING", "a published metadata directory cannot be read", error);
  }
  const matches = names.filter((name) => OFFLINE_FILE[role].test(name));
  if (matches.length !== 1)
    fail("VES_T76_PUBLISH_INPUT_INVALID", `a published metadata directory must hold exactly one ${role} file`);
  return matches[0];
};

// why: best effort only. The ledger is the authority; a served timestamp or
// snapshot newer than the requested version reveals an unrecorded refresh.
const publishedOnlineVersion = async (path) => {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    return 0;
  }
  try {
    const version = JSON.parse(bytes.toString("utf8"))?.signed?.version;
    return Number.isSafeInteger(version) ? version : 0;
  } catch {
    return 0;
  }
};

const readPublishedTarget = async (directory, key, manifest) => {
  const metadata = join(directory, "publication", key, "metadata");
  const trustedRoot = await readBytes(join(metadata, "root.json"), `${key} root.json`);
  if (sha256(trustedRoot) !== manifest.rootDigest)
    fail("VES_T76_REFRESH_ROOT_CHANGED", `${key} root.json is not the root the publication pinned`);
  const targetsName = await offlineFileName(metadata, "targets");
  const componentsName = await offlineFileName(metadata, "components");
  const snapshotNames = (await readdir(metadata)).filter((name) => /^[1-9][0-9]*\.snapshot\.json$/u.test(name));
  const servedVersions = [
    await publishedOnlineVersion(join(metadata, "timestamp.json")),
    ...snapshotNames.map((name) => Number(name.split(".")[0]))
  ];
  return Object.freeze({
    key,
    trustedRoot,
    targetsName,
    componentsName,
    targets: await readBytes(join(metadata, targetsName), `${key} ${targetsName}`),
    components: await readBytes(join(metadata, componentsName), `${key} ${componentsName}`),
    servedVersion: Math.max(...servedVersions)
  });
};

// invariant: the published root delegates root and targets to exactly the
// reviewed release anchor and timestamp and snapshot to exactly the reviewed
// timestamp anchor. The key ids are sha256(SPKI-DER), the identity both anchors
// resolve to, and the library has already proven each id's declared key.
const assertRootMatchesAnchors = (refresh, anchors) => {
  const expected = {
    root: anchors.releaseAnchor,
    targets: anchors.releaseAnchor,
    timestamp: anchors.timestampAnchor,
    snapshot: anchors.timestampAnchor
  };
  for (const [role, keyId] of Object.entries(expected)) {
    const published = refresh.rootRoles[role].keyids;
    if (published.length !== 1 || published[0] !== keyId)
      fail("VES_T76_REFRESH_ROOT_CHANGED", `the published root does not delegate ${role} to its reviewed anchor alone`);
  }
  for (const [keyId, publicKey] of refresh.rootKeys) {
    const derived = createHash("sha256").update(spkiDer(publicKey)).digest("hex");
    if (derived !== keyId) fail("VES_T76_REFRESH_ROOT_CHANGED", "the published root names a key by a foreign key id");
  }
};

const spkiDer = (publicKey) => {
  try {
    return createPublicKey(publicKey).export({ format: "der", type: "spki" });
  } catch (error) {
    return fail("VES_T76_REFRESH_ROOT_CHANGED", "the published root declares an unusable key", error);
  }
};

const assertReleaseTarget = (refresh, key, manifest) => {
  const path = `releases/${key}/release.json`;
  const entries = Object.keys(refresh.releaseTargets);
  const custom = refresh.releaseTargets[path]?.custom;
  if (entries.length !== 1 || !isRecord(custom) || custom.releaseId !== manifest.releaseId)
    fail("VES_T76_REFRESH_TARGETS_CHANGED", `${key} targets metadata does not name the release the publication pinned`);
};

const refreshOneTarget = (published, options, anchors, manifest) => {
  const refresh = buildTufOnlineRoleRefresh({
    schemaVersion: 1,
    trustedRoot: published.trustedRoot,
    targets: published.targets,
    components: published.components,
    versions: { snapshot: options.metadataVersion, timestamp: options.metadataVersion },
    expires: { snapshot: options.timestampExpires, timestamp: options.timestampExpires },
    roles: {
      timestamp: { threshold: 1, signers: [anchors.signer] },
      snapshot: { threshold: 1, signers: [anchors.signer] }
    }
  });
  assertRootMatchesAnchors(refresh, anchors);
  assertReleaseTarget(refresh, published.key, manifest);
  if (refresh.rootDigest !== manifest.rootDigest)
    fail("VES_T76_REFRESH_ROOT_CHANGED", `${published.key} was verified under a different root`);
  return refresh;
};

// invariant: snapshot before timestamp, the order a human must upload them in.
const uploadOrder = (name) => (name === "timestamp.json" ? 1 : 0);

const assetsFor = (key, refresh) =>
  [...refresh.metadata.entries()]
    .sort(([left], [right]) => uploadOrder(left) - uploadOrder(right))
    .map(([name, bytes]) => ({
      area: "metadata",
      assetName: name,
      path: `publication/${key}/metadata/${name}`,
      remoteKey: `${key}/metadata/${name}`,
      contentDigest: sha256(bytes),
      sizeBytes: bytes.byteLength
    }));

const writeTarget = async (outputDirectory, key, refresh) => {
  const directory = join(outputDirectory, "publication", key, "metadata");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const [name, bytes] of refresh.metadata) await writeExclusive(join(directory, name), bytes, `${key} ${name}`);
};

const refreshManifestFor = (manifest, options, anchors, refreshed) => ({
  schemaVersion: 1,
  kind: "role-refresh",
  releaseId: manifest.releaseId,
  semanticVersion: manifest.semanticVersion,
  baseUrl: manifest.baseUrl,
  rootDigest: manifest.rootDigest,
  targetsVersion: refreshed[0].refresh.versions.targets,
  metadataVersion: options.metadataVersion,
  timestampExpires: options.timestampExpires,
  timestampSigningKeyId: anchors.signer.keyId,
  steps: [...REFRESH_UPLOAD_STEPS],
  targets: refreshed.map(({ key, refresh }) => {
    const assets = assetsFor(key, refresh);
    return {
      targetKey: key,
      metadataBaseUrl: `${manifest.baseUrl}${key}/metadata/`,
      assetCount: assets.length,
      assets
    };
  })
});

export async function refreshT76Timestamp(rawOptions) {
  const options = validateOptions(rawOptions);
  const anchors = await onlineSignerFor(options);
  const ledger = await readPublicationLedger(options.ledgerPath);
  const manifest = await readManifest(options.currentDirectory);
  const published = [];
  for (const key of SUPPORTED_TARGET_KEYS)
    published.push(await readPublishedTarget(options.currentDirectory, key, manifest));
  const targetsVersions = new Set(published.map((item) => Number(item.targetsName.split(".")[0])));
  if (targetsVersions.size !== 1)
    fail("VES_T76_REFRESH_TARGETS_CHANGED", "the published targets do not share one targets version");
  const [targetsVersion] = targetsVersions;
  const entry = admitRefresh(ledger, {
    releaseId: manifest.releaseId,
    semanticVersion: manifest.semanticVersion,
    baseUrl: manifest.baseUrl,
    rootDigest: manifest.rootDigest,
    metadataVersion: options.metadataVersion,
    targetsVersion,
    publicationRunId: options.publicationRunId,
    evidence: REFRESH_EVIDENCE
  });
  if (published.some((item) => item.servedVersion >= options.metadataVersion))
    fail(
      "VES_T76_PUBLISH_METADATA_VERSION_NOT_MONOTONIC",
      `metadataVersion ${options.metadataVersion} does not exceed a timestamp or snapshot version already in the published input`
    );
  const refreshed = published.map((item) => ({
    key: item.key,
    refresh: refreshOneTarget(item, options, anchors, manifest)
  }));
  for (const { refresh } of refreshed)
    if (refresh.versions.targets !== targetsVersion)
      fail("VES_T76_REFRESH_TARGETS_CHANGED", "a published targets file is not named by its own version");
  const refreshManifest = refreshManifestFor(manifest, options, anchors, refreshed);
  await assertOutputAbsent(options.outputDirectory, "refresh");
  await mkdir(options.outputDirectory, { recursive: false, mode: 0o700 });
  for (const { key, refresh } of refreshed) await writeTarget(options.outputDirectory, key, refresh);
  await writeExclusive(
    join(options.outputDirectory, "ledger-entry.json"),
    Buffer.from(`${JSON.stringify(entry, null, 2)}\n`, "utf8"),
    "ledger-entry.json"
  );
  await writeExclusive(
    join(options.outputDirectory, "refresh-manifest.json"),
    Buffer.from(`${canonicalizeJsonV2(refreshManifest)}\n`, "utf8"),
    "refresh-manifest.json"
  );
  return Object.freeze({ manifest: refreshManifest, ledgerEntry: entry });
}

// invariant: key-free and asset-list-free, so it is safe to print to a build log.
export function refreshSummary(manifest) {
  return {
    releaseId: manifest.releaseId,
    semanticVersion: manifest.semanticVersion,
    baseUrl: manifest.baseUrl,
    rootDigest: manifest.rootDigest,
    targetsVersion: manifest.targetsVersion,
    metadataVersion: manifest.metadataVersion,
    timestampExpires: manifest.timestampExpires,
    timestampSigningKeyId: manifest.timestampSigningKeyId,
    targets: manifest.targets.map((entry) => ({ targetKey: entry.targetKey, assetCount: entry.assetCount }))
  };
}

const argument = (args, name) => {
  const index = args.indexOf(name);
  if (index < 0 || args[index + 1] === undefined) throw new Error(`missing ${name}`);
  return args[index + 1];
};

const optionalArgument = (args, name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};

const runCli = async () => {
  const args = process.argv.slice(2);
  const { manifest } = await refreshT76Timestamp({
    currentDirectory: argument(args, "--current"),
    outputDirectory: argument(args, "--out"),
    // why: required, no default. It must strictly exceed every version the ledger
    // records for the published root (#387).
    metadataVersion: Number(argument(args, "--metadata-version")),
    timestampExpires: argument(args, "--timestamp-expires"),
    publicationRunId: optionalArgument(args, "--run-id"),
    // why: the refresh workflow passes the ledger read from origin/main's tip;
    // omitted, the committed ledger applies.
    ledgerPath: optionalArgument(args, "--ledger"),
    // why: omitted by the refresh workflow, so a live refresh is always bound to the
    // committed anchors; overridable only for tests that sign with throwaway keys.
    releaseAnchorPath: optionalArgument(args, "--release-anchor"),
    timestampAnchorPath: optionalArgument(args, "--timestamp-anchor"),
    protectedEnvironment: process.env
  });
  console.log(canonicalizeJsonV2(refreshSummary(manifest)));
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
