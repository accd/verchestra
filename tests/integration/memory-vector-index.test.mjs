import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import {
  MemoryVectorIndex,
  QUALIFIED_SQLITE_VEC,
  QUALIFIED_SQLITE_VEC_ASSETS,
  getQualifiedSqliteVecAsset,
  inspectMemoryDatabase
} from "../../packages/memory/src/index.ts";
import {
  batch,
  cleanup,
  localVectorAsset,
  now,
  opened,
  projectId,
  source,
  workspaceId
} from "../helpers/memory-store-fixture.mjs";

afterEach(cleanup);

const model = (overrides = {}) => ({
  provider: "fixture",
  modelId: "fixture-embedding-3d",
  revision: "2026-07-15",
  dimensions: 3,
  distance: "l2",
  ...overrides
});

function buildInput(index, scope = { workspaceId, projectId }, overrides = {}) {
  const snapshot = index.authoritySnapshot(scope);
  const vectors = snapshot.chunks.map((chunk, index) => ({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    sourceId: chunk.sourceId,
    chunkId: chunk.chunkId,
    contentDigest: chunk.contentDigest,
    embedding: index === 0 ? [1, 0, 0] : [0, 1, 0]
  }));
  return {
    schemaVersion: 1,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    authorityDigest: snapshot.authorityDigest,
    model: model(),
    vectors,
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
  const status = index.open();
  return { ...context, index, status };
}

test("loads only the exact pinned sqlite-vec asset and version", async () => {
  const { index, status, store } = await ready();
  const local = localVectorAsset();
  assert.deepEqual(status, {
    enabled: true,
    code: "VES_VECTOR_READY",
    version: "v0.1.9",
    assetSha256: local.expectedAssetSha256,
    assetBytes: local.expectedAssetBytes
  });
  // On a qualified host the installed asset must be byte-identical to the
  // frozen qualification record; elsewhere no record exists to compare.
  if (QUALIFIED_SQLITE_VEC !== undefined) {
    assert.equal(local.expectedAssetSha256, QUALIFIED_SQLITE_VEC.sha256);
    assert.equal(local.expectedAssetBytes, QUALIFIED_SQLITE_VEC.bytes);
  }
  index.close();
  store.close();
});

// The closed default contract, asserted per platform: a qualified host opens
// READY with no injected identity; an unqualified host fails closed to
// lexical-only, refuses vector operations recoverably, and blocks a required
// profile — the same honest degradation contract the sqlite spike pins.
test("the default identity is the closed qualification table, failing closed elsewhere", async () => {
  const { dbPath, store } = await opened();
  store.ingest(batch());
  const index = new MemoryVectorIndex({ dbPath, mode: "preferred" });
  const status = index.open();
  if (QUALIFIED_SQLITE_VEC !== undefined) {
    assert.equal(status.code, "VES_VECTOR_READY");
    assert.equal(status.assetSha256, QUALIFIED_SQLITE_VEC.sha256);
  } else {
    assert.deepEqual(status, { enabled: false, code: "VES_VECTOR_UNAVAILABLE", version: null });
    assert.throws(() => index.authoritySnapshot({ workspaceId, projectId }), {
      code: "VES_VECTOR_UNAVAILABLE",
      recoverable: true
    });
    const required = new MemoryVectorIndex({ dbPath, mode: "required" });
    assert.throws(() => required.open(), { code: "VES_VECTOR_REQUIRED_UNAVAILABLE", recoverable: true });
  }
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "refund", limit: 5 }).length, 1);
  index.close();
  store.close();
});

test("qualification is closed to the verified x64 Windows and Linux assets", () => {
  assert.deepEqual(Object.keys(QUALIFIED_SQLITE_VEC_ASSETS).sort(), ["linux-x64", "win32-x64"]);
  assert.equal(getQualifiedSqliteVecAsset("darwin", "x64"), undefined);
  assert.equal(getQualifiedSqliteVecAsset("linux", "arm64"), undefined);
  assert.equal(QUALIFIED_SQLITE_VEC_ASSETS["linux-x64"].bytes, 159816);
  assert.equal(
    QUALIFIED_SQLITE_VEC_ASSETS["linux-x64"].sha256,
    "5923730861b86c707cca5602b5f91092f9e52a46706dbc6e269fd4bb9c4498e8"
  );
});

test("controlled bootstrap permanently disables further extension loading on its connection", async () => {
  const { index, store } = await ready();
  assert.throws(() => index.loadExtensionForTest(), { code: "ERR_INVALID_STATE" });
  index.close();
  store.close();
});

test("disabled semantic mode never loads sqlite-vec and lexical authority remains available", async () => {
  const { dbPath, store } = await opened();
  store.ingest(batch());
  const index = new MemoryVectorIndex({ dbPath, mode: "disabled" });
  assert.deepEqual(index.open(), { enabled: false, code: "VES_VECTOR_DISABLED", version: null });
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "refund", limit: 5 }).length, 1);
  index.close();
  store.close();
});

test("missing optional extension degrades to lexical-only operation", async () => {
  const { dbPath, store } = await opened();
  store.ingest(batch());
  const index = new MemoryVectorIndex({
    dbPath,
    mode: "preferred",
    ...localVectorAsset(),
    assetPath: "Z:\\missing\\vec0.dll"
  });
  assert.deepEqual(index.open(), { enabled: false, code: "VES_VECTOR_UNAVAILABLE", version: null });
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "orders", limit: 5 }).length, 1);
  index.close();
  store.close();
});

test("asset checksum mismatch degrades to lexical-only operation", async () => {
  const { dbPath, store } = await opened();
  store.ingest(batch());
  const index = new MemoryVectorIndex({
    dbPath,
    mode: "preferred",
    ...localVectorAsset(),
    expectedAssetSha256: "0".repeat(64)
  });
  assert.deepEqual(index.open(), { enabled: false, code: "VES_VECTOR_ASSET_MISMATCH", version: null });
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "audit", limit: 5 }).length, 1);
  index.close();
  store.close();
});

test("runtime version mismatch degrades to lexical-only operation", async () => {
  const { dbPath, store } = await opened();
  store.ingest(batch());
  const index = new MemoryVectorIndex({ dbPath, mode: "preferred", ...localVectorAsset(), expectedVersion: "v9.9.9" });
  assert.deepEqual(index.open(), { enabled: false, code: "VES_VECTOR_VERSION_MISMATCH", version: null });
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "capture", limit: 5 }).length, 1);
  index.close();
  store.close();
});

test("required semantic mode blocks explicitly when sqlite-vec is unavailable", async () => {
  const { dbPath, store } = await opened();
  store.ingest(batch());
  const index = new MemoryVectorIndex({
    dbPath,
    mode: "required",
    ...localVectorAsset(),
    assetPath: "Z:\\missing\\vec0.dll"
  });
  assert.throws(() => index.open(), { code: "VES_VECTOR_REQUIRED_UNAVAILABLE", recoverable: true });
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "refund", limit: 5 }).length, 1);
  store.close();
});

test("build creates a verified content-addressed vector generation", async () => {
  const { index, store } = await ready();
  const result = index.buildGeneration(buildInput(index));
  assert.equal(result.changed, true);
  assert.equal(result.vectorCount, 2);
  assert.match(result.generationId, /^sha256:[a-f0-9]{64}$/u);
  assert.match(result.vectorDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(result.status, "active");
  assert.equal(index.activeGeneration({ workspaceId, projectId }).generationId, result.generationId);
  index.close();
  store.close();
});

test("equivalent vector order converges on the active generation", async () => {
  const { index, store } = await ready();
  const input = buildInput(index);
  const first = index.buildGeneration(input);
  const second = index.buildGeneration({ ...input, vectors: input.vectors.toReversed() });
  assert.deepEqual(second, { ...first, changed: false });
  assert.equal(index.listGenerations({ workspaceId, projectId }).filter((item) => item.status === "active").length, 1);
  index.close();
  store.close();
});

test("real sqlite-vec nearest-neighbor search returns bound untrusted chunk identity", async () => {
  const { index, store } = await ready();
  const built = index.buildGeneration(buildInput(index));
  const [nearest] = index.search({ workspaceId, projectId, embedding: [0.9, 0.1, 0], limit: 1 });
  assert.equal(nearest.sourceId, "source:orders");
  assert.equal(nearest.chunkId, "source:orders:chunk:1");
  assert.equal(nearest.generationId, built.generationId);
  assert.equal(nearest.untrusted, true);
  assert.equal(nearest.retrieval, "sqlite-vec");
  assert.equal(nearest.distance >= 0, true);
  index.close();
  store.close();
});

test("semantic candidates are exact Workspace and Project scoped", async () => {
  const { dbPath, store } = await opened();
  const otherWorkspace = "workspace_018f0b6d-7b1a-7abc-8def-8123456789ab";
  store.ingest(batch([source("source:a", { contents: ["workspace alpha"] })]));
  store.ingest(batch([source("source:b", { contents: ["workspace beta"] })], { workspaceId: otherWorkspace }));
  const index = new MemoryVectorIndex({ dbPath, mode: "preferred", ...localVectorAsset() });
  index.open();
  index.buildGeneration(buildInput(index));
  index.buildGeneration(buildInput(index, { workspaceId: otherWorkspace, projectId }));
  assert.deepEqual(
    index.search({ workspaceId, projectId, embedding: [1, 0, 0], limit: 5 }).map((hit) => hit.sourceId),
    ["source:a"]
  );
  assert.deepEqual(
    index.search({ workspaceId: otherWorkspace, projectId, embedding: [1, 0, 0], limit: 5 }).map((hit) => hit.sourceId),
    ["source:b"]
  );
  index.close();
  store.close();
});

test("embedding metadata is explicit and contains no vector values", async () => {
  const { index, store } = await ready();
  index.buildGeneration(buildInput(index));
  const [generation] = index.listGenerations({ workspaceId, projectId });
  assert.deepEqual(generation.model, model());
  const serialized = JSON.stringify(generation);
  assert.equal(serialized.includes('"vectors"'), false);
  assert.equal(serialized.includes("[1,0,0]"), false);
  index.close();
  store.close();
});

test("a replacement generation builds in the inactive slot then supersedes the former generation", async () => {
  const { index, store } = await ready();
  const first = index.buildGeneration(buildInput(index));
  const input = buildInput(index, { workspaceId, projectId }, { model: model({ revision: "2026-07-15.2" }) });
  const second = index.buildGeneration(input);
  assert.notEqual(second.generationId, first.generationId);
  assert.notEqual(second.slot, first.slot);
  assert.equal(
    index.listGenerations({ workspaceId, projectId }).find((item) => item.generationId === first.generationId).status,
    "superseded"
  );
  assert.equal(index.activeGeneration({ workspaceId, projectId }).generationId, second.generationId);
  index.close();
  store.close();
});

test("vector build and search never change relational lexical authority digest", async () => {
  const { index, store } = await ready();
  const before = store.stateDigest();
  index.buildGeneration(buildInput(index));
  index.search({ workspaceId, projectId, embedding: [1, 0, 0], limit: 2 });
  assert.equal(store.stateDigest(), before);
  index.close();
  store.close();
});

test("memory backup remains valid and canonically identical when derived vector tables exist", async () => {
  const { index, root, store } = await ready();
  const lexicalDigest = store.stateDigest();
  index.buildGeneration(buildInput(index));
  const backup = await store.backupTo(join(root, "memory-with-vectors.sqlite"));
  assert.equal(backup.manifest.stateDigest, lexicalDigest);
  assert.equal(inspectMemoryDatabase(backup.path).integrity, "ok");
  index.close();
  store.close();
});

test("derived state can be discarded and rebuilt to the same generation identity", async () => {
  const { index, store } = await ready();
  const input = buildInput(index);
  const first = index.buildGeneration(input);
  const lexicalDigest = store.stateDigest();
  index.clearDerivedState({ workspaceId, projectId });
  assert.equal(index.availability({ workspaceId, projectId }).code, "VES_VECTOR_GENERATION_UNAVAILABLE");
  const rebuilt = index.buildGeneration(input);
  assert.equal(rebuilt.generationId, first.generationId);
  assert.equal(store.stateDigest(), lexicalDigest);
  index.close();
  store.close();
});

test("lexical source change makes the prior vector generation explicitly stale", async () => {
  const { index, store } = await ready();
  index.buildGeneration(buildInput(index));
  store.ingest(
    batch([source("source:orders", { revision: "rev-2", contents: ["changed authority"] })], {
      manifestRef: "artifact:memory/rev-2"
    })
  );
  assert.equal(index.availability({ workspaceId, projectId }).code, "VES_VECTOR_GENERATION_STALE");
  assert.throws(() => index.search({ workspaceId, projectId, embedding: [1, 0, 0], limit: 1 }), {
    code: "VES_VECTOR_GENERATION_STALE",
    recoverable: true
  });
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "changed", limit: 5 }).length, 1);
  index.close();
  store.close();
});

test("reopen verifies and reuses the active vector generation", async () => {
  const { dbPath, index, store } = await ready();
  const built = index.buildGeneration(buildInput(index));
  index.close();
  const reopened = new MemoryVectorIndex({ dbPath, mode: "preferred", ...localVectorAsset() });
  assert.equal(reopened.open().code, "VES_VECTOR_READY");
  assert.equal(reopened.activeGeneration({ workspaceId, projectId }).generationId, built.generationId);
  assert.equal(reopened.search({ workspaceId, projectId, embedding: [1, 0, 0], limit: 1 }).length, 1);
  reopened.close();
  store.close();
});

test("generation identity changes with model, authority, or embedding content", async () => {
  const { index, store } = await ready();
  const input = buildInput(index);
  const first = index.buildGeneration(input);
  const modelChanged = index.buildGeneration({ ...input, model: model({ modelId: "fixture-embedding-next" }) });
  const vectorChangedInput = buildInput(index);
  vectorChangedInput.vectors[0].embedding = [0.8, 0.2, 0];
  const vectorChanged = index.buildGeneration(vectorChangedInput);
  assert.notEqual(first.generationId, modelChanged.generationId);
  assert.notEqual(modelChanged.generationId, vectorChanged.generationId);
  assert.notEqual(first.vectorDigest, vectorChanged.vectorDigest);
  index.close();
  store.close();
});

// #58 (memory vertical): memory-vector-index.ts ordered canonical-JSON object
// members and the vector list with String.prototype.localeCompare, which is
// locale-dependent and diverges from UTF-16 code-unit order for the mixed-case
// ASCII identifiers IDENTIFIER_PATTERN accepts. The vector order fixes the
// persisted memory_vector_members.row_id sequence and the vector digest that
// #verifyGeneration re-derives from it. Replacing localeCompare with a
// comparator that reverses code-unit order simulates a divergent collation
// without depending on any particular installed ICU locale disagreeing on the
// host running the test.
async function withHostileLocaleCompare(run) {
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = function hostileLocaleCompare(other) {
    const left = String(this);
    return left < other ? 1 : left > other ? -1 : 0;
  };
  try {
    return await run();
  } finally {
    String.prototype.localeCompare = original;
  }
}

const mixedCaseBatch = () =>
  batch([source("Source-b", { contents: ["beta content"] }), source("source-a", { contents: ["alpha content"] })]);

async function mixedCaseReady() {
  const context = await opened();
  context.store.ingest(mixedCaseBatch());
  const index = new MemoryVectorIndex({
    dbPath: context.dbPath,
    mode: "preferred",
    now: () => now,
    ...localVectorAsset()
  });
  index.open();
  return { ...context, index };
}

// Vectors are handed in reversed so the module's own ordering, not the caller's
// argument order, decides the persisted row sequence.
function reversedMixedCaseBuild(index) {
  const snapshot = index.authoritySnapshot({ workspaceId, projectId });
  const vectors = snapshot.chunks.map((chunk, position) => ({
    workspaceId,
    projectId,
    sourceId: chunk.sourceId,
    chunkId: chunk.chunkId,
    contentDigest: chunk.contentDigest,
    embedding: position === 0 ? [1, 0, 0] : [0, 1, 0]
  }));
  return {
    schemaVersion: 1,
    workspaceId,
    projectId,
    authorityDigest: snapshot.authorityDigest,
    model: model(),
    vectors: [...vectors].reverse()
  };
}

test("vector generation identity and persisted row order are stable across divergent locale collations", async () => {
  const { dbPath, index, store } = await mixedCaseReady();
  const built = index.buildGeneration(reversedMixedCaseBuild(index));
  // Rebuilding the identical input under a hostile collation must reproduce the
  // exact generation identity, so the index recognizes it rather than staging a
  // new slot.
  const rebuilt = await withHostileLocaleCompare(() => index.buildGeneration(reversedMixedCaseBuild(index)));
  assert.equal(rebuilt.changed, false);
  assert.equal(rebuilt.generationId, built.generationId);
  assert.equal(rebuilt.vectorDigest, built.vectorDigest);
  assert.equal(rebuilt.tableName, built.tableName);
  assert.equal(rebuilt.authorityDigest, built.authorityDigest);

  // activeGeneration re-derives the table name, the model digest and the
  // generation identity against the stored row and fails closed on a mismatch.
  assert.deepEqual(
    await withHostileLocaleCompare(() => index.activeGeneration({ workspaceId, projectId })),
    index.activeGeneration({ workspaceId, projectId })
  );

  index.close();
  store.close();

  // Code-unit order specifically, not merely "some" deterministic order:
  // uppercase sorts before lowercase in UTF-16, so "Source-b" holds row 1 even
  // though every ambient collation the repository has met orders "source-a"
  // first.
  const db = new DatabaseSync(dbPath, { readOnly: true, allowExtension: false });
  try {
    const members = db
      .prepare("SELECT row_id, source_id FROM memory_vector_members WHERE generation_id=? ORDER BY row_id")
      .all(built.generationId);
    assert.deepEqual(
      members.map((row) => String(row.source_id)),
      ["Source-b", "source-a"]
    );
  } finally {
    db.close();
  }
});
