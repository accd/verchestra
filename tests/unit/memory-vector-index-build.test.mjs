import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { MemoryVectorIndex } from "../../packages/memory/src/index.ts";
import {
  batch,
  cleanup,
  localVectorAsset,
  now,
  opened,
  projectId,
  workspaceId
} from "../helpers/memory-store-fixture.mjs";

afterEach(cleanup);

const scope = { workspaceId, projectId };
const model = { provider: "fixture", modelId: "fixture-embedding-3d", revision: "1", dimensions: 3, distance: "l2" };

function input(index, overrides = {}) {
  const snapshot = index.authoritySnapshot(scope);
  return {
    schemaVersion: 1,
    workspaceId,
    projectId,
    authorityDigest: snapshot.authorityDigest,
    model,
    vectors: snapshot.chunks.map((chunk, ordinal) => ({
      workspaceId,
      projectId,
      sourceId: chunk.sourceId,
      chunkId: chunk.chunkId,
      contentDigest: chunk.contentDigest,
      embedding: ordinal === 0 ? [1, 0, 0] : [0, 1, 0]
    })),
    ...overrides
  };
}

async function ready(hooks = {}) {
  const context = await opened();
  context.store.ingest(batch());
  const index = new MemoryVectorIndex({
    dbPath: context.dbPath,
    mode: "preferred",
    now: () => now,
    hooks,
    ...localVectorAsset()
  });
  assert.equal(index.open().code, "VES_VECTOR_READY");
  return { ...context, index };
}

function close({ index, store }) {
  index.close();
  store.close();
}

test("a build stages, verifies and activates a new generation, and a repeat build reports no change", async () => {
  const context = await ready();
  const { index } = context;
  const built = index.buildGeneration(input(index));
  assert.equal(built.changed, true);
  assert.equal(built.status, "active");
  assert.equal(built.slot, "a");
  assert.equal(built.vectorCount, 2);
  assert.equal(index.activeGeneration(scope)?.generationId, built.generationId);

  const repeated = index.buildGeneration(input(index));
  assert.equal(repeated.changed, false);
  assert.equal(repeated.generationId, built.generationId);
  assert.equal(index.listGenerations(scope).length, 1);
  close(context);
});

test("a stale authority digest is refused before any derived state is written", async () => {
  const context = await ready();
  const { index } = context;
  assert.throws(() => index.buildGeneration(input(index, { authorityDigest: `sha256:${"0".repeat(64)}` })), {
    code: "VES_VECTOR_AUTHORITY_MISMATCH",
    message: "Vector build authority digest is stale"
  });
  assert.equal(index.listGenerations(scope).length, 0);
  close(context);
});

test("a vector set that differs from the active lexical chunks is refused", async () => {
  const context = await ready();
  const { index } = context;
  const build = input(index);
  build.vectors.pop();
  assert.throws(() => index.buildGeneration(build), {
    code: "VES_VECTOR_AUTHORITY_MISMATCH",
    message: "Vector set differs from active lexical chunks"
  });
  assert.equal(index.listGenerations(scope).length, 0);
  close(context);
});

test("an authority change before the writer lock is reported as the lock-time mismatch", async () => {
  let mutate = false;
  let store;
  const context = await ready({
    beforeBuildLock: () => {
      if (mutate) store.ingest(batch([], { manifestRef: "artifact:memory/empty" }));
    }
  });
  store = context.store;
  const { index } = context;
  const build = input(index);
  mutate = true;
  assert.throws(() => index.buildGeneration(build), {
    code: "VES_VECTOR_AUTHORITY_MISMATCH",
    message: "Lexical authority changed before vector build lock"
  });
  assert.equal(index.listGenerations(scope).length, 0);
  close(context);
});

test("a fault during staging rolls back and is reported as a recoverable build failure", async () => {
  const context = await ready({
    afterVectorInsert: () => {
      throw new Error("staging fault");
    }
  });
  const { index } = context;
  assert.throws(() => index.buildGeneration(input(index)), {
    code: "VES_VECTOR_BUILD_FAILED",
    message: "Vector generation build failed",
    recoverable: true
  });
  assert.equal(index.listGenerations(scope).length, 0);
  assert.equal(index.activeGeneration(scope), undefined);
  close(context);
});

test("a lost acknowledgement after the swap commits leaves the generation active and reports the outcome unknown", async () => {
  const context = await ready({
    afterSwap: () => {
      throw new Error("acknowledgement lost");
    }
  });
  const { index } = context;
  assert.throws(() => index.buildGeneration(input(index)), {
    code: "VES_VECTOR_SWAP_OUTCOME_UNKNOWN",
    recoverable: true
  });
  assert.equal(index.activeGeneration(scope)?.status, "active");
  close(context);
});

test("a replacement generation is staged in the inactive slot and supersedes the former one", async () => {
  const context = await ready();
  const { index } = context;
  const first = index.buildGeneration(input(index));
  const second = index.buildGeneration(input(index, { model: { ...model, revision: "2" } }));
  assert.equal(second.changed, true);
  assert.equal(second.slot, first.slot === "a" ? "b" : "a");
  const generations = index.listGenerations(scope);
  assert.deepEqual(
    generations.map((generation) => [generation.generationId, generation.status]).sort(),
    [
      [first.generationId, "superseded"],
      [second.generationId, "active"]
    ].sort()
  );
  close(context);
});
