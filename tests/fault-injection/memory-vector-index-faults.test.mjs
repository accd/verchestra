import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { getLoadablePath } from "sqlite-vec";

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

const model = { provider: "fixture", modelId: "fixture-embedding-3d", revision: "1", dimensions: 3, distance: "l2" };

function input(index, overrides = {}) {
  const snapshot = index.authoritySnapshot({ workspaceId, projectId });
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

async function ready(options = {}) {
  const context = await opened();
  context.store.ingest(batch());
  const index = new MemoryVectorIndex({
    dbPath: context.dbPath,
    mode: "preferred",
    now: () => now,
    ...localVectorAsset(),
    ...options
  });
  index.open();
  return { ...context, index };
}

test("wrong embedding dimensions reject before derived mutation", async () => {
  const { index, store } = await ready();
  const invalid = input(index);
  invalid.vectors[0].embedding = [1, 0];
  assert.throws(() => index.buildGeneration(invalid), { code: "VES_VECTOR_INPUT_INVALID" });
  assert.equal(index.listGenerations({ workspaceId, projectId }).length, 0);
  index.close();
  store.close();
});

test("non-finite embedding values reject before derived mutation", async () => {
  const { index, store } = await ready();
  const invalid = input(index);
  invalid.vectors[0].embedding = [Number.NaN, 0, 0];
  assert.throws(() => index.buildGeneration(invalid), { code: "VES_VECTOR_INPUT_INVALID" });
  assert.equal(index.listGenerations({ workspaceId, projectId }).length, 0);
  index.close();
  store.close();
});

test("duplicate chunk vector rejects before build", async () => {
  const { index, store } = await ready();
  const invalid = input(index);
  invalid.vectors.push({ ...invalid.vectors[0] });
  assert.throws(() => index.buildGeneration(invalid), { code: "VES_VECTOR_INPUT_INVALID" });
  index.close();
  store.close();
});

test("missing authoritative chunk vector rejects the complete generation", async () => {
  const { index, store } = await ready();
  const invalid = input(index);
  invalid.vectors.pop();
  assert.throws(() => index.buildGeneration(invalid), { code: "VES_VECTOR_AUTHORITY_MISMATCH" });
  assert.equal(index.listGenerations({ workspaceId, projectId }).length, 0);
  index.close();
  store.close();
});

test("forged chunk content digest rejects the complete generation", async () => {
  const { index, store } = await ready();
  const invalid = input(index);
  invalid.vectors[0].contentDigest = `sha256:${"0".repeat(64)}`;
  assert.throws(() => index.buildGeneration(invalid), { code: "VES_VECTOR_AUTHORITY_MISMATCH" });
  index.close();
  store.close();
});

test("stale authority digest rejects the complete generation", async () => {
  const { index, store } = await ready();
  assert.throws(() => index.buildGeneration({ ...input(index), authorityDigest: `sha256:${"0".repeat(64)}` }), {
    code: "VES_VECTOR_AUTHORITY_MISMATCH"
  });
  index.close();
  store.close();
});

test("failure after vector insert rolls back building slot and metadata", async () => {
  const { index, store } = await ready({
    hooks: {
      afterVectorInsert: () => {
        throw new Error("crash");
      }
    }
  });
  const before = store.stateDigest();
  assert.throws(() => index.buildGeneration(input(index)));
  assert.equal(index.listGenerations({ workspaceId, projectId }).length, 0);
  assert.equal(store.stateDigest(), before);
  index.close();
  store.close();
});

test("authority change before writer lock is detected inside the build transaction", async () => {
  let mutate = false;
  let storeRef;
  const { index, store } = await ready({
    hooks: {
      beforeBuildLock: () => {
        if (mutate) storeRef.ingest(batch([], { manifestRef: "artifact:memory/empty" }));
      }
    }
  });
  storeRef = store;
  const build = input(index);
  mutate = true;
  assert.throws(() => index.buildGeneration(build), { code: "VES_VECTOR_AUTHORITY_MISMATCH" });
  assert.equal(index.listGenerations({ workspaceId, projectId }).length, 0);
  index.close();
  store.close();
});

test("verification failure rolls back without an active generation", async () => {
  const { index, store } = await ready({
    hooks: {
      verifyGeneration: () => {
        throw new Error("bad recall");
      }
    }
  });
  assert.throws(() => index.buildGeneration(input(index)), { code: "VES_VECTOR_BUILD_FAILED" });
  assert.equal(index.availability({ workspaceId, projectId }).code, "VES_VECTOR_GENERATION_UNAVAILABLE");
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "refund", limit: 5 }).length, 1);
  index.close();
  store.close();
});

test("failure before swap preserves the former active generation", async () => {
  let fail = false;
  const { index, store } = await ready({
    hooks: {
      beforeSwap: () => {
        if (fail) throw new Error("crash");
      }
    }
  });
  const first = index.buildGeneration(input(index));
  fail = true;
  assert.throws(() => index.buildGeneration({ ...input(index), model: { ...model, revision: "2" } }));
  assert.equal(index.activeGeneration({ workspaceId, projectId }).generationId, first.generationId);
  index.close();
  store.close();
});

test("ack loss after committed swap converges idempotently after reopen", async () => {
  let fail = true;
  const { dbPath, index, store } = await ready({
    hooks: {
      afterSwap: () => {
        if (fail) throw new Error("ack lost");
      }
    }
  });
  const build = input(index);
  assert.throws(() => index.buildGeneration(build), { code: "VES_VECTOR_SWAP_OUTCOME_UNKNOWN" });
  fail = false;
  index.close();
  const reopened = new MemoryVectorIndex({ dbPath, mode: "preferred", ...localVectorAsset() });
  reopened.open();
  const result = reopened.buildGeneration(build);
  assert.equal(result.changed, false);
  assert.equal(reopened.search({ workspaceId, projectId, embedding: [1, 0, 0], limit: 1 }).length, 1);
  reopened.close();
  store.close();
});

test("missing active vec slot degrades preferred mode without touching lexical authority", async () => {
  const { dbPath, index, store } = await ready();
  const built = index.buildGeneration(input(index));
  index.close();
  const db = new DatabaseSync(dbPath, { allowExtension: true });
  db.loadExtension(getLoadablePath());
  db.exec(`DROP TABLE ${built.tableName}`);
  db.close();
  const degraded = new MemoryVectorIndex({ dbPath, mode: "preferred", ...localVectorAsset() });
  assert.equal(degraded.open().code, "VES_VECTOR_CORRUPT");
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "audit", limit: 5 }).length, 1);
  degraded.close();
  store.close();
});

test("corrupt active vector state blocks a required semantic profile", async () => {
  const { dbPath, index, store } = await ready();
  const built = index.buildGeneration(input(index));
  const lexicalBefore = store.stateDigest();
  index.close();
  const db = new DatabaseSync(dbPath, { allowExtension: true });
  db.prepare("UPDATE memory_vector_generations SET vector_count=999 WHERE generation_id=?").run(built.generationId);
  db.close();
  const required = new MemoryVectorIndex({ dbPath, mode: "required", ...localVectorAsset() });
  assert.throws(() => required.open(), { code: "VES_VECTOR_REQUIRED_UNAVAILABLE", recoverable: true });
  assert.equal(store.stateDigest(), lexicalBefore);
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "refund", limit: 5 }).length, 1);
  store.close();
});

test("member digest tampering is detected before semantic search", async () => {
  const { dbPath, index, store } = await ready();
  const built = index.buildGeneration(input(index));
  index.close();
  const db = new DatabaseSync(dbPath);
  db.prepare("UPDATE memory_vector_members SET embedding_digest=? WHERE generation_id=?").run(
    `sha256:${"0".repeat(64)}`,
    built.generationId
  );
  db.close();
  const degraded = new MemoryVectorIndex({ dbPath, mode: "preferred", ...localVectorAsset() });
  assert.equal(degraded.open().code, "VES_VECTOR_CORRUPT");
  degraded.close();
  store.close();
});

test("active slot metadata tampering is detected on reopen", async () => {
  const { dbPath, index, store } = await ready();
  index.buildGeneration(input(index));
  index.close();
  const db = new DatabaseSync(dbPath);
  db.prepare("UPDATE memory_vector_control SET active_slot='b' WHERE workspace_id=? AND project_id=?").run(
    workspaceId,
    projectId
  );
  db.close();
  const degraded = new MemoryVectorIndex({ dbPath, mode: "preferred", ...localVectorAsset() });
  assert.equal(degraded.open().code, "VES_VECTOR_CORRUPT");
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "orders", limit: 5 }).length, 1);
  degraded.close();
  store.close();
});

test("real SQLite writer lock makes vector build recoverable and preserves lexical state", async () => {
  const { dbPath, index, store } = await ready();
  const locker = new DatabaseSync(dbPath, { timeout: 10 });
  locker.exec("BEGIN EXCLUSIVE");
  assert.throws(() => index.buildGeneration(input(index)), { code: "VES_VECTOR_BUSY", recoverable: true });
  locker.exec("ROLLBACK");
  locker.close();
  assert.equal(index.listGenerations({ workspaceId, projectId }).length, 0);
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "orders", limit: 5 }).length, 1);
  index.close();
  store.close();
});
