import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";

interface UnknownRecord {
  readonly [key: string]: unknown;
  readonly schemaVersion?: unknown;
  readonly workspaceId?: unknown;
  readonly projectId?: unknown;
  readonly manifestRef?: unknown;
  readonly sources?: unknown;
  readonly sourceId?: unknown;
  readonly kind?: unknown;
  readonly revision?: unknown;
  readonly retrievedAt?: unknown;
  readonly validUntil?: unknown;
  readonly classification?: unknown;
  readonly contentDigest?: unknown;
  readonly chunks?: unknown;
  readonly chunkId?: unknown;
  readonly ordinal?: unknown;
  readonly content?: unknown;
  readonly includeInactive?: unknown;
  readonly query?: unknown;
  readonly limit?: unknown;
  readonly evaluatedAt?: unknown;
  readonly count?: unknown;
  readonly integrity_check?: unknown;
  readonly id?: unknown;
  readonly checksum?: unknown;
  readonly compile_options?: unknown;
  readonly journal_mode?: unknown;
  readonly foreign_keys?: unknown;
  readonly timeout?: unknown;
  readonly writable_schema?: unknown;
  readonly generation_id?: unknown;
  readonly manifest_digest?: unknown;
  readonly source_id?: unknown;
  readonly observation_id?: unknown;
  readonly source_kind?: unknown;
  readonly retrieved_at?: unknown;
  readonly valid_until?: unknown;
  readonly content_digest?: unknown;
  readonly manifest_ref?: unknown;
  readonly state?: unknown;
  readonly status?: unknown;
  readonly manifest_json?: unknown;
  readonly chunk_id?: unknown;
}
type Classification = "public" | "internal" | "confidential" | "restricted";
type SourceKind = "repository" | "tracker" | "knowledge" | "memory" | "database";
type SourceState = "active" | "stale" | "deleted" | "superseded";

export interface MemoryMigration {
  readonly id: string;
  readonly up: string;
}

export interface MemoryChunkInput {
  readonly chunkId: string;
  readonly ordinal: number;
  readonly content: string;
  readonly contentDigest: string;
}

export interface MemorySourceInput {
  readonly sourceId: string;
  readonly kind: SourceKind;
  readonly revision: string;
  readonly retrievedAt: string;
  readonly validUntil: string | null;
  readonly classification: Classification;
  readonly contentDigest: string;
  readonly chunks: readonly MemoryChunkInput[];
}

export interface MemoryIngestionBatch {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly manifestRef: string;
  readonly sources: readonly MemorySourceInput[];
}

type NormalizedChunk = MemoryChunkInput;

interface NormalizedSource extends Omit<MemorySourceInput, "chunks"> {
  readonly observationId: string;
  readonly chunks: readonly NormalizedChunk[];
}

interface NormalizedBatch extends Omit<MemoryIngestionBatch, "sources"> {
  readonly generationId: string;
  readonly manifestDigest: string;
  readonly manifestJson: string;
  readonly sources: readonly NormalizedSource[];
}

export interface MemoryStoreHooks {
  readonly afterChunkInsert?: () => void;
  readonly afterSourceInvalidated?: () => void;
  readonly afterReset?: () => void;
  readonly validateBackup?: (path: string) => unknown;
  readonly publishBackup?: (source: string, target: string) => Promise<unknown>;
}

export interface MemoryStoreOptions {
  readonly dbPath: string;
  readonly timeoutMs?: number;
  readonly migrations?: readonly MemoryMigration[];
  readonly now?: () => string;
  readonly hooks?: MemoryStoreHooks;
}

export interface MemoryIngestionResult {
  readonly generationId: string;
  readonly manifestDigest: string;
  readonly changed: boolean;
  readonly sourceCount: number;
  readonly chunkCount: number;
  readonly invalidatedSourceIds: readonly string[];
}

const MEMORY_SCHEMA = `
CREATE TABLE ingestion_generations (
  generation_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  manifest_digest TEXT NOT NULL CHECK (length(manifest_digest) = 71),
  manifest_ref TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded')),
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, project_id, manifest_digest)
) STRICT;
CREATE UNIQUE INDEX one_active_memory_generation
  ON ingestion_generations(workspace_id, project_id) WHERE status = 'active';

CREATE TABLE memory_source_versions (
  observation_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('repository', 'tracker', 'knowledge', 'memory', 'database')),
  revision TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  valid_until TEXT,
  classification TEXT NOT NULL CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  content_digest TEXT NOT NULL CHECK (length(content_digest) = 71),
  generation_id TEXT NOT NULL,
  manifest_ref TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'stale', 'deleted', 'superseded')),
  UNIQUE (workspace_id, project_id, source_id, observation_id)
) STRICT;
CREATE INDEX memory_source_versions_scope ON memory_source_versions(workspace_id, project_id, source_id);

CREATE TABLE memory_source_heads (
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  observation_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'stale', 'deleted')),
  PRIMARY KEY (workspace_id, project_id, source_id),
  FOREIGN KEY (observation_id) REFERENCES memory_source_versions(observation_id)
) STRICT;

CREATE TABLE memory_chunks (
  observation_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  content TEXT NOT NULL,
  content_digest TEXT NOT NULL CHECK (length(content_digest) = 71),
  state TEXT NOT NULL CHECK (state IN ('active', 'stale', 'deleted', 'superseded')),
  PRIMARY KEY (observation_id, chunk_id),
  UNIQUE (observation_id, ordinal),
  FOREIGN KEY (observation_id) REFERENCES memory_source_versions(observation_id) ON DELETE CASCADE
) STRICT;
CREATE INDEX memory_chunks_scope ON memory_chunks(workspace_id, project_id, source_id, state);

CREATE VIRTUAL TABLE memory_fts USING fts5(
  content,
  workspace_id UNINDEXED,
  project_id UNINDEXED,
  source_id UNINDEXED,
  observation_id UNINDEXED,
  chunk_id UNINDEXED,
  tokenize='porter unicode61'
);`;

export const DEFAULT_MEMORY_MIGRATIONS: readonly MemoryMigration[] = Object.freeze([
  Object.freeze({ id: "001_authoritative_lexical_memory", up: MEMORY_SCHEMA })
]);

export class MemoryStoreError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  override readonly cause?: unknown;

  constructor(code: string, message: string, recoverable = false, cause?: unknown) {
    super(message);
    this.name = "MemoryStoreError";
    this.code = code;
    this.recoverable = recoverable;
    if (cause !== undefined) this.cause = cause;
  }
}

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

const memoryError = (code: string, message: string, recoverable = false, cause?: unknown): MemoryStoreError =>
  new MemoryStoreError(code, message, recoverable, cause);

function mapSqliteError(error: unknown): Error {
  if (error instanceof MemoryStoreError) return error;
  const code = errorCode(error);
  if (code === "ERR_SQLITE_ERROR" && error instanceof Error && /locked|busy/iu.test(error.message)) {
    return memoryError("VES_MEMORY_BUSY", "Memory store is busy", true, error);
  }
  if (code === "ERR_SQLITE_CONSTRAINT") {
    return memoryError("VES_MEMORY_CONSTRAINT", "Memory store constraint rejected the operation", false, error);
  }
  if (
    code === "ERR_SQLITE_ERROR" &&
    error instanceof Error &&
    /malformed|not a database|database disk image/iu.test(error.message)
  ) {
    return memoryError("VES_MEMORY_CORRUPT", "Memory database is corrupt", true, error);
  }
  return error instanceof Error ? error : new Error(String(error));
}

const rawSha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const sha256 = (value: string | Uint8Array): string => `sha256:${rawSha256(value)}`;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as UnknownRecord)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$/u;
const SOURCE_KINDS = new Set<SourceKind>(["repository", "tracker", "knowledge", "memory", "database"]);
const CLASSIFICATIONS = new Set<Classification>(["public", "internal", "confidential", "restricted"]);

function inputError(message: string): never {
  throw memoryError("VES_MEMORY_INPUT_INVALID", message);
}

function record(value: unknown, name: string, keys: readonly string[]): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) inputError(`${name} must be an object`);
  const result = value as UnknownRecord;
  const extras = Object.keys(result).filter((key) => !keys.includes(key));
  if (extras.length > 0) inputError(`${name} contains unsupported fields: ${extras.sort().join(", ")}`);
  return result;
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) inputError(`${name} is invalid`);
  return value;
}

function nonEmpty(value: unknown, name: string, maximum = 16_384): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) inputError(`${name} is invalid`);
  return value;
}

function digest(value: unknown, name: string): string {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) inputError(`${name} must be a SHA-256 digest`);
  return value;
}

function instant(value: unknown, name: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) inputError(`${name} must be an ISO instant`);
  return value;
}

function normalizeBatch(value: unknown): NormalizedBatch {
  const batch = record(value, "ingestion batch", [
    "schemaVersion",
    "workspaceId",
    "projectId",
    "manifestRef",
    "sources"
  ]);
  if (batch.schemaVersion !== 1) inputError("schemaVersion must equal 1");
  const workspaceId = identifier(batch.workspaceId, "workspaceId");
  const projectId = identifier(batch.projectId, "projectId");
  const manifestRef = identifier(batch.manifestRef, "manifestRef");
  if (!Array.isArray(batch.sources)) inputError("sources must be an array");
  const seenSources = new Set<string>();
  const sources = batch.sources
    .map((item, sourceIndex): NormalizedSource => {
      const source = record(item, `sources[${sourceIndex}]`, [
        "sourceId",
        "kind",
        "revision",
        "retrievedAt",
        "validUntil",
        "classification",
        "contentDigest",
        "chunks"
      ]);
      const sourceId = identifier(source.sourceId, `sources[${sourceIndex}].sourceId`);
      if (seenSources.has(sourceId)) inputError(`Duplicate sourceId: ${sourceId}`);
      seenSources.add(sourceId);
      if (typeof source.kind !== "string" || !SOURCE_KINDS.has(source.kind as SourceKind))
        inputError("source kind is invalid");
      if (typeof source.classification !== "string" || !CLASSIFICATIONS.has(source.classification as Classification)) {
        inputError("source classification is invalid");
      }
      const revision = nonEmpty(source.revision, `sources[${sourceIndex}].revision`, 1_024);
      const retrievedAt = instant(source.retrievedAt, `sources[${sourceIndex}].retrievedAt`);
      const validUntil =
        source.validUntil === null ? null : instant(source.validUntil, `sources[${sourceIndex}].validUntil`);
      if (validUntil !== null && Date.parse(validUntil) < Date.parse(retrievedAt))
        inputError("validUntil precedes retrievedAt");
      const contentDigest = digest(source.contentDigest, `sources[${sourceIndex}].contentDigest`);
      if (!Array.isArray(source.chunks) || source.chunks.length === 0)
        inputError("source chunks must be a non-empty array");
      const seenChunkIds = new Set<string>();
      const seenOrdinals = new Set<number>();
      const chunks = source.chunks
        .map((chunkValue, chunkIndex): NormalizedChunk => {
          const chunk = record(chunkValue, `sources[${sourceIndex}].chunks[${chunkIndex}]`, [
            "chunkId",
            "ordinal",
            "content",
            "contentDigest"
          ]);
          const chunkId = identifier(chunk.chunkId, "chunkId");
          if (seenChunkIds.has(chunkId)) inputError(`Duplicate chunkId: ${chunkId}`);
          seenChunkIds.add(chunkId);
          if (!Number.isSafeInteger(chunk.ordinal) || Number(chunk.ordinal) < 0) inputError("chunk ordinal is invalid");
          const ordinal = Number(chunk.ordinal);
          if (seenOrdinals.has(ordinal)) inputError(`Duplicate chunk ordinal: ${ordinal}`);
          seenOrdinals.add(ordinal);
          const content = nonEmpty(chunk.content, "chunk content", 1_000_000);
          const contentDigest = digest(chunk.contentDigest, "chunk contentDigest");
          if (sha256(content) !== contentDigest) inputError(`Chunk digest mismatch: ${chunkId}`);
          return Object.freeze({ chunkId, ordinal, content, contentDigest });
        })
        .sort((left, right) => left.ordinal - right.ordinal || left.chunkId.localeCompare(right.chunkId));
      chunks.forEach((chunk, index) => {
        if (chunk.ordinal !== index) inputError(`Chunk ordinals must be contiguous for ${sourceId}`);
      });
      const identity = {
        workspaceId,
        projectId,
        sourceId,
        kind: source.kind,
        revision,
        retrievedAt,
        validUntil,
        classification: source.classification,
        contentDigest,
        chunks: chunks.map((chunk) => ({
          chunkId: chunk.chunkId,
          ordinal: chunk.ordinal,
          contentDigest: chunk.contentDigest
        }))
      };
      return Object.freeze({
        sourceId,
        kind: source.kind as SourceKind,
        revision,
        retrievedAt,
        validUntil,
        classification: source.classification as Classification,
        contentDigest,
        observationId: sha256(canonical(identity)),
        chunks: Object.freeze(chunks)
      });
    })
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const manifest = {
    schemaVersion: 1,
    workspaceId,
    projectId,
    manifestRef,
    sources: sources.map((source) => ({
      sourceId: source.sourceId,
      observationId: source.observationId,
      contentDigest: source.contentDigest,
      chunkDigests: source.chunks.map((chunk) => chunk.contentDigest)
    }))
  };
  const manifestJson = canonical(manifest);
  const manifestDigest = sha256(manifestJson);
  return Object.freeze({
    schemaVersion: 1,
    workspaceId,
    projectId,
    manifestRef,
    generationId: sha256(canonical({ workspaceId, projectId, manifestDigest })),
    manifestDigest,
    manifestJson,
    sources: Object.freeze(sources)
  });
}

function assertScope(value: unknown): { workspaceId: string; projectId: string } {
  const scope = record(value, "scope", ["workspaceId", "projectId"]);
  return {
    workspaceId: identifier(scope.workspaceId, "workspaceId"),
    projectId: identifier(scope.projectId, "projectId")
  };
}

function assertExtensionLoadingDenied(db: DatabaseSync): void {
  try {
    db.loadExtension("forbidden-extension");
  } catch (error) {
    if (errorCode(error) === "ERR_INVALID_STATE") return;
    throw error;
  }
  throw memoryError("VES_MEMORY_EXTENSION_ENABLED", "SQLite extension loading unexpectedly enabled");
}

function count(db: DatabaseSync, sql: string): number {
  return Number((db.prepare(sql).get() as UnknownRecord).count);
}

function assertAuthoritativeProjection(db: DatabaseSync): void {
  const chunks = db.prepare("SELECT chunk_id, content, content_digest FROM memory_chunks").all() as UnknownRecord[];
  for (const chunk of chunks) {
    if (sha256(String(chunk.content)) !== String(chunk.content_digest)) {
      throw memoryError("VES_MEMORY_CORRUPT", `Chunk content digest mismatch: ${String(chunk.chunk_id)}`, true);
    }
  }
  const projectionDrift = count(
    db,
    `WITH extra_fts AS (
      SELECT content, workspace_id, project_id, source_id, observation_id, chunk_id FROM memory_fts
      EXCEPT
      SELECT content, workspace_id, project_id, source_id, observation_id, chunk_id FROM memory_chunks WHERE state='active'
    ), missing_fts AS (
      SELECT content, workspace_id, project_id, source_id, observation_id, chunk_id FROM memory_chunks WHERE state='active'
      EXCEPT
      SELECT content, workspace_id, project_id, source_id, observation_id, chunk_id FROM memory_fts
    ) SELECT (SELECT count(*) FROM extra_fts) + (SELECT count(*) FROM missing_fts) AS count`
  );
  if (projectionDrift !== 0)
    throw memoryError("VES_MEMORY_CORRUPT", "FTS5 projection differs from active chunks", true);
}

function activeState(db: DatabaseSync): unknown {
  return {
    generations: db
      .prepare(
        `SELECT generation_id, workspace_id, project_id, manifest_digest, manifest_ref, manifest_json
      FROM ingestion_generations WHERE status='active' ORDER BY workspace_id, project_id`
      )
      .all(),
    sources: db
      .prepare(
        `SELECT h.workspace_id, h.project_id, h.source_id, h.observation_id, h.state,
      v.source_kind, v.revision, v.retrieved_at, v.valid_until, v.classification, v.content_digest, v.generation_id, v.manifest_ref
      FROM memory_source_heads h JOIN memory_source_versions v ON v.observation_id=h.observation_id
      WHERE h.state='active' ORDER BY h.workspace_id, h.project_id, h.source_id`
      )
      .all(),
    chunks: db
      .prepare(
        `SELECT observation_id, chunk_id, workspace_id, project_id, source_id, ordinal, content_digest
      FROM memory_chunks WHERE state='active' ORDER BY workspace_id, project_id, source_id, ordinal, chunk_id`
      )
      .all()
  };
}

function memoryStateDigest(db: DatabaseSync): string {
  assertAuthoritativeProjection(db);
  return sha256(canonical(activeState(db)));
}

function stateDigestFromFile(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true, allowExtension: false, defensive: true });
  try {
    return memoryStateDigest(db);
  } finally {
    db.close();
  }
}

export function inspectMemoryDatabase(
  path: string,
  options: { readonly assertExtensionsDisabled?: boolean } = {}
): {
  readonly integrity: "ok";
  readonly sources: number;
  readonly chunks: number;
  readonly ftsRows: number;
  readonly migrations: number;
} {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true, allowExtension: false, defensive: true });
    if (options.assertExtensionsDisabled === true) assertExtensionLoadingDenied(db);
    const integrity = String((db.prepare("PRAGMA integrity_check").get() as UnknownRecord).integrity_check);
    if (integrity !== "ok") throw new Error(integrity);
    assertAuthoritativeProjection(db);
    return {
      integrity: "ok",
      sources: count(db, "SELECT count(*) AS count FROM memory_source_heads WHERE state='active'"),
      chunks: count(db, "SELECT count(*) AS count FROM memory_chunks WHERE state='active'"),
      ftsRows: count(db, "SELECT count(*) AS count FROM memory_fts"),
      migrations: count(db, "SELECT count(*) AS count FROM ves_memory_migrations")
    };
  } catch (error) {
    if (error instanceof MemoryStoreError && error.code === "VES_MEMORY_EXTENSION_ENABLED") throw error;
    throw memoryError("VES_MEMORY_CORRUPT", "Memory database failed integrity or schema validation", true, error);
  } finally {
    db?.close();
  }
}

export class MemoryStore {
  readonly dbPath: string;
  readonly #timeoutMs: number;
  readonly #migrations: readonly MemoryMigration[];
  readonly #hooks: MemoryStoreHooks;
  readonly #now: () => string;
  readonly #usesDefaultMigrations: boolean;
  #db: DatabaseSync | undefined;

  constructor(options: MemoryStoreOptions) {
    this.dbPath = options.dbPath;
    this.#timeoutMs = options.timeoutMs ?? 100;
    this.#migrations = options.migrations ?? DEFAULT_MEMORY_MIGRATIONS;
    this.#usesDefaultMigrations = options.migrations === undefined;
    this.#hooks = options.hooks ?? {};
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  open(): { readonly appliedMigrations: number } {
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.#db = new DatabaseSync(this.dbPath, { timeout: this.#timeoutMs, allowExtension: false, defensive: true });
    try {
      this.#db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA writable_schema=OFF;");
      const appliedMigrations = this.#migrate();
      if (this.#usesDefaultMigrations) this.#validateAuthoritativeSchema();
      return { appliedMigrations };
    } catch (error) {
      this.close();
      throw mapSqliteError(error);
    }
  }

  close(): void {
    this.#db?.close();
    this.#db = undefined;
  }

  #database(): DatabaseSync {
    if (this.#db === undefined) throw memoryError("VES_MEMORY_CLOSED", "Memory store is closed");
    return this.#db;
  }

  #validateAuthoritativeSchema(): void {
    try {
      const db = this.#database();
      const integrity = String((db.prepare("PRAGMA integrity_check").get() as UnknownRecord).integrity_check);
      if (integrity !== "ok") throw new Error(integrity);
      assertAuthoritativeProjection(db);
    } catch (error) {
      if (error instanceof MemoryStoreError && error.code === "VES_MEMORY_CORRUPT") throw error;
      throw memoryError("VES_MEMORY_CORRUPT", "Memory database failed authoritative schema validation", true, error);
    }
  }

  #migrate(): number {
    const db = this.#database();
    db.exec(`CREATE TABLE IF NOT EXISTS ves_memory_migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;`);
    const existing = db.prepare("SELECT id, checksum FROM ves_memory_migrations ORDER BY id").all() as UnknownRecord[];
    const declaredIds = new Set(this.#migrations.map((migration) => migration.id));
    const existingById = new Map(existing.map((row) => [String(row.id), String(row.checksum)]));
    for (const migration of this.#migrations) {
      const appliedChecksum = existingById.get(migration.id);
      if (appliedChecksum !== undefined && appliedChecksum !== rawSha256(migration.up)) {
        throw memoryError("VES_MEMORY_MIGRATION_DRIFT", `Memory migration checksum drift: ${migration.id}`);
      }
    }
    if (existing.some((row) => !declaredIds.has(String(row.id)))) {
      throw memoryError("VES_MEMORY_MIGRATION_INCOMPATIBLE", "Memory database contains an unknown migration");
    }
    let applied = 0;
    for (const migration of this.#migrations) {
      if (existingById.has(migration.id)) continue;
      try {
        db.exec("BEGIN IMMEDIATE");
        db.exec(migration.up);
        db.prepare("INSERT INTO ves_memory_migrations(id, checksum, applied_at) VALUES (?, ?, ?)").run(
          migration.id,
          rawSha256(migration.up),
          this.#now()
        );
        db.exec("COMMIT");
        applied += 1;
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw mapSqliteError(error);
      }
    }
    return applied;
  }

  migrationLedger(): readonly { readonly id: string; readonly checksum: string }[] {
    return (
      this.#database().prepare("SELECT id, checksum FROM ves_memory_migrations ORDER BY id").all() as UnknownRecord[]
    ).map((row) => ({ id: String(row.id), checksum: String(row.checksum) }));
  }

  downgradeTo(migrationId: string): never {
    throw memoryError(
      "VES_MEMORY_DOWNGRADE_UNSUPPORTED",
      `Automatic memory database downgrade to ${migrationId} is prohibited; restore a compatible backup`
    );
  }

  safetySettings(): {
    readonly journalMode: string;
    readonly foreignKeys: number;
    readonly busyTimeoutMs: number;
    readonly writableSchema: number;
    readonly fts5: boolean;
  } {
    const db = this.#database();
    const options = (db.prepare("PRAGMA compile_options").all() as UnknownRecord[]).map((row) =>
      String(row.compile_options)
    );
    return {
      journalMode: String((db.prepare("PRAGMA journal_mode").get() as UnknownRecord).journal_mode),
      foreignKeys: Number((db.prepare("PRAGMA foreign_keys").get() as UnknownRecord).foreign_keys),
      busyTimeoutMs: Number((db.prepare("PRAGMA busy_timeout").get() as UnknownRecord).timeout),
      writableSchema: Number((db.prepare("PRAGMA writable_schema").get() as UnknownRecord).writable_schema),
      fts5: options.includes("ENABLE_FTS5")
    };
  }

  #applyIngestion(batch: NormalizedBatch): MemoryIngestionResult {
    const db = this.#database();
    const current = db
      .prepare(
        `SELECT generation_id, manifest_digest FROM ingestion_generations
      WHERE workspace_id=? AND project_id=? AND status='active'`
      )
      .get(batch.workspaceId, batch.projectId) as UnknownRecord | undefined;
    const sourceCount = batch.sources.length;
    const chunkCount = batch.sources.reduce((total, source) => total + source.chunks.length, 0);
    if (current !== undefined && current.manifest_digest === batch.manifestDigest) {
      return {
        generationId: String(current.generation_id),
        manifestDigest: batch.manifestDigest,
        changed: false,
        sourceCount,
        chunkCount,
        invalidatedSourceIds: Object.freeze([])
      };
    }

    const existingHeads = db
      .prepare(
        `SELECT source_id, observation_id, state FROM memory_source_heads
      WHERE workspace_id=? AND project_id=? ORDER BY source_id`
      )
      .all(batch.workspaceId, batch.projectId) as UnknownRecord[];
    const existingBySource = new Map(existingHeads.map((row) => [String(row.source_id), row]));
    const nextIds = new Set(batch.sources.map((source) => source.sourceId));
    const invalidated = new Set<string>();

    db.prepare(
      "UPDATE ingestion_generations SET status='superseded' WHERE workspace_id=? AND project_id=? AND status='active'"
    ).run(batch.workspaceId, batch.projectId);
    db.prepare(
      `INSERT INTO ingestion_generations(
      generation_id, workspace_id, project_id, manifest_digest, manifest_ref, manifest_json, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
    ON CONFLICT(generation_id) DO UPDATE SET manifest_ref=excluded.manifest_ref, manifest_json=excluded.manifest_json,
      status='active', created_at=excluded.created_at`
    ).run(
      batch.generationId,
      batch.workspaceId,
      batch.projectId,
      batch.manifestDigest,
      batch.manifestRef,
      batch.manifestJson,
      this.#now()
    );

    for (const source of batch.sources) {
      const previous = existingBySource.get(source.sourceId);
      const previousObservation = previous === undefined ? undefined : String(previous.observation_id);
      if (previousObservation !== undefined && previousObservation !== source.observationId) {
        invalidated.add(source.sourceId);
        db.prepare("UPDATE memory_source_versions SET state='superseded' WHERE observation_id=?").run(
          previousObservation
        );
        db.prepare("UPDATE memory_chunks SET state='superseded' WHERE observation_id=?").run(previousObservation);
        db.prepare("DELETE FROM memory_fts WHERE observation_id=?").run(previousObservation);
        this.#hooks.afterSourceInvalidated?.();
      }

      db.prepare(
        `INSERT INTO memory_source_versions(
        observation_id, workspace_id, project_id, source_id, source_kind, revision, retrieved_at, valid_until,
        classification, content_digest, generation_id, manifest_ref, state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
      ON CONFLICT(observation_id) DO UPDATE SET generation_id=excluded.generation_id, manifest_ref=excluded.manifest_ref,
        state='active'`
      ).run(
        source.observationId,
        batch.workspaceId,
        batch.projectId,
        source.sourceId,
        source.kind,
        source.revision,
        source.retrievedAt,
        source.validUntil,
        source.classification,
        source.contentDigest,
        batch.generationId,
        batch.manifestRef
      );
      db.prepare(
        `INSERT INTO memory_source_heads(workspace_id, project_id, source_id, observation_id, state)
        VALUES (?, ?, ?, ?, 'active')
        ON CONFLICT(workspace_id, project_id, source_id) DO UPDATE SET observation_id=excluded.observation_id, state='active'`
      ).run(batch.workspaceId, batch.projectId, source.sourceId, source.observationId);
      db.prepare("DELETE FROM memory_fts WHERE observation_id=?").run(source.observationId);
      for (const chunk of source.chunks) {
        db.prepare(
          `INSERT INTO memory_chunks(
          observation_id, chunk_id, workspace_id, project_id, source_id, ordinal, content, content_digest, state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
        ON CONFLICT(observation_id, chunk_id) DO UPDATE SET state='active', content=excluded.content,
          content_digest=excluded.content_digest, ordinal=excluded.ordinal`
        ).run(
          source.observationId,
          chunk.chunkId,
          batch.workspaceId,
          batch.projectId,
          source.sourceId,
          chunk.ordinal,
          chunk.content,
          chunk.contentDigest
        );
        db.prepare(
          `INSERT INTO memory_fts(content, workspace_id, project_id, source_id, observation_id, chunk_id)
          VALUES (?, ?, ?, ?, ?, ?)`
        ).run(chunk.content, batch.workspaceId, batch.projectId, source.sourceId, source.observationId, chunk.chunkId);
        this.#hooks.afterChunkInsert?.();
      }
    }

    for (const previous of existingHeads) {
      const sourceId = String(previous.source_id);
      if (nextIds.has(sourceId)) continue;
      invalidated.add(sourceId);
      const observationId = String(previous.observation_id);
      db.prepare("UPDATE memory_source_versions SET state='deleted' WHERE observation_id=?").run(observationId);
      db.prepare(
        "UPDATE memory_source_heads SET state='deleted' WHERE workspace_id=? AND project_id=? AND source_id=?"
      ).run(batch.workspaceId, batch.projectId, sourceId);
      db.prepare("UPDATE memory_chunks SET state='deleted' WHERE observation_id=?").run(observationId);
      db.prepare("DELETE FROM memory_fts WHERE observation_id=?").run(observationId);
      this.#hooks.afterSourceInvalidated?.();
    }
    return {
      generationId: batch.generationId,
      manifestDigest: batch.manifestDigest,
      changed: true,
      sourceCount,
      chunkCount,
      invalidatedSourceIds: Object.freeze([...invalidated].sort())
    };
  }

  ingest(value: unknown): MemoryIngestionResult {
    const batch = normalizeBatch(value);
    const db = this.#database();
    try {
      db.exec("BEGIN IMMEDIATE");
      const result = this.#applyIngestion(batch);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw mapSqliteError(error);
    }
  }

  rebuild(values: readonly unknown[]): readonly MemoryIngestionResult[] {
    if (!Array.isArray(values) || values.length === 0) inputError("rebuild requires canonical ingestion batches");
    const batches = values.map(normalizeBatch);
    const scopes = new Set<string>();
    for (const batch of batches) {
      const scope = `${batch.workspaceId}\0${batch.projectId}`;
      if (scopes.has(scope)) inputError("rebuild accepts one canonical batch per Workspace/Project scope");
      scopes.add(scope);
    }
    const db = this.#database();
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec(`DELETE FROM memory_fts;
        DELETE FROM memory_source_heads;
        DELETE FROM memory_chunks;
        DELETE FROM memory_source_versions;
        DELETE FROM ingestion_generations;`);
      this.#hooks.afterReset?.();
      const results = batches
        .sort(
          (left, right) =>
            left.workspaceId.localeCompare(right.workspaceId) || left.projectId.localeCompare(right.projectId)
        )
        .map((batch) => this.#applyIngestion(batch));
      db.exec("COMMIT");
      return Object.freeze(results);
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw mapSqliteError(error);
    }
  }

  listSources(value: unknown): readonly {
    readonly sourceId: string;
    readonly kind: string;
    readonly revision: string;
    readonly retrievedAt: string;
    readonly validUntil: string | null;
    readonly classification: string;
    readonly contentDigest: string;
    readonly generationId: string;
    readonly manifestRef: string;
    readonly state: SourceState;
  }[] {
    const scopeValue = record(value, "source scope", ["workspaceId", "projectId", "includeInactive"]);
    const workspaceId = identifier(scopeValue.workspaceId, "workspaceId");
    const projectId = identifier(scopeValue.projectId, "projectId");
    if (scopeValue.includeInactive !== undefined && typeof scopeValue.includeInactive !== "boolean")
      inputError("includeInactive is invalid");
    const includeInactive = scopeValue.includeInactive === true;
    const rows = this.#database()
      .prepare(
        `SELECT h.source_id, h.state, v.source_kind, v.revision, v.retrieved_at,
      v.valid_until, v.classification, v.content_digest, v.generation_id, v.manifest_ref
      FROM memory_source_heads h JOIN memory_source_versions v ON v.observation_id=h.observation_id
      WHERE h.workspace_id=? AND h.project_id=? ${includeInactive ? "" : "AND h.state='active'"}
      ORDER BY h.source_id`
      )
      .all(workspaceId, projectId) as UnknownRecord[];
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          sourceId: String(row.source_id),
          kind: String(row.source_kind),
          revision: String(row.revision),
          retrievedAt: String(row.retrieved_at),
          validUntil: row.valid_until === null ? null : String(row.valid_until),
          classification: String(row.classification),
          contentDigest: String(row.content_digest),
          generationId: String(row.generation_id),
          manifestRef: String(row.manifest_ref),
          state: String(row.state) as SourceState
        })
      )
    );
  }

  listChunks(value: unknown): readonly {
    readonly chunkId: string;
    readonly ordinal: number;
    readonly content: string;
    readonly contentDigest: string;
    readonly state: SourceState;
    readonly untrusted: true;
  }[] {
    const scope = record(value, "chunk scope", ["workspaceId", "projectId", "sourceId", "includeInactive"]);
    const workspaceId = identifier(scope.workspaceId, "workspaceId");
    const projectId = identifier(scope.projectId, "projectId");
    const sourceId = identifier(scope.sourceId, "sourceId");
    if (scope.includeInactive !== undefined && typeof scope.includeInactive !== "boolean")
      inputError("includeInactive is invalid");
    const rows = this.#database()
      .prepare(
        `SELECT chunk_id, ordinal, content, content_digest, state FROM memory_chunks
      WHERE workspace_id=? AND project_id=? AND source_id=? ${scope.includeInactive === true ? "" : "AND state='active'"}
      ORDER BY observation_id, ordinal, chunk_id`
      )
      .all(workspaceId, projectId, sourceId) as UnknownRecord[];
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          chunkId: String(row.chunk_id),
          ordinal: Number(row.ordinal),
          content: String(row.content),
          contentDigest: String(row.content_digest),
          state: String(row.state) as SourceState,
          untrusted: true as const
        })
      )
    );
  }

  listGenerations(value: unknown): readonly {
    readonly generationId: string;
    readonly manifestDigest: string;
    readonly manifestRef: string;
    readonly status: "active" | "superseded";
  }[] {
    const { workspaceId, projectId } = assertScope(value);
    const rows = this.#database()
      .prepare(
        `SELECT generation_id, manifest_digest, manifest_ref, status
      FROM ingestion_generations WHERE workspace_id=? AND project_id=? ORDER BY generation_id`
      )
      .all(workspaceId, projectId) as UnknownRecord[];
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          generationId: String(row.generation_id),
          manifestDigest: String(row.manifest_digest),
          manifestRef: String(row.manifest_ref),
          status: String(row.status) as "active" | "superseded"
        })
      )
    );
  }

  listIngestionManifests(value: unknown): readonly {
    readonly generationId: string;
    readonly manifestDigest: string;
    readonly manifestRef: string;
    readonly status: "active" | "superseded";
    readonly sourceDigests: readonly string[];
  }[] {
    const { workspaceId, projectId } = assertScope(value);
    const rows = this.#database()
      .prepare(
        `SELECT generation_id, manifest_digest, manifest_ref, manifest_json, status
      FROM ingestion_generations WHERE workspace_id=? AND project_id=? ORDER BY generation_id`
      )
      .all(workspaceId, projectId) as UnknownRecord[];
    return Object.freeze(
      rows.map((row) => {
        const manifest = JSON.parse(String(row.manifest_json)) as { sources: { contentDigest: string }[] };
        return Object.freeze({
          generationId: String(row.generation_id),
          manifestDigest: String(row.manifest_digest),
          manifestRef: String(row.manifest_ref),
          status: String(row.status) as "active" | "superseded",
          sourceDigests: Object.freeze(manifest.sources.map((source) => source.contentDigest))
        });
      })
    );
  }

  lexicalSearch(value: unknown): readonly {
    readonly chunkId: string;
    readonly sourceId: string;
    readonly content: string;
    readonly contentDigest: string;
    readonly revision: string;
    readonly retrievedAt: string;
    readonly validUntil: string | null;
    readonly classification: string;
    readonly generationId: string;
    readonly manifestRef: string;
    readonly untrusted: true;
  }[] {
    const query = record(value, "lexical query", ["workspaceId", "projectId", "query", "limit"]);
    const workspaceId = identifier(query.workspaceId, "workspaceId");
    const projectId = identifier(query.projectId, "projectId");
    if (typeof query.query !== "string" || query.query.length === 0 || query.query.length > 2_048)
      inputError("query is invalid");
    if (!Number.isSafeInteger(query.limit) || Number(query.limit) < 1 || Number(query.limit) > 100)
      inputError("limit is invalid");
    const tokens = [...new Set(query.query.toLowerCase().match(/[a-z0-9]+/gu) ?? [])];
    if (tokens.length === 0 || tokens.length > 32) inputError("query tokens are invalid");
    const match = tokens.map((token) => `"${token}"`).join(" AND ");
    const rows = this.#database()
      .prepare(
        `SELECT f.chunk_id, f.source_id, f.content, c.content_digest,
      v.revision, v.retrieved_at, v.valid_until, v.classification, v.generation_id, v.manifest_ref
      FROM memory_fts f
      JOIN memory_chunks c ON c.observation_id=f.observation_id AND c.chunk_id=f.chunk_id
      JOIN memory_source_heads h ON h.workspace_id=f.workspace_id AND h.project_id=f.project_id
        AND h.source_id=f.source_id AND h.observation_id=f.observation_id
      JOIN memory_source_versions v ON v.observation_id=f.observation_id
      WHERE memory_fts MATCH ? AND f.workspace_id=? AND f.project_id=? AND h.state='active' AND c.state='active'
      ORDER BY bm25(memory_fts), f.source_id, f.chunk_id LIMIT ?`
      )
      .all(match, workspaceId, projectId, Number(query.limit)) as UnknownRecord[];
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          chunkId: String(row.chunk_id),
          sourceId: String(row.source_id),
          content: String(row.content),
          contentDigest: String(row.content_digest),
          revision: String(row.revision),
          retrievedAt: String(row.retrieved_at),
          validUntil: row.valid_until === null ? null : String(row.valid_until),
          classification: String(row.classification),
          generationId: String(row.generation_id),
          manifestRef: String(row.manifest_ref),
          untrusted: true as const
        })
      )
    );
  }

  invalidateStale(value: unknown): readonly string[] {
    const request = record(value, "stale invalidation", ["workspaceId", "projectId", "evaluatedAt"]);
    const workspaceId = identifier(request.workspaceId, "workspaceId");
    const projectId = identifier(request.projectId, "projectId");
    const evaluatedAt = instant(request.evaluatedAt, "evaluatedAt");
    const db = this.#database();
    try {
      db.exec("BEGIN IMMEDIATE");
      const rows = db
        .prepare(
          `SELECT h.source_id, h.observation_id FROM memory_source_heads h
        JOIN memory_source_versions v ON v.observation_id=h.observation_id
        WHERE h.workspace_id=? AND h.project_id=? AND h.state='active'
          AND v.valid_until IS NOT NULL AND v.valid_until <= ? ORDER BY h.source_id`
        )
        .all(workspaceId, projectId, evaluatedAt) as UnknownRecord[];
      for (const row of rows) {
        const observationId = String(row.observation_id);
        db.prepare(
          "UPDATE memory_source_heads SET state='stale' WHERE workspace_id=? AND project_id=? AND source_id=?"
        ).run(workspaceId, projectId, String(row.source_id));
        db.prepare("UPDATE memory_source_versions SET state='stale' WHERE observation_id=?").run(observationId);
        db.prepare("UPDATE memory_chunks SET state='stale' WHERE observation_id=?").run(observationId);
        db.prepare("DELETE FROM memory_fts WHERE observation_id=?").run(observationId);
        this.#hooks.afterSourceInvalidated?.();
      }
      db.exec("COMMIT");
      return Object.freeze(rows.map((row) => String(row.source_id)));
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw mapSqliteError(error);
    }
  }

  integrityCheck(): string {
    return String((this.#database().prepare("PRAGMA integrity_check").get() as UnknownRecord).integrity_check);
  }

  stateDigest(): string {
    return memoryStateDigest(this.#database());
  }

  async backupTo(targetPath: string): Promise<{
    readonly code: "VES_MEMORY_BACKUP_READY";
    readonly path: string;
    readonly manifest: {
      readonly sha256: string;
      readonly stateDigest: string;
      readonly documentCount: number;
      readonly migrations: readonly { readonly id: string; readonly checksum: string }[];
      readonly createdAt: string;
    };
  }> {
    const stagingPath = `${targetPath}.staging-${randomUUID()}`;
    mkdirSync(dirname(targetPath), { recursive: true });
    try {
      await backup(this.#database(), stagingPath);
      let inspection: ReturnType<typeof inspectMemoryDatabase>;
      try {
        this.#hooks.validateBackup?.(stagingPath);
        inspection = inspectMemoryDatabase(stagingPath);
      } catch (error) {
        throw memoryError("VES_MEMORY_BACKUP_INVALID", "Staged memory backup failed validation", true, error);
      }
      const bytes = await readFile(stagingPath);
      const manifest = Object.freeze({
        sha256: rawSha256(bytes),
        stateDigest: stateDigestFromFile(stagingPath),
        documentCount: inspection.sources,
        migrations: Object.freeze([...this.migrationLedger()]),
        createdAt: this.#now()
      });
      try {
        await (this.#hooks.publishBackup ?? rename)(stagingPath, targetPath);
      } catch (error) {
        throw memoryError("VES_MEMORY_BACKUP_PUBLISH_FAILED", "Memory backup publication failed", true, error);
      }
      return { code: "VES_MEMORY_BACKUP_READY", path: targetPath, manifest };
    } finally {
      if (existsSync(stagingPath)) await rm(stagingPath, { force: true });
    }
  }
}
