import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import { TufUpdateClient } from "../../packages/distribution/src/tuf-update-client.ts";
import { FixtureDistributionSource, buildTufUpdateFixture } from "../helpers/tuf-update-fixture.mjs";

const roots = [];
const temporary = async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-t67-fault-"));
  roots.push(root);
  return root;
};
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function setup(sourceOptions = {}, fixture = buildTufUpdateFixture()) {
  const root = await temporary();
  const source = new FixtureDistributionSource(fixture, sourceOptions);
  const client = new TufUpdateClient({
    trustRootDirectory: join(root, "trust"),
    stagingRoot: join(root, "staging"),
    trustedRoot: fixture.trustedRoot,
    source,
    chunkSize: 17
  });
  const stageRoot = join(root, "staging", fixture.bundle.releaseDigest.slice("sha256:".length));
  return { client, fixture, root, source, stageRoot };
}

const run = (client) => client.resolveAndStage({ platform: "win32", arch: "x64" });

test("interrupted component download retains a bounded partial and resumes at its exact offset", async () => {
  const { client, stageRoot, source } = await setup({
    pathIncludes: "core-verchestra",
    failAtOffset: 17,
    failures: 1
  });
  await assert.rejects(run(client), { code: "VES_TUF_PARTIAL_DOWNLOAD", activationAllowed: false });
  const partial = join(stageRoot, "components", "core-verchestra.part");
  assert.equal((await stat(partial)).size, 17);
  await run(client);
  assert.equal(
    source.reads.some(({ path, offset }) => path.includes("core-verchestra") && offset === 17),
    true
  );
  await assert.rejects(access(partial));
});

test("zero-byte partial response fails without a busy loop", async () => {
  const { client } = await setup({ pathIncludes: "core-verchestra", emptyAtOffset: 17 });
  await assert.rejects(run(client), { code: "VES_TUF_PARTIAL_DOWNLOAD", activationAllowed: false });
});

test("source length disagreement fails before target publication", async () => {
  const { client } = await setup({ totalLengthOverride: 999999 });
  await assert.rejects(run(client), { code: "VES_TUF_LENGTH_MISMATCH", activationAllowed: false });
});

test("oversized source chunk is rejected rather than truncating silently", async () => {
  const { client } = await setup({ oversizedChunk: true });
  await assert.rejects(run(client), { code: "VES_TUF_PARTIAL_DOWNLOAD", activationAllowed: false });
});

test("same-length target corruption removes the invalid partial", async () => {
  const fixture = buildTufUpdateFixture();
  const key = [...fixture.targets.keys()].find((path) => path.includes("core-verchestra"));
  fixture.targets.set(key, Buffer.alloc(fixture.targets.get(key).length, 0x41));
  const { client, stageRoot } = await setup({}, fixture);
  await assert.rejects(run(client), { code: "VES_TUF_INTEGRITY", activationAllowed: false });
  await assert.rejects(access(join(stageRoot, "components", "core-verchestra.part")));
});

test("corrupt retained prefix is detected, discarded, and can be retried cleanly", async () => {
  const state = await setup({ pathIncludes: "core-verchestra", failAtOffset: 17, failures: 1 });
  await assert.rejects(run(state.client), { code: "VES_TUF_PARTIAL_DOWNLOAD" });
  const partial = join(state.stageRoot, "components", "core-verchestra.part");
  await writeFile(partial, Buffer.alloc(17, 0x42));
  await assert.rejects(run(state.client), { code: "VES_TUF_INTEGRITY" });
  await assert.rejects(access(partial));
  await run(state.client);
});

test("oversized retained partial is discarded and restarted from offset zero", async () => {
  const state = await setup();
  const partial = join(state.stageRoot, "components", "core-verchestra.part");
  await mkdir(dirname(partial), { recursive: true });
  await writeFile(partial, Buffer.alloc(10_000));
  await run(state.client);
  assert.equal(
    state.source.reads.some(({ path, offset }) => path.includes("core-verchestra") && offset === 0),
    true
  );
});

test("tampered finalized component is re-downloaded before an idempotent receipt is returned", async () => {
  const state = await setup();
  const first = await run(state.client);
  const path = join(state.stageRoot, "components", "core-verchestra");
  await writeFile(path, Buffer.alloc((await stat(path)).size, 0x43));
  const readsBefore = state.source.reads.length;
  const second = await run(state.client);
  assert.deepEqual(second, first);
  assert.equal(
    state.source.reads.slice(readsBefore).some((entry) => entry.path.includes("core-verchestra")),
    true
  );
});

test("conflicting existing stage receipt fails closed", async () => {
  const state = await setup();
  await run(state.client);
  await writeFile(join(state.stageRoot, "staged-release.json"), "{}\n");
  await assert.rejects(run(state.client), { code: "VES_TUF_STAGE_CONFLICT", activationAllowed: false });
});

test("resolution and staging never create an active pointer", async () => {
  const { client, root } = await setup();
  await run(client);
  await assert.rejects(access(join(root, "active.json")));
  await assert.rejects(access(join(root, "staging", "active.json")));
});

test("invalid target request performs no trust bootstrap or staging write", async () => {
  const { client, root } = await setup();
  await assert.rejects(client.resolveAndStage({ platform: "win32", arch: "ia32" }), {
    code: "VES_TUF_TARGET_INVALID"
  });
  await assert.rejects(access(join(root, "trust")));
  await assert.rejects(access(join(root, "staging")));
});

test("a completed stage receipt remains byte-stable across retries", async () => {
  const state = await setup();
  await run(state.client);
  const path = join(state.stageRoot, "staged-release.json");
  const before = await readFile(path);
  await run(state.client);
  assert.deepEqual(await readFile(path), before);
});
