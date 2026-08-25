import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { canonicalize } from "@tufjs/canonical-json";
import { DownloadHTTPError } from "tuf-js/dist/error.js";

import { buildHermeticDistributionBundle } from "../../packages/distribution/src/hermetic-bundle.ts";
import { bundleInput } from "./hermetic-bundle-fixture.mjs";

export const hex = (value) => createHash("sha256").update(value).digest("hex");
const digest = (value) => `sha256:${hex(value)}`;
const future = "2035-01-01T00:00:00.000Z";

export function createUpdateKeys(count = 3) {
  return Array.from({ length: count }, (_, index) => {
    const pair = generateKeyPairSync("ed25519");
    const publicPem = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
    return { id: hex(`verchestra-tuf-${index}:${publicPem}`), publicPem, privateKey: pair.privateKey };
  });
}

const signatures = (signed, keys, count) => {
  const bytes = Buffer.from(canonicalize(signed));
  return keys.slice(0, count).map((key) => ({
    keyid: key.id,
    sig: sign(null, bytes, key.privateKey).toString("hex")
  }));
};

export const serialize = (signed, keys, count, corrupt = false) => {
  const value = { signatures: signatures(signed, keys, count), signed };
  if (corrupt) {
    for (const signature of value.signatures) signature.sig = "00".repeat(64);
  }
  return Buffer.from(JSON.stringify(value));
};

export const metadataFile = (bytes, version, overrides = {}) => ({
  version,
  length: bytes.length,
  hashes: { sha256: hex(bytes) },
  ...overrides
});

const targetFile = (path, bytes, custom, overrides = {}) => ({
  length: bytes.length,
  hashes: { sha256: hex(bytes) },
  custom,
  ...overrides
});

const consistentTargetPath = (path, bytes, consistent) => {
  if (!consistent) return path;
  const slash = path.lastIndexOf("/");
  const directory = slash < 0 ? "" : path.slice(0, slash + 1);
  const name = slash < 0 ? path : path.slice(slash + 1);
  return `${directory}${hex(bytes)}.${name}`;
};

export function buildTufUpdateFixture(options = {}) {
  const keys = options.keys ?? createUpdateKeys();
  const metadataVersion = options.metadataVersion ?? 1;
  const rootVersion = options.rootVersion ?? 1;
  const threshold = options.threshold ?? 1;
  const signatureCount = options.signatureCount ?? 2;
  const consistentSnapshot = options.consistentSnapshot ?? true;
  const platform = options.platform ?? "win32";
  const arch = options.arch ?? "x64";
  const releaseId = options.releaseId ?? "release:verchestra:1.0.0:win32-x64";
  const semanticVersion = options.semanticVersion ?? "1.0.0";
  const expires = options.expires ?? {};
  const activeKeys = rootVersion > 1 && options.rotatedKeys ? options.rotatedKeys : keys;
  const roleFor = (roleKeys) => ({ keyids: roleKeys.map((entry) => entry.id), threshold });
  const keyMapFor = (roleKeys) =>
    Object.fromEntries(
      roleKeys.map((key) => [key.id, { keytype: "ed25519", scheme: "ed25519", keyval: { public: key.publicPem } }])
    );
  const keyMap = keyMapFor(activeKeys);
  const rootSigned = (version, rootKeys) => ({
    _type: "root",
    spec_version: "1.0.0",
    version,
    expires: expires.root ?? future,
    keys: keyMapFor(rootKeys),
    roles: {
      root: roleFor(rootKeys),
      timestamp: roleFor(rootKeys),
      snapshot: roleFor(rootKeys),
      targets: roleFor(rootKeys)
    },
    consistent_snapshot: consistentSnapshot
  });
  const bootstrapRoot = serialize(rootSigned(1, keys), keys, signatureCount, options.corruptRootSignature);
  const rotationSigners = [...keys.slice(0, threshold), ...activeKeys.slice(0, threshold)];
  const currentRoot = serialize(
    rootSigned(rootVersion, activeKeys),
    rootVersion > 1 ? rotationSigners : activeKeys,
    rootVersion > 1 ? rotationSigners.length : signatureCount,
    options.corruptRotatedRootSignature
  );

  const rawComponents = bundleInput({
    target: { platform, arch, nodeVersion: "24.14.0" }
  }).components;
  const componentBytes = new Map();
  const components = rawComponents.map((component) => {
    const bytes = Buffer.from(`verchestra:${component.componentId}:${"x".repeat(24)}`);
    const logicalPath = options.logicalPathOverrides?.[component.componentId] ?? component.logicalPath;
    componentBytes.set(logicalPath, bytes);
    return {
      ...component,
      logicalPath,
      releaseId,
      platform: ["node-runtime", "sqlite-native", "launcher"].includes(component.kind) ? platform : "any",
      arch: ["node-runtime", "sqlite-native", "launcher"].includes(component.kind) ? arch : "any",
      contentDigest: digest(bytes),
      sizeBytes: bytes.length
    };
  });
  let bundle = buildHermeticDistributionBundle(
    bundleInput({ releaseId, semanticVersion, target: { platform, arch, nodeVersion: "24.14.0" }, components })
  );
  if (options.bundleTransform) bundle = options.bundleTransform(structuredClone(bundle));
  const manifestPath = `releases/${platform}-${arch}/release.json`;
  const manifestBytes = Buffer.from(options.manifestBytes ?? JSON.stringify(bundle));

  const delegatedTargetFiles = Object.fromEntries(
    bundle.components.map((component) => {
      const bytes = componentBytes.get(component.logicalPath);
      const custom = {
        releaseId: component.releaseId,
        componentId: component.componentId,
        contentDigest: component.contentDigest,
        ...(options.componentCustomOverrides?.[component.componentId] ?? {})
      };
      return [
        component.logicalPath,
        targetFile(component.logicalPath, bytes, custom, options.componentMetadataOverrides?.[component.componentId])
      ];
    })
  );
  const releaseCustom = {
    releaseId: bundle.releaseId,
    releaseDigest: bundle.releaseDigest,
    platform,
    arch,
    ...(options.releaseCustomOverrides ?? {})
  };
  const topTargetsFiles = {
    [manifestPath]: targetFile(manifestPath, manifestBytes, releaseCustom, options.manifestMetadataOverrides)
  };

  const delegatedSigned = {
    _type: "targets",
    spec_version: "1.0.0",
    version: metadataVersion,
    expires: expires.delegated ?? future,
    targets: delegatedTargetFiles
  };
  const delegated = serialize(delegatedSigned, activeKeys, signatureCount, options.corruptRole === "components");
  const targetsSigned = {
    _type: "targets",
    spec_version: "1.0.0",
    version: metadataVersion,
    expires: expires.targets ?? future,
    targets: topTargetsFiles,
    delegations: {
      keys: keyMap,
      roles: [
        {
          name: "components",
          keyids: activeKeys.map((entry) => entry.id),
          threshold,
          terminating: true,
          paths: ["components/*", "bin/*", "licenses/*", "evidence/*"]
        }
      ]
    }
  };
  const targets = serialize(targetsSigned, activeKeys, signatureCount, options.corruptRole === "targets");
  const snapshotSigned = {
    _type: "snapshot",
    spec_version: "1.0.0",
    version: metadataVersion,
    expires: expires.snapshot ?? future,
    meta: {
      "targets.json": metadataFile(targets, metadataVersion, options.targetsMetaOverrides),
      "components.json": metadataFile(delegated, metadataVersion, options.delegatedMetaOverrides)
    }
  };
  const snapshot = serialize(snapshotSigned, activeKeys, signatureCount, options.corruptRole === "snapshot");
  const timestampSigned = {
    _type: "timestamp",
    spec_version: "1.0.0",
    version: metadataVersion,
    expires: expires.timestamp ?? future,
    meta: {
      "snapshot.json": metadataFile(snapshot, metadataVersion, options.snapshotMetaOverrides)
    }
  };
  const timestamp = serialize(timestampSigned, activeKeys, signatureCount, options.corruptRole === "timestamp");

  const metadata = new Map();
  if (rootVersion > 1) metadata.set(`${rootVersion}.root.json`, currentRoot);
  metadata.set("timestamp.json", timestamp);
  metadata.set(consistentSnapshot ? `${metadataVersion}.snapshot.json` : "snapshot.json", snapshot);
  metadata.set(consistentSnapshot ? `${metadataVersion}.targets.json` : "targets.json", targets);
  metadata.set(consistentSnapshot ? `${metadataVersion}.components.json` : "components.json", delegated);
  for (const name of options.omitMetadata ?? []) metadata.delete(name);

  const targetsMap = new Map();
  targetsMap.set(consistentTargetPath(manifestPath, manifestBytes, consistentSnapshot), manifestBytes);
  for (const [path, bytes] of componentBytes) {
    targetsMap.set(consistentTargetPath(path, bytes, consistentSnapshot), bytes);
  }
  for (const path of options.omitTargets ?? []) {
    targetsMap.delete(path);
    const bytes = componentBytes.get(path);
    if (bytes) targetsMap.delete(consistentTargetPath(path, bytes, consistentSnapshot));
  }
  for (const [path, bytes] of Object.entries(options.targetByteOverrides ?? {})) {
    const original = componentBytes.get(path) ?? (path === manifestPath ? manifestBytes : undefined);
    if (original) targetsMap.set(consistentTargetPath(path, original, consistentSnapshot), Buffer.from(bytes));
  }

  return {
    keys,
    activeKeys,
    trustedRoot: bootstrapRoot,
    metadata,
    targets: targetsMap,
    bundle,
    manifestPath,
    componentBytes,
    consistentSnapshot
  };
}

export class FixtureDistributionSource {
  constructor(fixture, options = {}) {
    this.mode = options.mode ?? "online";
    this.sourceId = options.sourceId ?? `source:${this.mode}:primary`;
    this.metadata = fixture.metadata;
    this.targets = fixture.targets;
    this.reads = [];
    this.options = options;
    this.failuresRemaining = options.failures ?? 0;
  }

  async readMetadata(path) {
    this.reads.push({ kind: "metadata", path });
    const value = this.metadata.get(path);
    if (!value) throw new DownloadHTTPError(`missing metadata: ${path}`, 404);
    return Buffer.from(value);
  }

  async readTarget(path, offset, maximumBytes) {
    this.reads.push({ kind: "target", path, offset, maximumBytes });
    const selected = this.options.pathIncludes === undefined || path.includes(this.options.pathIncludes);
    if (
      selected &&
      this.options.failAtOffset !== undefined &&
      offset >= this.options.failAtOffset &&
      this.failuresRemaining > 0
    ) {
      this.failuresRemaining -= 1;
      throw new Error("injected target source interruption");
    }
    const value = this.targets.get(path);
    if (!value) throw new DownloadHTTPError(`missing target: ${path}`, 404);
    if (selected && this.options.emptyAtOffset === offset) return { bytes: Buffer.alloc(0), totalLength: value.length };
    const totalLength = this.options.totalLengthOverride ?? value.length;
    const limit = this.options.oversizedChunk ? maximumBytes + 1 : maximumBytes;
    return { bytes: Buffer.from(value.subarray(offset, offset + limit)), totalLength };
  }
}
