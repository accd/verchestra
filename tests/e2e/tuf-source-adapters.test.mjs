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
import { buildTufUpdateFixture, createUpdateKeys } from "../helpers/tuf-update-fixture.mjs";

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

test("HTTPS adapter names a reused metadata version instead of failing the target range (#391)", async () => {
  // The live-activation matrix shape (#387): two releases share one managed
  // install and one metadata version, each served under its own URL prefix.
  const keys = createUpdateKeys();
  const release = (tag) =>
    buildTufUpdateFixture({
      keys,
      semanticVersion: `0.0.0-${tag}`,
      releaseId: `release:verchestra:0.0.0-${tag}:win32-x64`
    });
  const predecessor = release("a");
  const successor = release("b");
  const local = await temporary();
  const targetRequests = [];
  const client = (fixture, prefix) => {
    const fetchRelease = repositoryFetch(fixture);
    return new TufUpdateClient({
      trustRootDirectory: join(local, "trust"),
      stagingRoot: join(local, "staging"),
      trustedRoot: fixture.trustedRoot,
      source: new HttpsDistributionSource({
        mode: "online",
        sourceId: "https-source:online:release",
        metadataBaseUrl: `https://repository.invalid/metadata/${prefix}/`,
        targetBaseUrl: `https://repository.invalid/targets/${prefix}/`,
        fetch: async (input, init) => {
          const url = new URL(input);
          if (url.pathname.startsWith("/targets/")) targetRequests.push(url.pathname);
          url.pathname = url.pathname.replace(`/${prefix}/`, "/");
          return fetchRelease(url.href, init);
        }
      }),
      chunkSize: 4096
    }).resolveAndStage({ platform: "win32", arch: "x64" });
  };
  await client(predecessor, "v1");
  targetRequests.length = 0;
  await assert.rejects(client(successor, "v2"), (error) => {
    assert.equal(error.code, "VES_TUF_STALE_METADATA");
    assert.notEqual(error.code, "VES_TUF_SOURCE_HTTP");
    assert.match(error.message, /metadata version collision/u);
    return true;
  });
  assert.deepEqual(targetRequests, []);
});

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

// invariant: a release source that stops answering ends the read with a named
// code instead of leaving `npx verchestra` waiting on the runtime's own timers.
const BASE = "https://releases.invalid/";

function httpsSource(fetch, readTimeoutMs) {
  return new HttpsDistributionSource({
    mode: "online",
    sourceId: "https:test",
    metadataBaseUrl: `${BASE}metadata/`,
    targetBaseUrl: `${BASE}targets/`,
    fetch,
    ...(readTimeoutMs === undefined ? {} : { readTimeoutMs })
  });
}

// why: a real fetch rejects with the signal's reason once it aborts; this one
// never answers otherwise.
const neverAnswers = async (_input, init) =>
  new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });

test("a stalled read fails with VES_TUF_SOURCE_TIMEOUT", async () => {
  const source = httpsSource(neverAnswers, 50);
  await assert.rejects(source.readMetadata("1.root.json", 1024), { code: "VES_TUF_SOURCE_TIMEOUT" });
  await assert.rejects(source.readTarget("bundle.tar", 0, 1024), { code: "VES_TUF_SOURCE_TIMEOUT" });
  const stalledBody = async () => new Response(new ReadableStream({ start: () => undefined }), { status: 200 });
  await assert.rejects(httpsSource(stalledBody, 50).readMetadata("1.root.json", 1024), {
    code: "VES_TUF_SOURCE_TIMEOUT"
  });
});

test("reads carry a 30000 ms abort signal and succeed within it", async (t) => {
  const bounds = [];
  const original = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", (milliseconds) => {
    bounds.push(milliseconds);
    return original(milliseconds);
  });
  const signals = [];
  const metadata = Buffer.from('{"signed":{}}');
  const target = Buffer.from("0123456789");
  const source = httpsSource(async (input, init) => {
    signals.push(init.signal);
    if (new URL(input).pathname.startsWith("/metadata/"))
      return new Response(metadata, { status: 200, headers: { "content-length": String(metadata.length) } });
    return new Response(target.subarray(0, 4), {
      status: 206,
      headers: { "content-length": "4", "content-range": `bytes 0-3/${target.length}` }
    });
  });
  assert.deepEqual(await source.readMetadata("1.root.json", 1024), metadata);
  const range = await source.readTarget("bundle.tar", 0, 4);
  assert.deepEqual(range.bytes, target.subarray(0, 4));
  assert.equal(range.totalLength, target.length);
  assert.deepEqual(bounds, [30_000, 30_000]);
  assert.equal(signals.length, 2);
  for (const signal of signals) assert.ok(signal instanceof AbortSignal && !signal.aborted);
});

test("an unbounded metadata body fails before it ends", async () => {
  let pulls = 0;
  const endless = async () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          pulls += 1;
          controller.enqueue(new Uint8Array(256));
        }
      }),
      { status: 200 }
    );
  await assert.rejects(httpsSource(endless).readMetadata("1.root.json", 1024), { code: "VES_TUF_SOURCE_LIMIT" });
  assert.ok(pulls < 64, `the body was read ${pulls} times past its 1024-byte bound`);
});
