import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync, backup, type StatementSync } from "node:sqlite";

import type { RunSnapshot, WorkflowDecision } from "@verchestra/domain";

export interface RuntimeMigration {
  readonly id: string;
  readonly up: string;
}

const EFFECT_SCHEMA = `
CREATE TABLE effect_intents (
  effect_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  operation_kind TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  run_id TEXT,
  logical_target TEXT NOT NULL,
  canonical_input_digest TEXT NOT NULL,
  semantic_identity TEXT NOT NULL,
  risk_tier TEXT NOT NULL CHECK (risk_tier IN ('low', 'medium', 'high')),
  grant_ref TEXT NOT NULL,
  expected_remote_version TEXT,
  status TEXT NOT NULL CHECK (status IN ('planned', 'ready', 'applying', 'uncertain', 'completed', 'failed')),
  attempt INTEGER NOT NULL CHECK (attempt >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, idempotency_key),
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
) STRICT;
CREATE TABLE effect_outbox (
  idempotency_key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (idempotency_key) REFERENCES effect_intents(idempotency_key)
) STRICT;
CREATE TABLE operation_receipts (
  receipt_id TEXT PRIMARY KEY,
  effect_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  adapter_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  outcome TEXT NOT NULL,
  remote_identity TEXT,
  remote_version TEXT,
  output_digest TEXT,
  safe_evidence_refs_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  FOREIGN KEY (effect_id) REFERENCES effect_intents(effect_id),
  FOREIGN KEY (idempotency_key) REFERENCES effect_intents(idempotency_key)
) STRICT;
CREATE TABLE effect_inbox (
  receipt_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  received_at TEXT NOT NULL,
  FOREIGN KEY (receipt_id) REFERENCES operation_receipts(receipt_id)
) STRICT;`;

const RUNTIME_SCHEMA = `
CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  run_kind TEXT NOT NULL CHECK (run_kind IN ('feature', 'recovery')),
  state TEXT NOT NULL CHECK (state IN (
    'CREATED', 'INTAKE_REQUIRED', 'READY', 'DISCOVERY_REQUIRED', 'RECONNING',
    'SPECIFYING', 'SPEC_REVIEW', 'DESIGNING', 'DESIGN_REVIEW', 'TASKING',
    'EXECUTION_READY', 'AWAITING_EXECUTION_APPROVAL', 'EXECUTION_AUTHORIZED',
    'IMPLEMENTING', 'VERIFYING', 'REPAIRING', 'HUMAN_RESOLUTION_REQUIRED',
    'HUMAN_REVIEW', 'HANDOFF_PREPARING', 'AWAITING_HANDOFF_PUBLICATION_APPROVAL',
    'COMPLETED', 'HANDED_OFF', 'FAILED', 'ABORTED', 'INTERRUPTED', 'RECOVERED'
  )),
  state_version INTEGER NOT NULL CHECK (state_version >= 0),
  repair_cycles INTEGER NOT NULL CHECK (repair_cycles >= 0),
  approval_binding_digest TEXT,
  implementation_actor_id TEXT,
  terminal_capsule_required INTEGER NOT NULL CHECK (terminal_capsule_required IN (0, 1)),
  predecessor_run_id TEXT,
  successor_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE state_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  expected_state_version INTEGER NOT NULL CHECK (expected_state_version >= 0),
  previous_state TEXT NOT NULL,
  next_state TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_digest TEXT NOT NULL CHECK (length(payload_digest) = 64),
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  UNIQUE (run_id, sequence),
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
) STRICT;
CREATE TABLE approvals (
  approval_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  action TEXT NOT NULL,
  binding_digest TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
) STRICT;
CREATE TABLE grants (
  grant_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  action TEXT NOT NULL,
  binding_digest TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
) STRICT;
CREATE TABLE leases (
  workspace_id TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
  expires_at TEXT NOT NULL
) STRICT;
CREATE TABLE claims (
  claim_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  scope_digest TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (workspace_id, scope_digest)
) STRICT;
CREATE TABLE artifact_refs (
  ref_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  digest TEXT NOT NULL,
  logical_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
) STRICT;`;

export const DEFAULT_RUNTIME_MIGRATIONS: readonly RuntimeMigration[] = Object.freeze([
  Object.freeze({ id: "001_runtime", up: RUNTIME_SCHEMA }),
  Object.freeze({ id: "002_effects", up: EFFECT_SCHEMA })
]);

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
}

interface RuntimeStoreOptions {
  readonly dbPath: string;
  readonly timeoutMs?: number;
  readonly migrations?: readonly RuntimeMigration[];
  readonly hooks?: RuntimeStoreHooks;
  readonly now?: () => string;
}

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
  effect_inbox: "idempotency_key"
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

  putApproval(value: {
    readonly approvalId: string;
    readonly runId: string;
    readonly action: string;
    readonly bindingDigest: string;
    readonly issuedAt: string;
    readonly expiresAt: string;
  }): void {
    try {
      this.#database()
        .prepare(
          `INSERT INTO approvals(approval_id, run_id, action, binding_digest, issued_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(value.approvalId, value.runId, value.action, value.bindingDigest, value.issuedAt, value.expiresAt);
    } catch (error) {
      throw mapSqliteError(error);
    }
  }

  getApproval(approvalId: string): UnknownRecord {
    const row = requireRow(
      this.#database()
        .prepare(
          `SELECT approval_id AS approvalId, run_id AS runId, action, binding_digest AS bindingDigest,
          issued_at AS issuedAt, expires_at AS expiresAt, revoked_at AS revokedAt FROM approvals WHERE approval_id=?`
        )
        .get(approvalId)
    );
    return { ...row };
  }

  revokeApproval(approvalId: string, revokedAt: string): void {
    if (
      runStatement(
        this.#database().prepare("UPDATE approvals SET revoked_at=? WHERE approval_id=?"),
        revokedAt,
        approvalId
      ) !== 1
    ) {
      throw runtimeError("VES_RUNTIME_NOT_FOUND", "Approval was not found");
    }
  }

  putGrant(value: {
    readonly grantId: string;
    readonly runId: string;
    readonly action: string;
    readonly bindingDigest: string;
    readonly issuedAt: string;
    readonly expiresAt: string;
  }): void {
    try {
      this.#database()
        .prepare(
          `INSERT INTO grants(grant_id, run_id, action, binding_digest, issued_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(value.grantId, value.runId, value.action, value.bindingDigest, value.issuedAt, value.expiresAt);
    } catch (error) {
      throw mapSqliteError(error);
    }
  }

  listActiveGrants(runId: string, now: string): readonly UnknownRecord[] {
    return this.#database()
      .prepare(
        `SELECT grant_id AS grantId, run_id AS runId, action, binding_digest AS bindingDigest,
        issued_at AS issuedAt, expires_at AS expiresAt FROM grants
        WHERE run_id=? AND issued_at<=? AND expires_at>? ORDER BY grant_id`
      )
      .all(runId, now, now) as UnknownRecord[];
  }

  acquireLease(value: {
    readonly leaseId: string;
    readonly workspaceId: string;
    readonly ownerId: string;
    readonly now: string;
    readonly expiresAt: string;
  }): { readonly fencingToken: number } {
    const db = this.#database();
    try {
      db.exec("BEGIN IMMEDIATE");
      const current = db
        .prepare("SELECT owner_id, fencing_token, expires_at FROM leases WHERE workspace_id=?")
        .get(value.workspaceId) as UnknownRecord | undefined;
      let fencingToken = 1;
      if (current === undefined) {
        db.prepare(
          "INSERT INTO leases(workspace_id, lease_id, owner_id, fencing_token, expires_at) VALUES (?, ?, ?, ?, ?)"
        ).run(value.workspaceId, value.leaseId, value.ownerId, fencingToken, value.expiresAt);
      } else {
        if (String(current.owner_id) !== value.ownerId && String(current.expires_at) > value.now) {
          throw runtimeError("VES_RUNTIME_LEASE_CONFLICT", "Workspace has an active lease");
        }
        fencingToken = Number(current.fencing_token) + (String(current.owner_id) === value.ownerId ? 0 : 1);
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

  acquireClaim(value: {
    readonly claimId: string;
    readonly workspaceId: string;
    readonly scopeDigest: string;
    readonly ownerId: string;
    readonly now: string;
    readonly expiresAt: string;
  }): void {
    const db = this.#database();
    try {
      db.exec("BEGIN IMMEDIATE");
      const current = db
        .prepare("SELECT claim_id, owner_id, expires_at FROM claims WHERE workspace_id=? AND scope_digest=?")
        .get(value.workspaceId, value.scopeDigest) as UnknownRecord | undefined;
      if (
        current !== undefined &&
        String(current.owner_id) !== value.ownerId &&
        String(current.expires_at) > value.now
      ) {
        throw runtimeError("VES_RUNTIME_CLAIM_CONFLICT", "Scope has an active work claim");
      }
      if (current === undefined) {
        db.prepare(
          "INSERT INTO claims(claim_id, workspace_id, scope_digest, owner_id, expires_at) VALUES (?, ?, ?, ?, ?)"
        ).run(value.claimId, value.workspaceId, value.scopeDigest, value.ownerId, value.expiresAt);
      } else {
        db.prepare(
          "UPDATE claims SET claim_id=?, owner_id=?, expires_at=? WHERE workspace_id=? AND scope_digest=?"
        ).run(value.claimId, value.ownerId, value.expiresAt, value.workspaceId, value.scopeDigest);
      }
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      if (errorCode(error)?.startsWith("VES_RUNTIME_") === true) throw error;
      throw mapSqliteError(error);
    }
  }

  releaseClaim(claimId: string, ownerId: string): boolean {
    const current = this.#database().prepare("SELECT owner_id FROM claims WHERE claim_id=?").get(claimId) as
      UnknownRecord | undefined;
    if (current === undefined) return false;
    if (current.owner_id !== ownerId) {
      throw runtimeError("VES_RUNTIME_CLAIM_OWNER_MISMATCH", "Only the claim owner may release it");
    }
    return runStatement(this.#database().prepare("DELETE FROM claims WHERE claim_id=?"), claimId) === 1;
  }

  putArtifactRef(value: {
    readonly refId: string;
    readonly runId: string;
    readonly kind: string;
    readonly digest: string;
    readonly logicalPath: string;
    readonly createdAt: string;
  }): void {
    try {
      this.#database()
        .prepare(
          `INSERT INTO artifact_refs(ref_id, run_id, kind, digest, logical_path, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(value.refId, value.runId, value.kind, value.digest, value.logicalPath, value.createdAt);
    } catch (error) {
      throw mapSqliteError(error);
    }
  }

  listArtifactRefs(runId: string): readonly UnknownRecord[] {
    return this.#database()
      .prepare(
        `SELECT ref_id AS refId, run_id AS runId, kind, digest, logical_path AS logicalPath,
        created_at AS createdAt FROM artifact_refs WHERE run_id=? ORDER BY created_at, ref_id`
      )
      .all(runId) as UnknownRecord[];
  }

  createEffectRepository() {
    const readIntent = (key: string): StoredEffectIntent | undefined => {
      const row = this.#database().prepare("SELECT * FROM effect_intents WHERE idempotency_key=?").get(key) as
        UnknownRecord | undefined;
      if (row === undefined) return undefined;
      return Object.freeze({
        effectId: String(row["effect_id"]),
        idempotencyKey: String(row["idempotency_key"]),
        operationKind: String(row["operation_kind"]),
        workspaceId: String(row["workspace_id"]),
        ...(row["run_id"] === null ? {} : { runId: String(row["run_id"]) }),
        logicalTarget: String(row["logical_target"]),
        canonicalInputDigest: String(row["canonical_input_digest"]),
        semanticIdentity: String(row["semantic_identity"]),
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
            "semanticIdentity"
          ] as const;
          if (fields.some((field) => existing[field] !== intent[field])) {
            throw runtimeError("VES_EFFECT_KEY_CONFLICT", "Idempotency key is bound to different content");
          }
          return existing;
        }
        const db = this.#database();
        try {
          db.exec("BEGIN IMMEDIATE");
          db.prepare(
            `INSERT INTO effect_intents(
            effect_id, idempotency_key, operation_kind, workspace_id, run_id, logical_target,
            canonical_input_digest, semantic_identity, risk_tier, grant_ref, expected_remote_version,
            status, attempt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            intent.effectId,
            intent.idempotencyKey,
            intent.operationKind,
            intent.workspaceId,
            intent.runId ?? null,
            intent.logicalTarget,
            intent.canonicalInputDigest,
            intent.semanticIdentity,
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
