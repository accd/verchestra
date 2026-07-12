import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { canonicalize } from "@tufjs/canonical-json";

export const REQUIRED_COMPONENTS = [
  "core", "schemas", "cedar", "sqlite", "drivers", "extensions", "migrations",
  "licenses", "sbom", "provenance", "evaluations", "launchers"
];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function createTufKeys(count = 2) {
  return Array.from({ length: count }, (_, index) => {
    const pair = generateKeyPairSync("ed25519");
    const publicPem = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
    return { id: sha256(Buffer.from(`tuf-key-${index}:${publicPem}`)), publicPem, privateKey: pair.privateKey };
  });
}

function signatures(signed, keys, count) {
  const bytes = Buffer.from(canonicalize(signed));
  return keys.slice(0, count).map((key) => ({ keyid: key.id, sig: sign(null, bytes, key.privateKey).toString("hex") }));
}

function serialize(signed, keys, count) {
  return Buffer.from(JSON.stringify({ signatures: signatures(signed, keys, count), signed }));
}

function metaFile(bytes, version, hashOverride) {
  return { version, length: bytes.length, hashes: { sha256: hashOverride ?? sha256(bytes) } };
}

export function buildTufFixture({
  keys = createTufKeys(),
  version = 1,
  releaseId = "1.0.0",
  platform = "win32-x64",
  threshold = 1,
  signatureCount = 2,
  expires = {},
  omitComponents = [],
  componentReleaseOverrides = {},
  snapshotHashOverride,
  corruptTimestampSignature = false,
  corruptTargetPath,
  omitTargetPath
} = {}) {
  const future = "2030-01-01T00:00:00.000Z";
  const role = { keyids: keys.map((key) => key.id), threshold };
  const rootSigned = {
    _type: "root", spec_version: "1.0.0", version: 1, expires: expires.root ?? future,
    keys: Object.fromEntries(keys.map((key) => [key.id, { keytype: "ed25519", scheme: "ed25519", keyval: { public: key.publicPem } }])),
    roles: { root: role, timestamp: role, snapshot: role, targets: role },
    consistent_snapshot: false
  };
  const root = serialize(rootSigned, keys, signatureCount);

  const targetBytes = new Map();
  const components = REQUIRED_COMPONENTS.filter((name) => !omitComponents.includes(name)).map((name) => {
    const content = Buffer.from(`${releaseId}:${name}`);
    const path = `components/${name}.bin`;
    targetBytes.set(path, content);
    return { name, path, sha256: sha256(content), releaseId: componentReleaseOverrides[name] ?? releaseId };
  });
  const manifest = { releaseId, platform, components };
  targetBytes.set("release.json", Buffer.from(JSON.stringify(manifest)));

  const targetFiles = Object.fromEntries([...targetBytes].map(([path, bytes]) => [path, {
    length: bytes.length,
    hashes: { sha256: sha256(bytes) },
    custom: { releaseId, platform }
  }]));
  const targetsSigned = { _type: "targets", spec_version: "1.0.0", version, expires: expires.targets ?? future, targets: targetFiles };
  const targets = serialize(targetsSigned, keys, signatureCount);
  const snapshotSigned = {
    _type: "snapshot", spec_version: "1.0.0", version, expires: expires.snapshot ?? future,
    meta: { "targets.json": metaFile(targets, version, snapshotHashOverride) }
  };
  const snapshot = serialize(snapshotSigned, keys, signatureCount);
  const timestampSigned = {
    _type: "timestamp", spec_version: "1.0.0", version, expires: expires.timestamp ?? future,
    meta: { "snapshot.json": metaFile(snapshot, version) }
  };
  let timestamp = serialize(timestampSigned, keys, signatureCount);
  if (corruptTimestampSignature) {
    const parsed = JSON.parse(timestamp);
    for (const signature of parsed.signatures) signature.sig = "00".repeat(64);
    timestamp = Buffer.from(JSON.stringify(parsed));
  }
  if (corruptTargetPath && targetBytes.has(corruptTargetPath)) targetBytes.set(corruptTargetPath, Buffer.from("corrupted"));
  if (omitTargetPath) targetBytes.delete(omitTargetPath);
  return {
    keys,
    root,
    metadata: new Map([["timestamp.json", timestamp], ["snapshot.json", snapshot], ["targets.json", targets]]),
    targets: targetBytes,
    manifest
  };
}
