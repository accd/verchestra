import type {
  ExecutionCheckpoint,
  ExecutionCheckpointPort,
  GateRepairStatePort,
  TaskGateCheckpointPort
} from "@verchestra/application";
import { canonicalizeJsonV2 } from "@verchestra/domain";

import type { ExecutionCheckpointKind, RuntimeStore } from "./runtime-store/runtime-store.ts";

type Row = Record<string, unknown>;

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const REQUIREMENT = /^VES-[A-Z]{3}-\d{3}$/u;
const GATE_IDENTITY = ["workspaceId", "runId", "taskId", "gatePlanDigest", "changeDigest", "stage"] as const;
const passedFields = (row: Row): boolean =>
  matches(row["gateEvidenceDigest"], DIGEST) && list(row["gateEvidenceRefs"], SAFE);
// invariant: exactly the fields TaskGateCommitCoordinator#save writes per stage.
const GATE_STAGES: Readonly<
  Record<string, { readonly fields: readonly string[]; readonly valid: (row: Row) => boolean }>
> = Object.freeze({
  "gate-failed": {
    fields: ["gateId", "requirementIds", "evidenceRef", "evidenceDigest"],
    valid: (row: Row) =>
      matches(row["gateId"], SAFE) &&
      list(row["requirementIds"], REQUIREMENT) &&
      matches(row["evidenceRef"], SAFE) &&
      matches(row["evidenceDigest"], DIGEST)
  },
  "gates-passed": { fields: ["gateEvidenceDigest", "gateEvidenceRefs"], valid: passedFields },
  "commit-uncertain": { fields: ["gateEvidenceDigest", "gateEvidenceRefs"], valid: passedFields },
  committed: {
    fields: ["commitId", "idempotencyKey"],
    valid: (row: Row) => matches(row["commitId"], OBJECT_ID) && matches(row["idempotencyKey"], DIGEST)
  }
});
const REPAIR_STAGES: ReadonlySet<string> = new Set([
  "repair",
  "escalated",
  "converged",
  "gate-failed",
  "budget-exceeded"
]);

export class CheckpointStoreError extends Error {
  readonly code: "VES_RUNTIME_CONSTRAINT" | "VES_RUNTIME_CHECKPOINT_CORRUPT";

  constructor(code: CheckpointStoreError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CheckpointStoreError";
    this.code = code;
  }
}

type Failure = (message: string) => never;

const rejectInput: Failure = (message) => {
  throw new CheckpointStoreError("VES_RUNTIME_CONSTRAINT", message);
};
const rejectStored: Failure = (message) => {
  throw new CheckpointStoreError("VES_RUNTIME_CHECKPOINT_CORRUPT", message);
};

function codeUnitCompare(left: string, right: string): number {
  return Number(left > right) - Number(left < right);
}

function exactRow(value: unknown, keys: readonly string[], reject: Failure, label: string): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value)) reject(`${label} must be an object`);
  const row = value as Row;
  const actual = Object.keys(row).sort(codeUnitCompare);
  const expected = [...keys].sort(codeUnitCompare);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    reject(`${label} does not have the declared fields`);
  return row;
}

function matches(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}

function list(value: unknown, pattern: RegExp): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 100 &&
    value.every((entry) => matches(entry, pattern)) &&
    new Set(value).size === value.length
  );
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value as Row)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

function encode(record: Row): string {
  try {
    return canonicalizeJsonV2(record);
  } catch (error) {
    throw new CheckpointStoreError("VES_RUNTIME_CONSTRAINT", "Checkpoint record is not canonical JSON", {
      cause: error
    });
  }
}

function decode(recordJson: string): unknown {
  try {
    return JSON.parse(recordJson) as unknown;
  } catch (error) {
    throw new CheckpointStoreError("VES_RUNTIME_CHECKPOINT_CORRUPT", "Stored checkpoint is not JSON", {
      cause: error
    });
  }
}

function assertIdentity(workspaceId: unknown, runId: unknown, taskId: unknown, reject: Failure): void {
  if (!matches(workspaceId, SAFE) || !matches(runId, SAFE) || !matches(taskId, SAFE))
    reject("checkpoint identity is invalid");
}

function validateGateRecord(value: unknown, reject: Failure): Row {
  const stage = (value as Row | null)?.["stage"];
  const declared = typeof stage === "string" && Object.hasOwn(GATE_STAGES, stage) ? GATE_STAGES[stage] : undefined;
  if (declared === undefined) reject("gate checkpoint stage is not declared");
  const row = exactRow(value, [...GATE_IDENTITY, ...declared.fields], reject, "gate checkpoint");
  assertIdentity(row["workspaceId"], row["runId"], row["taskId"], reject);
  if (!matches(row["gatePlanDigest"], DIGEST) || !matches(row["changeDigest"], DIGEST))
    reject("gate checkpoint digests are invalid");
  if (!declared.valid(row)) reject(`gate checkpoint ${String(stage)} fields are invalid`);
  return row;
}

function validAttemptChain(attempts: unknown, digests: unknown): boolean {
  if (!Number.isSafeInteger(attempts) || (attempts as number) < 0 || (attempts as number) > 5) return false;
  return Array.isArray(digests) && digests.length === attempts && digests.every((digest) => matches(digest, DIGEST));
}

function validateRepairState(value: unknown, reject: Failure): Row {
  const row = exactRow(value, ["stage", "attempts", "attemptCapsuleDigests", "budgetLedger"], reject, "repair state");
  const ledger = row["budgetLedger"];
  const ledgerShape = ledger === null || (typeof ledger === "object" && !Array.isArray(ledger));
  if (
    !REPAIR_STAGES.has(row["stage"] as string) ||
    !validAttemptChain(row["attempts"], row["attemptCapsuleDigests"]) ||
    !ledgerShape
  )
    reject("repair state is invalid");
  return row;
}

// Durable checkpoints for the executor, the gate/commit coordinator, and the
// gate repair loop, backed by migration 012 in the runtime store. Saves are
// idempotent; loads verify digest, shape, and identity and fail closed.
export class RuntimeCheckpointStore {
  readonly #store: RuntimeStore;

  constructor(store: RuntimeStore) {
    this.#store = store;
  }

  executorCheckpoints(): ExecutionCheckpointPort {
    return Object.freeze({
      // invariant: no await precedes the store call, so concurrent saves reach
      // SQLite in call order and the executor's sequence stays contiguous.
      save: async (checkpoint: Omit<ExecutionCheckpoint, "checkpointRef">) => {
        const row = exactRow(
          checkpoint,
          ["workspaceId", "runId", "taskId", "stage", "sequence", "data"],
          rejectInput,
          "executor checkpoint"
        );
        assertIdentity(row["workspaceId"], row["runId"], row["taskId"], rejectInput);
        if (!matches(row["stage"], SAFE) || !Number.isSafeInteger(row["sequence"]) || (row["sequence"] as number) < 1)
          rejectInput("executor checkpoint stage or sequence is invalid");
        const saved = this.#store.appendExecutionCheckpoint({
          kind: "executor",
          workspaceId: row["workspaceId"] as string,
          runId: row["runId"] as string,
          taskId: row["taskId"] as string,
          stage: row["stage"] as string,
          sequence: row["sequence"] as number,
          recordJson: encode(row)
        });
        return Object.freeze({ checkpointRef: `checkpoint:executor:${saved.checkpointId}` });
      },
      load: async (workspaceId: string, runId: string, taskId: string) => {
        const stored = this.#latest("executor", workspaceId, runId, taskId);
        if (stored === undefined) return undefined;
        const row = exactRow(
          decode(stored.recordJson),
          ["workspaceId", "runId", "taskId", "stage", "sequence", "data"],
          rejectStored,
          "stored executor checkpoint"
        );
        if (
          row["workspaceId"] !== workspaceId ||
          row["runId"] !== runId ||
          row["taskId"] !== taskId ||
          row["sequence"] !== stored.sequence ||
          row["stage"] !== stored.stage ||
          !matches(row["stage"], SAFE)
        )
          rejectStored("stored executor checkpoint does not match its identity");
        return deepFreeze({
          ...row,
          checkpointRef: `checkpoint:executor:${stored.checkpointId}`
        }) as ExecutionCheckpoint;
      }
    });
  }

  gateCheckpoints(): TaskGateCheckpointPort {
    return Object.freeze({
      save: async (entry: Readonly<Record<string, unknown>>) => {
        const row = validateGateRecord(entry, rejectInput);
        const saved = this.#store.appendExecutionCheckpoint({
          kind: "gate",
          workspaceId: row["workspaceId"] as string,
          runId: row["runId"] as string,
          taskId: row["taskId"] as string,
          stage: row["stage"] as string,
          recordJson: encode(row)
        });
        return Object.freeze({ checkpointRef: `checkpoint:gate:${saved.checkpointId}` });
      },
      // why: a gate-failed attempt is terminal for that attempt; the next repair
      // attempt re-runs its gates instead of resuming a failed verdict.
      load: async (workspaceId: string, runId: string, taskId: string) => {
        const row = this.#gateRecord(workspaceId, runId, taskId);
        return row === undefined || row["stage"] === "gate-failed" ? undefined : row;
      }
    });
  }

  // The composition consults this before resuming: a committed task must not be
  // handed back to the gate coordinator, which rejects a committed record.
  inspectGate(
    workspaceId: string,
    runId: string,
    taskId: string
  ): { readonly stage: string; readonly record: Readonly<Row> } | undefined {
    const row = this.#gateRecord(workspaceId, runId, taskId);
    return row === undefined ? undefined : Object.freeze({ stage: row["stage"] as string, record: row });
  }

  repairState(workspaceId: string, runId: string, taskId: string): GateRepairStatePort {
    assertIdentity(workspaceId, runId, taskId, rejectInput);
    return Object.freeze({
      loadState: async () => this.inspectRepair(workspaceId, runId, taskId),
      saveState: async (state: Parameters<GateRepairStatePort["saveState"]>[0]) =>
        this.recordRepair(workspaceId, runId, taskId, state)
    });
  }

  // why: the repair state without a promise, for a caller that cannot await.
  // A driver's usage event is metered inside the driver's stream handling, and
  // the ledger it moves must be stored before the next event is read.
  // invariant: the same checks as the port: these two are what the port calls.
  inspectRepair(workspaceId: string, runId: string, taskId: string): Readonly<Row> | undefined {
    const stored = this.#latest("repair", workspaceId, runId, taskId);
    if (stored === undefined) return undefined;
    const row = validateRepairState(decode(stored.recordJson), rejectStored);
    if (row["stage"] !== stored.stage) rejectStored("stored repair state does not match its stage");
    return deepFreeze(row);
  }

  recordRepair(workspaceId: string, runId: string, taskId: string, state: unknown): void {
    assertIdentity(workspaceId, runId, taskId, rejectInput);
    const row = validateRepairState(state, rejectInput);
    this.#store.appendExecutionCheckpoint({
      kind: "repair",
      workspaceId,
      runId,
      taskId,
      stage: row["stage"] as string,
      recordJson: encode(row)
    });
  }

  #gateRecord(workspaceId: string, runId: string, taskId: string): Readonly<Row> | undefined {
    const stored = this.#latest("gate", workspaceId, runId, taskId);
    if (stored === undefined) return undefined;
    const row = validateGateRecord(decode(stored.recordJson), rejectStored);
    if (
      row["workspaceId"] !== workspaceId ||
      row["runId"] !== runId ||
      row["taskId"] !== taskId ||
      row["stage"] !== stored.stage
    )
      rejectStored("stored gate checkpoint does not match its identity");
    return deepFreeze(row);
  }

  #latest(kind: ExecutionCheckpointKind, workspaceId: string, runId: string, taskId: string) {
    assertIdentity(workspaceId, runId, taskId, rejectInput);
    return this.#store.latestExecutionCheckpoint(kind, workspaceId, runId, taskId);
  }
}
