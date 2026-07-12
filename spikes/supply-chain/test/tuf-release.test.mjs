import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { QUALIFIED_TUF, TufReleaseResolver } from "../src/tuf-release.mjs";
import { REQUIRED_COMPONENTS, buildTufFixture, createTufKeys } from "./tuf-fixture.mjs";

const roots = [];
async function tempRoot() {
  const value = await mkdtemp(join(tmpdir(), "verchestra-tuf-"));
  roots.push(value);
  return value;
}
afterEach(async () => Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true }))));

async function resolver(fixture, existingRoot) {
  const root = existingRoot ?? await tempRoot();
  return { root, client: new TufReleaseResolver({ root, trustedRoot: fixture.root, repository: fixture }) };
}

test("pins the latest tuf-js release compatible with qualified Node 24.14.0", () => {
  assert.deepEqual(QUALIFIED_TUF, { package: "tuf-js", version: "5.0.1", node: "24.14.0", latestIneligible: "6.0.0", reason: "requires Node ^24.15.0" });
});

for (const sourceMode of ["online", "mirror", "offline", "air-gapped"]) {
  test(`resolves one complete verified release view in ${sourceMode} mode`, async () => {
    const fixture = buildTufFixture();
    const { client } = await resolver(fixture);
    const view = await client.resolve({ sourceMode, platform: "win32-x64" });
    assert.equal(view.releaseId, "1.0.0");
    assert.equal(view.sourceMode, sourceMode);
    assert.deepEqual(view.components.map((component) => component.name), REQUIRED_COMPONENTS);
    assert.equal(view.components.every((component) => component.verified === true), true);
  });
}

test("rejects a metadata rollback after a newer trusted view", async () => {
  const keys = createTufKeys();
  const newer = buildTufFixture({ keys, version: 2, releaseId: "2.0.0" });
  const { root, client } = await resolver(newer);
  await client.resolve({ sourceMode: "online", platform: "win32-x64" });
  const older = buildTufFixture({ keys, version: 1, releaseId: "1.0.0" });
  const rollback = new TufReleaseResolver({ root, trustedRoot: older.root, repository: older });
  await assert.rejects(() => rollback.resolve({ sourceMode: "online", platform: "win32-x64" }), { code: "VES_TUF_ROLLBACK", activationAllowed: false });
});

for (const role of ["timestamp", "snapshot", "targets"]) {
  test(`rejects expired ${role} metadata as a freeze attack`, async () => {
    const fixture = buildTufFixture({ expires: { [role]: "2020-01-01T00:00:00.000Z" } });
    const { client } = await resolver(fixture);
    await assert.rejects(() => client.resolve({ sourceMode: "online", platform: "win32-x64" }), { code: "VES_TUF_EXPIRED", activationAllowed: false });
  });
}

test("rejects an expired trusted root", async () => {
  const fixture = buildTufFixture({ expires: { root: "2020-01-01T00:00:00.000Z" } });
  const { client } = await resolver(fixture);
  await assert.rejects(() => client.resolve({ sourceMode: "online", platform: "win32-x64" }), { code: "VES_TUF_EXPIRED", activationAllowed: false });
});

test("rejects metadata below the trusted signature threshold", async () => {
  const fixture = buildTufFixture({ threshold: 2, signatureCount: 1 });
  const { client } = await resolver(fixture);
  await assert.rejects(() => client.resolve({ sourceMode: "online", platform: "win32-x64" }), { code: "VES_TUF_THRESHOLD", activationAllowed: false });
});

test("rejects a corrupt metadata signature", async () => {
  const fixture = buildTufFixture({ corruptTimestampSignature: true });
  const { client } = await resolver(fixture);
  await assert.rejects(() => client.resolve({ sourceMode: "online", platform: "win32-x64" }), { code: "VES_TUF_THRESHOLD", activationAllowed: false });
});

test("rejects snapshot-to-targets mix-and-match metadata", async () => {
  const fixture = buildTufFixture({ snapshotHashOverride: "0".repeat(64) });
  const { client } = await resolver(fixture);
  await assert.rejects(() => client.resolve({ sourceMode: "online", platform: "win32-x64" }), { code: "VES_TUF_INTEGRITY", activationAllowed: false });
});

test("rejects a target whose bytes do not match TUF metadata", async () => {
  const fixture = buildTufFixture({ corruptTargetPath: "components/core.bin" });
  const { client } = await resolver(fixture);
  await assert.rejects(() => client.resolve({ sourceMode: "online", platform: "win32-x64" }), { code: "VES_TUF_INTEGRITY", activationAllowed: false });
});

test("rejects a release manifest for another platform", async () => {
  const fixture = buildTufFixture({ platform: "linux-x64" });
  const { client } = await resolver(fixture);
  await assert.rejects(() => client.resolve({ sourceMode: "online", platform: "win32-x64" }), { code: "VES_RELEASE_PLATFORM_MISMATCH", activationAllowed: false });
});

test("rejects a manifest that mixes component release views", async () => {
  const fixture = buildTufFixture({ componentReleaseOverrides: { drivers: "0.9.0" } });
  const { client } = await resolver(fixture);
  await assert.rejects(() => client.resolve({ sourceMode: "online", platform: "win32-x64" }), { code: "VES_RELEASE_VIEW_MIXED", activationAllowed: false });
});

test("rejects a manifest missing any required release component", async () => {
  const fixture = buildTufFixture({ omitComponents: ["sbom"] });
  const { client } = await resolver(fixture);
  await assert.rejects(() => client.resolve({ sourceMode: "online", platform: "win32-x64" }), { code: "VES_RELEASE_COMPONENT_MISSING", component: "sbom", activationAllowed: false });
});

test("rejects a partially published target closure", async () => {
  const fixture = buildTufFixture({ omitTargetPath: "components/licenses.bin" });
  const { client } = await resolver(fixture);
  await assert.rejects(() => client.resolve({ sourceMode: "online", platform: "win32-x64" }), { code: "VES_TUF_PARTIAL_PUBLISH", activationAllowed: false });
});

test("rejects a repository missing top-level metadata", async () => {
  const fixture = buildTufFixture();
  fixture.metadata.delete("targets.json");
  const { client } = await resolver(fixture);
  await assert.rejects(() => client.resolve({ sourceMode: "online", platform: "win32-x64" }), { code: "VES_TUF_PARTIAL_PUBLISH", activationAllowed: false });
});
