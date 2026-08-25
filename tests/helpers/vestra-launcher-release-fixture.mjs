// A genuinely executable release, published into a real TUF repository on disk.
//
// The other TUF fixtures publish placeholder component bytes, which is right for
// resolution and integrity cases but cannot prove activation: the health gate
// spawns both canonical launchers through the release's own Node runtime, so a
// release that cannot execute proves nothing about the bootstrap. This helper
// takes the executable closure from `activation-health-fixture.mjs` and signs it
// into metadata that `TufUpdateClient` resolves for real.
//
// Everything here is ephemeral and non-authoritative. The keys are generated per
// call, the repository lives under `mkdtemp`, and `disposeLauncherReleaseFixtures`
// removes both. A fixture trust root is never release authority.

import { link, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildExecutableRelease } from "./activation-health-fixture.mjs";
import { createUpdateKeys, hex, metadataFile, serialize } from "./tuf-update-fixture.mjs";
import { FLEET_TARGET_KEYS, fixtureTargets } from "./vestra-launcher-fixture.mjs";

const FUTURE = "2035-01-01T00:00:00.000Z";
const METADATA_VERSION = 1;
const roots = [];

/** Releases every repository this module materialized. */
export async function disposeLauncherReleaseFixtures() {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

/** The consistent-snapshot name of a target, derived from its known digest. */
function consistentPath(logicalPath, contentDigest) {
  const digest = contentDigest.slice("sha256:".length);
  const slash = logicalPath.lastIndexOf("/");
  return slash < 0
    ? `${digest}.${logicalPath}`
    : `${logicalPath.slice(0, slash + 1)}${digest}.${logicalPath.slice(slash + 1)}`;
}

async function writeTarget(targetsRoot, repositoryPath, content) {
  const path = join(targetsRoot, ...repositoryPath.split("/"));
  await mkdir(dirname(path), { recursive: true });
  if (content.runtimePath === undefined) await writeFile(path, content.bytes);
  else await link(content.runtimePath, path).catch(() => copyFile(content.runtimePath, path));
}

function signedRoles(keys) {
  const role = { keyids: keys.map((key) => key.id), threshold: 1 };
  return {
    keys: Object.fromEntries(
      keys.map((key) => [key.id, { keytype: "ed25519", scheme: "ed25519", keyval: { public: key.publicPem } }])
    ),
    roles: { root: role, timestamp: role, snapshot: role, targets: role }
  };
}

function targetsRole(bundle, manifestBytes, manifestPath) {
  const targets = {
    [manifestPath]: {
      length: manifestBytes.length,
      hashes: { sha256: hex(manifestBytes) },
      custom: {
        releaseId: bundle.releaseId,
        releaseDigest: bundle.releaseDigest,
        platform: bundle.target.platform,
        arch: bundle.target.arch
      }
    }
  };
  for (const component of bundle.components) {
    targets[component.logicalPath] = {
      length: component.sizeBytes,
      hashes: { sha256: component.contentDigest.slice("sha256:".length) },
      custom: {
        releaseId: component.releaseId,
        componentId: component.componentId,
        contentDigest: component.contentDigest
      }
    };
  }
  return targets;
}

function metadataFor(bundle, manifestBytes, manifestPath, keys) {
  const anchor = signedRoles(keys);
  const rootBytes = serialize(
    {
      _type: "root",
      spec_version: "1.0.0",
      version: 1,
      expires: FUTURE,
      ...anchor,
      consistent_snapshot: true
    },
    keys,
    keys.length
  );
  const targets = serialize(
    {
      _type: "targets",
      spec_version: "1.0.0",
      version: METADATA_VERSION,
      expires: FUTURE,
      targets: targetsRole(bundle, manifestBytes, manifestPath)
    },
    keys,
    keys.length
  );
  const snapshot = serialize(
    {
      _type: "snapshot",
      spec_version: "1.0.0",
      version: METADATA_VERSION,
      expires: FUTURE,
      meta: { "targets.json": metadataFile(targets, METADATA_VERSION) }
    },
    keys,
    keys.length
  );
  const timestamp = serialize(
    {
      _type: "timestamp",
      spec_version: "1.0.0",
      version: METADATA_VERSION,
      expires: FUTURE,
      meta: { "snapshot.json": metadataFile(snapshot, METADATA_VERSION) }
    },
    keys,
    keys.length
  );
  return new Map([
    ["root.json", rootBytes],
    ["timestamp.json", timestamp],
    [`${METADATA_VERSION}.snapshot.json`, snapshot],
    [`${METADATA_VERSION}.targets.json`, targets]
  ]);
}

/**
 * Publishes one executable release into `<root>/metadata` and `<root>/targets`,
 * laid out exactly as `NodeFilesystemDistributionSource` reads them, and returns
 * the trust root a launcher would carry plus the pinned source configuration
 * that names it.
 */
export async function publishExecutableRelease(options = {}) {
  const { bundle, files } = await buildExecutableRelease(options);
  const keys = createUpdateKeys(2);
  const manifestPath = `releases/${bundle.target.platform}-${bundle.target.arch}/release.json`;
  const manifestBytes = Buffer.from(JSON.stringify(bundle));
  const root = await mkdtemp(join(tmpdir(), "verchestra-launcher-release-"));
  roots.push(root);
  const repositoryRoot = join(root, "repository");
  const metadata = metadataFor(bundle, manifestBytes, manifestPath, keys);
  for (const [name, bytes] of metadata) {
    await mkdir(join(repositoryRoot, "metadata"), { recursive: true });
    await writeFile(join(repositoryRoot, "metadata", name), bytes);
  }
  const targetsRoot = join(repositoryRoot, "targets");
  await writeTarget(targetsRoot, consistentPath(manifestPath, `sha256:${hex(manifestBytes)}`), {
    bytes: manifestBytes
  });
  for (const component of bundle.components) {
    await writeTarget(targetsRoot, consistentPath(component.logicalPath, component.contentDigest), {
      ...files.get(component.logicalPath)
    });
  }
  return Object.freeze({
    bundle,
    manifestPath,
    repositoryRoot,
    root,
    trustedRoot: new Uint8Array(metadata.get("root.json")),
    source: Object.freeze({
      schemaVersion: 2,
      sourceId: "source:offline:launcher-e2e",
      releaseId: bundle.releaseId,
      semanticVersion: bundle.semanticVersion,
      rootDigest: `sha256:${hex(metadata.get("root.json"))}`,
      // The e2e bootstrap runs on the real host, so the current process key
      // must be in the pinned map even if the fleet list did not name it.
      targets: fixtureTargets([...new Set([...FLEET_TARGET_KEYS, `${process.platform}-${process.arch}`])])
    })
  });
}
