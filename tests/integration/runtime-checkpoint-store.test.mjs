import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import { runGateRepairLoop } from "../../packages/application/src/index.ts";
import {
  DEFAULT_RUNTIME_MIGRATIONS,
  RuntimeCheckpointStore,
  RuntimeStore
} from "../../packages/platform-node/src/index.ts";
import { coordinator as gateCoordinator, gateInput, gatePorts } from "../helpers/gate-commit-fixture.mjs";
import { executor, executorInput, executorPorts } from "../helpers/task-executor-fixture.mjs";
import { cleanup, opened } from "../helpers/runtime-store-fixture.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const identity = { workspaceId: "workspace:checkpoint", runId: "run:checkpoint", taskId: "T405.2" };
const checkpoint = (sequence, data = { turn: sequence }, stage = "driver-progress") => ({
  ...identity,
  stage,
  sequence,
  data
});

afterEach(cleanup);

async function storeFixture() {
  const { dbPath, store } = await opened();
  return { dbPath, store, checkpoints: new RuntimeCheckpointStore(store) };
}

// Rewrites a stored row behind the store, the way a tampering process or a
// torn manual edit would.
function tamper(dbPath, sql, ...values) {
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(sql).run(...values);
  } finally {
    db.close();
  }
}

test("migration 012 creates the execution checkpoint table as the twelfth registered migration", async () => {
  const { dbPath, store } = await storeFixture();
  assert.equal(DEFAULT_RUNTIME_MIGRATIONS.length, 12);
  assert.equal(DEFAULT_RUNTIME_MIGRATIONS.at(-1).id, "012_execution_checkpoints");
  assert.equal(store.migrationLedger().at(-1).id, "012_execution_checkpoints");
  store.close();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const columns = db
      .prepare("SELECT name FROM pragma_table_info('execution_checkpoints') ORDER BY cid")
      .all()
      .map((row) => row.name);
    assert.deepEqual(columns, [
      "checkpoint_id",
      "kind",
      "workspace_id",
      "run_id",
      "task_id",
      "sequence",
      "stage",
      "record_json",
      "record_digest",
      "created_at"
    ]);
  } finally {
    db.close();
  }
});

test("executor checkpoints round-trip the latest record with its reference and frozen data", async () => {
  const { checkpoints } = await storeFixture();
  const port = checkpoints.executorCheckpoints();
  assert.equal(await port.load(identity.workspaceId, identity.runId, identity.taskId), undefined);
  await port.save(checkpoint(1));
  const second = await port.save(checkpoint(2, { changedPaths: ["src/a.txt"], meter: null }));
  const loaded = await port.load(identity.workspaceId, identity.runId, identity.taskId);
  assert.equal(loaded.checkpointRef, second.checkpointRef);
  assert.match(loaded.checkpointRef, /^checkpoint:executor:[a-f0-9]{64}$/u);
  assert.equal(loaded.sequence, 2);
  assert.deepEqual(loaded.data, { changedPaths: ["src/a.txt"], meter: null });
  assert.equal(Object.isFrozen(loaded.data.changedPaths), true);
  assert.equal(await port.load(identity.workspaceId, identity.runId, "another-task"), undefined);
});

test("an identical executor replay is idempotent and returns the original reference", async () => {
  const { checkpoints } = await storeFixture();
  const port = checkpoints.executorCheckpoints();
  const first = await port.save(checkpoint(1));
  const replay = await port.save(checkpoint(1));
  assert.equal(replay.checkpointRef, first.checkpointRef);
  const next = await port.save(checkpoint(2));
  assert.notEqual(next.checkpointRef, first.checkpointRef);
});

test("a conflicting record at a stored sequence or a sequence gap fails closed", async () => {
  const { checkpoints } = await storeFixture();
  const port = checkpoints.executorCheckpoints();
  await port.save(checkpoint(1));
  await assert.rejects(port.save(checkpoint(1, { turn: 99 })), { code: "VES_RUNTIME_CHECKPOINT_CONFLICT" });
  await assert.rejects(port.save(checkpoint(3)), { code: "VES_RUNTIME_CHECKPOINT_CONFLICT" });
  const loaded = await port.load(identity.workspaceId, identity.runId, identity.taskId);
  assert.equal(loaded.sequence, 1);
  assert.deepEqual(loaded.data, { turn: 1 });
});

test("unencodable or malformed executor checkpoints are refused before storage", async () => {
  const { checkpoints } = await storeFixture();
  const port = checkpoints.executorCheckpoints();
  await assert.rejects(port.save(checkpoint(1, { value: Number.NaN })), { code: "VES_RUNTIME_CONSTRAINT" });
  await assert.rejects(port.save({ ...checkpoint(1), extra: true }), { code: "VES_RUNTIME_CONSTRAINT" });
  await assert.rejects(port.save({ ...checkpoint(1), stage: "../escape stage" }), { code: "VES_RUNTIME_CONSTRAINT" });
  await assert.rejects(port.save(checkpoint(0)), { code: "VES_RUNTIME_CONSTRAINT" });
  await assert.rejects(port.save(checkpoint(1, { blob: "x".repeat(300_000) })), { code: "VES_RUNTIME_CONSTRAINT" });
  assert.equal(await port.load(identity.workspaceId, identity.runId, identity.taskId), undefined);
});

test("concurrent executor saves issued without awaiting keep their call order", async () => {
  const { checkpoints } = await storeFixture();
  const port = checkpoints.executorCheckpoints();
  const saves = [1, 2, 3, 4].map((sequence) => port.save(checkpoint(sequence)));
  await Promise.all(saves);
  assert.equal((await port.load(identity.workspaceId, identity.runId, identity.taskId)).sequence, 4);
});

test("a tampered, forged, or non-JSON executor record fails closed on load", async () => {
  for (const [name, edit] of [
    [
      "edited bytes",
      (dbPath) => tamper(dbPath, "UPDATE execution_checkpoints SET record_json=replace(record_json, '1', '7')")
    ],
    [
      "a re-digested record claiming another task",
      (dbPath) => {
        const forged = canonicalizeJsonV2({ ...checkpoint(1), taskId: "T-other" });
        tamper(dbPath, "UPDATE execution_checkpoints SET record_json=?, record_digest=?", forged, sha(forged));
      }
    ],
    [
      "non-JSON bytes",
      (dbPath) => tamper(dbPath, "UPDATE execution_checkpoints SET record_json=?, record_digest=?", "{", sha("{"))
    ]
  ]) {
    const { dbPath, store, checkpoints } = await storeFixture();
    await checkpoints.executorCheckpoints().save(checkpoint(1));
    edit(dbPath);
    await assert.rejects(
      checkpoints.executorCheckpoints().load(identity.workspaceId, identity.runId, identity.taskId),
      { code: "VES_RUNTIME_CHECKPOINT_CORRUPT" },
      name
    );
    store.close();
  }
});

test("checkpoints survive reopening the runtime store", async () => {
  const { dbPath, store, checkpoints } = await storeFixture();
  const saved = await checkpoints.executorCheckpoints().save(checkpoint(1));
  store.close();
  const reopened = new RuntimeStore({ dbPath, timeoutMs: 10 });
  reopened.open();
  try {
    const loaded = await new RuntimeCheckpointStore(reopened)
      .executorCheckpoints()
      .load(identity.workspaceId, identity.runId, identity.taskId);
    assert.equal(loaded.checkpointRef, saved.checkpointRef);
  } finally {
    reopened.close();
  }
});

test("the real executor persists its checkpoints and a second run resumes the sequence", async () => {
  const { checkpoints } = await storeFixture();
  const port = checkpoints.executorCheckpoints();
  const input = executorInput();
  const first = executorPorts({ checkpoints: port });
  const result = await executor(first.ports).execute(input);
  assert.equal(result.status, "AWAITING_GATE");
  const afterFirst = await port.load(input.workspaceId, input.runId, input.task.taskId);
  assert.equal(afterFirst.stage, "awaiting-gate");
  assert.equal(afterFirst.checkpointRef, result.checkpointRef);
  const second = executorPorts({ checkpoints: port });
  await executor(second.ports).execute(input);
  const afterSecond = await port.load(input.workspaceId, input.runId, input.task.taskId);
  assert.equal(afterSecond.sequence, afterFirst.sequence + 2);
});

const gateRecord = (stage, fields) => ({
  workspaceId: gateInput().workspaceId,
  runId: gateInput().runId,
  taskId: gateInput().task.taskId,
  gatePlanDigest: gateInput().gatePlan.planDigest,
  changeDigest: gateInput().execution.changeDigest,
  stage,
  ...fields
});
const passedFields = { gateEvidenceDigest: `sha256:${"6".repeat(64)}`, gateEvidenceRefs: ["evidence:gate:1"] };

test("a gates-passed checkpoint resumes the real gate coordinator through reconciliation", async () => {
  const { checkpoints } = await storeFixture();
  const gates = checkpoints.gateCheckpoints();
  await gates.save(gateRecord("gates-passed", passedFields));
  const { ports, state } = gatePorts({
    checkpoints: gates,
    git: {
      reconcile: async (request) => ({
        status: "already-committed",
        commitId: "c".repeat(40),
        parentCommit: request.baseCommit,
        changeDigest: request.expectedChangeDigest,
        gateEvidenceDigest: request.gateEvidenceDigest,
        idempotencyKey: request.idempotencyKey
      })
    }
  });
  const result = await gateCoordinator(ports).execute(gateInput());
  assert.equal(result.status, "COMMITTED");
  assert.equal(result.commitStatus, "already-committed");
  assert.equal(state.gateRuns, 0);
  const inspected = checkpoints.inspectGate(gateInput().workspaceId, gateInput().runId, gateInput().task.taskId);
  assert.equal(inspected.stage, "committed");
});

test("a committed gate checkpoint is reported by inspection and refused by the coordinator", async () => {
  const { checkpoints } = await storeFixture();
  const gates = checkpoints.gateCheckpoints();
  await gates.save(gateRecord("committed", { commitId: "c".repeat(40), idempotencyKey: `sha256:${"7".repeat(64)}` }));
  const { ports } = gatePorts({ checkpoints: gates });
  await assert.rejects(gateCoordinator(ports).execute(gateInput()), { code: "VES_GATE_CHECKPOINT_INVALID" });
});

test("a gate-failed checkpoint leaves no resumable state for the next attempt", async () => {
  const { checkpoints } = await storeFixture();
  const gates = checkpoints.gateCheckpoints();
  await gates.save(
    gateRecord("gate-failed", {
      gateId: "gate:test",
      requirementIds: ["VES-VFY-001"],
      evidenceRef: "evidence:gate:1",
      evidenceDigest: `sha256:${"8".repeat(64)}`
    })
  );
  const { workspaceId, runId, task } = gateInput();
  assert.equal(await gates.load(workspaceId, runId, task.taskId), undefined);
  assert.equal(checkpoints.inspectGate(workspaceId, runId, task.taskId).stage, "gate-failed");
});

test("identical gate saves are idempotent and undeclared gate records are refused", async () => {
  const { checkpoints } = await storeFixture();
  const gates = checkpoints.gateCheckpoints();
  const first = await gates.save(gateRecord("gates-passed", passedFields));
  const replay = await gates.save(gateRecord("gates-passed", passedFields));
  assert.equal(replay.checkpointRef, first.checkpointRef);
  await assert.rejects(gates.save(gateRecord("merged", {})), { code: "VES_RUNTIME_CONSTRAINT" });
  await assert.rejects(gates.save(gateRecord("gates-passed", { ...passedFields, bypass: true })), {
    code: "VES_RUNTIME_CONSTRAINT"
  });
  await assert.rejects(gates.save(gateRecord("gates-passed", { ...passedFields, gateEvidenceRefs: [] })), {
    code: "VES_RUNTIME_CONSTRAINT"
  });
});

test("a tampered gate record fails closed for both load and inspection", async () => {
  const { dbPath, checkpoints } = await storeFixture();
  await checkpoints.gateCheckpoints().save(gateRecord("gates-passed", passedFields));
  const forged = canonicalizeJsonV2(
    gateRecord("gates-passed", { ...passedFields, gateEvidenceRefs: ["evidence:forged"] })
  );
  tamper(dbPath, "UPDATE execution_checkpoints SET record_json=?", forged);
  const { workspaceId, runId, task } = gateInput();
  await assert.rejects(checkpoints.gateCheckpoints().load(workspaceId, runId, task.taskId), {
    code: "VES_RUNTIME_CHECKPOINT_CORRUPT"
  });
  assert.throws(() => checkpoints.inspectGate(workspaceId, runId, task.taskId), {
    code: "VES_RUNTIME_CHECKPOINT_CORRUPT"
  });
});

test("the repair loop persists its state and resumes attempt counts after a restart", async () => {
  const { checkpoints } = await storeFixture();
  const statePort = checkpoints.repairState("workspace:repair", "run:repair", "T405.3");
  let attempts = 0;
  const ports = {
    ...statePort,
    attempt: async () => {
      attempts += 1;
      return attempts === 1
        ? { passed: false, failure: { failedGateId: "gate:test", evidenceRef: "evidence:gate:1" } }
        : { passed: true };
    },
    buildFeedback: async () => assert.fail("feedback is withheld by policy"),
    sealAttempt: async ({ attempt }) => ({ capsuleDigest: `sha256:${String(attempt).repeat(64)}` })
  };
  const outcome = await runGateRepairLoop(
    { onGateFailure: { maxAttempts: 3, feedbackToDriver: false, escalateAfter: 3 } },
    ports
  );
  assert.equal(outcome.status, "CONVERGED");
  const stored = await checkpoints.repairState("workspace:repair", "run:repair", "T405.3").loadState();
  assert.equal(stored.stage, "converged");
  assert.equal(stored.attempts, 2);
  await assert.rejects(statePort.saveState({ ...stored, attempts: 1 }), { code: "VES_RUNTIME_CONSTRAINT" });
});

// invariant: the repair state is also reached without a promise, for a caller
// that meters usage inside a driver's event stream. These two are what the
// port calls, so every check of the port holds for them, and a state recorded
// here is stored when the call returns.
test("the repair state is inspected and recorded without a promise, under the port's checks", async () => {
  const { dbPath, checkpoints } = await storeFixture();
  const repair = ["workspace:repair", "run:repair", "T405.3"];
  assert.equal(checkpoints.inspectRepair(...repair), undefined);
  const ledger = { consumedCostUsd: 0, consumedTokens: 18, consumedDurationMs: 40, usageEvents: 1, stopReason: null };
  const state = { stage: "converged", attempts: 1, attemptCapsuleDigests: [`sha256:${"1".repeat(64)}`] };

  assert.equal(checkpoints.recordRepair(...repair, { ...state, budgetLedger: ledger }), undefined);
  assert.deepEqual(checkpoints.inspectRepair(...repair), { ...state, budgetLedger: ledger });
  assert.equal(Object.isFrozen(checkpoints.inspectRepair(...repair).budgetLedger), true);
  assert.deepEqual(await checkpoints.repairState(...repair).loadState(), checkpoints.inspectRepair(...repair));

  await checkpoints.repairState(...repair).saveState({ ...state, budgetLedger: { ...ledger, consumedTokens: 26 } });
  assert.equal(checkpoints.inspectRepair(...repair).budgetLedger.consumedTokens, 26);

  for (const refused of [
    { ...state, budgetLedger: ledger, extra: true },
    { ...state, stage: "verifying", budgetLedger: ledger },
    { ...state, attempts: 2, budgetLedger: ledger },
    { ...state, budgetLedger: [ledger] },
    { ...state }
  ])
    assert.throws(() => checkpoints.recordRepair(...repair, refused), { code: "VES_RUNTIME_CONSTRAINT" });
  assert.throws(() => checkpoints.recordRepair("workspace repair", "run:repair", "T405.3", state), {
    code: "VES_RUNTIME_CONSTRAINT"
  });
  assert.equal(checkpoints.inspectRepair(...repair).budgetLedger.consumedTokens, 26, "a refused state was stored");

  tamper(
    dbPath,
    "UPDATE execution_checkpoints SET record_json = replace(record_json, '26', '1') WHERE kind = 'repair'"
  );
  assert.throws(() => checkpoints.inspectRepair(...repair), { code: "VES_RUNTIME_CHECKPOINT_CORRUPT" });
});
