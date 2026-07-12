import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { getLoadablePath } from "sqlite-vec";
import {
  QUALIFIED_SQLITE,
  SqliteMemoryStack,
  inspectSqliteRuntime
} from "../src/sqlite-memory-stack.mjs";

const roots = [];
async function tempRoot() {
  const root = join(tmpdir(), `verchestra-sqlite-${process.pid}-${crypto.randomUUID()}`);
  roots.push(root);
  return root;
}
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function document(overrides = {}) {
  return {
    id: "doc-1",
    workspace: "acme",
    project: "payments",
    body: "The orchestration contract is evidence driven",
    provenance: "git:abc123:docs/contract.md",
    sourceUpdatedAt: "2026-07-12T10:00:00.000Z",
    embedding: [1, 0, 0],
    ...overrides
  };
}

async function opened(options = {}) {
  const root = await tempRoot();
  const stack = new SqliteMemoryStack({ dbPath: join(root, "memory.sqlite"), ...options });
  const status = stack.open();
  return { root, stack, status };
}

test("records the exact qualified Node, SQLite, FTS5, and sqlite-vec versions", async () => {
  const runtime = inspectSqliteRuntime();
  assert.deepEqual(runtime, {
    node: "24.14.0",
    sqlite: "3.51.2",
    fts5: true,
    sqliteVec: "0.1.9",
    sqliteVecSha256: QUALIFIED_SQLITE.sqliteVecSha256
  });
});

test("records the exact sqlite-vec release asset checksum and byte size", async () => {
  const asset = await readFile(getLoadablePath());
  assert.equal(createHash("sha256").update(asset).digest("hex"), "fcf98662a7ad9dce394b96a88f91032047823831b951c76636787c312a6476e6");
  assert.equal((await stat(getLoadablePath())).size, 289280);
});

test("opens a file database with WAL, foreign keys, busy timeout, and defensive mode", async () => {
  const { stack } = await opened({ timeoutMs: 75 });
  assert.deepEqual(stack.safetySettings(), { journalMode: "wal", foreignKeys: 1, busyTimeoutMs: 75, writableSchema: 0 });
  stack.close();
});

test("extension loading is denied by default", async () => {
  const root = await tempRoot();
  const stack = new SqliteMemoryStack({ dbPath: join(root, "memory.sqlite"), vector: { enabled: false } });
  stack.open();
  assert.throws(() => stack.loadExtensionForTest(getLoadablePath()), { code: "ERR_INVALID_STATE" });
  stack.close();
});

test("controlled vector bootstrap loads the exact extension and locks loading afterward", async () => {
  const { stack, status } = await opened();
  assert.deepEqual(status.vector, { enabled: true, version: "v0.1.9", code: "VES_VECTOR_READY" });
  assert.throws(() => stack.loadExtensionForTest(getLoadablePath()), { code: "ERR_INVALID_STATE" });
  stack.close();
});

test("wrong vector asset checksum fails closed to lexical-only operation", async () => {
  const { stack, status } = await opened({ vector: { enabled: true, expectedSha256: "0".repeat(64) } });
  assert.deepEqual(status.vector, { enabled: false, version: null, code: "VES_VECTOR_ASSET_MISMATCH" });
  stack.upsertDocuments([document()]);
  assert.equal(stack.searchLexical("orchestration", { workspace: "acme", project: "payments" }).length, 1);
  stack.close();
});

test("missing vector extension fails closed to lexical-only operation", async () => {
  const { stack, status } = await opened({ vector: { enabled: true, path: "Z:\\missing\\vec0.dll" } });
  assert.equal(status.vector.code, "VES_VECTOR_UNAVAILABLE");
  stack.upsertDocuments([document()]);
  assert.equal(stack.searchLexical("evidence", { workspace: "acme", project: "payments" })[0].id, "doc-1");
  stack.close();
});

test("applies checksummed migrations once", async () => {
  const { stack } = await opened();
  assert.equal(stack.migrationLedger().length, 1);
  assert.equal(stack.migrate().applied, 0);
  assert.equal(stack.migrationLedger()[0].checksum.length, 64);
  stack.close();
});

test("rejects migration checksum drift", async () => {
  const root = await tempRoot();
  const dbPath = join(root, "memory.sqlite");
  const first = new SqliteMemoryStack({ dbPath, vector: { enabled: false } });
  first.open();
  first.close();
  const changed = new SqliteMemoryStack({ dbPath, vector: { enabled: false }, migrations: [{ id: "001_memory", sql: "SELECT 1" }] });
  assert.throws(() => changed.open(), { code: "VES_MIGRATION_CHECKSUM_DRIFT" });
});

test("FTS5 retrieves lexical matches with provenance, freshness, trust, and explanation", async () => {
  const { stack } = await opened();
  stack.upsertDocuments([document()]);
  const [result] = stack.searchLexical("orchestration", { workspace: "acme", project: "payments" });
  assert.deepEqual(result, {
    id: "doc-1",
    body: "The orchestration contract is evidence driven",
    provenance: "git:abc123:docs/contract.md",
    sourceUpdatedAt: "2026-07-12T10:00:00.000Z",
    untrusted: true,
    retrieval: "fts5",
    explanation: "FTS5 lexical match scoped to workspace=acme project=payments"
  });
  stack.close();
});

test("workspace scope prevents cross-workspace retrieval", async () => {
  const { stack } = await opened();
  stack.upsertDocuments([document(), document({ id: "doc-2", workspace: "other" })]);
  assert.deepEqual(stack.searchLexical("orchestration", { workspace: "acme", project: "payments" }).map((row) => row.id), ["doc-1"]);
  stack.close();
});

test("project scope prevents cross-project retrieval", async () => {
  const { stack } = await opened();
  stack.upsertDocuments([document(), document({ id: "doc-2", project: "ledger" })]);
  assert.deepEqual(stack.searchLexical("orchestration", { workspace: "acme", project: "payments" }).map((row) => row.id), ["doc-1"]);
  stack.close();
});

test("lexical search requires both workspace and project scope", async () => {
  const { stack } = await opened();
  assert.throws(() => stack.searchLexical("evidence", { workspace: "acme" }), { code: "VES_SCOPE_REQUIRED" });
  stack.close();
});

test("canonical ingestion is idempotent and preserves the state digest", async () => {
  const { stack } = await opened();
  const first = stack.upsertDocuments([document()]);
  const second = stack.upsertDocuments([document()]);
  assert.equal(first.changed, 1);
  assert.equal(second.changed, 0);
  assert.equal(second.digest, first.digest);
  assert.equal(stack.documentCount(), 1);
  stack.close();
});

test("changed canonical content updates relational and FTS authority exactly once", async () => {
  const { stack } = await opened();
  stack.upsertDocuments([document()]);
  const update = stack.upsertDocuments([document({ body: "The conductor contract changed" })]);
  assert.equal(update.changed, 1);
  assert.equal(stack.searchLexical("orchestration", { workspace: "acme", project: "payments" }).length, 0);
  assert.equal(stack.searchLexical("conductor", { workspace: "acme", project: "payments" }).length, 1);
  stack.close();
});

test("invalid canonical document rolls back the whole ingestion transaction", async () => {
  const { stack } = await opened();
  assert.throws(() => stack.upsertDocuments([document(), document({ id: "doc-2", provenance: "" })]), { code: "VES_DOCUMENT_INVALID" });
  assert.equal(stack.documentCount(), 0);
  stack.close();
});

test("vector search is derived and returns scoped nearest neighbors", async () => {
  const { stack } = await opened();
  stack.upsertDocuments([document(), document({ id: "doc-2", body: "Unrelated", embedding: [0, 1, 0] })]);
  const [nearest] = stack.searchVector([0.9, 0.1, 0], { workspace: "acme", project: "payments", limit: 1 });
  assert.equal(nearest.id, "doc-1");
  assert.equal(nearest.retrieval, "sqlite-vec");
  stack.close();
});

test("dropping derived vectors does not damage relational or FTS authority", async () => {
  const { stack } = await opened();
  stack.upsertDocuments([document()]);
  stack.dropVectorIndexForTest();
  assert.equal(stack.documentCount(), 1);
  assert.equal(stack.searchLexical("evidence", { workspace: "acme", project: "payments" }).length, 1);
  assert.throws(() => stack.searchVector([1, 0, 0], { workspace: "acme", project: "payments" }), { code: "VES_VECTOR_UNAVAILABLE" });
  stack.close();
});

test("derived vectors rebuild from relational canonical records", async () => {
  const { stack } = await opened();
  stack.upsertDocuments([document()]);
  stack.dropVectorIndexForTest();
  assert.equal(stack.rebuildVectorIndex().rebuilt, 1);
  assert.equal(stack.searchVector([1, 0, 0], { workspace: "acme", project: "payments" })[0].id, "doc-1");
  stack.close();
});
