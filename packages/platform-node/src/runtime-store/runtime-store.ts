import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync, backup, type StatementSync } from "node:sqlite";

import type { IdempotencyInput } from "@verchestra/application";
import { canonicalizeJsonV2, type RunSnapshot, type WorkflowDecision } from "@verchestra/domain";

// The migration registry lives in runtime-migrations.ts (which imports
// nothing) so the sealed launcher's activation-health observation can project
// it without loading node:sqlite; this module re-exports it so every existing
// consumer keeps its import path.
import { DEFAULT_RUNTIME_MIGRATIONS, type RuntimeMigration } from "./runtime-migrations.ts";

export { DEFAULT_RUNTIME_MIGRATIONS, type RuntimeMigration };

type UnknownRecord = Record<string, unknown> & {
  integrity_check?: unknown;
  count?: unknown;
  id?: unknown;
  checksum?: unknown;
  journal_mode?: unknown;
  foreign_keys?: unknown;
  timeout?: unknown;
  writable_schema?: unknown;
  approval_binding_digest?: unknown;
  run_id?: unknown;
  run_kind?: unknown;
  state?: unknown;
  state_version?: unknown;
  repair_cycles?: unknown;
  terminal_capsule_required?: unknown;
  implementation_actor_id?: unknown;
  predecessor_run_id?: unknown;
  successor_run_id?: unknown;
  owner_id?: unknown;
  expires_at?: unknown;
  fencing_token?: unknown;
};

interface RuntimeStoreHooks {
  readonly afterEventInsert?: () => void;
  readonly validateBackup?: (path: string) => unknown;
  readonly publishBackup?: (source: string, destination: string) => Promise<void>;
  readonly afterEffectStart?: () => void;
  readonly beforeEffectComplete?: () => void;
  readonly afterEffectComplete?: () => void;
  readonly afterRunCapsuleSealCommit?: () => void;
}

interface RuntimeStoreOptions {
  readonly dbPath: string;
  readonly timeoutMs?: number;
  readonly migrations?: readonly RuntimeMigration[];
  readonly hooks?: RuntimeStoreHooks;
  readonly now?: () => string;
}

export type ExecutionCheckpointKind = "executor" | "gate" | "repair";

export interface StoredExecutionCheckpoint {
  readonly checkpointId: string;
  readonly kind: ExecutionCheckpointKind;
  readonly workspaceId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly sequence: number;
  readonly stage: string;
  readonly recordJson: string;
}

const CHECKPOINT_KINDS: ReadonlySet<string> = new Set(["executor", "gate", "repair"]);
const MAXIMUM_CHECKPOINT_RECORD_BYTES = 262_144;

interface EventMetadata {
  readonly eventId: string;
  readonly payloadDigest: string;
  readonly actor: { readonly kind: string; readonly id: string };
  readonly occurredAt: string;
}

interface StoredEffectIntent {
  readonly effectId: string;
  readonly idempotencyKey: string;
  readonly operationKind: string;
  readonly workspaceId: string;
  readonly runId?: string;
  readonly logicalTarget: string;
  readonly canonicalInputDigest: string;
  readonly semanticIdentity: string;
  readonly canonicalizationVersion: 1 | 2;
  readonly riskTier: "low" | "medium" | "high";
  readonly grantRef: string;
  readonly expectedRemoteVersion?: string;
  readonly status: "planned" | "ready" | "applying" | "uncertain" | "completed" | "failed";
  readonly attempt: number;
  readonly createdAt: string;
}

interface StoredReceipt {
  readonly receiptId: string;
  readonly effectId: string;
  readonly idempotencyKey: string;
  readonly adapterId: string;
  readonly attempt: number;
  readonly outcome: "applied" | "already-applied" | "not-applied" | "unknown" | "compensated";
  readonly remoteIdentity?: string;
  readonly remoteVersion?: string;
  readonly outputDigest?: string;
  readonly safeEvidenceRefs: readonly string[];
  readonly startedAt: string;
  readonly completedAt: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function runtimeError(code: string, message: string, cause?: unknown, recoverable = false): Error {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code, recoverable });
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mapSqliteError(error: unknown): Error {
  const code = errorCode(error);
  if (code === "SQLITE_BUSY" || /database is locked/iu.test(errorMessage(error))) {
    return runtimeError("VES_RUNTIME_BUSY", "Runtime database is busy", error, true);
  }
  if (code?.startsWith("SQLITE_CONSTRAINT") === true || /constraint failed/iu.test(errorMessage(error))) {
    return runtimeError("VES_RUNTIME_CONSTRAINT", "Runtime relational constraint failed", error);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function requireRow(row: unknown): UnknownRecord {
  if (row === undefined || row === null || typeof row !== "object") {
    throw runtimeError("VES_RUNTIME_NOT_FOUND", "Runtime record was not found");
  }
  return row as UnknownRecord;
}

function runStatement(statement: StatementSync, ...values: readonly (string | number | null)[]): number {
  return Number(statement.run(...values).changes);
}

// invariant: approvals, grants, claims and artifact_refs have no writer in this
// module, but migration 001 still creates them and a database written by an
// older build may hold rows there, so the state digest keeps covering them.
const STATE_TABLE_ORDER = Object.freeze({
  runs: "run_id",
  state_events: "run_id, sequence",
  approvals: "approval_id",
  grants: "grant_id",
  leases: "workspace_id",
  claims: "workspace_id, scope_digest",
  artifact_refs: "ref_id",
  effect_intents: "idempotency_key",
  effect_outbox: "idempotency_key",
  operation_receipts: "idempotency_key",
  effect_inbox: "idempotency_key",
  machine_profiles: "workspace_id",
  workspace_sync_states: "workspace_id",
  workspace_projects: "workspace_id, project_id",
  projection_mappings: "workspace_id, projection_id",
  local_rebuild_state: "workspace_id",
  active_policy_views: "workspace_id",
  authority_approvals: "approval_id",
  authority_grants: "grant_id",
  run_capsule_seals: "run_id",
  execution_checkpoints: "kind, workspace_id, run_id, task_id, sequence"
});

function runtimeStateDigest(db: DatabaseSync): string {
  const state = Object.fromEntries(
    Object.entries(STATE_TABLE_ORDER).map(([table, order]) => [
      table,
      db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all()
    ])
  );
  return sha256(JSON.stringify(state));
}

function stateDigestFromFile(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true, allowExtension: false, defensive: true });
  try {
    return runtimeStateDigest(db);
  } finally {
    db.close();
  }
}

function assertExtensionLoadingDenied(db: DatabaseSync): void {
  try {
    db.loadExtension("forbidden-extension");
  } catch (error) {
    if (errorCode(error) === "ERR_INVALID_STATE") return;
    throw error;
  }
  throw runtimeError("VES_RUNTIME_EXTENSION_ENABLED", "Extension loading unexpectedly enabled");
}

export function inspectRuntimeDatabase(
  path: string,
  options: { readonly assertExtensionsDisabled?: boolean } = {}
): { readonly integrity: "ok"; readonly runs: number; readonly migrations: number } {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true, allowExtension: false, defensive: true });
    if (options.assertExtensionsDisabled === true) assertExtensionLoadingDenied(db);
    const integrity = String((db.prepare("PRAGMA integrity_check").get() as UnknownRecord).integrity_check);
    if (integrity !== "ok") throw new Error(integrity);
    return {
      integrity: "ok",
      runs: Number((db.prepare("SELECT count(*) AS count FROM runs").get() as UnknownRecord).count),
      migrations: Number((db.prepare("SELECT count(*) AS count FROM ves_migrations").get() as UnknownRecord).count)
    };
  } catch (error) {
    if (errorCode(error) === "ERR_INVALID_STATE") throw error;
    throw runtimeError("VES_RUNTIME_CORRUPT", "Runtime database failed integrity validation", error, true);
  } finally {
    db?.close();
  }
}

export class RuntimeStore {
  readonly dbPath: string;
  readonly #timeoutMs: number;
  readonly #migrations: readonly RuntimeMigration[];
  readonly #hooks: RuntimeStoreHooks;
  readonly #now: () => string;
  #db: DatabaseSync | undefined;

  constructor(options: RuntimeStoreOptions) {
    this.dbPath = options.dbPath;
    this.#timeoutMs = options.timeoutMs ?? 100;
    this.#migrations = options.migrations ?? DEFAULT_RUNTIME_MIGRATIONS;
    this.#hooks = options.hooks ?? {};
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  open(): { readonly appliedMigrations: number } {
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.#db = new DatabaseSync(this.dbPath, {
      timeout: this.#timeoutMs,
      allowExtension: false,
      defensive: true
    });
    try {
      this.#db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA writable_schema=OFF;");
      return { appliedMigrations: this.#migrate() };
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
    if (this.#db === undefined) throw runtimeError("VES_RUNTIME_CLOSED", "Runtime store is closed");
    return this.#db;
  }

  #migrate(): number {
    const db = this.#database();
    db.exec(`CREATE TABLE IF NOT EXISTS ves_migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;`);
    const declaredIds = new Set(this.#migrations.map((migration) => migration.id));
    const existing = db.prepare("SELECT id, checksum FROM ves_migrations ORDER BY id").all() as UnknownRecord[];
    const existingById = new Map(existing.map((row) => [String(row.id), String(row.checksum)]));
    for (const migration of this.#migrations) {
      const appliedChecksum = existingById.get(migration.id);
      if (appliedChecksum !== undefined && appliedChecksum !== sha256(migration.up)) {
        throw runtimeError("VES_RUNTIME_MIGRATION_DRIFT", `Migration checksum drift: ${migration.id}`);
      }
    }
    for (const row of existing) {
      if (!declaredIds.has(String(row.id))) {
        throw runtimeError("VES_RUNTIME_MIGRATION_INCOMPATIBLE", "Database contains a newer or unknown migration");
      }
    }

    let applied = 0;
    for (const migration of this.#migrations) {
      const checksum = sha256(migration.up);
      const row = db.prepare("SELECT checksum FROM ves_migrations WHERE id=?").get(migration.id) as
        UnknownRecord | undefined;
      if (row !== undefined) continue;
      try {
        db.exec("BEGIN IMMEDIATE");
        db.exec(migration.up);
        db.prepare("INSERT INTO ves_migrations(id, checksum, applied_at) VALUES (?, ?, ?)").run(
          migration.id,
          checksum,
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
      this.#database().prepare("SELECT id, checksum FROM ves_migrations ORDER BY id").all() as UnknownRecord[]
    ).map((row) => ({ id: String(row.id), checksum: String(row.checksum) }));
  }

  downgradeTo(migrationId: string): never {
    throw runtimeError(
      "VES_RUNTIME_DOWNGRADE_UNSUPPORTED",
      `Automatic runtime database downgrade to ${migrationId} is prohibited; restore a compatible backup`
    );
  }

  safetySettings(): {
    readonly journalMode: string;
    readonly foreignKeys: number;
    readonly busyTimeoutMs: number;
    readonly writableSchema: number;
  } {
    const db = this.#database();
    return {
      journalMode: String((db.prepare("PRAGMA journal_mode").get() as UnknownRecord).journal_mode),
      foreignKeys: Number((db.prepare("PRAGMA foreign_keys").get() as UnknownRecord).foreign_keys),
      busyTimeoutMs: Number((db.prepare("PRAGMA busy_timeout").get() as UnknownRecord).timeout),
      writableSchema: Number((db.prepare("PRAGMA writable_schema").get() as UnknownRecord).writable_schema)
    };
  }

  saveMachineProfile(
    workspaceId: string,
    profileJson: string
  ): { readonly changed: boolean; readonly profileDigest: string } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(profileJson);
    } catch (error) {
      throw runtimeError("VES_RUNTIME_CONSTRAINT", "Machine Profile JSON is invalid", error);
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { readonly workspaceId?: unknown }).workspaceId !== workspaceId
    ) {
      throw runtimeError("VES_RUNTIME_CONSTRAINT", "Machine Profile Workspace binding is invalid");
    }
    const profileDigest = sha256(profileJson);
    try {
      const changed =
        runStatement(
          this.#database().prepare(
            `INSERT INTO machine_profiles(workspace_id, profile_json, profile_digest, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(workspace_id) DO UPDATE SET
               profile_json=excluded.profile_json,
               profile_digest=excluded.profile_digest,
               updated_at=excluded.updated_at
             WHERE machine_profiles.profile_digest <> excluded.profile_digest`
          ),
          workspaceId,
          profileJson,
          profileDigest,
          this.#now()
        ) === 1;
      return Object.freeze({ changed, profileDigest: `sha256:${profileDigest}` });
    } catch (error) {
      throw mapSqliteError(error);
    }
  }

  getMachineProfile(workspaceId: string): Readonly<Record<string, unknown>> | undefined {
    const row = this.#database()
      .prepare("SELECT profile_json FROM machine_profiles WHERE workspace_id=?")
      .get(workspaceId) as UnknownRecord | undefined;
    if (row === undefined) return undefined;
    return Object.freeze(JSON.parse(String(row["profile_json"])) as Record<string, unknown>);
  }

  listMachineProfiles(): readonly Readonly<Record<string, unknown>>[] {
    return Object.freeze(
      (
        this.#database()
          .prepare("SELECT profile_json FROM machine_profiles ORDER BY workspace_id")
          .all() as UnknownRecord[]
      ).map((row) => Object.freeze(JSON.parse(String(row["profile_json"])) as Record<string, unknown>))
    );
  }

  saveSyncState(
    workspaceId: string,
    stateJson: string,
    stateDigest: string
  ): { readonly changed: boolean; readonly stateDigest: string } {
    let state: UnknownRecord;
    try {
      state = JSON.parse(stateJson) as UnknownRecord;
    } catch (error) {
      throw runtimeError("VES_RUNTIME_CONSTRAINT", "Workspace sync state JSON is invalid", error);
    }
    if (
      state["workspaceId"] !== workspaceId ||
      state["stateDigest"] !== stateDigest ||
      !/^sha256:[a-f0-9]{64}$/u.test(stateDigest)
    ) {
      throw runtimeError("VES_RUNTIME_CONSTRAINT", "Workspace sync state binding or digest is invalid");
    }
    const rawDigest = stateDigest.slice(7);
    const projects = state["projects"] as readonly UnknownRecord[];
    const projections = state["projections"] as readonly UnknownRecord[];
    const db = this.#database();
    const existing = db
      .prepare("SELECT state_digest FROM workspace_sync_states WHERE workspace_id=?")
      .get(workspaceId) as UnknownRecord | undefined;
    if (existing?.["state_digest"] === rawDigest) return Object.freeze({ changed: false, stateDigest });
    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare(
        `INSERT INTO workspace_sync_states(
           workspace_id, state_json, state_digest, generations_json, ingestion_manifests_json, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id) DO UPDATE SET
           state_json=excluded.state_json,
           state_digest=excluded.state_digest,
           generations_json=excluded.generations_json,
           ingestion_manifests_json=excluded.ingestion_manifests_json,
           updated_at=excluded.updated_at`
      ).run(
        workspaceId,
        stateJson,
        rawDigest,
        JSON.stringify(state["generations"]),
        JSON.stringify(state["ingestionManifests"]),
        this.#now()
      );
      db.prepare("DELETE FROM projection_mappings WHERE workspace_id=?").run(workspaceId);
      db.prepare("DELETE FROM workspace_projects WHERE workspace_id=?").run(workspaceId);
      const insertProject = db.prepare(
        `INSERT INTO workspace_projects(
           workspace_id, project_id, logical_path, lifecycle_state, lineage_json
         ) VALUES (?, ?, ?, ?, ?)`
      );
      for (const entry of projects) {
        insertProject.run(
          workspaceId,
          String(entry["projectId"]),
          String(entry["logicalPath"]),
          String(entry["state"]),
          JSON.stringify(entry["predecessorProjectIds"])
        );
      }
      const insertProjection = db.prepare(
        `INSERT INTO projection_mappings(
           workspace_id, projection_id, project_id, connector_id, canonical_digest,
           observed_remote_digest, observed_remote_version
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const entry of projections) {
        insertProjection.run(
          workspaceId,
          String(entry["projectionId"]),
          String(entry["projectId"]),
          String(entry["connectorId"]),
          String(entry["canonicalDigest"]),
          String(entry["observedRemoteDigest"]),
          entry["observedRemoteVersion"] === undefined ? null : String(entry["observedRemoteVersion"])
        );
      }
      db.prepare(
        `INSERT INTO local_rebuild_state(workspace_id, canonical_state_digest, source_policy)
         VALUES (?, ?, 'canonical-sources-and-ingestion-manifests')
         ON CONFLICT(workspace_id) DO UPDATE SET canonical_state_digest=excluded.canonical_state_digest`
      ).run(workspaceId, rawDigest);
      db.exec("COMMIT");
      return Object.freeze({ changed: true, stateDigest });
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw mapSqliteError(error);
    }
  }

  getSyncState(workspaceId: string): Readonly<Record<string, unknown>> | undefined {
    const row = this.#database()
      .prepare("SELECT state_json FROM workspace_sync_states WHERE workspace_id=?")
      .get(workspaceId) as UnknownRecord | undefined;
    if (row === undefined) return undefined;
    return Object.freeze(JSON.parse(String(row["state_json"])) as Record<string, unknown>);
  }

  saveActivePolicyView(
    workspaceId: string,
    viewJson: string,
    viewDigest: string,
    expectedGeneration: number
  ): { readonly activated: boolean; readonly conflict: boolean } {
    let view: UnknownRecord;
    try {
      view = JSON.parse(viewJson) as UnknownRecord;
    } catch (error) {
      throw runtimeError("VES_RUNTIME_CONSTRAINT", "Active Policy View JSON is invalid", error);
    }
    const generation = Number(view["generation"]);
    if (
      !Number.isSafeInteger(generation) ||
      generation <= expectedGeneration ||
      view["policyViewDigest"] !== viewDigest ||
      !/^sha256:[a-f0-9]{64}$/u.test(viewDigest)
    ) {
      throw runtimeError("VES_RUNTIME_CONSTRAINT", "Active Policy View generation or digest is invalid");
    }
    const db = this.#database();
    try {
      db.exec("BEGIN IMMEDIATE");
      const current = db.prepare("SELECT generation FROM active_policy_views WHERE workspace_id=?").get(workspaceId) as
        UnknownRecord | undefined;
      const currentGeneration = current === undefined ? 0 : Number(current["generation"]);
      if (currentGeneration !== expectedGeneration) {
        db.exec("ROLLBACK");
        return Object.freeze({ activated: false, conflict: true });
      }
      db.prepare(
        `INSERT INTO active_policy_views(workspace_id, generation, view_json, view_digest, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id) DO UPDATE SET
           generation=excluded.generation,
           view_json=excluded.view_json,
           view_digest=excluded.view_digest,
           updated_at=excluded.updated_at`
      ).run(workspaceId, generation, viewJson, viewDigest.slice(7), this.#now());
      db.exec("COMMIT");
      return Object.freeze({ activated: true, conflict: false });
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw mapSqliteError(error);
    }
  }

  getActivePolicyView(workspaceId: string): Readonly<Record<string, unknown>> | undefined {
    const row = this.#database()
      .prepare("SELECT view_json, view_digest FROM active_policy_views WHERE workspace_id=?")
      .get(workspaceId) as UnknownRecord | undefined;
    if (row === undefined) return undefined;
    const view = JSON.parse(String(row["view_json"])) as Record<string, unknown>;
    const { policyViewDigest, ...viewMaterial } = view;
    const storedDigest = `sha256:${String(row["view_digest"])}`;
    if (policyViewDigest !== storedDigest || `sha256:${sha256(canonicalizeJsonV2(viewMaterial))}` !== storedDigest) {
      throw runtimeError(
        "VES_RUNTIME_CORRUPT",
        "Active Policy View digest does not match its content",
        undefined,
        true
      );
    }
    return Object.freeze(view);
  }

  createRun(snapshot: RunSnapshot): void {
    const timestamp = this.#now();
    try {
      this.#database()
        .prepare(
          `INSERT INTO runs(
          run_id, run_kind, state, state_version, repair_cycles, approval_binding_digest,
          implementation_actor_id, terminal_capsule_required, predecessor_run_id, successor_run_id,
          created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          snapshot.runId,
          snapshot.runKind,
          snapshot.state,
          snapshot.version,
          snapshot.repairCycles,
          snapshot.approval?.bindingDigest ?? null,
          snapshot.implementationActorId ?? null,
          snapshot.terminalCapsuleRequired === true ? 1 : 0,
          snapshot.predecessorRunId ?? null,
          snapshot.successorRunId ?? null,
          timestamp,
          timestamp
        );
    } catch (error) {
      throw mapSqliteError(error);
    }
  }

  getRun(runId: string): RunSnapshot {
    const row = requireRow(this.#database().prepare("SELECT * FROM runs WHERE run_id=?").get(runId));
    const approval =
      row.approval_binding_digest === null ? undefined : { bindingDigest: String(row.approval_binding_digest) };
    return {
      runId: String(row.run_id),
      runKind: String(row.run_kind) as RunSnapshot["runKind"],
      state: String(row.state) as RunSnapshot["state"],
      version: Number(row.state_version),
      repairCycles: Number(row.repair_cycles),
      approval,
      terminalCapsuleRequired: Number(row.terminal_capsule_required) === 1,
      ...(row.implementation_actor_id === null ? {} : { implementationActorId: String(row.implementation_actor_id) }),
      ...(row.predecessor_run_id === null ? {} : { predecessorRunId: String(row.predecessor_run_id) }),
      ...(row.successor_run_id === null ? {} : { successorRunId: String(row.successor_run_id) })
    };
  }

  applyTransition(runId: string, decision: WorkflowDecision, metadata: EventMetadata): void {
    if (
      !decision.accepted ||
      decision.snapshot.runId !== runId ||
      decision.version !== decision.snapshot.version ||
      decision.version < 1 ||
      decision.events.length < 1 ||
      decision.events[0]?.expectedVersion !== decision.version - 1
    ) {
      throw runtimeError("VES_RUNTIME_TRANSITION_INVALID", "Workflow decision is not persistable");
    }
    const db = this.#database();
    try {
      db.exec("BEGIN IMMEDIATE");
      const changed = runStatement(
        db.prepare(`UPDATE runs SET
          state=?, state_version=?, repair_cycles=?, approval_binding_digest=?, implementation_actor_id=?,
          terminal_capsule_required=?, predecessor_run_id=?, successor_run_id=?, updated_at=?
          WHERE run_id=? AND state_version=? AND state=?`),
        decision.snapshot.state,
        decision.snapshot.version,
        decision.snapshot.repairCycles,
        decision.snapshot.approval?.bindingDigest ?? null,
        decision.snapshot.implementationActorId ?? null,
        decision.snapshot.terminalCapsuleRequired === true ? 1 : 0,
        decision.snapshot.predecessorRunId ?? null,
        decision.snapshot.successorRunId ?? null,
        metadata.occurredAt,
        runId,
        decision.version - 1,
        decision.previousState
      );
      if (changed !== 1) {
        throw runtimeError("VES_RUNTIME_VERSION_CONFLICT", "Run projection changed before CAS transition");
      }
      db.prepare(
        `INSERT INTO state_events(
        event_id, run_id, sequence, expected_state_version, previous_state, next_state,
        event_type, payload_digest, actor_kind, actor_id, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        metadata.eventId,
        runId,
        decision.version,
        decision.version - 1,
        decision.previousState,
        decision.nextState,
        decision.events[0].type,
        metadata.payloadDigest,
        metadata.actor.kind,
        metadata.actor.id,
        metadata.occurredAt
      );
      this.#hooks.afterEventInsert?.();
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      if (errorCode(error)?.startsWith("VES_RUNTIME_") === true) throw error;
      throw mapSqliteError(error);
    }
  }

  listEvents(runId: string): readonly UnknownRecord[] {
    return (
      this.#database()
        .prepare(
          `SELECT event_id AS eventId, run_id AS runId, sequence,
        expected_state_version AS expectedStateVersion, previous_state AS previousState,
        next_state AS nextState, event_type AS eventType, payload_digest AS payloadDigest,
        actor_kind AS actorKind, actor_id AS actorId, occurred_at AS occurredAt
        FROM state_events WHERE run_id=? ORDER BY sequence`
        )
        .all(runId) as UnknownRecord[]
    ).map((row) => ({ ...row }));
  }

  listUnsealedTerminalRuns(): readonly {
    readonly runId: string;
    readonly runKind: "feature" | "recovery";
    readonly status: "COMPLETED" | "HANDED_OFF" | "FAILED" | "ABORTED" | "INTERRUPTED" | "RECOVERED";
    readonly stateVersion: number;
    readonly predecessorRunId?: string;
    readonly successorRunId?: string;
  }[] {
    return (
      this.#database()
        .prepare(
          `SELECT r.run_id AS runId, r.run_kind AS runKind, r.state AS status,
            r.state_version AS stateVersion, r.predecessor_run_id AS predecessorRunId,
            r.successor_run_id AS successorRunId
           FROM runs r LEFT JOIN run_capsule_seals c ON c.run_id=r.run_id
           WHERE r.terminal_capsule_required=1 AND c.run_id IS NULL
             AND r.state IN ('COMPLETED','HANDED_OFF','FAILED','ABORTED','INTERRUPTED','RECOVERED')
           ORDER BY r.run_id`
        )
        .all() as UnknownRecord[]
    ).map((row) =>
      Object.freeze({
        runId: String(row["runId"]),
        runKind: String(row["runKind"]) as "feature" | "recovery",
        status: String(row["status"]) as
          "COMPLETED" | "HANDED_OFF" | "FAILED" | "ABORTED" | "INTERRUPTED" | "RECOVERED",
        stateVersion: Number(row["stateVersion"]),
        ...(row["predecessorRunId"] === null ? {} : { predecessorRunId: String(row["predecessorRunId"]) }),
        ...(row["successorRunId"] === null ? {} : { successorRunId: String(row["successorRunId"]) })
      })
    );
  }

  recordRunCapsuleSeal(value: {
    readonly runId: string;
    readonly stateVersion: number;
    readonly status: string;
    readonly capsuleId: string;
    readonly payloadDigest: string;
    readonly sealedAt: string;
  }): "recorded" | "already-recorded" {
    if (
      !/^[a-f0-9]{64}$/u.test(value.capsuleId) ||
      !/^[a-f0-9]{64}$/u.test(value.payloadDigest) ||
      !Number.isSafeInteger(value.stateVersion) ||
      value.stateVersion < 1 ||
      !["COMPLETED", "HANDED_OFF", "FAILED", "ABORTED", "INTERRUPTED", "RECOVERED"].includes(value.status) ||
      !Number.isFinite(Date.parse(value.sealedAt)) ||
      new Date(value.sealedAt).toISOString() !== value.sealedAt
    ) {
      throw runtimeError("VES_RUNTIME_CONSTRAINT", "Run Capsule seal record is malformed");
    }
    const db = this.#database();
    try {
      db.exec("BEGIN IMMEDIATE");
      const existing = db.prepare("SELECT * FROM run_capsule_seals WHERE run_id=?").get(value.runId) as
        UnknownRecord | undefined;
      if (existing !== undefined) {
        const identical =
          Number(existing["state_version"]) === value.stateVersion &&
          String(existing["terminal_status"]) === value.status &&
          String(existing["capsule_id"]) === value.capsuleId &&
          String(existing["payload_digest"]) === value.payloadDigest &&
          String(existing["sealed_at"]) === value.sealedAt;
        if (!identical) throw runtimeError("VES_RUNTIME_CONSTRAINT", "Run already has a different Capsule seal");
        db.exec("COMMIT");
        return "already-recorded";
      }
      const runRow = requireRow(
        db.prepare("SELECT state, state_version, terminal_capsule_required FROM runs WHERE run_id=?").get(value.runId)
      );
      if (
        String(runRow["state"]) !== value.status ||
        Number(runRow["state_version"]) !== value.stateVersion ||
        Number(runRow["terminal_capsule_required"]) !== 1
      ) {
        throw runtimeError("VES_RUNTIME_VERSION_CONFLICT", "Terminal run changed before Capsule seal recording");
      }
      db.prepare(
        `INSERT INTO run_capsule_seals(
          run_id, state_version, terminal_status, capsule_id, payload_digest, sealed_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(value.runId, value.stateVersion, value.status, value.capsuleId, value.payloadDigest, value.sealedAt);
      db.exec("COMMIT");
      this.#hooks.afterRunCapsuleSealCommit?.();
      return "recorded";
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      if (errorCode(error)?.startsWith("VES_RUNTIME_") === true) throw error;
      throw mapSqliteError(error);
    }
  }

  getRunCapsuleSeal(runId: string): Readonly<Record<string, unknown>> | undefined {
    const row = this.#database().prepare("SELECT * FROM run_capsule_seals WHERE run_id=?").get(runId) as
      UnknownRecord | undefined;
    if (row === undefined) return undefined;
    return Object.freeze({
      runId: String(row["run_id"]),
      stateVersion: Number(row["state_version"]),
      status: String(row["terminal_status"]),
      capsuleId: String(row["capsule_id"]),
      payloadDigest: String(row["payload_digest"]),
      sealedAt: String(row["sealed_at"])
    });
  }

  saveAuthorityApproval(value: {
    readonly approvalId: string;
    readonly workspaceId: string;
    readonly runId: string;
    readonly action: string;
    readonly recordJson: string;
    readonly issuedAt: string;
    readonly expiresAt: string;
  }): { readonly created: boolean } {
    return this.#saveAuthorityRecord("authority_approvals", "approval_id", value.approvalId, value);
  }

  loadAuthorityApproval(approvalId: string): UnknownRecord | undefined {
    return this.#loadAuthorityRecord("authority_approvals", "approval_id", approvalId);
  }

  revokeAuthorityApproval(approvalId: string, revokedAt: string, reason: string): boolean {
    return this.#revokeAuthorityRecord("authority_approvals", "approval_id", approvalId, revokedAt, reason);
  }

  saveAuthorityGrant(value: {
    readonly grantId: string;
    readonly workspaceId: string;
    readonly runId: string;
    readonly action: string;
    readonly recordJson: string;
    readonly issuedAt: string;
    readonly expiresAt: string;
  }): { readonly created: boolean } {
    return this.#saveAuthorityRecord("authority_grants", "grant_id", value.grantId, value);
  }

  loadAuthorityGrant(grantId: string): UnknownRecord | undefined {
    return this.#loadAuthorityRecord("authority_grants", "grant_id", grantId);
  }

  revokeAuthorityGrant(grantId: string, revokedAt: string, reason: string): boolean {
    return this.#revokeAuthorityRecord("authority_grants", "grant_id", grantId, revokedAt, reason);
  }

  #saveAuthorityRecord(
    table: "authority_approvals" | "authority_grants",
    idColumn: "approval_id" | "grant_id",
    id: string,
    value: {
      readonly workspaceId: string;
      readonly runId: string;
      readonly action: string;
      readonly recordJson: string;
      readonly issuedAt: string;
      readonly expiresAt: string;
    }
  ): { readonly created: boolean } {
    const recordDigest = sha256(value.recordJson);
    const existing = this.#database().prepare(`SELECT record_digest FROM ${table} WHERE ${idColumn}=?`).get(id) as
      UnknownRecord | undefined;
    if (existing !== undefined) {
      if (String(existing["record_digest"]) !== recordDigest) {
        throw runtimeError("VES_RUNTIME_CONSTRAINT", "Authority identity has conflicting content");
      }
      return Object.freeze({ created: false });
    }
    try {
      this.#database()
        .prepare(
          `INSERT INTO ${table}(${idColumn}, workspace_id, run_id, action, record_json, record_digest, issued_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          value.workspaceId,
          value.runId,
          value.action,
          value.recordJson,
          recordDigest,
          value.issuedAt,
          value.expiresAt
        );
      return Object.freeze({ created: true });
    } catch (error) {
      throw mapSqliteError(error);
    }
  }

  #loadAuthorityRecord(
    table: "authority_approvals" | "authority_grants",
    idColumn: "approval_id" | "grant_id",
    id: string
  ): UnknownRecord | undefined {
    const row = this.#database()
      .prepare(
        `SELECT record_json AS recordJson, record_digest AS recordDigest, revoked_at AS revokedAt,
        revocation_reason AS revocationReason FROM ${table} WHERE ${idColumn}=?`
      )
      .get(id) as UnknownRecord | undefined;
    if (row === undefined) return undefined;
    const recordJson = String(row["recordJson"]);
    if (sha256(recordJson) !== String(row["recordDigest"])) {
      throw runtimeError("VES_RUNTIME_CORRUPT", "Authority record integrity failed");
    }
    try {
      return Object.freeze({
        record: JSON.parse(recordJson) as unknown,
        revokedAt: row["revokedAt"] === null ? undefined : String(row["revokedAt"]),
        revocationReason: row["revocationReason"] === null ? undefined : String(row["revocationReason"])
      });
    } catch {
      throw runtimeError("VES_RUNTIME_CORRUPT", "Authority record JSON is invalid");
    }
  }

  #revokeAuthorityRecord(
    table: "authority_approvals" | "authority_grants",
    idColumn: "approval_id" | "grant_id",
    id: string,
    revokedAt: string,
    reason: string
  ): boolean {
    return (
      runStatement(
        this.#database().prepare(
          `UPDATE ${table} SET revoked_at=?, revocation_reason=? WHERE ${idColumn}=? AND revoked_at IS NULL`
        ),
        revokedAt,
        reason,
        id
      ) === 1
    );
  }

  acquireLease(value: {
    readonly leaseId: string;
    readonly workspaceId: string;
    readonly ownerId: string;
    readonly now: string;
    readonly expiresAt: string;
    readonly expectedFencingToken?: number;
  }): { readonly fencingToken: number } {
    const db = this.#database();
    try {
      db.exec("BEGIN IMMEDIATE");
      const current = db
        .prepare("SELECT owner_id, fencing_token, expires_at FROM leases WHERE workspace_id=?")
        .get(value.workspaceId) as UnknownRecord | undefined;
      if (
        value.expectedFencingToken !== undefined &&
        (current === undefined ||
          Number(current.fencing_token) !== value.expectedFencingToken ||
          String(current.owner_id) !== value.ownerId ||
          String(current.expires_at) <= value.now)
      ) {
        throw runtimeError("VES_RUNTIME_LEASE_CONFLICT", "Lease fencing compare-and-set failed");
      }
      let fencingToken = 1;
      if (current === undefined) {
        db.prepare(
          "INSERT INTO leases(workspace_id, lease_id, owner_id, fencing_token, expires_at) VALUES (?, ?, ?, ?, ?)"
        ).run(value.workspaceId, value.leaseId, value.ownerId, fencingToken, value.expiresAt);
      } else {
        if (String(current.owner_id) !== value.ownerId && String(current.expires_at) > value.now) {
          throw runtimeError("VES_RUNTIME_LEASE_CONFLICT", "Workspace has an active lease");
        }
        fencingToken =
          Number(current.fencing_token) +
          (String(current.owner_id) === value.ownerId && String(current.expires_at) > value.now ? 0 : 1);
        db.prepare("UPDATE leases SET lease_id=?, owner_id=?, fencing_token=?, expires_at=? WHERE workspace_id=?").run(
          value.leaseId,
          value.ownerId,
          fencingToken,
          value.expiresAt,
          value.workspaceId
        );
      }
      db.exec("COMMIT");
      return { fencingToken };
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      if (errorCode(error)?.startsWith("VES_RUNTIME_") === true) throw error;
      throw mapSqliteError(error);
    }
  }

  releaseLease(workspaceId: string, ownerId: string): boolean {
    const current = this.#database().prepare("SELECT owner_id FROM leases WHERE workspace_id=?").get(workspaceId) as
      UnknownRecord | undefined;
    if (current === undefined) return false;
    if (current.owner_id !== ownerId) {
      throw runtimeError("VES_RUNTIME_LEASE_OWNER_MISMATCH", "Only the lease owner may release it");
    }
    return runStatement(this.#database().prepare("DELETE FROM leases WHERE workspace_id=?"), workspaceId) === 1;
  }

  // Appends one execution checkpoint. With an explicit sequence the caller
  // owns ordering (the executor): only the next contiguous sequence, or an
  // identical replay of an existing one, is accepted. Without one the store
  // assigns the next sequence and treats an identical latest record as a
  // replay (gate and repair state).
  appendExecutionCheckpoint(value: {
    readonly kind: ExecutionCheckpointKind;
    readonly workspaceId: string;
    readonly runId: string;
    readonly taskId: string;
    readonly stage: string;
    readonly sequence?: number;
    readonly recordJson: string;
  }): { readonly checkpointId: string; readonly sequence: number; readonly replayed: boolean } {
    if (!CHECKPOINT_KINDS.has(value.kind))
      throw runtimeError("VES_RUNTIME_CONSTRAINT", "Execution checkpoint kind is invalid");
    if (Buffer.byteLength(value.recordJson, "utf8") > MAXIMUM_CHECKPOINT_RECORD_BYTES)
      throw runtimeError("VES_RUNTIME_CONSTRAINT", "Execution checkpoint record exceeds its bound");
    const recordDigest = sha256(value.recordJson);
    const db = this.#database();
    const identity = [value.kind, value.workspaceId, value.runId, value.taskId] as const;
    try {
      db.exec("BEGIN IMMEDIATE");
      const resolved = this.#nextCheckpointSequence(identity, value.sequence, recordDigest);
      if (resolved.replayOf !== undefined) {
        db.exec("COMMIT");
        return Object.freeze({ checkpointId: resolved.replayOf, sequence: resolved.sequence, replayed: true });
      }
      const sequence = resolved.sequence;
      const checkpointId = sha256(canonicalizeJsonV2([...identity, sequence, recordDigest]));
      db.prepare(
        `INSERT INTO execution_checkpoints(
          checkpoint_id, kind, workspace_id, run_id, task_id, sequence, stage, record_json, record_digest, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(checkpointId, ...identity, sequence, value.stage, value.recordJson, recordDigest, this.#now());
      db.exec("COMMIT");
      return Object.freeze({ checkpointId, sequence, replayed: false });
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      if (errorCode(error)?.startsWith("VES_") === true) throw error;
      throw mapSqliteError(error);
    }
  }

  #nextCheckpointSequence(
    identity: readonly [string, string, string, string],
    requested: number | undefined,
    recordDigest: string
  ): { readonly sequence: number; readonly replayOf?: string } {
    const db = this.#database();
    const latest = db
      .prepare(
        `SELECT checkpoint_id, sequence, record_digest FROM execution_checkpoints
         WHERE kind=? AND workspace_id=? AND run_id=? AND task_id=? ORDER BY sequence DESC LIMIT 1`
      )
      .get(...identity) as UnknownRecord | undefined;
    const latestSequence = latest === undefined ? 0 : Number(latest["sequence"]);
    if (requested === undefined) {
      return latest?.["record_digest"] === recordDigest
        ? { sequence: latestSequence, replayOf: String(latest["checkpoint_id"]) }
        : { sequence: latestSequence + 1 };
    }
    const existing = db
      .prepare(
        `SELECT checkpoint_id, record_digest FROM execution_checkpoints
         WHERE kind=? AND workspace_id=? AND run_id=? AND task_id=? AND sequence=?`
      )
      .get(...identity, requested) as UnknownRecord | undefined;
    if (existing !== undefined) {
      if (existing["record_digest"] !== recordDigest)
        throw runtimeError("VES_RUNTIME_CHECKPOINT_CONFLICT", "Checkpoint sequence is bound to another record");
      return { sequence: requested, replayOf: String(existing["checkpoint_id"]) };
    }
    if (requested !== latestSequence + 1)
      throw runtimeError("VES_RUNTIME_CHECKPOINT_CONFLICT", "Checkpoint sequence is not contiguous");
    return { sequence: requested };
  }

  // Returns the latest checkpoint only after its stored digest matches its
  // bytes; a row edited behind the store fails closed instead of steering a
  // resumed coordinator.
  latestExecutionCheckpoint(
    kind: ExecutionCheckpointKind,
    workspaceId: string,
    runId: string,
    taskId: string
  ): StoredExecutionCheckpoint | undefined {
    const row = this.#database()
      .prepare(
        `SELECT checkpoint_id, kind, workspace_id, run_id, task_id, sequence, stage, record_json, record_digest
         FROM execution_checkpoints
         WHERE kind=? AND workspace_id=? AND run_id=? AND task_id=? ORDER BY sequence DESC LIMIT 1`
      )
      .get(kind, workspaceId, runId, taskId) as UnknownRecord | undefined;
    if (row === undefined) return undefined;
    const recordJson = row["record_json"];
    const sequence = Number(row["sequence"]);
    if (
      typeof recordJson !== "string" ||
      sha256(recordJson) !== row["record_digest"] ||
      !Number.isSafeInteger(sequence) ||
      sequence < 1 ||
      row["checkpoint_id"] !==
        sha256(canonicalizeJsonV2([kind, workspaceId, runId, taskId, sequence, row["record_digest"]]))
    )
      throw runtimeError("VES_RUNTIME_CHECKPOINT_CORRUPT", "Execution checkpoint failed integrity validation");
    return Object.freeze({
      checkpointId: String(row["checkpoint_id"]),
      kind,
      workspaceId,
      runId,
      taskId,
      sequence,
      stage: String(row["stage"]),
      recordJson
    });
  }

  createEffectRepository() {
    const readIntentRow = (row: UnknownRecord): StoredEffectIntent => {
      const canonicalizationVersion = Number(row["canonicalization_version"]);
      if (canonicalizationVersion !== 1 && canonicalizationVersion !== 2) {
        throw runtimeError("VES_RUNTIME_CORRUPT", "Effect intent canonicalization version is invalid");
      }
      return Object.freeze({
        effectId: String(row["effect_id"]),
        idempotencyKey: String(row["idempotency_key"]),
        operationKind: String(row["operation_kind"]),
        workspaceId: String(row["workspace_id"]),
        ...(row["run_id"] === null ? {} : { runId: String(row["run_id"]) }),
        logicalTarget: String(row["logical_target"]),
        canonicalInputDigest: String(row["canonical_input_digest"]),
        semanticIdentity: String(row["semantic_identity"]),
        canonicalizationVersion,
        riskTier: String(row["risk_tier"]) as StoredEffectIntent["riskTier"],
        grantRef: String(row["grant_ref"]),
        ...(row["expected_remote_version"] === null
          ? {}
          : { expectedRemoteVersion: String(row["expected_remote_version"]) }),
        status: String(row["status"]) as StoredEffectIntent["status"],
        attempt: Number(row["attempt"]),
        createdAt: String(row["created_at"])
      });
    };
    const readIntent = (key: string): StoredEffectIntent | undefined => {
      const row = this.#database().prepare("SELECT * FROM effect_intents WHERE idempotency_key=?").get(key) as
        UnknownRecord | undefined;
      if (row === undefined) return undefined;
      return readIntentRow(row);
    };
    const readIntentByIdentity = (input: IdempotencyInput): StoredEffectIntent | undefined => {
      const row = this.#database()
        .prepare(
          `SELECT * FROM effect_intents
          WHERE operation_kind=? AND workspace_id=? AND logical_target=?
            AND canonical_input_digest=? AND semantic_identity=?`
        )
        .get(
          input.operationKind,
          input.workspaceId,
          input.logicalTarget,
          input.canonicalInputDigest,
          input.semanticIdentity
        ) as UnknownRecord | undefined;
      return row === undefined ? undefined : readIntentRow(row);
    };
    const readReceipt = (key: string): StoredReceipt | undefined => {
      const row = this.#database().prepare("SELECT * FROM operation_receipts WHERE idempotency_key=?").get(key) as
        UnknownRecord | undefined;
      if (row === undefined) return undefined;
      return Object.freeze({
        receiptId: String(row["receipt_id"]),
        effectId: String(row["effect_id"]),
        idempotencyKey: String(row["idempotency_key"]),
        adapterId: String(row["adapter_id"]),
        attempt: Number(row["attempt"]),
        outcome: String(row["outcome"]) as StoredReceipt["outcome"],
        ...(row["remote_identity"] === null ? {} : { remoteIdentity: String(row["remote_identity"]) }),
        ...(row["remote_version"] === null ? {} : { remoteVersion: String(row["remote_version"]) }),
        ...(row["output_digest"] === null ? {} : { outputDigest: String(row["output_digest"]) }),
        safeEvidenceRefs: Object.freeze(JSON.parse(String(row["safe_evidence_refs_json"])) as string[]),
        startedAt: String(row["started_at"]),
        completedAt: String(row["completed_at"])
      });
    };
    const updateStatus = (key: string, status: StoredEffectIntent["status"]): StoredEffectIntent => {
      const db = this.#database();
      try {
        db.exec("BEGIN IMMEDIATE");
        if (runStatement(db.prepare("UPDATE effect_intents SET status=? WHERE idempotency_key=?"), status, key) !== 1) {
          throw runtimeError("VES_EFFECT_NOT_FOUND", "Effect intent was not found");
        }
        db.prepare("UPDATE effect_outbox SET status=?, updated_at=? WHERE idempotency_key=?").run(
          status,
          this.#now(),
          key
        );
        db.exec("COMMIT");
        return readIntent(key) as StoredEffectIntent;
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        if (errorCode(error)?.startsWith("VES_") === true) throw error;
        throw mapSqliteError(error);
      }
    };

    return Object.freeze({
      insertOrGet: async (intent: StoredEffectIntent): Promise<StoredEffectIntent> => {
        const existing = readIntent(intent.idempotencyKey);
        if (existing !== undefined) {
          const fields = [
            "operationKind",
            "workspaceId",
            "logicalTarget",
            "canonicalInputDigest",
            "semanticIdentity",
            "canonicalizationVersion"
          ] as const;
          if (fields.some((field) => existing[field] !== intent[field])) {
            throw runtimeError("VES_EFFECT_KEY_CONFLICT", "Idempotency key is bound to different content");
          }
          return existing;
        }
        const existingByIdentity = readIntentByIdentity(intent);
        if (existingByIdentity !== undefined) return existingByIdentity;
        const db = this.#database();
        try {
          db.exec("BEGIN IMMEDIATE");
          const concurrent = readIntentByIdentity(intent);
          if (concurrent !== undefined) {
            db.exec("COMMIT");
            return concurrent;
          }
          db.prepare(
            `INSERT INTO effect_intents(
            effect_id, idempotency_key, operation_kind, workspace_id, run_id, logical_target,
            canonical_input_digest, semantic_identity, canonicalization_version, risk_tier, grant_ref, expected_remote_version,
            status, attempt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            intent.effectId,
            intent.idempotencyKey,
            intent.operationKind,
            intent.workspaceId,
            intent.runId ?? null,
            intent.logicalTarget,
            intent.canonicalInputDigest,
            intent.semanticIdentity,
            intent.canonicalizationVersion,
            intent.riskTier,
            intent.grantRef,
            intent.expectedRemoteVersion ?? null,
            intent.status,
            intent.attempt,
            intent.createdAt
          );
          db.prepare("INSERT INTO effect_outbox(idempotency_key, status, updated_at) VALUES (?, ?, ?)").run(
            intent.idempotencyKey,
            intent.status,
            this.#now()
          );
          db.exec("COMMIT");
          return readIntent(intent.idempotencyKey) as StoredEffectIntent;
        } catch (error) {
          if (db.isTransaction) db.exec("ROLLBACK");
          throw mapSqliteError(error);
        }
      },
      get: async (key: string) => readIntent(key),
      findByIdentity: async (input: IdempotencyInput) => readIntentByIdentity(input),
      getReceipt: async (key: string) => readReceipt(key),
      listDispatchable: async (limit: number): Promise<readonly StoredEffectIntent[]> => {
        const rows = this.#database()
          .prepare(
            `SELECT i.idempotency_key FROM effect_intents i
            INNER JOIN effect_outbox o ON o.idempotency_key=i.idempotency_key
            WHERE i.status IN ('planned', 'ready') AND o.status IN ('planned', 'ready')
            ORDER BY i.created_at, i.idempotency_key LIMIT ?`
          )
          .all(limit) as UnknownRecord[];
        return Object.freeze(rows.map((row) => readIntent(String(row["idempotency_key"])) as StoredEffectIntent));
      },
      updateStatus: async (key: string, status: StoredEffectIntent["status"]) => updateStatus(key, status),
      startAttempt: async (key: string): Promise<StoredEffectIntent> => {
        const db = this.#database();
        try {
          db.exec("BEGIN IMMEDIATE");
          if (
            runStatement(
              db.prepare(
                "UPDATE effect_intents SET status='applying', attempt=attempt+1 WHERE idempotency_key=? AND status IN ('planned', 'ready')"
              ),
              key
            ) !== 1
          ) {
            if (readIntent(key) === undefined)
              throw runtimeError("VES_EFFECT_NOT_FOUND", "Effect intent was not found");
            throw runtimeError(
              "VES_EFFECT_RECONCILIATION_REQUIRED",
              "Effect cannot be claimed from its current status"
            );
          }
          db.prepare("UPDATE effect_outbox SET status='applying', updated_at=? WHERE idempotency_key=?").run(
            this.#now(),
            key
          );
          db.exec("COMMIT");
          this.#hooks.afterEffectStart?.();
          return readIntent(key) as StoredEffectIntent;
        } catch (error) {
          if (db.isTransaction) db.exec("ROLLBACK");
          if (errorCode(error)?.startsWith("VES_") === true) throw error;
          throw mapSqliteError(error);
        }
      },
      complete: async (key: string, receipt: StoredReceipt): Promise<void> => {
        const existing = readReceipt(key);
        if (existing !== undefined) {
          if (JSON.stringify(existing) !== JSON.stringify(receipt)) {
            throw runtimeError("VES_EFFECT_RECEIPT_CONFLICT", "Receipt conflicts with durable inbox");
          }
          return;
        }
        const db = this.#database();
        try {
          db.exec("BEGIN IMMEDIATE");
          this.#hooks.beforeEffectComplete?.();
          db.prepare(
            `INSERT INTO operation_receipts(
            receipt_id, effect_id, idempotency_key, adapter_id, attempt, outcome, remote_identity,
            remote_version, output_digest, safe_evidence_refs_json, started_at, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            receipt.receiptId,
            receipt.effectId,
            receipt.idempotencyKey,
            receipt.adapterId,
            receipt.attempt,
            receipt.outcome,
            receipt.remoteIdentity ?? null,
            receipt.remoteVersion ?? null,
            receipt.outputDigest ?? null,
            JSON.stringify(receipt.safeEvidenceRefs),
            receipt.startedAt,
            receipt.completedAt
          );
          db.prepare("INSERT INTO effect_inbox(receipt_id, idempotency_key, received_at) VALUES (?, ?, ?)").run(
            receipt.receiptId,
            key,
            this.#now()
          );
          db.prepare("UPDATE effect_intents SET status='completed' WHERE idempotency_key=?").run(key);
          db.prepare("UPDATE effect_outbox SET status='completed', updated_at=? WHERE idempotency_key=?").run(
            this.#now(),
            key
          );
          db.exec("COMMIT");
          this.#hooks.afterEffectComplete?.();
        } catch (error) {
          if (db.isTransaction) db.exec("ROLLBACK");
          if (errorCode(error)?.startsWith("VES_") === true) throw error;
          throw mapSqliteError(error);
        }
      }
    });
  }

  integrityCheck(): string {
    return String((this.#database().prepare("PRAGMA integrity_check").get() as UnknownRecord).integrity_check);
  }

  stateDigest(): string {
    return runtimeStateDigest(this.#database());
  }

  async backupTo(targetPath: string): Promise<{
    readonly code: "VES_RUNTIME_BACKUP_READY";
    readonly path: string;
    readonly manifest: {
      readonly sha256: string;
      readonly stateDigest: string;
      readonly migrations: readonly { readonly id: string; readonly checksum: string }[];
      readonly createdAt: string;
    };
  }> {
    const stagingPath = `${targetPath}.staging-${randomUUID()}`;
    mkdirSync(dirname(targetPath), { recursive: true });
    try {
      await backup(this.#database(), stagingPath);
      try {
        (this.#hooks.validateBackup ?? inspectRuntimeDatabase)(stagingPath);
      } catch (error) {
        throw runtimeError("VES_RUNTIME_BACKUP_INVALID", "Staged runtime backup failed validation", error, true);
      }
      const bytes = await readFile(stagingPath);
      const manifest = Object.freeze({
        sha256: sha256(bytes),
        stateDigest: stateDigestFromFile(stagingPath),
        migrations: Object.freeze([...this.migrationLedger()]),
        createdAt: this.#now()
      });
      try {
        await (this.#hooks.publishBackup ?? rename)(stagingPath, targetPath);
      } catch (error) {
        throw runtimeError("VES_RUNTIME_BACKUP_PUBLISH_FAILED", "Runtime backup publication failed", error, true);
      }
      return { code: "VES_RUNTIME_BACKUP_READY", path: targetPath, manifest };
    } finally {
      if (existsSync(stagingPath)) await rm(stagingPath, { force: true });
    }
  }
}
