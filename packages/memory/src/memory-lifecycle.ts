import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  ArtifactPlanningPort,
  LogicalArtifactAddress,
  PlacementSnapshot,
  WritePlan
} from "@verchestra/application";
import { canonicalizeJsonV2, normalizeDeclaredSet } from "@verchestra/domain";

type Row = Record<string, unknown>;
type Classification = "public" | "internal" | "confidential" | "restricted";
type ObjectProtection = "none" | "canonical" | "required-evidence";
type ObjectState = "active" | "quarantined" | "forgotten";

export interface MemoryPromotionPlan {
  readonly schemaVersion: 1;
  readonly planId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly artifactDigest: string;
  readonly artifactContent: string;
  readonly writePlan: WritePlan;
  readonly status: "review-required";
}

export interface MemoryManagedObject {
  readonly objectId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly kind: string;
  readonly classification: Classification;
  readonly contentDigest: string;
  readonly bytes: number;
  readonly createdAt: string;
  readonly retainUntil: string | null;
  readonly protection: ObjectProtection;
  readonly encryptionKeyRef: string | null;
  readonly state: ObjectState;
  readonly lifecycleReason: string | null;
}

export interface MemoryGarbageCollectionPlan {
  readonly schemaVersion: 1;
  readonly planId: string;
  readonly workspaceId: string;
  readonly evaluatedAt: string;
  readonly quotaBytes: number;
  readonly candidates: readonly {
    readonly objectId: string;
    readonly reason: "retention-expired" | "quota";
    readonly bytes: number;
  }[];
  readonly protectedObjectIds: readonly string[];
  readonly legalHoldObjectIds: readonly string[];
}

export interface MemoryLifecycleHooks {
  readonly afterPromotionStage?: () => void | Promise<void>;
  readonly beforePromotionPublish?: () => void | Promise<void>;
  readonly afterPromotionPublish?: () => void | Promise<void>;
  readonly beforeQuarantineMove?: (objectId: string) => void | Promise<void>;
  readonly afterQuarantineMove?: (objectId: string) => void | Promise<void>;
  readonly afterGarbageCollectionCommit?: () => void | Promise<void>;
  readonly afterCryptoShred?: (objectId: string) => void | Promise<void>;
}

export interface MemoryPromotionLifecycleOptions {
  readonly dbPath: string;
  readonly objectRoot: string;
  readonly ownerRoots: Readonly<Record<string, string>>;
  readonly artifactPlanner: ArtifactPlanningPort;
  readonly timeoutMs?: number;
  readonly now?: () => string;
  readonly cryptoShred?: { readonly destroy: (keyRef: string) => Promise<void> };
  readonly hooks?: MemoryLifecycleHooks;
}

export class MemoryLifecycleError extends Error {
  readonly code: string;
  readonly recoverable: boolean;

  constructor(code: string, message: string, recoverable = false, options?: ErrorOptions) {
    super(message, options);
    this.name = "MemoryLifecycleError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memory_promotions (
  plan_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  artifact_digest TEXT NOT NULL,
  git_owner_id TEXT NOT NULL,
  logical_path TEXT NOT NULL,
  approval_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('published')),
  published_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS memory_managed_objects (
  object_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  classification TEXT NOT NULL CHECK(classification IN ('public','internal','confidential','restricted')),
  content_digest TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes >= 0),
  created_at TEXT NOT NULL,
  retain_until TEXT,
  protection TEXT NOT NULL CHECK(protection IN ('none','canonical','required-evidence')),
  encryption_key_ref TEXT,
  state TEXT NOT NULL CHECK(state IN ('active','quarantined','forgotten')),
  quarantined_at TEXT,
  lifecycle_reason TEXT,
  UNIQUE(workspace_id, object_id)
) STRICT;
CREATE INDEX IF NOT EXISTS memory_managed_objects_scope
  ON memory_managed_objects(workspace_id, project_id, state, created_at, object_id);
CREATE TABLE IF NOT EXISTS memory_object_references (
  workspace_id TEXT NOT NULL,
  from_object_id TEXT NOT NULL,
  to_object_id TEXT NOT NULL,
  PRIMARY KEY(workspace_id, from_object_id, to_object_id),
  FOREIGN KEY(from_object_id) REFERENCES memory_managed_objects(object_id) ON DELETE CASCADE,
  FOREIGN KEY(to_object_id) REFERENCES memory_managed_objects(object_id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE IF NOT EXISTS memory_legal_holds (
  workspace_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  hold_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, object_id, hold_id),
  FOREIGN KEY(object_id) REFERENCES memory_managed_objects(object_id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE IF NOT EXISTS memory_gc_runs (
  plan_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT;`;
const LIFECYCLE_MIGRATION_ID = "001-lifecycle";
const LIFECYCLE_COLUMNS = Object.freeze({
  ves_memory_lifecycle_migrations: ["id", "checksum", "applied_at"],
  memory_promotions: [
    "plan_id",
    "workspace_id",
    "project_id",
    "artifact_digest",
    "git_owner_id",
    "logical_path",
    "approval_json",
    "status",
    "published_at"
  ],
  memory_managed_objects: [
    "object_id",
    "workspace_id",
    "project_id",
    "kind",
    "classification",
    "content_digest",
    "relative_path",
    "bytes",
    "created_at",
    "retain_until",
    "protection",
    "encryption_key_ref",
    "state",
    "quarantined_at",
    "lifecycle_reason"
  ],
  memory_object_references: ["workspace_id", "from_object_id", "to_object_id"],
  memory_legal_holds: ["workspace_id", "object_id", "hold_id", "created_at"],
  memory_gc_runs: ["plan_id", "workspace_id", "receipt_json", "applied_at"]
});

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,511}$/u;
const CLASSIFICATIONS: readonly Classification[] = ["public", "internal", "confidential", "restricted"];
const PROTECTIONS: readonly ObjectProtection[] = ["none", "canonical", "required-evidence"];
const SOURCE_KINDS = ["repository", "tracker", "knowledge", "memory", "database"] as const;

// This module's former private recursive serializer ordered object members
// with the ambient-locale `String.prototype.localeCompare`; `canonicalizeJsonV2`
// (RFC 8785, UTF-16 code-unit member order) replaces it at every call site
// below (issue #58). Every identity here -- promotion plan IDs, managed object
// IDs, garbage-collection plan IDs, the stored GC receipt and the lifecycle
// state digest -- is derived from those bytes, so the encoder must not depend
// on the machine's collation.
const digest = (value: string | Uint8Array): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function invalid(message: string): never {
  throw new MemoryLifecycleError("VES_MEMORY_LIFECYCLE_INVALID", message);
}

// Both plan-integrity checks previously re-encoded `{ ...plan, planId:
// undefined }`, relying on the old serializer silently dropping `undefined`
// members to mean "every plan field except its own identity".
// `canonicalizeJsonV2` rejects `undefined` instead of dropping it, so the
// identity member is removed rather than blanked -- the same bytes without
// depending on a silent prune. Every other own enumerable member is kept, so a
// plan carrying a tampered extra field still fails its identity check.
function planMaterial(plan: object): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "planId"));
}

// A caller-supplied plan is untrusted input. A value canonicalizeJsonV2
// refuses to encode (an `undefined` member, a cycle, a non-plain prototype) is
// an invalid plan, so it fails closed under this surface's own plan-integrity
// code rather than escaping as a canonicalization error (issue #58).
function planIdentity(plan: object, code: string, message: string): string {
  try {
    return digest(canonicalizeJsonV2(planMaterial(plan)));
  } catch (error) {
    throw new MemoryLifecycleError(code, message, false, { cause: error });
  }
}

function closed(value: unknown, name: string, keys: readonly string[]): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(`${name} must be an object`);
  const row = value as Row;
  const extras = Object.keys(row).filter((key) => !keys.includes(key));
  if (extras.length > 0) invalid(`${name} contains unsupported fields: ${extras.sort().join(", ")}`);
  return row;
}

function safe(value: unknown, name: string): string {
  if (typeof value !== "string" || !SAFE.test(value)) invalid(`${name} is invalid`);
  return value;
}

function boundedText(value: unknown, name: string, maximum = 512): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum ||
    /[\u0000-\u001f]/u.test(value)
  )
    invalid(`${name} is invalid`);
  return value;
}

function qualifiedDigest(value: unknown, name: string): string {
  if (typeof value !== "string" || !DIGEST.test(value)) invalid(`${name} is invalid`);
  return value;
}

function instant(value: unknown, name: string): { readonly value: string; readonly milliseconds: number } {
  if (typeof value !== "string") invalid(`${name} is invalid`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) invalid(`${name} is invalid`);
  return { value, milliseconds };
}

function enumValue<T extends string>(value: unknown, values: readonly T[], name: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) invalid(`${name} is invalid`);
  return value as T;
}

function mapSqlite(error: unknown): Error {
  const code =
    typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
  if (code === "SQLITE_BUSY" || (error instanceof Error && /locked|busy/iu.test(error.message)))
    return new MemoryLifecycleError("VES_MEMORY_LIFECYCLE_BUSY", "Memory lifecycle database is busy", true, {
      cause: error
    });
  return error instanceof Error ? error : new Error(String(error));
}

function ownerTarget(root: string, logicalPath: string): string {
  const target = resolve(root, ...logicalPath.split("/"));
  const fromRoot = relative(resolve(root), target);
  if (fromRoot.startsWith("..") || resolve(root, fromRoot) !== target)
    throw new MemoryLifecycleError("VES_MEMORY_PROMOTION_TARGET_INVALID", "Promotion target escapes its Git owner");
  return target;
}

async function optionalBytes(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as { readonly code?: unknown }).code === "ENOENT") return undefined;
    throw error;
  }
}

async function assertSafeTarget(root: string, target: string): Promise<void> {
  const canonicalRoot = await realpath(root);
  // Rebase the target into canonical space before any ancestry comparison. The
  // caller builds targets under the root as it was configured, and that form is
  // routinely an alias of the canonical directory — macOS resolves /var into
  // /private/var and Windows expands 8.3 names such as RUNNER~1 — so comparing
  // an aliased ancestry against the canonical root reports a false escape on
  // exactly those platforms. A target that lexically leaves the root still
  // rebases outside canonicalRoot and fails the walk below unchanged.
  const canonicalTargetPath = resolve(canonicalRoot, relative(root, target));
  try {
    if ((await lstat(canonicalTargetPath)).isSymbolicLink())
      throw new MemoryLifecycleError("VES_MEMORY_PROMOTION_TARGET_INVALID", "Target is a link");
    const canonicalTarget = await realpath(canonicalTargetPath);
    if (relative(canonicalRoot, canonicalTarget).startsWith(".."))
      throw new MemoryLifecycleError("VES_MEMORY_PROMOTION_TARGET_INVALID", "Target leaves its owner");
  } catch (error) {
    if ((error as { readonly code?: unknown }).code !== "ENOENT") throw error;
  }
  let current = dirname(canonicalTargetPath);
  const ancestors: string[] = [];
  while (current !== canonicalRoot) {
    const fromRoot = relative(canonicalRoot, current);
    if (fromRoot.startsWith("..") || resolve(canonicalRoot, fromRoot) !== current)
      throw new MemoryLifecycleError("VES_MEMORY_PROMOTION_TARGET_INVALID", "Target ancestry escapes its owner");
    ancestors.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const ancestor of ancestors.reverse()) {
    try {
      if ((await lstat(ancestor)).isSymbolicLink())
        throw new MemoryLifecycleError("VES_MEMORY_PROMOTION_TARGET_INVALID", "Target ancestry contains a link");
      const canonicalAncestor = await realpath(ancestor);
      if (relative(canonicalRoot, canonicalAncestor).startsWith(".."))
        throw new MemoryLifecycleError("VES_MEMORY_PROMOTION_TARGET_INVALID", "Target ancestry leaves its owner");
    } catch (error) {
      if ((error as { readonly code?: unknown }).code === "ENOENT") break;
      throw error;
    }
  }
}

function promotionArtifact(value: unknown): {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly generatorVersion: string;
  readonly target: LogicalArtifactAddress;
  readonly placement: PlacementSnapshot;
  readonly content: string;
} {
  const row = closed(value, "promotion input", [
    "schemaVersion",
    "workspaceId",
    "projectId",
    "title",
    "purpose",
    "classification",
    "retrievalSearchId",
    "fragments",
    "target",
    "placement",
    "generatorVersion"
  ]);
  if (row["schemaVersion"] !== 1) invalid("promotion schemaVersion must equal 1");
  const workspaceId = safe(row["workspaceId"], "workspaceId");
  const projectId = safe(row["projectId"], "projectId");
  const title = boundedText(row["title"], "title");
  const purpose = safe(row["purpose"], "purpose");
  const classification = enumValue(row["classification"], ["public", "internal"], "classification");
  const retrievalSearchId = qualifiedDigest(row["retrievalSearchId"], "retrievalSearchId");
  const generatorVersion = safe(row["generatorVersion"], "generatorVersion");
  if (!Array.isArray(row["fragments"]) || row["fragments"].length < 1 || row["fragments"].length > 100)
    invalid("promotion fragments are invalid");
  const seen = new Set<string>();
  const fragments = row["fragments"].map((value) => {
    const hit = closed(value, "promotion fragment", [
      "rank",
      "fragmentId",
      "workspaceId",
      "projectId",
      "sourceId",
      "chunkId",
      "classification",
      "trust",
      "content",
      "contentDigest",
      "confidence",
      "provenance",
      "explanation"
    ]);
    if (hit["workspaceId"] !== workspaceId || hit["projectId"] !== projectId || hit["trust"] !== "untrusted-data")
      invalid("promotion fragment scope or trust is invalid");
    const fragmentId = qualifiedDigest(hit["fragmentId"], "fragmentId");
    if (seen.has(fragmentId)) invalid("promotion fragments must be unique");
    seen.add(fragmentId);
    if (typeof hit["content"] !== "string" || digest(hit["content"]) !== hit["contentDigest"])
      throw new MemoryLifecycleError("VES_MEMORY_PROMOTION_INTEGRITY", "Promotion fragment content binding is invalid");
    const provenance = closed(hit["provenance"], "promotion provenance", [
      "sourceKind",
      "sourceId",
      "revision",
      "manifestRef",
      "retrievedAt",
      "validUntil",
      "contentDigest",
      "lexicalGenerationId",
      "vectorGenerationId"
    ]);
    const sourceKind = enumValue(provenance["sourceKind"], SOURCE_KINDS, "sourceKind");
    const sourceId = safe(provenance["sourceId"], "sourceId");
    if (sourceId !== hit["sourceId"] || provenance["contentDigest"] !== hit["contentDigest"])
      throw new MemoryLifecycleError("VES_MEMORY_PROMOTION_INTEGRITY", "Promotion provenance binding is invalid");
    return Object.freeze({
      fragmentId,
      content: hit["content"],
      contentDigest: qualifiedDigest(hit["contentDigest"], "contentDigest"),
      classification: enumValue(hit["classification"], ["public", "internal"], "fragment classification"),
      source: Object.freeze({
        sourceKind,
        sourceId,
        chunkId: safe(hit["chunkId"], "chunkId"),
        revision: safe(provenance["revision"], "revision"),
        manifestRef: safe(provenance["manifestRef"], "manifestRef"),
        retrievedAt: instant(provenance["retrievedAt"], "retrievedAt").value,
        validUntil: provenance["validUntil"] === null ? null : instant(provenance["validUntil"], "validUntil").value
      })
    });
  });
  // Declared set, ordered by UTF-16 code unit rather than by localeCompare:
  // this order is emitted into the promoted artifact's bytes (and therefore
  // into its artifactDigest and planId), and the sort key joins fields with
  // NUL, which ICU treats as completely ignorable -- so the previous
  // localeCompare both varied by machine collation and collapsed the field
  // boundary (issue #58).
  const orderedFragments = normalizeDeclaredSet(
    fragments,
    (fragment) => `${fragment.source.sourceId}\0${fragment.source.chunkId}\0${fragment.fragmentId}`
  );
  const artifact = {
    schemaVersion: 1,
    artifactKind: "promoted-memory",
    workspaceId,
    projectId,
    title,
    purpose,
    classification,
    retrievalSearchId,
    fragments: orderedFragments
  };
  return {
    workspaceId,
    projectId,
    generatorVersion,
    target: row["target"] as LogicalArtifactAddress,
    placement: row["placement"] as PlacementSnapshot,
    content: `${JSON.stringify(artifact, null, 2)}\n`
  };
}

function managedObject(row: Row): MemoryManagedObject {
  return Object.freeze({
    objectId: String(row["object_id"]),
    workspaceId: String(row["workspace_id"]),
    projectId: String(row["project_id"]),
    kind: String(row["kind"]),
    classification: String(row["classification"]) as Classification,
    contentDigest: String(row["content_digest"]),
    bytes: Number(row["bytes"]),
    createdAt: String(row["created_at"]),
    retainUntil: row["retain_until"] === null ? null : String(row["retain_until"]),
    protection: String(row["protection"]) as ObjectProtection,
    encryptionKeyRef: row["encryption_key_ref"] === null ? null : String(row["encryption_key_ref"]),
    state: String(row["state"]) as ObjectState,
    lifecycleReason: row["lifecycle_reason"] === null ? null : String(row["lifecycle_reason"])
  });
}

export class MemoryPromotionLifecycle {
  readonly #options: MemoryPromotionLifecycleOptions;
  readonly #now: () => string;
  #db: DatabaseSync | undefined;

  constructor(options: MemoryPromotionLifecycleOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  open(): void {
    mkdirSync(dirname(this.#options.dbPath), { recursive: true });
    mkdirSync(this.#options.objectRoot, { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(this.#options.dbPath, {
      timeout: this.#options.timeoutMs ?? 100,
      allowExtension: false,
      defensive: true
    });
    try {
      this.#db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA writable_schema=OFF;");
      this.#migrate();
      const integrity = String((this.#db.prepare("PRAGMA integrity_check").get() as Row)["integrity_check"]);
      if (integrity !== "ok")
        throw new MemoryLifecycleError(
          "VES_MEMORY_LIFECYCLE_CORRUPT",
          "Memory lifecycle database failed integrity validation",
          true
        );
      this.#validateSchema();
    } catch (error) {
      this.close();
      throw mapSqlite(error);
    }
  }

  close(): void {
    this.#db?.close();
    this.#db = undefined;
  }

  #database(): DatabaseSync {
    if (this.#db === undefined) throw new MemoryLifecycleError("VES_MEMORY_LIFECYCLE_CLOSED", "Lifecycle is closed");
    return this.#db;
  }

  #migrate(): void {
    const db = this.#database();
    db.exec(`CREATE TABLE IF NOT EXISTS ves_memory_lifecycle_migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;`);
    const rows = db.prepare("SELECT id,checksum FROM ves_memory_lifecycle_migrations ORDER BY id").all() as Row[];
    if (rows.some((row) => String(row["id"]) !== LIFECYCLE_MIGRATION_ID))
      throw new MemoryLifecycleError(
        "VES_MEMORY_LIFECYCLE_MIGRATION_INCOMPATIBLE",
        "Memory lifecycle database contains an unknown migration"
      );
    const expectedChecksum = digest(SCHEMA);
    const applied = rows.find((row) => String(row["id"]) === LIFECYCLE_MIGRATION_ID);
    if (applied !== undefined && String(applied["checksum"]) !== expectedChecksum)
      throw new MemoryLifecycleError(
        "VES_MEMORY_LIFECYCLE_MIGRATION_DRIFT",
        `Memory lifecycle migration checksum drift: ${LIFECYCLE_MIGRATION_ID}`
      );
    if (applied !== undefined) return;
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec(SCHEMA);
      db.prepare("INSERT INTO ves_memory_lifecycle_migrations(id,checksum,applied_at) VALUES(?,?,?)").run(
        LIFECYCLE_MIGRATION_ID,
        expectedChecksum,
        this.#now()
      );
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  #validateSchema(): void {
    const db = this.#database();
    try {
      for (const [table, expected] of Object.entries(LIFECYCLE_COLUMNS)) {
        const actual = (db.prepare(`PRAGMA table_xinfo("${table}")`).all() as Row[]).map((row) => String(row["name"]));
        if (canonicalizeJsonV2(actual) !== canonicalizeJsonV2(expected)) throw new Error(`schema mismatch: ${table}`);
      }
      const scopeIndex = db
        .prepare("SELECT 1 AS present FROM sqlite_schema WHERE type='index' AND name='memory_managed_objects_scope'")
        .get();
      const foreignKeys = Number((db.prepare("PRAGMA foreign_keys").get() as Row)["foreign_keys"]);
      const writableSchema = Number((db.prepare("PRAGMA writable_schema").get() as Row)["writable_schema"]);
      if (scopeIndex === undefined || foreignKeys !== 1 || writableSchema !== 0) throw new Error("unsafe schema state");
    } catch (error) {
      throw new MemoryLifecycleError(
        "VES_MEMORY_LIFECYCLE_CORRUPT",
        "Memory lifecycle database failed authoritative schema validation",
        true,
        { cause: error }
      );
    }
  }

  proposePromotion(value: unknown): MemoryPromotionPlan {
    const artifact = promotionArtifact(value);
    const artifactDigest = digest(artifact.content);
    const writePlan = this.#options.artifactPlanner.createWritePlan(
      [
        {
          address: artifact.target,
          contentDigest: artifactDigest,
          generatorVersion: artifact.generatorVersion,
          lifecyclePolicy: "tracked-reviewed"
        }
      ],
      artifact.placement
    );
    const portable = {
      schemaVersion: 1 as const,
      workspaceId: artifact.workspaceId,
      projectId: artifact.projectId,
      artifactDigest,
      artifactContent: artifact.content,
      writePlan,
      status: "review-required" as const
    };
    return Object.freeze({ ...portable, planId: digest(canonicalizeJsonV2(portable)) });
  }

  async applyPromotion(
    plan: MemoryPromotionPlan,
    review: unknown
  ): Promise<{
    readonly planId: string;
    readonly artifactDigest: string;
    readonly outcome: "published" | "already-published";
  }> {
    if (
      digest(plan.artifactContent) !== plan.artifactDigest ||
      planIdentity(plan, "VES_MEMORY_PROMOTION_PLAN_INVALID", "Promotion plan integrity is invalid") !== plan.planId
    )
      throw new MemoryLifecycleError("VES_MEMORY_PROMOTION_PLAN_INVALID", "Promotion plan integrity is invalid");
    if (plan.writePlan.writes.length !== 1 || plan.writePlan.writes[0]?.contentDigest !== plan.artifactDigest)
      throw new MemoryLifecycleError("VES_MEMORY_PROMOTION_PLAN_INVALID", "Promotion write plan is invalid");
    const approval = closed(review, "promotion review", [
      "schemaVersion",
      "decision",
      "planId",
      "artifactDigest",
      "reviewer",
      "reviewedAt"
    ]);
    const reviewer = closed(approval["reviewer"], "reviewer", ["kind", "id"]);
    if (
      approval["schemaVersion"] !== 1 ||
      approval["decision"] !== "approved" ||
      approval["planId"] !== plan.planId ||
      approval["artifactDigest"] !== plan.artifactDigest ||
      reviewer["kind"] !== "human"
    )
      throw new MemoryLifecycleError("VES_MEMORY_PROMOTION_REVIEW_REQUIRED", "Exact human review is required");
    safe(reviewer["id"], "reviewer.id");
    instant(approval["reviewedAt"], "reviewedAt");
    const write = plan.writePlan.writes[0];
    const ownerRoot = this.#options.ownerRoots[write.gitOwnerId];
    if (ownerRoot === undefined)
      throw new MemoryLifecycleError("VES_MEMORY_PROMOTION_TARGET_INVALID", "Git owner root is unavailable");
    const canonicalRoot = await realpath(ownerRoot);
    const target = ownerTarget(canonicalRoot, write.logicalPath);
    await assertSafeTarget(canonicalRoot, target);
    const existing = await optionalBytes(target);
    let outcome: "published" | "already-published" = "published";
    if (existing !== undefined) {
      if (digest(existing) !== plan.artifactDigest)
        throw new MemoryLifecycleError("VES_MEMORY_PROMOTION_CONFLICT", "Canonical target contains different content");
      outcome = "already-published";
    } else {
      const staging = join(canonicalRoot, ".verchestra", `.promotion-staging-${randomUUID()}`);
      const staged = join(staging, "artifact");
      try {
        await mkdir(staging, { recursive: true, mode: 0o700 });
        await writeFile(staged, plan.artifactContent, { encoding: "utf8", mode: 0o600, flush: true, flag: "wx" });
        await this.#options.hooks?.afterPromotionStage?.();
        await mkdir(dirname(target), { recursive: true });
        await this.#options.hooks?.beforePromotionPublish?.();
        await assertSafeTarget(canonicalRoot, target);
        if ((await optionalBytes(target)) !== undefined)
          throw new MemoryLifecycleError("VES_MEMORY_PROMOTION_CONFLICT", "Canonical target changed before publish");
        await rename(staged, target);
        await this.#options.hooks?.afterPromotionPublish?.();
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    }
    try {
      this.#database()
        .prepare(
          `INSERT INTO memory_promotions(plan_id,workspace_id,project_id,artifact_digest,git_owner_id,logical_path,approval_json,status,published_at)
           VALUES(?,?,?,?,?,?,?,'published',?) ON CONFLICT(plan_id) DO NOTHING`
        )
        .run(
          plan.planId,
          plan.workspaceId,
          plan.projectId,
          plan.artifactDigest,
          write.gitOwnerId,
          write.logicalPath,
          canonicalizeJsonV2(approval),
          this.#now()
        );
    } catch (error) {
      throw mapSqlite(error);
    }
    return Object.freeze({ planId: plan.planId, artifactDigest: plan.artifactDigest, outcome });
  }

  async registerObject(value: unknown): Promise<MemoryManagedObject> {
    const row = closed(value, "managed object", [
      "schemaVersion",
      "workspaceId",
      "projectId",
      "kind",
      "classification",
      "content",
      "contentDigest",
      "createdAt",
      "retainUntil",
      "protection",
      "encryptionKeyRef"
    ]);
    if (row["schemaVersion"] !== 1 || typeof row["content"] !== "string") invalid("managed object is invalid");
    const workspaceId = safe(row["workspaceId"], "workspaceId");
    const projectId = safe(row["projectId"], "projectId");
    const kind = safe(row["kind"], "kind");
    const classification = enumValue(row["classification"], CLASSIFICATIONS, "classification");
    const contentDigest = qualifiedDigest(row["contentDigest"], "contentDigest");
    if (digest(row["content"]) !== contentDigest)
      throw new MemoryLifecycleError("VES_MEMORY_LIFECYCLE_INTEGRITY", "Managed object digest is invalid");
    const createdAtWasSupplied = row["createdAt"] !== undefined;
    const createdAt = instant(row["createdAt"] ?? this.#now(), "createdAt");
    const retainUntil = row["retainUntil"] === null ? null : instant(row["retainUntil"], "retainUntil");
    const protection = enumValue(row["protection"], PROTECTIONS, "protection");
    const encryptionKeyRef =
      row["encryptionKeyRef"] === null ? null : safe(row["encryptionKeyRef"], "encryptionKeyRef");
    if (new Set<Classification>(["confidential", "restricted"]).has(classification) && encryptionKeyRef === null)
      invalid("sensitive managed objects require an encryption key reference");
    const bytes = Buffer.byteLength(row["content"], "utf8");
    const objectId = digest(canonicalizeJsonV2({ workspaceId, projectId, kind, classification, contentDigest }));
    const relativePath = `${workspaceId}/objects/${objectId.slice(7)}.blob`;
    const target = ownerTarget(this.#options.objectRoot, relativePath);
    const prior = this.#database().prepare("SELECT * FROM memory_managed_objects WHERE object_id=?").get(objectId) as
      Row | undefined;
    if (prior !== undefined) {
      const stored = managedObject(prior);
      if (
        stored.workspaceId !== workspaceId ||
        stored.projectId !== projectId ||
        stored.kind !== kind ||
        stored.classification !== classification ||
        stored.contentDigest !== contentDigest ||
        stored.bytes !== bytes ||
        (createdAtWasSupplied && stored.createdAt !== createdAt.value) ||
        stored.retainUntil !== (retainUntil?.value ?? null) ||
        stored.protection !== protection ||
        stored.encryptionKeyRef !== encryptionKeyRef ||
        stored.state !== "active" ||
        String(prior["relative_path"]) !== relativePath
      )
        throw new MemoryLifecycleError(
          "VES_MEMORY_OBJECT_CONFLICT",
          "Managed object identity already has different lifecycle metadata"
        );
      await assertSafeTarget(this.#options.objectRoot, target);
      const priorBytes = await optionalBytes(target);
      if (priorBytes === undefined || digest(priorBytes) !== contentDigest)
        throw new MemoryLifecycleError("VES_MEMORY_LIFECYCLE_INTEGRITY", "Managed object bytes are unavailable");
      return stored;
    }
    await assertSafeTarget(this.#options.objectRoot, target);
    const existing = await optionalBytes(target);
    if (existing === undefined) {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await assertSafeTarget(this.#options.objectRoot, target);
      await writeFile(target, row["content"], { encoding: "utf8", mode: 0o600, flush: true, flag: "wx" });
    } else if (digest(existing) !== contentDigest) {
      throw new MemoryLifecycleError("VES_MEMORY_LIFECYCLE_INTEGRITY", "Managed object path contains other bytes");
    }
    try {
      this.#database()
        .prepare(
          `INSERT INTO memory_managed_objects(object_id,workspace_id,project_id,kind,classification,content_digest,relative_path,bytes,created_at,retain_until,protection,encryption_key_ref,state)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'active') ON CONFLICT(object_id) DO NOTHING`
        )
        .run(
          objectId,
          workspaceId,
          projectId,
          kind,
          classification,
          contentDigest,
          relativePath,
          bytes,
          createdAt.value,
          retainUntil?.value ?? null,
          protection,
          encryptionKeyRef
        );
      const stored = this.#database()
        .prepare("SELECT * FROM memory_managed_objects WHERE object_id=?")
        .get(objectId) as Row;
      return managedObject(stored);
    } catch (error) {
      throw mapSqlite(error);
    }
  }

  listObjects(value: unknown): readonly MemoryManagedObject[] {
    const row = closed(value, "object query", ["workspaceId", "projectId"]);
    const workspaceId = safe(row["workspaceId"], "workspaceId");
    const projectId = safe(row["projectId"], "projectId");
    return Object.freeze(
      (
        this.#database()
          .prepare("SELECT * FROM memory_managed_objects WHERE workspace_id=? AND project_id=? ORDER BY object_id")
          .all(workspaceId, projectId) as Row[]
      ).map(managedObject)
    );
  }

  addReference(value: unknown): void {
    const row = closed(value, "object reference", ["schemaVersion", "workspaceId", "fromObjectId", "toObjectId"]);
    if (row["schemaVersion"] !== 1) invalid("reference schemaVersion is invalid");
    const workspaceId = safe(row["workspaceId"], "workspaceId");
    const from = qualifiedDigest(row["fromObjectId"], "fromObjectId");
    const to = qualifiedDigest(row["toObjectId"], "toObjectId");
    const count = Number(
      (
        this.#database()
          .prepare("SELECT count(*) AS count FROM memory_managed_objects WHERE workspace_id=? AND object_id IN (?,?)")
          .get(workspaceId, from, to) as Row
      )["count"]
    );
    if (count !== (from === to ? 1 : 2)) invalid("reference objects do not belong to the exact Workspace");
    this.#database()
      .prepare("INSERT OR IGNORE INTO memory_object_references(workspace_id,from_object_id,to_object_id) VALUES(?,?,?)")
      .run(workspaceId, from, to);
  }

  setLegalHold(value: unknown): void {
    const row = closed(value, "legal hold", ["schemaVersion", "workspaceId", "objectId", "holdId"]);
    if (row["schemaVersion"] !== 1) invalid("legal hold schemaVersion is invalid");
    const workspaceId = safe(row["workspaceId"], "workspaceId");
    const objectId = qualifiedDigest(row["objectId"], "objectId");
    const exists = this.#database()
      .prepare("SELECT 1 FROM memory_managed_objects WHERE workspace_id=? AND object_id=?")
      .get(workspaceId, objectId);
    if (exists === undefined) invalid("legal hold object does not belong to the exact Workspace");
    this.#database()
      .prepare("INSERT OR IGNORE INTO memory_legal_holds(workspace_id,object_id,hold_id,created_at) VALUES(?,?,?,?)")
      .run(workspaceId, objectId, safe(row["holdId"], "holdId"), this.#now());
  }

  #protection(workspaceId: string): { readonly protectedIds: Set<string>; readonly legalHoldIds: Set<string> } {
    const db = this.#database();
    const protectedIds = new Set(
      (
        db
          .prepare(
            "SELECT object_id FROM memory_managed_objects WHERE workspace_id=? AND state='active' AND protection<>'none'"
          )
          .all(workspaceId) as Row[]
      ).map((row) => String(row["object_id"]))
    );
    const legalHoldIds = new Set(
      (
        db.prepare("SELECT DISTINCT object_id FROM memory_legal_holds WHERE workspace_id=?").all(workspaceId) as Row[]
      ).map((row) => String(row["object_id"]))
    );
    for (const id of legalHoldIds) protectedIds.add(id);
    const edges = db
      .prepare("SELECT from_object_id,to_object_id FROM memory_object_references WHERE workspace_id=?")
      .all(workspaceId) as Row[];
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of edges) {
        const from = String(edge["from_object_id"]);
        const to = String(edge["to_object_id"]);
        if (protectedIds.has(from) && !protectedIds.has(to)) {
          protectedIds.add(to);
          changed = true;
        }
      }
    }
    return { protectedIds, legalHoldIds };
  }

  planGarbageCollection(value: unknown): MemoryGarbageCollectionPlan {
    const row = closed(value, "garbage collection request", [
      "schemaVersion",
      "workspaceId",
      "evaluatedAt",
      "quotaBytes"
    ]);
    if (row["schemaVersion"] !== 1) invalid("garbage collection schemaVersion is invalid");
    const workspaceId = safe(row["workspaceId"], "workspaceId");
    const evaluatedAt = instant(row["evaluatedAt"], "evaluatedAt");
    const quotaBytes = row["quotaBytes"];
    if (typeof quotaBytes !== "number" || !Number.isSafeInteger(quotaBytes) || quotaBytes < 0)
      invalid("quotaBytes is invalid");
    const objects = (
      this.#database()
        .prepare(
          "SELECT * FROM memory_managed_objects WHERE workspace_id=? AND state='active' ORDER BY created_at,object_id"
        )
        .all(workspaceId) as Row[]
    ).map(managedObject);
    const { protectedIds, legalHoldIds } = this.#protection(workspaceId);
    const candidates = new Map<
      string,
      { readonly objectId: string; readonly reason: "retention-expired" | "quota"; readonly bytes: number }
    >();
    for (const object of objects) {
      if (
        !protectedIds.has(object.objectId) &&
        object.retainUntil !== null &&
        Date.parse(object.retainUntil) <= evaluatedAt.milliseconds
      )
        candidates.set(object.objectId, {
          objectId: object.objectId,
          reason: "retention-expired",
          bytes: object.bytes
        });
    }
    let retainedBytes = objects
      .filter((object) => !candidates.has(object.objectId))
      .reduce((total, object) => total + object.bytes, 0);
    for (const object of objects) {
      if (retainedBytes <= quotaBytes) break;
      if (protectedIds.has(object.objectId) || candidates.has(object.objectId)) continue;
      candidates.set(object.objectId, { objectId: object.objectId, reason: "quota", bytes: object.bytes });
      retainedBytes -= object.bytes;
    }
    const portable = {
      schemaVersion: 1 as const,
      workspaceId,
      evaluatedAt: evaluatedAt.value,
      quotaBytes,
      candidates: Object.freeze([...candidates.values()]),
      protectedObjectIds: Object.freeze([...protectedIds].sort()),
      legalHoldObjectIds: Object.freeze([...legalHoldIds].sort())
    };
    return Object.freeze({ ...portable, planId: digest(canonicalizeJsonV2(portable)) });
  }

  async #quarantineObject(object: MemoryManagedObject): Promise<{ readonly source: string; readonly target: string }> {
    const row = this.#database()
      .prepare("SELECT relative_path FROM memory_managed_objects WHERE object_id=?")
      .get(object.objectId) as Row;
    const source = ownerTarget(this.#options.objectRoot, String(row["relative_path"]));
    const target = ownerTarget(
      this.#options.objectRoot,
      `${object.workspaceId}/quarantine/${object.objectId.slice(7)}.blob`
    );
    await assertSafeTarget(this.#options.objectRoot, source);
    await assertSafeTarget(this.#options.objectRoot, target);
    await this.#options.hooks?.beforeQuarantineMove?.(object.objectId);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await assertSafeTarget(this.#options.objectRoot, target);
    await rename(source, target);
    return { source, target };
  }

  async applyGarbageCollection(plan: MemoryGarbageCollectionPlan): Promise<{
    readonly planId: string;
    readonly quarantinedObjectIds: readonly string[];
  }> {
    if (
      planIdentity(plan, "VES_MEMORY_GC_PLAN_INVALID", "Garbage collection plan integrity is invalid") !== plan.planId
    )
      throw new MemoryLifecycleError("VES_MEMORY_GC_PLAN_INVALID", "Garbage collection plan integrity is invalid");
    const receipt = Object.freeze({
      planId: plan.planId,
      quarantinedObjectIds: Object.freeze(plan.candidates.map((candidate) => candidate.objectId))
    });
    const recorded = this.#database()
      .prepare("SELECT receipt_json FROM memory_gc_runs WHERE plan_id=? AND workspace_id=?")
      .get(plan.planId, plan.workspaceId) as Row | undefined;
    if (recorded !== undefined) {
      if (String(recorded["receipt_json"]) !== canonicalizeJsonV2(receipt))
        throw new MemoryLifecycleError(
          "VES_MEMORY_LIFECYCLE_CORRUPT",
          "Stored garbage collection receipt conflicts with its plan",
          true
        );
      return receipt;
    }
    const current = this.planGarbageCollection({
      schemaVersion: 1,
      workspaceId: plan.workspaceId,
      evaluatedAt: plan.evaluatedAt,
      quotaBytes: plan.quotaBytes
    });
    if (current.planId !== plan.planId)
      throw new MemoryLifecycleError("VES_MEMORY_GC_PLAN_STALE", "Garbage collection plan is stale");
    const moved: { source: string; target: string; object: MemoryManagedObject }[] = [];
    const db = this.#database();
    try {
      for (const candidate of plan.candidates) {
        const row = db
          .prepare("SELECT * FROM memory_managed_objects WHERE object_id=? AND workspace_id=?")
          .get(candidate.objectId, plan.workspaceId) as Row;
        const object = managedObject(row);
        moved.push({ ...(await this.#quarantineObject(object)), object });
        await this.#options.hooks?.afterQuarantineMove?.(object.objectId);
      }
      db.exec("BEGIN IMMEDIATE");
      for (const item of moved)
        db.prepare(
          "UPDATE memory_managed_objects SET state='quarantined',quarantined_at=?,lifecycle_reason=? WHERE object_id=? AND state='active'"
        ).run(
          this.#now(),
          `gc:${plan.candidates.find((candidate) => candidate.objectId === item.object.objectId)?.reason ?? "eligible"}`,
          item.object.objectId
        );
      db.prepare("INSERT INTO memory_gc_runs(plan_id,workspace_id,receipt_json,applied_at) VALUES(?,?,?,?)").run(
        plan.planId,
        plan.workspaceId,
        canonicalizeJsonV2(receipt),
        this.#now()
      );
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      for (const item of [...moved].reverse()) {
        if (existsSync(item.target) && !existsSync(item.source)) {
          await mkdir(dirname(item.source), { recursive: true, mode: 0o700 });
          await rename(item.target, item.source);
        }
      }
      throw mapSqlite(error);
    }
    try {
      await this.#options.hooks?.afterGarbageCollectionCommit?.();
    } catch (error) {
      throw new MemoryLifecycleError(
        "VES_MEMORY_GC_OUTCOME_UNKNOWN",
        "Garbage collection committed but acknowledgement was lost",
        true,
        { cause: error }
      );
    }
    return receipt;
  }

  async invalidateObject(value: unknown): Promise<{ readonly objectId: string; readonly state: "quarantined" }> {
    const row = closed(value, "invalidation request", ["schemaVersion", "workspaceId", "objectId", "reason"]);
    if (row["schemaVersion"] !== 1) invalid("invalidation schemaVersion is invalid");
    const workspaceId = safe(row["workspaceId"], "workspaceId");
    const objectId = qualifiedDigest(row["objectId"], "objectId");
    const reason = boundedText(row["reason"], "reason", 256);
    const stored = this.#database()
      .prepare("SELECT * FROM memory_managed_objects WHERE workspace_id=? AND object_id=?")
      .get(workspaceId, objectId) as Row | undefined;
    if (stored === undefined) invalid("invalidation object does not belong to the exact Workspace");
    const object = managedObject(stored);
    if (object.state === "quarantined" && object.lifecycleReason === reason) {
      const target = ownerTarget(
        this.#options.objectRoot,
        `${object.workspaceId}/quarantine/${object.objectId.slice(7)}.blob`
      );
      await assertSafeTarget(this.#options.objectRoot, target);
      const bytes = await optionalBytes(target);
      if (bytes === undefined || digest(bytes) !== object.contentDigest)
        throw new MemoryLifecycleError("VES_MEMORY_LIFECYCLE_INTEGRITY", "Invalidated object bytes are unavailable");
      return Object.freeze({ objectId, state: "quarantined" as const });
    }
    if (object.state !== "active") invalid("invalidation object is not active");
    if (this.#protection(workspaceId).protectedIds.has(objectId))
      throw new MemoryLifecycleError("VES_MEMORY_OBJECT_PROTECTED", "Protected memory cannot be invalidated");
    const moved = await this.#quarantineObject(object);
    try {
      await this.#options.hooks?.afterQuarantineMove?.(object.objectId);
      this.#database()
        .prepare(
          "UPDATE memory_managed_objects SET state='quarantined',quarantined_at=?,lifecycle_reason=? WHERE object_id=? AND state='active'"
        )
        .run(this.#now(), reason, objectId);
    } catch (error) {
      if (existsSync(moved.target) && !existsSync(moved.source)) {
        await mkdir(dirname(moved.source), { recursive: true, mode: 0o700 });
        await rename(moved.target, moved.source);
      }
      throw mapSqlite(error);
    }
    return Object.freeze({ objectId, state: "quarantined" as const });
  }

  async forget(value: unknown): Promise<{ readonly objectId: string; readonly cryptoShredded: boolean }> {
    const row = closed(value, "forget request", ["schemaVersion", "workspaceId", "objectId"]);
    if (row["schemaVersion"] !== 1) invalid("forget schemaVersion is invalid");
    const workspaceId = safe(row["workspaceId"], "workspaceId");
    const objectId = qualifiedDigest(row["objectId"], "objectId");
    const stored = this.#database()
      .prepare("SELECT * FROM memory_managed_objects WHERE workspace_id=? AND object_id=?")
      .get(workspaceId, objectId) as Row | undefined;
    if (stored === undefined) invalid("forget object does not belong to the exact Workspace");
    const object = managedObject(stored);
    const sensitive = new Set<Classification>(["confidential", "restricted"]).has(object.classification);
    if (object.state === "quarantined" && object.lifecycleReason === "forget") {
      if (object.encryptionKeyRef === null) return Object.freeze({ objectId, cryptoShredded: sensitive });
      if (this.#options.cryptoShred === undefined)
        throw new MemoryLifecycleError("VES_MEMORY_CRYPTO_SHRED_UNAVAILABLE", "Crypto-shred adapter is unavailable");
      try {
        await this.#options.cryptoShred.destroy(object.encryptionKeyRef);
        this.#database()
          .prepare(
            "UPDATE memory_managed_objects SET encryption_key_ref=NULL WHERE object_id=? AND state='quarantined'"
          )
          .run(objectId);
        await this.#options.hooks?.afterCryptoShred?.(objectId);
      } catch (error) {
        const converged = this.#database()
          .prepare("SELECT encryption_key_ref FROM memory_managed_objects WHERE object_id=?")
          .get(objectId) as Row;
        if (converged["encryption_key_ref"] === null)
          throw new MemoryLifecycleError(
            "VES_MEMORY_FORGET_OUTCOME_UNKNOWN",
            "Crypto-shred committed but acknowledgement was lost",
            true,
            { cause: error }
          );
        throw mapSqlite(error);
      }
      return Object.freeze({ objectId, cryptoShredded: true });
    }
    if (object.state !== "active") invalid("forget object is not active");
    if (this.#protection(workspaceId).protectedIds.has(objectId))
      throw new MemoryLifecycleError("VES_MEMORY_OBJECT_PROTECTED", "Protected memory cannot be forgotten");
    const moved = await this.#quarantineObject(object);
    try {
      await this.#options.hooks?.afterQuarantineMove?.(object.objectId);
      this.#database()
        .prepare(
          "UPDATE memory_managed_objects SET state='quarantined',quarantined_at=?,lifecycle_reason='forget' WHERE object_id=? AND state='active'"
        )
        .run(this.#now(), objectId);
    } catch (error) {
      if (existsSync(moved.target) && !existsSync(moved.source)) {
        await mkdir(dirname(moved.source), { recursive: true, mode: 0o700 });
        await rename(moved.target, moved.source);
      }
      throw mapSqlite(error);
    }
    if (object.encryptionKeyRef === null) return Object.freeze({ objectId, cryptoShredded: false });
    if (this.#options.cryptoShred === undefined) {
      this.#database()
        .prepare(
          "UPDATE memory_managed_objects SET state='active',quarantined_at=NULL,lifecycle_reason=NULL WHERE object_id=?"
        )
        .run(objectId);
      await rename(moved.target, moved.source);
      throw new MemoryLifecycleError("VES_MEMORY_CRYPTO_SHRED_UNAVAILABLE", "Crypto-shred adapter is unavailable");
    }
    try {
      await this.#options.cryptoShred.destroy(object.encryptionKeyRef);
    } catch (error) {
      try {
        this.#database()
          .prepare(
            "UPDATE memory_managed_objects SET state='active',quarantined_at=NULL,lifecycle_reason=NULL WHERE object_id=?"
          )
          .run(objectId);
        await rename(moved.target, moved.source);
      } catch (restoreError) {
        throw new MemoryLifecycleError(
          "VES_MEMORY_FORGET_OUTCOME_UNKNOWN",
          "Crypto-shred failed and filesystem restoration is incomplete",
          true,
          { cause: restoreError }
        );
      }
      throw mapSqlite(error);
    }
    try {
      this.#database()
        .prepare("UPDATE memory_managed_objects SET encryption_key_ref=NULL WHERE object_id=? AND state='quarantined'")
        .run(objectId);
      await this.#options.hooks?.afterCryptoShred?.(objectId);
    } catch (error) {
      throw new MemoryLifecycleError(
        "VES_MEMORY_FORGET_OUTCOME_UNKNOWN",
        "Crypto-shred committed but acknowledgement was lost",
        true,
        { cause: error }
      );
    }
    return Object.freeze({ objectId, cryptoShredded: true });
  }

  stateDigest(): string {
    const db = this.#database();
    return digest(
      canonicalizeJsonV2({
        promotions: db.prepare("SELECT * FROM memory_promotions ORDER BY plan_id").all(),
        objects: db.prepare("SELECT * FROM memory_managed_objects ORDER BY object_id").all(),
        gcRuns: db.prepare("SELECT * FROM memory_gc_runs ORDER BY plan_id").all(),
        references: db
          .prepare("SELECT * FROM memory_object_references ORDER BY workspace_id,from_object_id,to_object_id")
          .all(),
        holds: db.prepare("SELECT * FROM memory_legal_holds ORDER BY workspace_id,object_id,hold_id").all()
      })
    );
  }
}
