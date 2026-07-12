import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { SqliteMemoryStack, inspectDatabaseFile } from "../src/sqlite-memory-stack.mjs";

const roots = [];
async function tempRoot() {
  const root = join(tmpdir(), `verchestra-sqlite-resilience-${process.pid}-${crypto.randomUUID()}`);
  roots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function doc(id = "doc-1", body = "backup evidence") {
  return { id, workspace: "acme", project: "payments", body, provenance: `git:abc:${id}`, sourceUpdatedAt: "2026-07-12T10:00:00.000Z", embedding: [1, 0, 0] };
}

async function opened(options = {}) {
  const root = await tempRoot();
  const stack = new SqliteMemoryStack({ dbPath: join(root, "memory.sqlite"), timeoutMs: 10, ...options });
  stack.open();
  return { root, stack };
}

test("online backup produces an integrity-checked database and SHA-256 manifest", async () => {
  const { root, stack } = await opened();
  stack.upsertDocuments([doc()]);
  const result = await stack.backupTo(join(root, "backup.sqlite"));
  assert.equal(result.code, "VES_BACKUP_READY");
  assert.equal(result.manifest.sha256.length, 64);
  assert.deepEqual(inspectDatabaseFile(result.path), { integrity: "ok", documents: 1 });
  stack.close();
});

test("online backup includes committed WAL records", async () => {
  const { root, stack } = await opened();
  stack.upsertDocuments([doc("doc-1"), doc("doc-2")]);
  const result = await stack.backupTo(join(root, "backup.sqlite"));
  assert.equal(inspectDatabaseFile(result.path).documents, 2);
  stack.close();
});

test("backup manifest binds the canonical state digest", async () => {
  const { root, stack } = await opened();
  stack.upsertDocuments([doc()]);
  const digest = stack.stateDigest();
  const result = await stack.backupTo(join(root, "backup.sqlite"));
  assert.equal(result.manifest.stateDigest, digest);
  stack.close();
});

test("backup staging validation failure leaves the active database unchanged", async () => {
  const { root, stack } = await opened({ hooks: { validateBackup: () => { const error = new Error("injected"); error.code = "SQLITE_CORRUPT"; throw error; } } });
  stack.upsertDocuments([doc()]);
  const before = stack.stateDigest();
  await assert.rejects(() => stack.backupTo(join(root, "backup.sqlite")), { code: "VES_BACKUP_INVALID" });
  assert.equal(stack.stateDigest(), before);
  assert.equal(stack.documentCount(), 1);
  stack.close();
});

test("atomic publication failure leaves the active database unchanged", async () => {
  const { root, stack } = await opened({ hooks: { publishBackup: async () => { throw new Error("rename denied"); } } });
  stack.upsertDocuments([doc()]);
  const before = stack.stateDigest();
  await assert.rejects(() => stack.backupTo(join(root, "backup.sqlite")), { code: "VES_BACKUP_PUBLISH_FAILED" });
  assert.equal(stack.stateDigest(), before);
  stack.close();
});

test("an exclusive writer lock maps to a stable recoverable error", async () => {
  const { stack } = await opened({ vector: { enabled: false } });
  const contender = new DatabaseSync(stack.dbPath, { timeout: 10, defensive: true });
  contender.exec("BEGIN EXCLUSIVE");
  assert.throws(() => stack.upsertDocuments([doc()]), { code: "VES_SQLITE_BUSY", recoverable: true });
  contender.exec("ROLLBACK");
  contender.close();
  assert.equal(stack.documentCount(), 0);
  stack.close();
});

test("corrupt database bytes map to a stable recoverable integrity error", async () => {
  const root = await tempRoot();
  const path = join(root, "corrupt.sqlite");
  await writeFile(path, "not a sqlite database");
  assert.throws(() => inspectDatabaseFile(path), { code: "VES_SQLITE_CORRUPT", recoverable: true });
});

test("valid backup can be validated without enabling extensions", async () => {
  const { root, stack } = await opened();
  stack.upsertDocuments([doc()]);
  const result = await stack.backupTo(join(root, "backup.sqlite"));
  assert.equal(inspectDatabaseFile(result.path, { assertExtensionsDisabled: true }).integrity, "ok");
  stack.close();
});

test("failed ingestion does not change the pre-existing canonical digest", async () => {
  const { stack } = await opened();
  stack.upsertDocuments([doc()]);
  const before = stack.stateDigest();
  assert.throws(() => stack.upsertDocuments([doc("doc-2", "")]), { code: "VES_DOCUMENT_INVALID" });
  assert.equal(stack.stateDigest(), before);
  stack.close();
});

test("closing and reopening preserves the same canonical digest", async () => {
  const root = await tempRoot();
  const dbPath = join(root, "memory.sqlite");
  const first = new SqliteMemoryStack({ dbPath });
  first.open();
  first.upsertDocuments([doc()]);
  const digest = first.stateDigest();
  first.close();
  const second = new SqliteMemoryStack({ dbPath });
  second.open();
  assert.equal(second.stateDigest(), digest);
  second.close();
});

test("defensive mode keeps writable_schema disabled", async () => {
  const { stack } = await opened();
  assert.equal(stack.attemptWritableSchemaForTest(), 0);
  stack.close();
});

test("foreign-key violations are rejected without partial writes", async () => {
  const { stack } = await opened();
  assert.throws(() => stack.insertOrphanForTest(), { code: "VES_SQLITE_CONSTRAINT" });
  assert.equal(stack.documentCount(), 0);
  stack.close();
});
