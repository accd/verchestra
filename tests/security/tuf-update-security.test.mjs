import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
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

test("older metadata is rejected after a newer trusted view", async () => {
  const keys = createUpdateKeys();
  const newer = buildTufUpdateFixture({ keys, metadataVersion: 2 });
  const { client, root } = await clientFor(newer);
  await stage(client);
  const older = buildTufUpdateFixture({ keys, metadataVersion: 1 });
  const retry = await clientFor(older, {}, { root, trustedRoot: newer.trustedRoot });
  await rejected(stage(retry.client), "VES_TUF_ROLLBACK");
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
