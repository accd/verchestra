import assert from "node:assert/strict";
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

// Regression for #387. Two distinct releases that share one managed install's
// trusted root must still be publishable one-over-the-other. The failure the
// live-activation matrix caught was not an unavailable endpoint: it was two
// releases published with the SAME TUF metadataVersion. Under consistent
// snapshots both expose `1.snapshot.json`/`1.targets.json`; the persistent
// metadata cache then reuses the first release's targets and resolves a target
// hash the successor never serves. Incrementing the successor's metadataVersion
// forces a re-fetch and resolves it.
const distinctRelease = (metadataVersion, tag, keys) =>
  buildTufUpdateFixture({
    keys,
    metadataVersion,
    releaseId: `release:verchestra:0.0.0${tag}:win32-x64`,
    semanticVersion: `0.0.0${tag}`
  });

const stageOverSharedInstall = (root, fixture) =>
  new TufUpdateClient({
    trustRootDirectory: join(root, "trust"),
    stagingRoot: join(root, "staging"),
    trustedRoot: fixture.trustedRoot,
    source: new FixtureDistributionSource(fixture, { mode: "online" }),
    chunkSize: 4096
  }).resolveAndStage({ platform: "win32", arch: "x64" });

test("a successor sharing the predecessor's TUF metadataVersion cannot be staged over it (#387)", async () => {
  const keys = createUpdateKeys();
  const predecessor = distinctRelease(1, "-a", keys);
  const successor = distinctRelease(1, "-b", keys);
  // The two releases are genuinely different builds sharing one trust root.
  assert.notEqual(successor.bundle.releaseDigest, predecessor.bundle.releaseDigest);
  assert.equal(successor.trustedRoot.equals(predecessor.trustedRoot), true);

  const root = await temporary();
  const first = await stageOverSharedInstall(root, predecessor);
  assert.equal(first.releaseDigest, predecessor.bundle.releaseDigest);
  // Same metadataVersion over the cached install: the successor's own targets
  // are never reached because the stale cached metadata resolves the
  // predecessor's release-manifest hash, which the successor never serves. The
  // fixture source reports the absent hash as a partial publish; the live HTTPS
  // adapter reports the same collision as VES_TUF_SOURCE_HTTP via its 206 check
  // (the failure the live-activation matrix recorded, #387).
  await assert.rejects(stageOverSharedInstall(root, successor), (error) => {
    assert.equal(error.code, "VES_TUF_PARTIAL_PUBLISH");
    assert.match(error.cause?.message ?? "", /release\.json/u);
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
