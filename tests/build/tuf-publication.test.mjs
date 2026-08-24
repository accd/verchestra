import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { TufUpdateClient } from "../../packages/distribution/src/tuf-update-client.ts";
import { buildTufReleasePublication } from "../../packages/distribution/src/tuf-publication.ts";
import { fixture, MapDistributionSource } from "../helpers/tuf-publication-fixture.mjs";

const resolvePublication = async (publication, mode) => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-tuf-publication-"));
  const client = new TufUpdateClient({
    trustRootDirectory: join(root, "trust"),
    stagingRoot: join(root, "staging"),
    trustedRoot: publication.trustedRoot,
    source: new MapDistributionSource(publication, mode),
    chunkSize: 17
  });
  try {
    return await client.resolveAndStage({ platform: "win32", arch: "x64" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("publishes a signed root, delegated components, and a complete bundle", async () => {
  const { bundle, publication } = fixture();
  assert.equal(publication.releaseDigest, bundle.releaseDigest);
  assert.equal(publication.metadata.has("root.json"), true);
  assert.equal(publication.metadata.has("1.components.json"), true);
  assert.equal(publication.targets.size, bundle.components.length + 1);
  for (const mode of ["online", "mirror", "offline", "air-gapped"]) {
    const staged = await resolvePublication(publication, mode);
    assert.equal(staged.releaseDigest, bundle.releaseDigest);
    assert.equal(staged.sourceMode, mode);
    assert.deepEqual(staged.bundle, bundle);
    assert.equal(staged.components.length, bundle.components.length);
  }
});

test("publication identity is independent of component descriptor order", () => {
  const { candidate, componentBytes, signers, publication } = fixture();
  const reversed = buildTufReleasePublication({
    schemaVersion: 1,
    candidate,
    componentBytes: [...componentBytes].reverse(),
    metadataVersion: 1,
    expires: "2035-01-01T00:00:00.000Z",
    threshold: 2,
    signers,
    consistentSnapshot: true
  });
  assert.equal(Buffer.from(publication.trustedRoot).toString("hex"), Buffer.from(reversed.trustedRoot).toString("hex"));
  assert.deepEqual([...publication.metadata], [...reversed.metadata]);
  assert.deepEqual([...publication.targets], [...reversed.targets]);
});

test("publication can emit non-consistent-snapshot paths without changing the bundle", async () => {
  const { bundle, candidate, componentBytes, signers } = fixture();
  const publication = buildTufReleasePublication({
    schemaVersion: 1,
    candidate,
    componentBytes,
    metadataVersion: 1,
    expires: "2035-01-01T00:00:00.000Z",
    threshold: 2,
    signers,
    consistentSnapshot: false
  });
  const staged = await resolvePublication(publication, "offline");
  assert.equal(staged.releaseDigest, bundle.releaseDigest);
  assert.equal(publication.targets.has(publication.manifestPath), true);
});
