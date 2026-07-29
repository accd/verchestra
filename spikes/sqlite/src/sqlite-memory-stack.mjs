import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { getLoadablePath } from "sqlite-vec";

export const QUALIFIED_SQLITE_ASSETS = Object.freeze({
  "linux-x64": Object.freeze({
    sha256: "5923730861b86c707cca5602b5f91092f9e52a46706dbc6e269fd4bb9c4498e8",
    bytes: 159816
  }),
  "win32-x64": Object.freeze({
    sha256: "fcf98662a7ad9dce394b96a88f91032047823831b951c76636787c312a6476e6",
    bytes: 289280
  })
});

export function qualifiedSqliteAsset({ platform = process.platform, arch = process.arch } = {}) {
  return QUALIFIED_SQLITE_ASSETS[`${platform}-${arch}`] ?? null;
}

const hostQualifiedSqliteAsset = qualifiedSqliteAsset();

export const QUALIFIED_SQLITE = Object.freeze({
  node: "24.14.0",
  sqlite: "3.51.2",
  sqliteVec: "0.1.9",
  sqliteVecVersion: "v0.1.9",
  sqliteVecSha256: hostQualifiedSqliteAsset?.sha256 ?? null,
  sqliteVecBytes: hostQualifiedSqliteAsset?.bytes ?? null
});

const SCHEMA_SQL = `
CREATE TABLE scopes (
  workspace TEXT NOT NULL,
  project TEXT NOT NULL,
  PRIMARY KEY (workspace, project)
) STRICT;
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  project TEXT NOT NULL,
  body TEXT NOT NULL,
  provenance TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  embedding TEXT,
  untrusted INTEGER NOT NULL DEFAULT 1 CHECK (untrusted = 1),
  FOREIGN KEY (workspace, project) REFERENCES scopes(workspace, project)
) STRICT;
CREATE VIRTUAL TABLE documents_fts USING fts5(
  id UNINDEXED,
  workspace UNINDEXED,
  project UNINDEXED,
  body,
  provenance UNINDEXED,
  source_updated_at UNINDEXED,
  tokenize = 'unicode61'
);`;

export const DEFAULT_MIGRATIONS = Object.freeze([{ id: "001_memory", sql: SCHEMA_SQL }]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableError(code, message, cause, recoverable = false) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.recoverable = recoverable;
  return error;
}

function mapSqliteError(error) {
  if (error?.code === "SQLITE_BUSY" || /database is locked/i.test(error?.message ?? "")) {
    return stableError("VES_SQLITE_BUSY", "SQLite is busy; retry the operation", error, true);
  }
  if (error?.code === "SQLITE_CONSTRAINT_FOREIGNKEY" || /constraint failed/i.test(error?.message ?? "")) {
    return stableError("VES_SQLITE_CONSTRAINT", "SQLite rejected a relational constraint", error);
  }
  return error;
}

function validateDocument(document) {
  const strings = ["id", "workspace", "project", "body", "provenance", "sourceUpdatedAt"];
  if (strings.some((key) => typeof document?.[key] !== "string" || document[key].trim() === "")) {
    throw stableError("VES_DOCUMENT_INVALID", "canonical document fields must be non-empty strings");
  }
  if (document.embedding !== undefined && (!Array.isArray(document.embedding) || document.embedding.length !== 3 || document.embedding.some((value) => !Number.isFinite(value)))) {
    throw stableError("VES_DOCUMENT_INVALID", "embedding must contain exactly three finite numbers");
  }
}

export function inspectSqliteRuntime() {
  const db = new DatabaseSync(":memory:", { allowExtension: true, defensive: true });
  try {
    const sqlite = db.prepare("SELECT sqlite_version() AS version").get().version;
    const compileOptions = db.prepare("PRAGMA compile_options").all().map((row) => Object.values(row)[0]);
    const path = getLoadablePath();
    const asset = readFileSync(path);
    db.loadExtension(path);
    const sqliteVec = db.prepare("SELECT vec_version() AS version").get().version.replace(/^v/, "");
    db.enableLoadExtension(false);
    return {
      node: process.versions.node,
      sqlite,
      fts5: compileOptions.includes("ENABLE_FTS5"),
      sqliteVec,
      sqliteVecSha256: sha256(asset)
    };
  } finally {
    db.close();
  }
}

export function inspectDatabaseFile(path, { assertExtensionsDisabled = false } = {}) {
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true, allowExtension: false, defensive: true });
    if (assertExtensionsDisabled) {
      assertLoadDenied(db);
    }
    const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
    if (integrity !== "ok") throw new Error(integrity);
    const documents = db.prepare("SELECT count(*) AS count FROM documents").get().count;
    return { integrity, documents };
  } catch (error) {
    if (error?.code === "ERR_INVALID_STATE") throw error;
    throw stableError("VES_SQLITE_CORRUPT", "SQLite database failed integrity validation", error, true);
  } finally {
    db?.close();
  }
}

function assertLoadDenied(db) {
  try {
    db.loadExtension(getLoadablePath());
  } catch (error) {
    if (error.code === "ERR_INVALID_STATE") return;
    throw error;
  }
  throw new Error("extension loading unexpectedly enabled");
}

export class SqliteMemoryStack {
  constructor({
    dbPath,
    timeoutMs = 100,
    vector = { enabled: true },
    migrations = DEFAULT_MIGRATIONS,
    hooks = {}
  }) {
    this.dbPath = dbPath;
    this.timeoutMs = timeoutMs;
    this.vector = { enabled: true, ...vector };
    this.migrations = migrations;
    this.hooks = hooks;
    this.db = null;
    this.vectorReady = false;
    this.vectorLoaded = false;
  }

  open() {
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath, {
      allowExtension: this.vector.enabled,
      timeout: this.timeoutMs,
      defensive: true
    });
    try {
      this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
      this.migrate();
      const vector = this.#bootstrapVector();
      return { vector };
    } catch (error) {
      this.close();
      throw error;
    }
  }

  close() {
    this.db?.close();
    this.db = null;
    this.vectorReady = false;
    this.vectorLoaded = false;
  }

  safetySettings() {
    return {
      journalMode: this.db.prepare("PRAGMA journal_mode").get().journal_mode,
      foreignKeys: this.db.prepare("PRAGMA foreign_keys").get().foreign_keys,
      busyTimeoutMs: this.db.prepare("PRAGMA busy_timeout").get().timeout,
      writableSchema: this.db.prepare("PRAGMA writable_schema").get().writable_schema
    };
  }

  migrate() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS ves_migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;`);
    let applied = 0;
    for (const migration of this.migrations) {
      const checksum = sha256(migration.sql);
      const existing = this.db.prepare("SELECT checksum FROM ves_migrations WHERE id=?").get(migration.id);
      if (existing && existing.checksum !== checksum) {
        throw stableError("VES_MIGRATION_CHECKSUM_DRIFT", `migration checksum drift: ${migration.id}`);
      }
      if (existing) continue;
      try {
        this.db.exec("BEGIN IMMEDIATE");
        this.db.exec(migration.sql);
        this.db.prepare("INSERT INTO ves_migrations(id, checksum, applied_at) VALUES (?, ?, ?)").run(migration.id, checksum, new Date().toISOString());
        this.db.exec("COMMIT");
        applied += 1;
      } catch (error) {
        if (this.db.isTransaction) this.db.exec("ROLLBACK");
        throw mapSqliteError(error);
      }
    }
    return { applied };
  }

  migrationLedger() {
    return this.db.prepare("SELECT id, checksum FROM ves_migrations ORDER BY id").all();
  }

  #bootstrapVector() {
    if (!this.vector.enabled) return { enabled: false, version: null, code: "VES_VECTOR_DISABLED" };
    let code = "VES_VECTOR_UNAVAILABLE";
    try {
      if (!hostQualifiedSqliteAsset) throw new Error("platform is not qualified");
      const path = this.vector.path ?? getLoadablePath();
      const asset = readFileSync(path);
      const expected = this.vector.expectedSha256 ?? hostQualifiedSqliteAsset.sha256;
      if (sha256(asset) !== expected) {
        code = "VES_VECTOR_ASSET_MISMATCH";
        throw new Error("asset mismatch");
      }
      this.db.loadExtension(path);
      this.vectorLoaded = true;
      const version = this.db.prepare("SELECT vec_version() AS version").get().version;
      if (version !== QUALIFIED_SQLITE.sqliteVecVersion) throw new Error("version mismatch");
      this.#createVectorTable();
      this.vectorReady = true;
      return { enabled: true, version, code: "VES_VECTOR_READY" };
    } catch {
      this.vectorReady = false;
      return { enabled: false, version: null, code };
    } finally {
      this.db.enableLoadExtension(false);
    }
  }

  #createVectorTable() {
    this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS vec_documents USING vec0(embedding float[3])");
  }

  upsertDocuments(documents) {
    for (const document of documents) validateDocument(document);
    let changed = 0;
    const changedDocuments = [];
    try {
      this.db.exec("BEGIN IMMEDIATE");
      for (const document of documents) {
        const digest = sha256(JSON.stringify({
          workspace: document.workspace,
          project: document.project,
          body: document.body,
          provenance: document.provenance,
          sourceUpdatedAt: document.sourceUpdatedAt,
          embedding: document.embedding ?? null
        }));
        const current = this.db.prepare("SELECT content_digest FROM documents WHERE id=?").get(document.id);
        if (current?.content_digest === digest) continue;
        this.db.prepare("INSERT OR IGNORE INTO scopes(workspace, project) VALUES (?, ?)").run(document.workspace, document.project);
        this.db.prepare(`INSERT INTO documents(id, workspace, project, body, provenance, source_updated_at, content_digest, embedding)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET workspace=excluded.workspace, project=excluded.project, body=excluded.body,
            provenance=excluded.provenance, source_updated_at=excluded.source_updated_at,
            content_digest=excluded.content_digest, embedding=excluded.embedding`).run(
          document.id, document.workspace, document.project, document.body, document.provenance,
          document.sourceUpdatedAt, digest, document.embedding ? JSON.stringify(document.embedding) : null
        );
        this.db.prepare("DELETE FROM documents_fts WHERE id=?").run(document.id);
        this.db.prepare("INSERT INTO documents_fts(id, workspace, project, body, provenance, source_updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
          document.id, document.workspace, document.project, document.body, document.provenance, document.sourceUpdatedAt
        );
        changed += 1;
        changedDocuments.push(document.id);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw mapSqliteError(error);
    }
    if (this.vectorReady) {
      for (const id of changedDocuments) this.#refreshVector(id);
    }
    return { changed, digest: this.stateDigest() };
  }

  #refreshVector(id) {
    try {
      const row = this.db.prepare("SELECT rowid, embedding FROM documents WHERE id=?").get(id);
      const vectorRowId = BigInt(row.rowid);
      this.db.prepare("DELETE FROM vec_documents WHERE rowid=?").run(vectorRowId);
      if (row.embedding) this.db.prepare("INSERT INTO vec_documents(rowid, embedding) VALUES (?, ?)").run(vectorRowId, row.embedding);
    } catch {
      this.vectorReady = false;
    }
  }

  searchLexical(query, scope) {
    if (!scope?.workspace || !scope?.project) throw stableError("VES_SCOPE_REQUIRED", "workspace and project scopes are required");
    return this.db.prepare(`SELECT id, body, provenance, source_updated_at
      FROM documents_fts
      WHERE documents_fts MATCH ? AND workspace=? AND project=?
      ORDER BY bm25(documents_fts), id`).all(query, scope.workspace, scope.project).map((row) => ({
      id: row.id,
      body: row.body,
      provenance: row.provenance,
      sourceUpdatedAt: row.source_updated_at,
      untrusted: true,
      retrieval: "fts5",
      explanation: `FTS5 lexical match scoped to workspace=${scope.workspace} project=${scope.project}`
    }));
  }

  searchVector(embedding, scope) {
    if (!scope?.workspace || !scope?.project) throw stableError("VES_SCOPE_REQUIRED", "workspace and project scopes are required");
    if (!this.vectorReady) throw stableError("VES_VECTOR_UNAVAILABLE", "derived vector index is unavailable", undefined, true);
    const k = Math.max(this.documentCount(), scope.limit ?? 10);
    const rows = this.db.prepare(`SELECT d.id, d.body, d.provenance, d.source_updated_at, v.distance
      FROM vec_documents v JOIN documents d ON d.rowid=v.rowid
      WHERE v.embedding MATCH ? AND k=? AND d.workspace=? AND d.project=?
      ORDER BY v.distance LIMIT ?`).all(JSON.stringify(embedding), k, scope.workspace, scope.project, scope.limit ?? 10);
    return rows.map((row) => ({
      id: row.id,
      body: row.body,
      provenance: row.provenance,
      sourceUpdatedAt: row.source_updated_at,
      untrusted: true,
      retrieval: "sqlite-vec",
      distance: row.distance,
      explanation: `sqlite-vec nearest neighbor scoped to workspace=${scope.workspace} project=${scope.project}`
    }));
  }

  dropVectorIndexForTest() {
    if (this.vectorLoaded) this.db.exec("DROP TABLE IF EXISTS vec_documents");
    this.vectorReady = false;
  }

  rebuildVectorIndex() {
    if (!this.vectorLoaded) throw stableError("VES_VECTOR_UNAVAILABLE", "sqlite-vec was not loaded", undefined, true);
    this.#createVectorTable();
    let rebuilt = 0;
    for (const row of this.db.prepare("SELECT rowid, embedding FROM documents WHERE embedding IS NOT NULL ORDER BY id").all()) {
      this.db.prepare("INSERT INTO vec_documents(rowid, embedding) VALUES (?, ?)").run(BigInt(row.rowid), row.embedding);
      rebuilt += 1;
    }
    this.vectorReady = true;
    return { rebuilt };
  }

  documentCount() {
    return this.db.prepare("SELECT count(*) AS count FROM documents").get().count;
  }

  stateDigest() {
    const documents = this.db.prepare(`SELECT id, workspace, project, body, provenance, source_updated_at, content_digest, embedding
      FROM documents ORDER BY id`).all();
    const migrations = this.migrationLedger();
    return sha256(JSON.stringify({ migrations, documents }));
  }

  async backupTo(targetPath) {
    const stagingPath = `${targetPath}.staging-${crypto.randomUUID()}`;
    mkdirSync(dirname(targetPath), { recursive: true });
    try {
      await backup(this.db, stagingPath);
      try {
        (this.hooks.validateBackup ?? inspectDatabaseFile)(stagingPath);
      } catch (error) {
        throw stableError("VES_BACKUP_INVALID", "staged backup failed integrity validation", error, true);
      }
      const bytes = await readFile(stagingPath);
      const manifest = { sha256: sha256(bytes), stateDigest: this.stateDigest(), documents: this.documentCount() };
      try {
        await (this.hooks.publishBackup ?? rename)(stagingPath, targetPath);
      } catch (error) {
        throw stableError("VES_BACKUP_PUBLISH_FAILED", "backup publication failed", error, true);
      }
      return { code: "VES_BACKUP_READY", path: targetPath, manifest };
    } finally {
      if (existsSync(stagingPath)) await rm(stagingPath, { force: true });
    }
  }

  loadExtensionForTest(path) {
    return this.db.loadExtension(path);
  }

  attemptWritableSchemaForTest() {
    this.db.exec("PRAGMA writable_schema=ON");
    return this.db.prepare("PRAGMA writable_schema").get().writable_schema;
  }

  insertOrphanForTest() {
    try {
      this.db.prepare(`INSERT INTO documents(id, workspace, project, body, provenance, source_updated_at, content_digest)
        VALUES ('orphan', 'missing', 'missing', 'body', 'source', '2026-01-01T00:00:00Z', 'digest')`).run();
    } catch (error) {
      throw mapSqliteError(error);
    }
  }
}
