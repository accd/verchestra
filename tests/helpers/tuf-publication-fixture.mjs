import { createHash, generateKeyPairSync, sign } from "node:crypto";

import { buildHermeticDistributionBundle } from "../../packages/distribution/src/hermetic-bundle.ts";
import { buildReleaseCandidate } from "../../packages/distribution/src/release-candidate.ts";
import { buildTufReleasePublication } from "../../packages/distribution/src/tuf-publication.ts";
import { bundleInput, components, releaseId } from "./hermetic-bundle-fixture.mjs";

export const sha = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const keys = (count, label) =>
  Array.from({ length: count }, (_, index) => {
    const pair = generateKeyPairSync("ed25519");
    const publicKeyPem = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
    const keyId = createHash("sha256").update(`tuf-publication-${label}-${index}:${publicKeyPem}`).digest("hex");
    return {
      keyId,
      publicKeyPem,
      sign: (payload) => sign(null, payload, pair.privateKey)
    };
  });

// Role-separated authority (#18, F1): an offline key set signs root and targets,
// a distinct online key set signs timestamp and snapshot.
export const rolesFor = (offline, online) => ({
  root: { threshold: offline.length, signers: offline },
  targets: { threshold: offline.length, signers: offline },
  timestamp: { threshold: online.length, signers: online },
  snapshot: { threshold: online.length, signers: online }
});

// Per-role expiry (#18, F2): the online metadata expires before the offline
// horizon, ordered timestamp <= snapshot <= targets <= root.
export const defaultExpiries = Object.freeze({
  timestamp: "2030-01-01T00:00:00.000Z",
  snapshot: "2030-01-01T00:00:00.000Z",
  targets: "2035-01-01T00:00:00.000Z",
  root: "2035-01-01T00:00:00.000Z"
});

export function fixture(options = {}) {
  // options.components lets a test supply realistic logicalPaths (nested
  // components/<trackedPath>, runtime/node, native/*) without changing the
  // shared component list other suites depend on.
  const rawComponents = options.components ?? components();
  const componentBytes = rawComponents.map((component) => {
    const bytes = Buffer.from(`tuf-publication:${component.componentId}`);
    return { logicalPath: component.logicalPath, bytes };
  });
  const normalizedComponents = rawComponents.map((component, index) => ({
    ...component,
    contentDigest: sha(componentBytes[index].bytes),
    sizeBytes: componentBytes[index].bytes.byteLength
  }));
  const bundle = buildHermeticDistributionBundle(
    bundleInput({
      releaseId,
      components: normalizedComponents,
      createdAt: "2026-08-24T00:00:00.000Z"
    })
  );
  const evidence = bundle.components
    .filter((component) => ["license", "sbom", "provenance", "evaluation"].includes(component.kind))
    .map(({ kind, contentDigest, sizeBytes }) => ({ kind, digest: contentDigest, sizeBytes }));
  const candidate = buildReleaseCandidate({
    schemaVersion: 1,
    candidateId: "candidate:verchestra:2026-08-24:win32-x64",
    revision: "a".repeat(40),
    semanticVersion: bundle.semanticVersion,
    bundle,
    views: ["online", "mirror", "offline", "air-gapped"].map((mode) => ({
      mode,
      sourceId: `source:${mode}:release`,
      releaseDigest: bundle.releaseDigest,
      metadataDigest: sha(`${mode}:metadata`),
      targetDigest: sha(`${mode}:target`)
    })),
    evidence,
    rollback: {
      previousReleaseDigest: sha("previous-release"),
      verified: true,
      verificationDigest: sha("rollback-proof")
    }
  });
  const offline = options.offline ?? keys(2, "offline");
  const online = options.online ?? keys(1, "online");
  const roles = options.roles ?? rolesFor(offline, online);
  const expires = options.expires ?? defaultExpiries;
  const publication = buildTufReleasePublication({
    schemaVersion: 1,
    candidate,
    componentBytes,
    metadataVersion: options.metadataVersion ?? 1,
    rootVersion: options.rootVersion ?? 1,
    expires,
    roles,
    consistentSnapshot: options.consistentSnapshot ?? true
  });
  return { bundle, candidate, componentBytes, publication, offline, online, roles, expires };
}

export class MapDistributionSource {
  constructor(publication, mode = "offline", sourceId = `source:${mode}:fixture`) {
    this.mode = mode;
    this.sourceId = sourceId;
    this.metadata = publication.metadata;
    this.targets = publication.targets;
  }

  async readMetadata(path) {
    const bytes = this.metadata.get(path);
    if (!bytes) throw new Error(`missing metadata: ${path}`);
    return Buffer.from(bytes);
  }

  async readTarget(path, offset, maximumBytes) {
    const bytes = this.targets.get(path);
    if (!bytes) throw new Error(`missing target: ${path}`);
    return { bytes: Buffer.from(bytes.subarray(offset, offset + maximumBytes)), totalLength: bytes.length };
  }
}
