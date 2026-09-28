import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { mkdtemp } from "node:fs/promises";

import { TufUpdateClient } from "../../packages/distribution/src/tuf-update-client.ts";
import { FixtureDistributionSource, buildTufUpdateFixture, createUpdateKeys } from "../helpers/tuf-update-fixture.mjs";

const roots = [];
const temporary = async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-t67-"));
  roots.push(root);
  return root;
};
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function setup(fixture = buildTufUpdateFixture(), sourceOptions = {}, clientOptions = {}) {
  const root = await temporary();
  const source = new FixtureDistributionSource(fixture, sourceOptions);
  const client = new TufUpdateClient({
    trustRootDirectory: join(root, "trust"),
    stagingRoot: join(root, "staging"),
    trustedRoot: fixture.trustedRoot,
    source,
    chunkSize: clientOptions.chunkSize ?? 17
  });
  return { root, source, client, fixture };
}

for (const mode of ["online", "mirror", "offline", "air-gapped"]) {
  test(`resolves and stages one complete release from ${mode}`, async () => {
    const { client, fixture } = await setup(buildTufUpdateFixture(), { mode });
    const result = await client.resolveAndStage({ platform: "win32", arch: "x64" });
    assert.equal(result.releaseDigest, fixture.bundle.releaseDigest);
    assert.deepEqual(result.bundle, fixture.bundle);
    assert.equal(result.sourceMode, mode);
    assert.equal(result.components.length, fixture.bundle.components.length);
    assert.equal(result.activationAllowed, false);
  });
}

test("delegated component targets resolve through the signed components role", async () => {
  const { client, source } = await setup();
  await client.resolveAndStage({ platform: "win32", arch: "x64" });
  assert.equal(
    source.reads.some(({ kind, path }) => kind === "metadata" && path.endsWith("components.json")),
    true
  );
});

test("trusted root rotates sequentially before release resolution", async () => {
  const rotatedKeys = createUpdateKeys();
  const fixture = buildTufUpdateFixture({ rootVersion: 2, rotatedKeys });
  const { client, root, source } = await setup(fixture);
  await client.resolveAndStage({ platform: "win32", arch: "x64" });
  assert.equal(
    source.reads.some(({ path }) => path === "2.root.json"),
    true
  );
  const persisted = JSON.parse(await readFile(join(root, "trust", "root.json"), "utf8"));
  assert.equal(persisted.signed.version, 2);
  assert.deepEqual(Object.keys(persisted.signed.keys).sort(), rotatedKeys.map(({ id }) => id).sort());
});

test("consistent snapshots fetch hash-prefixed target names", async () => {
  const { client, source } = await setup();
  await client.resolveAndStage({ platform: "win32", arch: "x64" });
  assert.equal(
    source.reads.some(({ kind, path }) => kind === "target" && /\/[a-f0-9]{64}\./u.test(path)),
    true
  );
});

test("a repeated staging request returns the same receipt and reuses verified component files", async () => {
  const { client, source } = await setup();
  const first = await client.resolveAndStage({ platform: "win32", arch: "x64" });
  const componentReads = source.reads.filter(
    ({ kind, path }) => kind === "target" && path.includes("components/")
  ).length;
  const second = await client.resolveAndStage({ platform: "win32", arch: "x64" });
  assert.deepEqual(second, first);
  assert.equal(
    source.reads.filter(({ kind, path }) => kind === "target" && path.includes("components/")).length,
    componentReads
  );
});

// Regression for #387 and #391. Two distinct releases that share one managed
// install's trusted root must still be publishable one-over-the-other. The
// failure the live-activation matrix caught was not an unavailable endpoint: it
// was two releases published with the SAME TUF metadataVersion. Under consistent
// snapshots both expose `1.snapshot.json`/`1.targets.json`, and tuf-js keeps its
// cached equal-version timestamp, snapshot and targets. Before #391 the client
// then resolved a target hash the successor never serves and failed as a source
// error; it now names the collision before any target is read. Incrementing the
// successor's metadataVersion forces a re-fetch and resolves it.
const distinctRelease = (metadataVersion, tag, keys) =>
  buildTufUpdateFixture({
    keys,
    metadataVersion,
    releaseId: `release:verchestra:0.0.0${tag}:win32-x64`,
    semanticVersion: `0.0.0${tag}`
  });

const stageOverSharedInstall = (root, fixture, source = new FixtureDistributionSource(fixture, { mode: "online" })) =>
  new TufUpdateClient({
    trustRootDirectory: join(root, "trust"),
    stagingRoot: join(root, "staging"),
    trustedRoot: fixture.trustedRoot,
    source,
    chunkSize: 4096
  }).resolveAndStage({ platform: "win32", arch: "x64" });

const rejectsAsVersionCollision = async (promise) =>
  assert.rejects(promise, (error) => {
    assert.equal(error.code, "VES_TUF_STALE_METADATA");
    assert.equal(error.activationAllowed, false);
    assert.match(error.message, /metadata version collision: timestamp version 1 was re-published/u);
    return true;
  });

test("a successor sharing the predecessor's TUF metadataVersion fails as a named version collision (#387, #391)", async () => {
  const keys = createUpdateKeys();
  const predecessor = distinctRelease(1, "-a", keys);
  const successor = distinctRelease(1, "-b", keys);
  // The two releases are genuinely different builds sharing one trust root.
  assert.notEqual(successor.bundle.releaseDigest, predecessor.bundle.releaseDigest);
  assert.equal(successor.trustedRoot.equals(predecessor.trustedRoot), true);

  const root = await temporary();
  const first = await stageOverSharedInstall(root, predecessor);
  assert.equal(first.releaseDigest, predecessor.bundle.releaseDigest);
  const trustedTimestamp = await readFile(join(root, "trust", "timestamp.json"));

  const source = new FixtureDistributionSource(successor, { mode: "online" });
  await rejectsAsVersionCollision(stageOverSharedInstall(root, successor, source));
  // The collision is named before a single target byte is requested, so it can
  // no longer degrade into a misleading target-fetch failure.
  assert.deepEqual(
    source.reads.filter(({ kind }) => kind === "target"),
    []
  );
  assert.equal(
    source.reads.some(({ path }) => path === "timestamp.json"),
    true
  );
  // Nothing the successor served was trusted in place of the cached view.
  assert.deepEqual(await readFile(join(root, "trust", "timestamp.json")), trustedTimestamp);
  assert.deepEqual(await readdir(join(root, "staging")), [predecessor.bundle.releaseDigest.slice("sha256:".length)]);
});

test("a version collision is still named when the cached snapshot must be re-fetched (#391)", async () => {
  const keys = createUpdateKeys();
  const predecessor = distinctRelease(1, "-a", keys);
  const successor = distinctRelease(1, "-b", keys);
  const root = await temporary();
  await stageOverSharedInstall(root, predecessor);
  // Without its cached snapshot the client re-fetches `1.snapshot.json`, which
  // the successor serves with different bytes than the trusted timestamp pins:
  // refresh fails after the timestamp step, and the cause is still the reused
  // version rather than a bare integrity failure.
  await rm(join(root, "trust", "snapshot.json"));
  await assert.rejects(stageOverSharedInstall(root, successor), (error) => {
    assert.equal(error.code, "VES_TUF_STALE_METADATA");
    assert.match(error.message, /metadata version collision/u);
    assert.notEqual(error.cause, undefined);
    return true;
  });
});

test("a successor with an incremented TUF metadataVersion stages cleanly over its predecessor (#387 fix)", async () => {
  const keys = createUpdateKeys();
  const predecessor = distinctRelease(1, "-a", keys);
  const successor = distinctRelease(2, "-b", keys);
  assert.notEqual(successor.bundle.releaseDigest, predecessor.bundle.releaseDigest);
  assert.equal(successor.trustedRoot.equals(predecessor.trustedRoot), true);

  const root = await temporary();
  await stageOverSharedInstall(root, predecessor);
  const updated = await stageOverSharedInstall(root, successor);
  assert.equal(updated.releaseDigest, successor.bundle.releaseDigest);
  // The negative control for the collision check: a genuine increment replaces
  // the trusted timestamp instead of tripping VES_TUF_STALE_METADATA.
  const persisted = JSON.parse(await readFile(join(root, "trust", "timestamp.json"), "utf8"));
  assert.equal(persisted.signed.version, 2);
  assert.deepEqual(await readFile(join(root, "trust", "timestamp.json")), successor.metadata.get("timestamp.json"));
});

// #393. After a successor advances the shared metadata cache, staging the
// predecessor again is a metadata downgrade. The client must keep refusing it:
// the launcher's retained-release path (AD-036) never asks the client, so
// nothing about this refusal may soften.
test("re-staging a predecessor after its successor advanced the cache is refused as a rollback (#393)", async () => {
  const keys = createUpdateKeys();
  const predecessor = distinctRelease(1, "-a", keys);
  const successor = distinctRelease(2, "-b", keys);
  const root = await temporary();
  await stageOverSharedInstall(root, predecessor);
  await stageOverSharedInstall(root, successor);
  await assert.rejects(stageOverSharedInstall(root, predecessor), (error) => {
    assert.equal(error.code, "VES_TUF_ROLLBACK");
    assert.match(error.cause?.message ?? "", /version 1 is less than current version 2/u);
    return true;
  });
});

test("the trust-anchor probe reads only the local anchor and creates nothing", async () => {
  const { root, source, client, fixture } = await setup();
  assert.equal(await client.trustAnchored(), false, "an unanchored machine is not anchored");
  await assert.rejects(stat(join(root, "trust")), { code: "ENOENT" });
  await client.resolveAndStage({ platform: "win32", arch: "x64" });
  const reads = source.reads.length;
  assert.equal(await client.trustAnchored(), true);
  assert.equal(source.reads.length, reads, "probing the anchor never reads the source");
  assert.equal(client.trustRootDigest, `sha256:${createHash("sha256").update(fixture.trustedRoot).digest("hex")}`);
});

test("staged bytes exactly match every TUF-bound component", async () => {
  const { client, fixture, root } = await setup();
  await client.resolveAndStage({ platform: "win32", arch: "x64" });
  const stage = join(root, "staging", fixture.bundle.releaseDigest.slice("sha256:".length));
  for (const component of fixture.bundle.components) {
    assert.deepEqual(
      await readFile(join(stage, component.logicalPath)),
      fixture.componentBytes.get(component.logicalPath)
    );
  }
});

test("both canonical launchers are independently staged and measured", async () => {
  const { client, fixture, root } = await setup();
  const result = await client.resolveAndStage({ platform: "win32", arch: "x64" });
  const stage = join(root, "staging", fixture.bundle.releaseDigest.slice("sha256:".length));
  assert.equal((await stat(join(stage, "bin", "vestra.cmd"))).isFile(), true);
  assert.equal((await stat(join(stage, "bin", "verchestra.cmd"))).isFile(), true);
  assert.deepEqual(
    result.components
      .filter(({ componentId }) => componentId.startsWith("launcher:"))
      .map(({ componentId }) => componentId),
    ["launcher:verchestra", "launcher:vestra"]
  );
});

test("staged receipt is content-addressed, immutable, and contains no machine path", async () => {
  const { client, fixture, root } = await setup();
  const result = await client.resolveAndStage({ platform: "win32", arch: "x64" });
  assert.equal(result.stageId, `stage:${fixture.bundle.releaseDigest}`);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.components), true);
  assert.equal(JSON.stringify(result).includes(root), false);
});

test("staging writes only beneath the release digest directory", async () => {
  const { client, fixture, root } = await setup();
  await client.resolveAndStage({ platform: "win32", arch: "x64" });
  assert.deepEqual(await readdir(join(root, "staging")), [fixture.bundle.releaseDigest.slice("sha256:".length)]);
});

test("a compatible non-consistent-snapshot repository still stages through TUF", async () => {
  const fixture = buildTufUpdateFixture({ consistentSnapshot: false });
  const { client, source } = await setup(fixture);
  await client.resolveAndStage({ platform: "win32", arch: "x64" });
  assert.equal(
    source.reads.some(({ kind, path }) => kind === "target" && /[a-f0-9]{64}\./u.test(path)),
    false
  );
});

test("receipt source identity is local configuration rather than repository-controlled content", async () => {
  const { client } = await setup(buildTufUpdateFixture(), { sourceId: "mirror:team-a:approved" });
  const result = await client.resolveAndStage({ platform: "win32", arch: "x64" });
  assert.equal(result.sourceId, "mirror:team-a:approved");
});

test("a staged component carries the executability its bundle declares", async () => {
  const { client, fixture, root } = await setup();
  const staged = await client.resolveAndStage({ platform: "win32", arch: "x64" });
  const stageRoot = join(root, "staging", staged.releaseDigest.slice("sha256:".length));
  const executable = fixture.bundle.components.filter((component) => component.executable);
  const inert = fixture.bundle.components.filter((component) => !component.executable);
  assert.ok(executable.length > 0);
  assert.ok(inert.length > 0);
  // This discriminates on POSIX only. Node's chmod on Windows toggles just the
  // read-only bit, so both branches read 0o666 there and a mutant that always
  // wrote 0o600 would survive a Windows-only run. Linux and macOS CI carry the
  // real signal, which is also where the defect could actually strand a user:
  // a non-executable staged runtime the activation health gate cannot spawn.
  for (const component of executable) {
    const mode = (await stat(join(stageRoot, component.logicalPath))).mode & 0o777;
    assert.equal(mode, process.platform === "win32" ? 0o666 : 0o700, component.componentId);
  }
  for (const component of inert) {
    const mode = (await stat(join(stageRoot, component.logicalPath))).mode & 0o777;
    assert.equal(mode, process.platform === "win32" ? 0o666 : 0o600, component.componentId);
  }
});
