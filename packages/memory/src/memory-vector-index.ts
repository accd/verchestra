import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { canonicalizeJsonV2 } from "@verchestra/domain";
import { getLoadablePath } from "sqlite-vec";

import { MemoryStoreError } from "./memory-store.ts";

type VectorMode = "disabled" | "preferred" | "required";
type VectorSlot = "a" | "b";
type VectorStatusCode =
  | "VES_VECTOR_READY"
  | "VES_VECTOR_DISABLED"
  | "VES_VECTOR_UNAVAILABLE"
  | "VES_VECTOR_ASSET_MISMATCH"
  | "VES_VECTOR_VERSION_MISMATCH"
  | "VES_VECTOR_CORRUPT"
  | "VES_VECTOR_GENERATION_UNAVAILABLE"
  | "VES_VECTOR_GENERATION_STALE";

type Row = Record<string, unknown>;

export interface QualifiedSqliteVecAsset {
  readonly package: "sqlite-vec";
  readonly packageVersion: "0.1.9";
  readonly version: "v0.1.9";
  readonly platform: string;
  readonly sha256: string;
  readonly bytes: number;
}

/**
 * Only assets whose exact package, version, byte length and digest have been
 * qualified are eligible for the default semantic index.  Keeping this table
 * closed makes an unknown host fail closed instead of accidentally trusting a
 * native binary that happens to be present in node_modules.
 */
export const QUALIFIED_SQLITE_VEC_ASSETS: Readonly<Record<string, QualifiedSqliteVecAsset>> = Object.freeze({
  "win32-x64": Object.freeze({
    package: "sqlite-vec",
    packageVersion: "0.1.9",
    version: "v0.1.9",
    platform: "win32-x64",
    sha256: "fcf98662a7ad9dce394b96a88f91032047823831b951c76636787c312a6476e6",
    bytes: 289_280
  }),
  "linux-x64": Object.freeze({
    package: "sqlite-vec",
    packageVersion: "0.1.9",
    version: "v0.1.9",
    platform: "linux-x64",
    sha256: "5923730861b86c707cca5602b5f91092f9e52a46706dbc6e269fd4bb9c4498e8",
    bytes: 159_816
  })
});

export function getQualifiedSqliteVecAsset(
  platform = process.platform,
  arch = process.arch
): QualifiedSqliteVecAsset | undefined {
  return QUALIFIED_SQLITE_VEC_ASSETS[`${platform}-${arch}`];
}

/** The asset qualified for the current host, or undefined when unsupported. */
export const QUALIFIED_SQLITE_VEC = getQualifiedSqliteVecAsset();

export interface MemoryVectorModel {
  readonly provider: string;
  readonly modelId: string;
  readonly revision: string;
  readonly dimensions: number;
  readonly distance: "l2";
}

export interface MemoryVectorInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly chunkId: string;
  readonly contentDigest: string;
  readonly embedding: readonly number[];
}

export interface MemoryVectorBuildInput {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly authorityDigest: string;
  readonly model: MemoryVectorModel;
  readonly vectors: readonly MemoryVectorInput[];
}

export interface MemoryVectorHooks {
  readonly beforeBuildLock?: () => void;
  readonly afterVectorInsert?: () => void;
  readonly verifyGeneration?: () => void;
  readonly beforeSwap?: () => void;
  readonly afterSwap?: () => void;
}

export interface MemoryVectorIndexOptions {
  readonly dbPath: string;
  readonly mode: VectorMode;
  readonly timeoutMs?: number;
  readonly assetPath?: string;
  readonly expectedAssetSha256?: string;
  readonly expectedAssetBytes?: number;
  readonly expectedVersion?: string;
  readonly now?: () => string;
  readonly hooks?: MemoryVectorHooks;
}

export interface MemoryVectorOpenStatus {
  readonly enabled: boolean;
  readonly code: VectorStatusCode;
  readonly version: string | null;
  readonly assetSha256?: string;
  readonly assetBytes?: number;
}

export interface MemoryVectorGeneration {
  readonly generationId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly authorityDigest: string;
  readonly model: MemoryVectorModel;
  readonly vectorCount: number;
  readonly vectorDigest: string;
  readonly slot: VectorSlot;
  readonly tableName: string;
  readonly extensionVersion: string;
  readonly assetSha256: string;
  readonly status: "active" | "superseded";
  readonly createdAt: string;
  readonly verifiedAt: string;
}

export interface MemoryVectorBuildResult extends MemoryVectorGeneration {
  readonly changed: boolean;
}

interface NormalizedVector extends Omit<MemoryVectorInput, "embedding"> {
  readonly embedding: readonly number[];
  readonly embeddingDigest: string;
}

interface NormalizedBuild extends Omit<MemoryVectorBuildInput, "vectors" | "model"> {
  readonly model: MemoryVectorModel;
  readonly modelDigest: string;
  readonly vectors: readonly NormalizedVector[];
  readonly vectorDigest: string;
  readonly generationId: string;
}

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const RAW_DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$/u;
const TABLE_PATTERN = /^memory_vec_[a-f0-9]{24}_[ab]$/u;

const rawSha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const sha256 = (value: string | Uint8Array): string => `sha256:${rawSha256(value)}`;

function embeddingDigest(values: readonly number[]): string {
  const bytes = new Uint8Array(values.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, Math.fround(value), true));
  return sha256(bytes);
}

// This module's former private recursive serializer ordered object members
// with the ambient-locale `String.prototype.localeCompare`; `canonicalizeJsonV2`
// (RFC 8785, UTF-16 code-unit member order) replaces it at every call site
// below (issue #58). The vector table name, the authority digest, the stored
// model JSON and its digest, the vector digest and the generation ID are all
// derived from those bytes -- and `assertTableName` and `#verifyGeneration`
// re-derive them against persisted rows -- so the encoder must not depend on
// the machine's collation.

// Code-unit comparison, not localeCompare: this ordering fixes the persisted
// `memory_vector_members.row_id` sequence and the vector digest that
// `#verifyGeneration` re-derives from it (issue #58).
function codeUnitCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

const codeOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

function vectorError(code: string, message: string, recoverable = false, cause?: unknown): MemoryStoreError {
  return new MemoryStoreError(code, message, recoverable, cause);
}

function mapVectorError(error: unknown): Error {
  if (error instanceof MemoryStoreError) return error;
  if (error instanceof Error && /locked|busy/iu.test(error.message)) {
    return vectorError("VES_VECTOR_BUSY", "Vector index is busy", true, error);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function invalid(message: string): never {
  throw vectorError("VES_VECTOR_INPUT_INVALID", message);
}

function closedRecord(value: unknown, name: string, keys: readonly string[]): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(`${name} must be an object`);
  const row = value as Row;
  const extras = Object.keys(row).filter((key) => !keys.includes(key));
  if (extras.length > 0) invalid(`${name} contains unsupported fields: ${extras.sort().join(", ")}`);
  return row;
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) invalid(`${name} is invalid`);
  return value;
}

function qualifiedDigest(value: unknown, name: string): string {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) invalid(`${name} is invalid`);
  return value;
}

function tableName(workspaceId: string, projectId: string, slot: VectorSlot): string {
  return `memory_vec_${rawSha256(canonicalizeJsonV2({ workspaceId, projectId })).slice(0, 24)}_${slot}`;
}

function assertTableName(value: string, workspaceId: string, projectId: string, slot: VectorSlot): void {
  if (!TABLE_PATTERN.test(value) || value !== tableName(workspaceId, projectId, slot)) {
    throw vectorError("VES_VECTOR_CORRUPT", "Vector table identity is invalid", true);
  }
}

function scope(value: unknown): { readonly workspaceId: string; readonly projectId: string } {
  const row = closedRecord(value, "vector scope", ["workspaceId", "projectId"]);
  return {
    workspaceId: identifier(row["workspaceId"], "workspaceId"),
    projectId: identifier(row["projectId"], "projectId")
  };
}

function authoritySnapshot(db: DatabaseSync, value: { readonly workspaceId: string; readonly projectId: string }) {
  const generation = db
    .prepare(
      `SELECT generation_id, manifest_digest FROM ingestion_generations
      WHERE workspace_id=? AND project_id=? AND status='active'`
    )
    .get(value.workspaceId, value.projectId) as Row | undefined;
  if (generation === undefined)
    throw vectorError("VES_VECTOR_AUTHORITY_UNAVAILABLE", "No active lexical generation exists", true);
  const sources = db
    .prepare(
      `SELECT h.source_id, h.observation_id, v.revision, v.retrieved_at, v.valid_until,
      v.classification, v.content_digest
      FROM memory_source_heads h JOIN memory_source_versions v ON v.observation_id=h.observation_id
      WHERE h.workspace_id=? AND h.project_id=? AND h.state='active' ORDER BY h.source_id`
    )
    .all(value.workspaceId, value.projectId) as Row[];
  const chunks = db
    .prepare(
      `SELECT c.source_id, c.chunk_id, c.ordinal, c.content_digest
      FROM memory_chunks c JOIN memory_source_heads h
        ON h.workspace_id=c.workspace_id AND h.project_id=c.project_id AND h.source_id=c.source_id
        AND h.observation_id=c.observation_id
      WHERE c.workspace_id=? AND c.project_id=? AND c.state='active' AND h.state='active'
      ORDER BY c.source_id, c.ordinal, c.chunk_id`
    )
    .all(value.workspaceId, value.projectId)
    .map((row) => ({
      sourceId: String((row as Row)["source_id"]),
      chunkId: String((row as Row)["chunk_id"]),
      ordinal: Number((row as Row)["ordinal"]),
      contentDigest: String((row as Row)["content_digest"])
    }));
  const state = {
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    generationId: String(generation["generation_id"]),
    manifestDigest: String(generation["manifest_digest"]),
    sources: sources.map((row) => ({
      sourceId: String(row["source_id"]),
      observationId: String(row["observation_id"]),
      revision: String(row["revision"]),
      retrievedAt: String(row["retrieved_at"]),
      validUntil: row["valid_until"] === null ? null : String(row["valid_until"]),
      classification: String(row["classification"]),
      contentDigest: String(row["content_digest"])
    })),
    chunks
  };
  return Object.freeze({
    authorityDigest: sha256(canonicalizeJsonV2(state)),
    lexicalGenerationId: state.generationId,
    chunks: Object.freeze(chunks.map((chunk) => Object.freeze(chunk)))
  });
}

function normalizeBuild(value: unknown): NormalizedBuild {
  const row = closedRecord(value, "vector build", [
    "schemaVersion",
    "workspaceId",
    "projectId",
    "authorityDigest",
    "model",
    "vectors"
  ]);
  if (row["schemaVersion"] !== 1) invalid("schemaVersion must equal 1");
  const workspaceId = identifier(row["workspaceId"], "workspaceId");
  const projectId = identifier(row["projectId"], "projectId");
  const authorityDigest = qualifiedDigest(row["authorityDigest"], "authorityDigest");
  const modelRow = closedRecord(row["model"], "model", ["provider", "modelId", "revision", "dimensions", "distance"]);
  const provider = identifier(modelRow["provider"], "model.provider");
  const modelId = identifier(modelRow["modelId"], "model.modelId");
  const revision = identifier(modelRow["revision"], "model.revision");
  if (
    !Number.isSafeInteger(modelRow["dimensions"]) ||
    Number(modelRow["dimensions"]) < 1 ||
    Number(modelRow["dimensions"]) > 4096
  ) {
    invalid("model.dimensions is invalid");
  }
  if (modelRow["distance"] !== "l2") invalid("model.distance must equal l2");
  const model = Object.freeze({
    provider,
    modelId,
    revision,
    dimensions: Number(modelRow["dimensions"]),
    distance: "l2" as const
  });
  if (!Array.isArray(row["vectors"])) invalid("vectors must be an array");
  const seen = new Set<string>();
  const vectors = row["vectors"]
    .map((item, index): NormalizedVector => {
      const vector = closedRecord(item, `vectors[${index}]`, [
        "workspaceId",
        "projectId",
        "sourceId",
        "chunkId",
        "contentDigest",
        "embedding"
      ]);
      if (vector["workspaceId"] !== workspaceId || vector["projectId"] !== projectId)
        invalid("vector scope differs from build scope");
      const sourceId = identifier(vector["sourceId"], "vector.sourceId");
      const chunkId = identifier(vector["chunkId"], "vector.chunkId");
      const key = `${sourceId}\0${chunkId}`;
      if (seen.has(key)) invalid(`Duplicate vector identity: ${sourceId}/${chunkId}`);
      seen.add(key);
      const contentDigest = qualifiedDigest(vector["contentDigest"], "vector.contentDigest");
      if (!Array.isArray(vector["embedding"]) || vector["embedding"].length !== model.dimensions)
        invalid("embedding dimensions differ from model");
      const embedding = vector["embedding"].map((number) => {
        if (typeof number !== "number" || !Number.isFinite(number) || Math.abs(number) > 3.402_823_466e38)
          invalid("embedding value is invalid");
        const normalized = Math.fround(Object.is(number, -0) ? 0 : number);
        if (!Number.isFinite(normalized)) invalid("embedding value cannot be represented as Float32");
        return normalized;
      });
      return Object.freeze({
        workspaceId,
        projectId,
        sourceId,
        chunkId,
        contentDigest,
        embedding: Object.freeze(embedding),
        embeddingDigest: embeddingDigest(embedding)
      });
    })
    .sort(
      (left, right) => codeUnitCompare(left.sourceId, right.sourceId) || codeUnitCompare(left.chunkId, right.chunkId)
    );
  const vectorDigest = sha256(
    canonicalizeJsonV2(
      vectors.map((vector) => ({
        sourceId: vector.sourceId,
        chunkId: vector.chunkId,
        contentDigest: vector.contentDigest,
        embeddingDigest: vector.embeddingDigest
      }))
    )
  );
  const modelDigest = sha256(canonicalizeJsonV2(model));
  return Object.freeze({
    schemaVersion: 1,
    workspaceId,
    projectId,
    authorityDigest,
    model,
    modelDigest,
    vectors: Object.freeze(vectors),
    vectorDigest,
    generationId: sha256(canonicalizeJsonV2({ workspaceId, projectId, authorityDigest, modelDigest, vectorDigest }))
  });
}

function generationFromRow(row: Row): MemoryVectorGeneration {
  return Object.freeze({
    generationId: String(row["generation_id"]),
    workspaceId: String(row["workspace_id"]),
    projectId: String(row["project_id"]),
    authorityDigest: String(row["authority_digest"]),
    model: Object.freeze(JSON.parse(String(row["model_json"])) as MemoryVectorModel),
    vectorCount: Number(row["vector_count"]),
    vectorDigest: String(row["vector_digest"]),
    slot: String(row["slot"]) as VectorSlot,
    tableName: String(row["table_name"]),
    extensionVersion: String(row["extension_version"]),
    assetSha256: String(row["asset_sha256"]),
    status: String(row["status"]) as "active" | "superseded",
    createdAt: String(row["created_at"]),
    verifiedAt: String(row["verified_at"])
  });
}

export class MemoryVectorIndex {
  readonly dbPath: string;
  readonly #mode: VectorMode;
  readonly #timeoutMs: number;
  readonly #assetPath: string | undefined;
  readonly #expectedAssetSha256: string | undefined;
  readonly #expectedAssetBytes: number | undefined;
  readonly #expectedVersion: string;
  readonly #now: () => string;
  readonly #hooks: MemoryVectorHooks;
  #db: DatabaseSync | undefined;
  #status: MemoryVectorOpenStatus = Object.freeze({ enabled: false, code: "VES_VECTOR_UNAVAILABLE", version: null });

  constructor(options: MemoryVectorIndexOptions) {
    this.dbPath = options.dbPath;
    this.#mode = options.mode;
    this.#timeoutMs = options.timeoutMs ?? 100;
    this.#assetPath = options.assetPath;
    this.#expectedAssetSha256 = options.expectedAssetSha256 ?? QUALIFIED_SQLITE_VEC?.sha256;
    this.#expectedAssetBytes = options.expectedAssetBytes ?? QUALIFIED_SQLITE_VEC?.bytes;
    this.#expectedVersion = options.expectedVersion ?? QUALIFIED_SQLITE_VEC?.version ?? "v0.1.9";
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#hooks = options.hooks ?? {};
    if (this.#expectedAssetSha256 !== undefined && !RAW_DIGEST_PATTERN.test(this.#expectedAssetSha256))
      invalid("expectedAssetSha256 is invalid");
    if (
      this.#expectedAssetBytes !== undefined &&
      (!Number.isSafeInteger(this.#expectedAssetBytes) || this.#expectedAssetBytes < 1)
    )
      invalid("expectedAssetBytes is invalid");
    if ((this.#expectedAssetSha256 === undefined) !== (this.#expectedAssetBytes === undefined))
      invalid("expected asset identity must include both sha256 and bytes");
  }

  open(): MemoryVectorOpenStatus {
    if (this.#mode === "disabled") {
      this.#status = Object.freeze({ enabled: false, code: "VES_VECTOR_DISABLED", version: null });
      return this.#status;
    }
    let failureCode: VectorStatusCode = "VES_VECTOR_UNAVAILABLE";
    try {
      if (this.#expectedAssetSha256 === undefined || this.#expectedAssetBytes === undefined)
        throw new Error("sqlite-vec platform is not qualified");
      this.#db = new DatabaseSync(this.dbPath, { timeout: this.#timeoutMs, allowExtension: true, defensive: true });
      this.#db.exec("PRAGMA foreign_keys=ON; PRAGMA writable_schema=OFF;");
      const path = this.#assetPath ?? getLoadablePath();
      const bytes = readFileSync(path);
      const assetSha256 = rawSha256(bytes);
      const assetBytes = statSync(path).size;
      if (assetSha256 !== this.#expectedAssetSha256 || assetBytes !== this.#expectedAssetBytes) {
        failureCode = "VES_VECTOR_ASSET_MISMATCH";
        throw new Error("sqlite-vec asset identity mismatch");
      }
      this.#db.loadExtension(path);
      const version = String((this.#db.prepare("SELECT vec_version() AS version").get() as Row)["version"]);
      if (version !== this.#expectedVersion) {
        failureCode = "VES_VECTOR_VERSION_MISMATCH";
        throw new Error("sqlite-vec runtime version mismatch");
      }
      this.#db.enableLoadExtension(false);
      this.#status = Object.freeze({ enabled: true, code: "VES_VECTOR_READY", version, assetSha256, assetBytes });
      this.#verifyEveryActiveGeneration();
      return this.#status;
    } catch (error) {
      if (error instanceof MemoryStoreError && error.code === "VES_VECTOR_CORRUPT") failureCode = "VES_VECTOR_CORRUPT";
      try {
        this.#db?.enableLoadExtension(false);
      } catch {
        // The connection is closed below; failure cannot retain extension authority.
      }
      this.#db?.close();
      this.#db = undefined;
      this.#status = Object.freeze({ enabled: false, code: failureCode, version: null });
      if (this.#mode === "required") {
        throw vectorError(
          "VES_VECTOR_REQUIRED_UNAVAILABLE",
          `Required semantic index is unavailable: ${failureCode}`,
          true,
          error
        );
      }
      return this.#status;
    }
  }

  close(): void {
    this.#db?.close();
    this.#db = undefined;
  }

  #database(): DatabaseSync {
    if (this.#db === undefined || !this.#status.enabled)
      throw vectorError("VES_VECTOR_UNAVAILABLE", "Vector index is unavailable", true);
    return this.#db;
  }

  loadExtensionForTest(): void {
    this.#database().loadExtension(this.#assetPath ?? getLoadablePath());
  }

  authoritySnapshot(value: unknown): ReturnType<typeof authoritySnapshot> {
    return authoritySnapshot(this.#database(), scope(value));
  }

  #rowForGeneration(generationId: string): Row | undefined {
    return this.#database()
      .prepare("SELECT * FROM memory_vector_generations WHERE generation_id=?")
      .get(generationId) as Row | undefined;
  }

  #activeRow(value: { readonly workspaceId: string; readonly projectId: string }): Row | undefined {
    return this.#database()
      .prepare(
        `SELECT g.*, c.active_slot AS control_slot FROM memory_vector_control c
      JOIN memory_vector_generations g ON g.generation_id=c.active_generation_id
      WHERE c.workspace_id=? AND c.project_id=?`
      )
      .get(value.workspaceId, value.projectId) as Row | undefined;
  }

  #verifyGeneration(row: Row): void {
    const generation = generationFromRow(row);
    assertTableName(generation.tableName, generation.workspaceId, generation.projectId, generation.slot);
    if (row["control_slot"] !== undefined && row["control_slot"] !== generation.slot) {
      throw vectorError("VES_VECTOR_CORRUPT", "Active vector slot differs from generation metadata", true);
    }
    if (generation.extensionVersion !== this.#status.version || generation.assetSha256 !== this.#status.assetSha256) {
      throw vectorError("VES_VECTOR_CORRUPT", "Vector generation runtime identity is incompatible", true);
    }
    const modelDigest = sha256(canonicalizeJsonV2(generation.model));
    if (
      modelDigest !== String(row["model_digest"]) ||
      generation.model.dimensions !== Number(row["dimensions"]) ||
      generation.model.distance !== row["distance"]
    ) {
      throw vectorError("VES_VECTOR_CORRUPT", "Vector model metadata digest mismatch", true);
    }
    const expectedGenerationId = sha256(
      canonicalizeJsonV2({
        workspaceId: generation.workspaceId,
        projectId: generation.projectId,
        authorityDigest: generation.authorityDigest,
        modelDigest,
        vectorDigest: generation.vectorDigest
      })
    );
    if (expectedGenerationId !== generation.generationId) {
      throw vectorError("VES_VECTOR_CORRUPT", "Vector generation identity mismatch", true);
    }
    const db = this.#database();
    const tableExists = Number(
      (
        db
          .prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name=?")
          .get(generation.tableName) as Row
      )["count"]
    );
    if (tableExists !== 1) throw vectorError("VES_VECTOR_CORRUPT", "Active vector table is missing", true);
    const members = db
      .prepare(
        `SELECT row_id, source_id, chunk_id, content_digest, embedding_digest
      FROM memory_vector_members WHERE generation_id=? ORDER BY row_id`
      )
      .all(generation.generationId) as Row[];
    const vectors = db
      .prepare(`SELECT rowid, vec_to_json(embedding) AS embedding_json FROM ${generation.tableName} ORDER BY rowid`)
      .all() as Row[];
    if (members.length !== generation.vectorCount || vectors.length !== generation.vectorCount) {
      throw vectorError("VES_VECTOR_CORRUPT", "Vector generation count mismatch", true);
    }
    for (let index = 0; index < members.length; index += 1) {
      const member = members[index];
      const vector = vectors[index];
      if (member === undefined || vector === undefined || Number(member["row_id"]) !== Number(vector["rowid"])) {
        throw vectorError("VES_VECTOR_CORRUPT", "Vector row mapping mismatch", true);
      }
      const embedding = JSON.parse(String(vector["embedding_json"])) as number[];
      if (embeddingDigest(embedding) !== String(member["embedding_digest"])) {
        throw vectorError("VES_VECTOR_CORRUPT", "Vector embedding digest mismatch", true);
      }
    }
    const vectorDigest = sha256(
      canonicalizeJsonV2(
        members.map((member) => ({
          sourceId: String(member["source_id"]),
          chunkId: String(member["chunk_id"]),
          contentDigest: String(member["content_digest"]),
          embeddingDigest: String(member["embedding_digest"])
        }))
      )
    );
    if (vectorDigest !== generation.vectorDigest)
      throw vectorError("VES_VECTOR_CORRUPT", "Vector generation digest mismatch", true);
  }

  #verifyEveryActiveGeneration(): void {
    const rows = this.#database()
      .prepare(
        `SELECT g.*, c.active_slot AS control_slot FROM memory_vector_control c
      JOIN memory_vector_generations g ON g.generation_id=c.active_generation_id ORDER BY c.workspace_id, c.project_id`
      )
      .all() as Row[];
    for (const row of rows) this.#verifyGeneration(row);
  }

  buildGeneration(value: unknown): MemoryVectorBuildResult {
    const build = normalizeBuild(value);
    const db = this.#database();
    const snapshot = authoritySnapshot(db, build);
    if (snapshot.authorityDigest !== build.authorityDigest) {
      throw vectorError("VES_VECTOR_AUTHORITY_MISMATCH", "Vector build authority digest is stale");
    }
    const expected = snapshot.chunks
      .map((chunk) => `${chunk.sourceId}\0${chunk.chunkId}\0${chunk.contentDigest}`)
      .sort();
    const actual = build.vectors
      .map((vector) => `${vector.sourceId}\0${vector.chunkId}\0${vector.contentDigest}`)
      .sort();
    if (canonicalizeJsonV2(expected) !== canonicalizeJsonV2(actual)) {
      throw vectorError("VES_VECTOR_AUTHORITY_MISMATCH", "Vector set differs from active lexical chunks");
    }
    const existing = this.#rowForGeneration(build.generationId);
    const active = this.#activeRow(build);
    if (existing !== undefined && active !== undefined && active["generation_id"] === build.generationId) {
      this.#verifyGeneration(existing);
      return Object.freeze({ ...generationFromRow(existing), changed: false });
    }
    const slot: VectorSlot = active?.["slot"] === "a" ? "b" : "a";
    const derivedTable = tableName(build.workspaceId, build.projectId, slot);
    const createdAt = this.#now();
    const assetSha256 = this.#status.assetSha256;
    if (assetSha256 === undefined || this.#status.version === null) {
      throw vectorError("VES_VECTOR_CORRUPT", "Qualified vector runtime identity is missing", true);
    }
    let committed = false;
    try {
      this.#hooks.beforeBuildLock?.();
      db.exec("BEGIN IMMEDIATE");
      if (authoritySnapshot(db, build).authorityDigest !== build.authorityDigest) {
        throw vectorError("VES_VECTOR_AUTHORITY_MISMATCH", "Lexical authority changed before vector build lock");
      }
      db.prepare(
        `DELETE FROM memory_vector_members WHERE generation_id IN (
        SELECT generation_id FROM memory_vector_generations WHERE workspace_id=? AND project_id=? AND slot=?
      )`
      ).run(build.workspaceId, build.projectId, slot);
      db.exec(`DROP TABLE IF EXISTS ${derivedTable}`);
      db.exec(`CREATE VIRTUAL TABLE ${derivedTable} USING vec0(embedding float[${build.model.dimensions}])`);
      db.prepare(
        `DELETE FROM memory_vector_generations WHERE workspace_id=? AND project_id=? AND slot=? AND status='superseded'`
      ).run(build.workspaceId, build.projectId, slot);
      db.prepare(
        `INSERT INTO memory_vector_generations(
        generation_id, workspace_id, project_id, authority_digest, model_json, model_digest, dimensions, distance,
        vector_count, vector_digest, slot, table_name, extension_version, asset_sha256, status, created_at, verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'l2', ?, ?, ?, ?, ?, ?, 'superseded', ?, ?)`
      ).run(
        build.generationId,
        build.workspaceId,
        build.projectId,
        build.authorityDigest,
        canonicalizeJsonV2(build.model),
        build.modelDigest,
        build.model.dimensions,
        build.vectors.length,
        build.vectorDigest,
        slot,
        derivedTable,
        this.#status.version,
        assetSha256,
        createdAt,
        createdAt
      );
      for (let index = 0; index < build.vectors.length; index += 1) {
        const vector = build.vectors[index];
        if (vector === undefined) throw vectorError("VES_VECTOR_BUILD_FAILED", "Vector disappeared during build");
        const rowId = index + 1;
        db.prepare(`INSERT INTO ${derivedTable}(rowid, embedding) VALUES (?, ?)`).run(
          BigInt(rowId),
          JSON.stringify(vector.embedding)
        );
        db.prepare(
          `INSERT INTO memory_vector_members(
          generation_id, row_id, source_id, chunk_id, content_digest, embedding_digest
        ) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(build.generationId, rowId, vector.sourceId, vector.chunkId, vector.contentDigest, vector.embeddingDigest);
        this.#hooks.afterVectorInsert?.();
      }
      const staged = this.#rowForGeneration(build.generationId);
      if (staged === undefined) throw vectorError("VES_VECTOR_BUILD_FAILED", "Staged generation metadata is missing");
      this.#verifyGeneration(staged);
      this.#hooks.verifyGeneration?.();
      this.#hooks.beforeSwap?.();
      db.prepare(
        "UPDATE memory_vector_generations SET status='superseded' WHERE workspace_id=? AND project_id=? AND status='active'"
      ).run(build.workspaceId, build.projectId);
      db.prepare("UPDATE memory_vector_generations SET status='active', verified_at=? WHERE generation_id=?").run(
        this.#now(),
        build.generationId
      );
      db.prepare(
        `INSERT INTO memory_vector_control(workspace_id, project_id, active_generation_id, active_slot, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, project_id) DO UPDATE SET active_generation_id=excluded.active_generation_id,
          active_slot=excluded.active_slot, updated_at=excluded.updated_at`
      ).run(build.workspaceId, build.projectId, build.generationId, slot, this.#now());
      db.exec("COMMIT");
      committed = true;
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      const mapped = mapVectorError(error);
      if (mapped instanceof MemoryStoreError || codeOf(mapped) === "VES_VECTOR_BUSY") throw mapped;
      throw vectorError("VES_VECTOR_BUILD_FAILED", "Vector generation build failed", true, mapped);
    }
    try {
      this.#hooks.afterSwap?.();
    } catch (error) {
      if (committed)
        throw vectorError(
          "VES_VECTOR_SWAP_OUTCOME_UNKNOWN",
          "Vector generation committed but acknowledgement was lost",
          true,
          error
        );
      throw error;
    }
    const row = this.#rowForGeneration(build.generationId);
    if (row === undefined) throw vectorError("VES_VECTOR_CORRUPT", "Committed vector generation is missing", true);
    return Object.freeze({ ...generationFromRow(row), changed: true });
  }

  listGenerations(value: unknown): readonly MemoryVectorGeneration[] {
    const selected = scope(value);
    const rows = this.#database()
      .prepare(
        `SELECT * FROM memory_vector_generations
      WHERE workspace_id=? AND project_id=? ORDER BY created_at, generation_id`
      )
      .all(selected.workspaceId, selected.projectId) as Row[];
    return Object.freeze(rows.map(generationFromRow));
  }

  activeGeneration(value: unknown): MemoryVectorGeneration | undefined {
    const row = this.#activeRow(scope(value));
    return row === undefined ? undefined : generationFromRow(row);
  }

  availability(value: unknown): MemoryVectorOpenStatus {
    if (!this.#status.enabled) return this.#status;
    const selected = scope(value);
    const row = this.#activeRow(selected);
    if (row === undefined)
      return Object.freeze({
        enabled: false,
        code: "VES_VECTOR_GENERATION_UNAVAILABLE",
        version: this.#status.version
      });
    try {
      this.#verifyGeneration(row);
    } catch {
      return Object.freeze({ enabled: false, code: "VES_VECTOR_CORRUPT", version: this.#status.version });
    }
    const generation = generationFromRow(row);
    const snapshot = authoritySnapshot(this.#database(), selected);
    if (snapshot.authorityDigest !== generation.authorityDigest) {
      return Object.freeze({ enabled: false, code: "VES_VECTOR_GENERATION_STALE", version: this.#status.version });
    }
    return this.#status;
  }

  search(value: unknown): readonly {
    readonly sourceId: string;
    readonly chunkId: string;
    readonly contentDigest: string;
    readonly generationId: string;
    readonly distance: number;
    readonly retrieval: "sqlite-vec";
    readonly untrusted: true;
  }[] {
    const row = closedRecord(value, "vector query", ["workspaceId", "projectId", "embedding", "limit"]);
    const selected = {
      workspaceId: identifier(row["workspaceId"], "workspaceId"),
      projectId: identifier(row["projectId"], "projectId")
    };
    const status = this.availability(selected);
    if (!status.enabled) throw vectorError(status.code, "Semantic generation is unavailable", true);
    const generation = this.activeGeneration(selected);
    if (generation === undefined)
      throw vectorError("VES_VECTOR_GENERATION_UNAVAILABLE", "Semantic generation is unavailable", true);
    if (!Array.isArray(row["embedding"]) || row["embedding"].length !== generation.model.dimensions)
      invalid("query embedding dimensions are invalid");
    const embedding = row["embedding"].map((number) => {
      if (typeof number !== "number" || !Number.isFinite(number)) invalid("query embedding value is invalid");
      return Object.is(number, -0) ? 0 : number;
    });
    if (!Number.isSafeInteger(row["limit"]) || Number(row["limit"]) < 1 || Number(row["limit"]) > 100)
      invalid("query limit is invalid");
    const db = this.#database();
    const nearest = db
      .prepare(
        `SELECT rowid, distance FROM ${generation.tableName}
      WHERE embedding MATCH ? AND k=? ORDER BY distance`
      )
      .all(JSON.stringify(embedding), Number(row["limit"])) as Row[];
    const member = db.prepare(`SELECT source_id, chunk_id, content_digest FROM memory_vector_members
      WHERE generation_id=? AND row_id=?`);
    return Object.freeze(
      nearest.map((candidate) => {
        const identity = member.get(generation.generationId, Number(candidate["rowid"])) as Row | undefined;
        if (identity === undefined)
          throw vectorError("VES_VECTOR_CORRUPT", "Nearest vector has no member identity", true);
        return Object.freeze({
          sourceId: String(identity["source_id"]),
          chunkId: String(identity["chunk_id"]),
          contentDigest: String(identity["content_digest"]),
          generationId: generation.generationId,
          distance: Number(candidate["distance"]),
          retrieval: "sqlite-vec" as const,
          untrusted: true as const
        });
      })
    );
  }

  clearDerivedState(value: unknown): void {
    const selected = scope(value);
    const db = this.#database();
    const before = authoritySnapshot(db, selected).authorityDigest;
    try {
      db.exec("BEGIN IMMEDIATE");
      for (const slot of ["a", "b"] as const)
        db.exec(`DROP TABLE IF EXISTS ${tableName(selected.workspaceId, selected.projectId, slot)}`);
      db.prepare("DELETE FROM memory_vector_control WHERE workspace_id=? AND project_id=?").run(
        selected.workspaceId,
        selected.projectId
      );
      db.prepare(
        `DELETE FROM memory_vector_members WHERE generation_id IN (
        SELECT generation_id FROM memory_vector_generations WHERE workspace_id=? AND project_id=?
      )`
      ).run(selected.workspaceId, selected.projectId);
      db.prepare("DELETE FROM memory_vector_generations WHERE workspace_id=? AND project_id=?").run(
        selected.workspaceId,
        selected.projectId
      );
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw mapVectorError(error);
    }
    if (authoritySnapshot(db, selected).authorityDigest !== before) {
      throw vectorError("VES_VECTOR_CORRUPT", "Derived-state clearing changed lexical authority", true);
    }
  }
}
