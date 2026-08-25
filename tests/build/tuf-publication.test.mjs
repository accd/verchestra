import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { TufUpdateClient } from "../../packages/distribution/src/tuf-update-client.ts";
import {
  buildTufReleasePublication,
  writeTufReleasePublication
} from "../../packages/distribution/src/tuf-publication.ts";
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

test("writes a complete publication atomically into metadata and targets views", async () => {
  const { publication } = fixture();
  const root = await mkdtemp(join(tmpdir(), "verchestra-tuf-filesystem-"));
  const destination = join(root, "repository");
  try {
    const layout = await writeTufReleasePublication(publication, destination);
    assert.equal(layout.directory, destination);
    for (const [path, bytes] of publication.metadata) {
      assert.deepEqual(await readFile(join(layout.metadataDirectory, path)), Buffer.from(bytes));
    }
    for (const [path, bytes] of publication.targets) {
      assert.deepEqual(await readFile(join(layout.targetsDirectory, path)), Buffer.from(bytes));
    }
    await assert.rejects(() => writeTufReleasePublication(publication, destination), {
      code: "VES_TUF_PUBLICATION_DESTINATION_EXISTS"
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unsafe target paths before creating a publication directory", async () => {
  const { publication } = fixture();
  const root = await mkdtemp(join(tmpdir(), "verchestra-tuf-paths-"));
  const destination = join(root, "repository");
  const unsafe = {
    ...publication,
    targets: new Map([["../escape.bin", Buffer.from("escape")]])
  };
  try {
    await assert.rejects(() => writeTufReleasePublication(unsafe, destination), {
      code: "VES_TUF_PUBLICATION_PATH_INVALID"
    });
    await assert.rejects(() => lstat(destination), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
