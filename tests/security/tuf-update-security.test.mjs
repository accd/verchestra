import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { TufUpdateClient } from "../../packages/distribution/src/tuf-update-client.ts";
import { FixtureDistributionSource, buildTufUpdateFixture, createUpdateKeys } from "../helpers/tuf-update-fixture.mjs";

const roots = [];
const temporary = async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-t67-security-"));
  roots.push(root);
  return root;
};
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function clientFor(fixture, sourceOptions = {}, options = {}) {
  const root = options.root ?? (await temporary());
  const source = new FixtureDistributionSource(fixture, sourceOptions);
  const client = new TufUpdateClient({
    trustRootDirectory: join(root, "trust"),
    stagingRoot: join(root, "staging"),
    trustedRoot: options.trustedRoot ?? fixture.trustedRoot,
    source,
    chunkSize: options.chunkSize ?? 19
  });
  return { client, root, source };
}

const stage = (client, request = { platform: "win32", arch: "x64" }) => client.resolveAndStage(request);
const rejected = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    assert.equal(error.activationAllowed, false);
    return true;
  });
};

test("invalid source mode is rejected before trust or staging effects", async () => {
  const fixture = buildTufUpdateFixture();
  const root = await temporary();
  assert.throws(
    () =>
      new TufUpdateClient({
        trustRootDirectory: join(root, "trust"),
        stagingRoot: join(root, "staging"),
        trustedRoot: fixture.trustedRoot,
        source: new FixtureDistributionSource(fixture, { mode: "network-ish" })
      }),
    { code: "VES_TUF_SOURCE_INVALID" }
  );
});

for (const sourceId of ["", "https://user:secret@example.invalid", "source with spaces"]) {
  test(`unsafe source identity is rejected: ${sourceId || "empty"}`, async () => {
    const fixture = buildTufUpdateFixture();
    const root = await temporary();
    assert.throws(
      () =>
        new TufUpdateClient({
          trustRootDirectory: join(root, "trust"),
          stagingRoot: join(root, "staging"),
          trustedRoot: fixture.trustedRoot,
          source: new FixtureDistributionSource(fixture, { sourceId })
        }),
      { code: "VES_TUF_SOURCE_INVALID" }
    );
  });
}

for (const chunkSize of [0, -1, 16 * 1024 * 1024 + 1, 1.5]) {
  test(`invalid download chunk size is rejected: ${chunkSize}`, async () => {
    const fixture = buildTufUpdateFixture();
    const root = await temporary();
    assert.throws(
      () =>
        new TufUpdateClient({
          trustRootDirectory: join(root, "trust"),
          stagingRoot: join(root, "staging"),
          trustedRoot: fixture.trustedRoot,
          source: new FixtureDistributionSource(fixture),
          chunkSize
        }),
      { code: "VES_TUF_SOURCE_INVALID" }
    );
  });
}

test("empty bootstrap trust root is rejected", async () => {
  const fixture = buildTufUpdateFixture();
  const root = await temporary();
  assert.throws(
    () =>
      new TufUpdateClient({
        trustRootDirectory: join(root, "trust"),
        stagingRoot: join(root, "staging"),
        trustedRoot: Buffer.alloc(0),
        source: new FixtureDistributionSource(fixture)
      }),
    { code: "VES_TUF_TRUST_ROOT_INVALID" }
  );
});

for (const request of [
  { platform: "freebsd", arch: "x64" },
  { platform: "win32", arch: "ia32" }
]) {
  test(`unsupported requested target fails closed: ${request.platform}-${request.arch}`, async () => {
    const { client } = await clientFor(buildTufUpdateFixture());
    await rejected(stage(client, request), "VES_TUF_TARGET_INVALID");
  });
}

test("metadata below its signature threshold is rejected", async () => {
  const { client } = await clientFor(buildTufUpdateFixture({ threshold: 2, signatureCount: 1 }));
  await rejected(stage(client), "VES_TUF_THRESHOLD");
});

for (const role of ["timestamp", "snapshot", "targets", "components"]) {
  test(`corrupt ${role} signature is rejected`, async () => {
    const { client } = await clientFor(buildTufUpdateFixture({ corruptRole: role }));
    await rejected(stage(client), "VES_TUF_THRESHOLD");
  });
}

for (const role of ["root", "timestamp", "snapshot", "targets", "delegated"]) {
  test(`expired ${role} metadata is rejected as freeze: ${role}`, async () => {
    const { client } = await clientFor(buildTufUpdateFixture({ expires: { [role]: "2020-01-01T00:00:00.000Z" } }));
    await rejected(stage(client), "VES_TUF_EXPIRED");
  });
}

for (const [field, value] of [
  ["releaseId", "release:foreign"],
  ["releaseDigest", `sha256:${"0".repeat(64)}`],
  ["platform", "linux"],
  ["arch", "arm64"]
]) {
  test(`release target custom ${field} cannot contradict the manifest`, async () => {
    const fixture = buildTufUpdateFixture({ releaseCustomOverrides: { [field]: value } });
    const { client } = await clientFor(fixture);
    await rejected(stage(client), "VES_TUF_RELEASE_VIEW_MIXED");
  });
}

for (const [field, value] of [
  ["releaseId", "release:foreign"],
  ["componentId", "component:substituted"],
  ["contentDigest", `sha256:${"1".repeat(64)}`]
]) {
  test(`component provenance ${field} cannot contradict the bundle`, async () => {
    const fixture = buildTufUpdateFixture({
      componentCustomOverrides: { "core:verchestra": { [field]: value } }
    });
    const { client } = await clientFor(fixture);
    await rejected(stage(client), "VES_TUF_PROVENANCE_MISMATCH");
  });
}

test("TUF target length cannot contradict the Hermetic Bundle", async () => {
  const fixture = buildTufUpdateFixture({
    consistentSnapshot: false,
    componentMetadataOverrides: { "core:verchestra": { length: 9999 } }
  });
  const { client } = await clientFor(fixture);
  await rejected(stage(client), "VES_TUF_RELEASE_VIEW_MIXED");
});

test("TUF target hash cannot contradict the Hermetic Bundle", async () => {
  const fixture = buildTufUpdateFixture({
    consistentSnapshot: false,
    componentMetadataOverrides: { "core:verchestra": { hashes: { sha256: "0".repeat(64) } } }
  });
  const { client } = await clientFor(fixture);
  await rejected(stage(client), "VES_TUF_RELEASE_VIEW_MIXED");
});

test("corrupt target bytes fail TUF integrity before a stage receipt exists", async () => {
  const fixture = buildTufUpdateFixture({ targetByteOverrides: { "components/core-verchestra": "corrupt" } });
  const { client } = await clientFor(fixture);
  await rejected(stage(client), "VES_TUF_LENGTH_MISMATCH");
});

test("invalid but TUF-signed release JSON cannot become a bundle", async () => {
  const fixture = buildTufUpdateFixture({ manifestBytes: "{not-json" });
  const { client } = await clientFor(fixture);
  await rejected(stage(client), "VES_TUF_BUNDLE_INVALID");
});

test("missing delegated metadata is a partial publication", async () => {
  const fixture = buildTufUpdateFixture({ omitMetadata: ["1.components.json"] });
  const { client } = await clientFor(fixture);
  await rejected(stage(client), "VES_TUF_PARTIAL_PUBLISH");
});

test("missing component target is a partial publication", async () => {
  const fixture = buildTufUpdateFixture({ omitTargets: ["components/core-verchestra"] });
  const { client } = await clientFor(fixture);
  await rejected(stage(client), "VES_TUF_PARTIAL_PUBLISH");
});

test("a pinned bootstrap root cannot be replaced by caller-controlled root bytes", async () => {
  const first = buildTufUpdateFixture();
  const { client, root } = await clientFor(first);
  await stage(client);
  const second = buildTufUpdateFixture();
  const replacement = await clientFor(second, {}, { root, trustedRoot: second.trustedRoot });
  await rejected(stage(replacement.client), "VES_TUF_TRUST_ROOT_MISMATCH");
});

test("the trust-anchor probe refuses a replaced anchor instead of reporting it unanchored", async () => {
  const { client, root } = await clientFor(buildTufUpdateFixture());
  await stage(client);
  const second = buildTufUpdateFixture();
  const replacement = await clientFor(second, {}, { root, trustedRoot: second.trustedRoot });
  await rejected(replacement.client.trustAnchored(), "VES_TUF_TRUST_ROOT_MISMATCH");
  assert.equal(replacement.source.reads.length, 0);
});

test("the trust-anchor probe refuses a symbolic-link anchor", async () => {
  const fixture = buildTufUpdateFixture();
  const root = await temporary();
  const outside = join(root, "outside");
  await mkdir(outside);
  await symlink(outside, join(root, "trust"), "junction");
  const { client } = await clientFor(fixture, {}, { root });
  await rejected(client.trustAnchored(), "VES_TUF_STAGE_PATH_INVALID");
});

test("older metadata is rejected after a newer trusted view", async () => {
  const keys = createUpdateKeys();
  const newer = buildTufUpdateFixture({ keys, metadataVersion: 2 });
  const { client, root } = await clientFor(newer);
  await stage(client);
  const older = buildTufUpdateFixture({ keys, metadataVersion: 1 });
  const retry = await clientFor(older, {}, { root, trustedRoot: newer.trustedRoot });
  await rejected(stage(retry.client), "VES_TUF_ROLLBACK");
});

// #391 precision: the metadata-version collision check must name exactly one
// situation, a signed equal-version timestamp with different content. Every
// neighbouring case keeps its own code or still succeeds.
const collisionFixtures = (keys, options = {}) => ({
  predecessor: buildTufUpdateFixture({
    keys,
    semanticVersion: "0.0.0-a",
    releaseId: "release:verchestra:0.0.0-a:win32-x64"
  }),
  successor: buildTufUpdateFixture({
    keys,
    semanticVersion: "0.0.0-b",
    releaseId: "release:verchestra:0.0.0-b:win32-x64",
    ...options
  })
});

test("a replayed older release is still a rollback, not a version collision (#391)", async () => {
  const keys = createUpdateKeys();
  const older = buildTufUpdateFixture({ keys, metadataVersion: 1 });
  const newer = buildTufUpdateFixture({
    keys,
    metadataVersion: 2,
    semanticVersion: "1.0.1",
    releaseId: "release:verchestra:1.0.1:win32-x64"
  });
  const { client, root } = await clientFor(older);
  await stage(client);
  await stage((await clientFor(newer, {}, { root })).client);
  // The genuine, validly signed version-1 metadata served again after version 2
  // was trusted: an anti-rollback rejection, never a collision.
  const replay = await clientFor(older, {}, { root });
  await rejected(stage(replay.client), "VES_TUF_ROLLBACK");
  const persisted = JSON.parse(await readFile(join(root, "trust", "timestamp.json"), "utf8"));
  assert.equal(persisted.signed.version, 2);
});

test("identical metadata served again is accepted without a collision (#391)", async () => {
  const fixture = buildTufUpdateFixture();
  const { client, root } = await clientFor(fixture);
  const first = await stage(client);
  const trusted = await readFile(join(root, "trust", "timestamp.json"));
  const again = await clientFor(fixture, {}, { root });
  assert.deepEqual(await stage(again.client), first);
  assert.deepEqual(await readFile(join(root, "trust", "timestamp.json")), trusted);
});

test("an unsigned equal-version timestamp is a signature failure, not a version collision (#391)", async () => {
  const { predecessor, successor } = collisionFixtures(createUpdateKeys(), { corruptRole: "timestamp" });
  const { client, root } = await clientFor(predecessor);
  await stage(client);
  // Same version, different content, but not signed by the trusted timestamp
  // keys: tuf-js rejects it before any version comparison, and the collision
  // check must not relabel a forgery as a publisher mistake.
  const forged = await clientFor(successor, {}, { root });
  await rejected(stage(forged.client), "VES_TUF_THRESHOLD");
});

test("an equal-version timestamp accepted under a rotated root is not a collision (#391)", async () => {
  const keys = createUpdateKeys();
  const { predecessor, successor } = collisionFixtures(keys, { rootVersion: 2, rotatedKeys: createUpdateKeys() });
  assert.equal(successor.trustedRoot.equals(predecessor.trustedRoot), true);
  const { client, root } = await clientFor(predecessor);
  await stage(client);
  // The rotated root no longer trusts the cached timestamp's keys, so tuf-js
  // discards the cache and accepts the successor's version-1 timestamp. The
  // version number matches the cached one, yet nothing stale is in use: the
  // update must succeed.
  const rotated = await clientFor(successor, {}, { root });
  const staged = await stage(rotated.client);
  assert.equal(staged.releaseDigest, successor.bundle.releaseDigest);
  assert.deepEqual(await readFile(join(root, "trust", "timestamp.json")), successor.metadata.get("timestamp.json"));
});

test("snapshot-to-targets mix-and-match metadata is rejected", async () => {
  const fixture = buildTufUpdateFixture({ targetsMetaOverrides: { hashes: { sha256: "0".repeat(64) } } });
  const { client } = await clientFor(fixture);
  await rejected(stage(client), "VES_TUF_INTEGRITY");
});

test("timestamp-to-snapshot mix-and-match metadata is rejected", async () => {
  const fixture = buildTufUpdateFixture({ snapshotMetaOverrides: { length: 1 } });
  const { client } = await clientFor(fixture);
  await rejected(stage(client), "VES_TUF_INTEGRITY");
});

test("snapshot-to-delegated-role mix-and-match metadata is rejected", async () => {
  const fixture = buildTufUpdateFixture({ delegatedMetaOverrides: { hashes: { sha256: "f".repeat(64) } } });
  const { client } = await clientFor(fixture);
  await rejected(stage(client), "VES_TUF_INTEGRITY");
});

test("pre-existing staging directory junction cannot redirect component writes", async () => {
  const fixture = buildTufUpdateFixture();
  const { client, root } = await clientFor(fixture);
  const stageRoot = join(root, "staging", fixture.bundle.releaseDigest.slice("sha256:".length));
  const outside = join(root, "outside");
  await mkdir(stageRoot, { recursive: true });
  await mkdir(outside);
  await symlink(outside, join(stageRoot, "components"), "junction");
  await rejected(stage(client), "VES_TUF_STAGE_PATH_INVALID");
  assert.deepEqual(await readdir(outside), []);
});
