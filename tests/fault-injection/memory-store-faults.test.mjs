import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { DEFAULT_MEMORY_MIGRATIONS, MemoryStore, inspectMemoryDatabase } from "../../packages/memory/src/index.ts";
import { batch, cleanup, now, opened, source, workspaceId, projectId } from "../helpers/memory-store-fixture.mjs";

afterEach(cleanup);

test("migration checksum drift fails closed", async () => {
  const { dbPath, store } = await opened();
  store.close();
  const migrations = [{ ...DEFAULT_MEMORY_MIGRATIONS[0], up: `${DEFAULT_MEMORY_MIGRATIONS[0].up}\nSELECT 1;` }];
  assert.throws(() => new MemoryStore({ dbPath, migrations, now: () => now }).open(), {
    code: "VES_MEMORY_MIGRATION_DRIFT"
  });
});

test("unknown newer migration fails compatibility", async () => {
  const { dbPath, store } = await opened();
  store.close();
  const db = new DatabaseSync(dbPath);
  db.prepare("INSERT INTO ves_memory_migrations(id, checksum, applied_at) VALUES (?, ?, ?)").run(
    "999_future",
    "f".repeat(64),
    now
  );
  db.close();
  assert.throws(() => new MemoryStore({ dbPath }).open(), { code: "VES_MEMORY_MIGRATION_INCOMPATIBLE" });
});

test("failed raw migration rolls back its schema and ledger row", async () => {
  const { root, store } = await opened();
  store.close();
  const dbPath = join(root, "failed.sqlite");
  const migrations = [
    { id: "001_ok", up: "CREATE TABLE stable(id TEXT PRIMARY KEY) STRICT;" },
    { id: "002_fail", up: "CREATE TABLE partial(id TEXT); THIS IS NOT SQL;" }
  ];
  assert.throws(() => new MemoryStore({ dbPath, migrations, now: () => now }).open());
  const db = new DatabaseSync(dbPath);
  assert.equal(db.prepare("SELECT count(*) AS count FROM ves_memory_migrations").get().count, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='partial'").get().count, 0);
  db.close();
});

test("invalid chunk digest rejects the complete batch before writing", async () => {
  const { store } = await opened();
  const invalid = source();
  invalid.chunks[1].contentDigest = `sha256:${"0".repeat(64)}`;
  assert.throws(() => store.ingest(batch([invalid])), { code: "VES_MEMORY_INPUT_INVALID" });
  assert.equal(store.listSources({ workspaceId, projectId }).length, 0);
  store.close();
});

test("duplicate source identities reject the complete batch", async () => {
  const { store } = await opened();
  assert.throws(() => store.ingest(batch([source(), source()])), { code: "VES_MEMORY_INPUT_INVALID" });
  assert.equal(store.listGenerations({ workspaceId, projectId }).length, 0);
  store.close();
});

test("duplicate chunk identities reject the complete batch", async () => {
  const { store } = await opened();
  const invalid = source();
  invalid.chunks[1] = { ...invalid.chunks[1], chunkId: invalid.chunks[0].chunkId };
  assert.throws(() => store.ingest(batch([invalid])), { code: "VES_MEMORY_INPUT_INVALID" });
  assert.equal(store.listSources({ workspaceId, projectId }).length, 0);
  store.close();
});

test("unknown input fields fail closed before persistence", async () => {
  const { store } = await opened();
  assert.throws(() => store.ingest({ ...batch(), credential: "secret" }), { code: "VES_MEMORY_INPUT_INVALID" });
  assert.throws(() => store.ingest(batch([{ ...source(), instructionAuthority: true }])), {
    code: "VES_MEMORY_INPUT_INVALID"
  });
  assert.equal(store.listSources({ workspaceId, projectId }).length, 0);
  store.close();
});

test("injected failure after a chunk insert rolls back generation source FTS and chunks", async () => {
  const { store } = await opened({
    hooks: {
      afterChunkInsert: () => {
        throw new Error("crash");
      }
    }
  });
  assert.throws(() => store.ingest(batch()));
  assert.deepEqual(inspectMemoryDatabase(store.dbPath), {
    integrity: "ok",
    sources: 0,
    chunks: 0,
    ftsRows: 0,
    migrations: DEFAULT_MEMORY_MIGRATIONS.length
  });
  store.close();
});

test("injected failure while tombstoning leaves the former generation active", async () => {
  let fail = false;
  const { store } = await opened({
    hooks: {
      afterSourceInvalidated: () => {
        if (fail) throw new Error("crash");
      }
    }
  });
  store.ingest(batch([source("source:a"), source("source:b", { contents: ["keep visible"] })]));
  const before = store.stateDigest();
  fail = true;
  assert.throws(() => store.ingest(batch([source("source:a")], { manifestRef: "artifact:memory/next" })));
  assert.equal(store.stateDigest(), before);
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "visible", limit: 5 }).length, 1);
  store.close();
});

test("exclusive writer lock maps to a recoverable busy error", async () => {
  const { dbPath, store } = await opened();
  const locker = new DatabaseSync(dbPath, { timeout: 10, defensive: true });
  locker.exec("BEGIN EXCLUSIVE");
  assert.throws(() => store.ingest(batch()), { code: "VES_MEMORY_BUSY", recoverable: true });
  locker.exec("ROLLBACK");
  locker.close();
  assert.equal(store.listSources({ workspaceId, projectId }).length, 0);
  store.close();
});

test("corrupt memory bytes map to a recoverable integrity error", async () => {
  const { root, store } = await opened();
  store.close();
  const path = join(root, "corrupt.sqlite");
  await writeFile(path, "not sqlite");
  assert.throws(() => inspectMemoryDatabase(path), { code: "VES_MEMORY_CORRUPT", recoverable: true });
});

test("missing authoritative FTS schema maps to corruption", async () => {
  const { dbPath, store } = await opened();
  store.close();
  const db = new DatabaseSync(dbPath);
  db.exec("DROP TABLE memory_fts");
  db.close();
  assert.throws(() => inspectMemoryDatabase(dbPath), { code: "VES_MEMORY_CORRUPT", recoverable: true });
  assert.throws(() => new MemoryStore({ dbPath }).open(), { code: "VES_MEMORY_CORRUPT", recoverable: true });
});

test("semantic chunk tampering fails even when SQLite integrity remains structurally valid", async () => {
  const { dbPath, store } = await opened();
  store.ingest(batch());
  store.close();
  const db = new DatabaseSync(dbPath);
  db.prepare("UPDATE memory_chunks SET content='tampered' WHERE chunk_id=?").run("source:orders:chunk:1");
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  db.close();
  assert.throws(() => inspectMemoryDatabase(dbPath), { code: "VES_MEMORY_CORRUPT", recoverable: true });
});

test("FTS projection tampering fails even when relational chunks are intact", async () => {
  const { dbPath, store } = await opened();
  store.ingest(batch());
  store.close();
  const db = new DatabaseSync(dbPath);
  db.prepare("DELETE FROM memory_fts WHERE chunk_id=?").run("source:orders:chunk:1");
  db.close();
  assert.throws(() => new MemoryStore({ dbPath }).open(), { code: "VES_MEMORY_CORRUPT", recoverable: true });
});

test("injected FTS-only content is detected as non-authoritative projection drift", async () => {
  const { dbPath, store } = await opened();
  store.ingest(batch());
  store.close();
  const db = new DatabaseSync(dbPath);
  db.prepare(
    `INSERT INTO memory_fts(content, workspace_id, project_id, source_id, observation_id, chunk_id)
    VALUES (?, ?, ?, ?, ?, ?)`
  ).run("forged authority", workspaceId, projectId, "source:forged", "sha256:forged", "forged:1");
  db.close();
  assert.throws(() => inspectMemoryDatabase(dbPath), { code: "VES_MEMORY_CORRUPT", recoverable: true });
});

test("backup validation failure publishes no backup and preserves authority", async () => {
  const { root, store } = await opened({
    hooks: {
      validateBackup: () => {
        throw new Error("invalid staging");
      }
    }
  });
  store.ingest(batch());
  const before = store.stateDigest();
  const target = join(root, "backup.sqlite");
  await assert.rejects(() => store.backupTo(target), { code: "VES_MEMORY_BACKUP_INVALID" });
  await assert.rejects(() => access(target));
  assert.equal(store.stateDigest(), before);
  store.close();
});

test("backup publication failure preserves active authority", async () => {
  const { root, store } = await opened({
    hooks: {
      publishBackup: async () => {
        throw new Error("rename denied");
      }
    }
  });
  store.ingest(batch());
  const before = store.stateDigest();
  await assert.rejects(() => store.backupTo(join(root, "backup.sqlite")), { code: "VES_MEMORY_BACKUP_PUBLISH_FAILED" });
  assert.equal(store.stateDigest(), before);
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "refund", limit: 5 }).length, 1);
  store.close();
});

test("failed rebuild restores the prior authoritative state atomically", async () => {
  let fail = false;
  const { store } = await opened({
    hooks: {
      afterReset: () => {
        if (fail) throw new Error("crash");
      }
    }
  });
  store.ingest(batch());
  const before = store.stateDigest();
  fail = true;
  assert.throws(() => store.rebuild([batch([source("source:new", { contents: ["new state"] })])]));
  assert.equal(store.stateDigest(), before);
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "refund", limit: 5 }).length, 1);
  store.close();
});

test("malformed lexical query and bounds fail without changing state", async () => {
  const { store } = await opened();
  store.ingest(batch());
  const before = store.stateDigest();
  assert.throws(() => store.lexicalSearch({ workspaceId, projectId, query: "", limit: 5 }), {
    code: "VES_MEMORY_INPUT_INVALID"
  });
  assert.throws(() => store.lexicalSearch({ workspaceId, projectId, query: "refund", limit: 0 }), {
    code: "VES_MEMORY_INPUT_INVALID"
  });
  assert.throws(() => store.invalidateStale({ workspaceId, projectId, evaluatedAt: "not-a-date" }), {
    code: "VES_MEMORY_INPUT_INVALID"
  });
  assert.equal(store.stateDigest(), before);
  store.close();
});
