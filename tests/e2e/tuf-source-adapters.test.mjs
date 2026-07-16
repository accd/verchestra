import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import {
  HttpsDistributionSource,
  NodeFilesystemDistributionSource,
  TufUpdateClient
} from "../../packages/distribution/src/tuf-update-client.ts";
import { buildTufUpdateFixture } from "../helpers/tuf-update-fixture.mjs";

const roots = [];
const temporary = async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-t67-source-"));
  roots.push(root);
  return root;
};
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function materialize(root, fixture) {
  for (const [path, bytes] of fixture.metadata) {
    const target = join(root, "metadata", ...path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  for (const [path, bytes] of fixture.targets) {
    const target = join(root, "targets", ...path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

function repositoryFetch(fixture, faults = {}) {
  return async (input, init = {}) => {
    const url = new URL(input);
    const parts = url.pathname.split("/").filter(Boolean);
    const area = parts.shift();
    const path = parts.map(decodeURIComponent).join("/");
    if (faults.redirect) return new Response(null, { status: 302, headers: { location: "https://evil.invalid/" } });
    if (area === "metadata") {
      const bytes = fixture.metadata.get(path);
      if (!bytes) return new Response(null, { status: 404 });
      return new Response(bytes, {
        status: 200,
        headers: { "content-length": String(faults.metadataLength ?? bytes.length) }
      });
    }
    const bytes = fixture.targets.get(path);
    if (!bytes) return new Response(null, { status: 404 });
    const match = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(init.headers).get("range") ?? "");
    if (!match) return new Response(null, { status: 416 });
    const start = Number(match[1]);
    const requestedEnd = Number(match[2]);
    const end = Math.min(requestedEnd, bytes.length - 1);
    const chunk = bytes.subarray(start, end + 1);
    return new Response(chunk, {
      status: 206,
      headers: {
        "content-length": String(chunk.length),
        "content-range": faults.contentRange ?? `bytes ${start}-${end}/${bytes.length}`
      }
    });
  };
}

async function stageWith(source, fixture) {
  const local = await temporary();
  const client = new TufUpdateClient({
    trustRootDirectory: join(local, "trust"),
    stagingRoot: join(local, "staging"),
    trustedRoot: fixture.trustedRoot,
    source,
    chunkSize: 23
  });
  return client.resolveAndStage({ platform: "win32", arch: "x64" });
}

for (const mode of ["mirror", "offline", "air-gapped"]) {
  test(`filesystem ${mode} adapter stages a complete verified release`, async () => {
    const fixture = buildTufUpdateFixture();
    const root = await temporary();
    await materialize(root, fixture);
    const result = await stageWith(
      new NodeFilesystemDistributionSource({ mode, sourceId: `filesystem:${mode}:team`, root }),
      fixture
    );
    assert.equal(result.releaseDigest, fixture.bundle.releaseDigest);
    assert.equal(result.sourceMode, mode);
  });
}

for (const mode of ["online", "mirror"]) {
  test(`HTTPS ${mode} adapter stages a complete range-verified release`, async () => {
    const fixture = buildTufUpdateFixture();
    const result = await stageWith(
      new HttpsDistributionSource({
        mode,
        sourceId: `https-source:${mode}:team`,
        metadataBaseUrl: "https://repository.invalid/metadata/",
        targetBaseUrl: "https://repository.invalid/targets/",
        fetch: repositoryFetch(fixture)
      }),
      fixture
    );
    assert.equal(result.releaseDigest, fixture.bundle.releaseDigest);
    assert.equal(result.sourceMode, mode);
  });
}

test("filesystem adapter rejects lexical traversal before opening a file", async () => {
  const root = await temporary();
  const source = new NodeFilesystemDistributionSource({ mode: "offline", sourceId: "offline:safe", root });
  await assert.rejects(source.readMetadata("../secret", 1024), { code: "VES_TUF_SOURCE_PATH_INVALID" });
});

for (const path of ["CON", "metadata."]) {
  test(`filesystem adapter rejects Windows-ambiguous repository path: ${path}`, async () => {
    const root = await temporary();
    const source = new NodeFilesystemDistributionSource({ mode: "offline", sourceId: "offline:safe", root });
    await assert.rejects(source.readMetadata(path, 1024), { code: "VES_TUF_SOURCE_PATH_INVALID" });
  });
}

test("filesystem adapter rejects a repository root junction", async () => {
  const parent = await temporary();
  const outside = join(parent, "outside-root");
  const linkedRoot = join(parent, "linked-root");
  await mkdir(join(outside, "metadata"), { recursive: true });
  await writeFile(join(outside, "metadata", "timestamp.json"), "{}");
  await symlink(outside, linkedRoot, "junction");
  const source = new NodeFilesystemDistributionSource({
    mode: "offline",
    sourceId: "offline:root-bound",
    root: linkedRoot
  });
  await assert.rejects(source.readMetadata("timestamp.json", 1024), { code: "VES_TUF_SOURCE_PATH_INVALID" });
});

test("filesystem adapter rejects a target symlink before reading outside the repository", async () => {
  const root = await temporary();
  const outside = join(root, "outside");
  const linked = join(root, "targets", "linked");
  await mkdir(outside, { recursive: true });
  await mkdir(dirname(linked), { recursive: true });
  await writeFile(join(outside, "secret.bin"), "secret");
  await symlink(outside, linked, "junction");
  const source = new NodeFilesystemDistributionSource({ mode: "air-gapped", sourceId: "airgap:safe", root });
  await assert.rejects(source.readTarget("linked/secret.bin", 0, 32), { code: "VES_TUF_SOURCE_PATH_INVALID" });
});

test("filesystem metadata read enforces the caller-provided TUF bound", async () => {
  const root = await temporary();
  await mkdir(join(root, "metadata"), { recursive: true });
  await writeFile(join(root, "metadata", "timestamp.json"), "12345");
  const source = new NodeFilesystemDistributionSource({ mode: "mirror", sourceId: "mirror:bounded", root });
  await assert.rejects(source.readMetadata("timestamp.json", 4), { code: "VES_TUF_SOURCE_LIMIT" });
});

for (const url of ["http://repository.invalid/", "https://user:secret@repository.invalid/"]) {
  test(`HTTPS adapter rejects unsafe base URL: ${url}`, () => {
    assert.throws(
      () =>
        new HttpsDistributionSource({
          mode: "online",
          sourceId: "online:safe",
          metadataBaseUrl: url,
          targetBaseUrl: "https://repository.invalid/targets/"
        }),
      { code: "VES_TUF_SOURCE_INVALID" }
    );
  });
}

test("HTTPS metadata adapter rejects redirects", async () => {
  const fixture = buildTufUpdateFixture();
  const source = new HttpsDistributionSource({
    mode: "online",
    sourceId: "online:no-redirect",
    metadataBaseUrl: "https://repository.invalid/metadata/",
    targetBaseUrl: "https://repository.invalid/targets/",
    fetch: repositoryFetch(fixture, { redirect: true })
  });
  await assert.rejects(source.readMetadata("timestamp.json", 1_000_000), { code: "VES_TUF_SOURCE_HTTP" });
});

test("HTTPS target adapter rejects a malformed Content-Range", async () => {
  const fixture = buildTufUpdateFixture();
  const [path] = fixture.targets.keys();
  const source = new HttpsDistributionSource({
    mode: "online",
    sourceId: "online:range",
    metadataBaseUrl: "https://repository.invalid/metadata/",
    targetBaseUrl: "https://repository.invalid/targets/",
    fetch: repositoryFetch(fixture, { contentRange: "bytes 9-1/2" })
  });
  await assert.rejects(source.readTarget(path, 0, 16), { code: "VES_TUF_SOURCE_HTTP_INVALID" });
});

test("HTTPS metadata adapter rejects declared length above its bound before consuming bytes", async () => {
  const fixture = buildTufUpdateFixture();
  const source = new HttpsDistributionSource({
    mode: "mirror",
    sourceId: "mirror:bounded",
    metadataBaseUrl: "https://repository.invalid/metadata/",
    targetBaseUrl: "https://repository.invalid/targets/",
    fetch: repositoryFetch(fixture, { metadataLength: 2_000_000 })
  });
  await assert.rejects(source.readMetadata("timestamp.json", 1_000_000), { code: "VES_TUF_SOURCE_LIMIT" });
});
