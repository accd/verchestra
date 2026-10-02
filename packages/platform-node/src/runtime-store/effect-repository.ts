import type { DatabaseSync } from "node:sqlite";

import type { IdempotencyInput } from "@verchestra/application";

import { errorCode, mapSqliteError, runStatement, runtimeError } from "./runtime-sqlite.ts";

// why: the durable effect intents, outbox, receipts and inbox form one unit
// with its own transactions and fault hooks. Holding them here leaves
// runtime-store.ts with the connection, the migrations and the clock, and the
// type-only node:sqlite import means this module never loads SQLite itself.

type Row = Record<string, unknown>;

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

export interface EffectRepositoryHooks {
  readonly afterEffectStart?: () => void;
  readonly beforeEffectComplete?: () => void;
  readonly afterEffectComplete?: () => void;
}

interface EffectRepositoryOptions {
  // invariant: resolved on every use and never cached, so a closed store fails
  // closed with VES_RUNTIME_CLOSED and a reopened one is picked up.
  readonly database: () => DatabaseSync;
  readonly now: () => string;
  readonly hooks: EffectRepositoryHooks;
}

// why: the status, attempt and receipt writers share one failure tail. A VES_
// error raised inside the transaction is already a public code and passes
// through unmapped; anything else is a SQLite failure.
function rolledBack(db: DatabaseSync, error: unknown): unknown {
  if (db.isTransaction) db.exec("ROLLBACK");
  return errorCode(error)?.startsWith("VES_") === true ? error : mapSqliteError(error);
}

export function createSqliteEffectRepository({ database, now, hooks }: EffectRepositoryOptions) {
  const readIntentRow = (row: Row): StoredEffectIntent => {
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
    const row = database().prepare("SELECT * FROM effect_intents WHERE idempotency_key=?").get(key) as Row | undefined;
    if (row === undefined) return undefined;
    return readIntentRow(row);
  };
  const readIntentByIdentity = (input: IdempotencyInput): StoredEffectIntent | undefined => {
    const row = database()
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
      ) as Row | undefined;
    return row === undefined ? undefined : readIntentRow(row);
  };
  const readReceipt = (key: string): StoredReceipt | undefined => {
    const row = database().prepare("SELECT * FROM operation_receipts WHERE idempotency_key=?").get(key) as
      Row | undefined;
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
    const db = database();
    try {
      db.exec("BEGIN IMMEDIATE");
      if (runStatement(db.prepare("UPDATE effect_intents SET status=? WHERE idempotency_key=?"), status, key) !== 1) {
        throw runtimeError("VES_EFFECT_NOT_FOUND", "Effect intent was not found");
      }
      db.prepare("UPDATE effect_outbox SET status=?, updated_at=? WHERE idempotency_key=?").run(status, now(), key);
      db.exec("COMMIT");
      return readIntent(key) as StoredEffectIntent;
    } catch (error) {
      throw rolledBack(db, error);
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
      const db = database();
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
          now()
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
      const rows = database()
        .prepare(
          `SELECT i.idempotency_key FROM effect_intents i
          INNER JOIN effect_outbox o ON o.idempotency_key=i.idempotency_key
          WHERE i.status IN ('planned', 'ready') AND o.status IN ('planned', 'ready')
          ORDER BY i.created_at, i.idempotency_key LIMIT ?`
        )
        .all(limit) as Row[];
      return Object.freeze(rows.map((row) => readIntent(String(row["idempotency_key"])) as StoredEffectIntent));
    },
    updateStatus: async (key: string, status: StoredEffectIntent["status"]) => updateStatus(key, status),
    startAttempt: async (key: string): Promise<StoredEffectIntent> => {
      const db = database();
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
          if (readIntent(key) === undefined) throw runtimeError("VES_EFFECT_NOT_FOUND", "Effect intent was not found");
          throw runtimeError("VES_EFFECT_RECONCILIATION_REQUIRED", "Effect cannot be claimed from its current status");
        }
        db.prepare("UPDATE effect_outbox SET status='applying', updated_at=? WHERE idempotency_key=?").run(now(), key);
        db.exec("COMMIT");
        hooks.afterEffectStart?.();
        return readIntent(key) as StoredEffectIntent;
      } catch (error) {
        throw rolledBack(db, error);
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
      const db = database();
      try {
        db.exec("BEGIN IMMEDIATE");
        hooks.beforeEffectComplete?.();
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
          now()
        );
        db.prepare("UPDATE effect_intents SET status='completed' WHERE idempotency_key=?").run(key);
        db.prepare("UPDATE effect_outbox SET status='completed', updated_at=? WHERE idempotency_key=?").run(now(), key);
        db.exec("COMMIT");
        hooks.afterEffectComplete?.();
      } catch (error) {
        throw rolledBack(db, error);
      }
    }
  });
}
