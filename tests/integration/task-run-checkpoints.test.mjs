// invariant: the Run record module is the one reader of a Run's checkpoint
// rows (ADP-2). The runtime store keeps them as records of unknown shape; the
// task commands read typed projections instead of casting a row. These cases
// write rows through the store's own ports, as the coordinators do, into a
// real runtime store, and read them back through the projections.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { budgetStatus, capsuleBudgetConsumption } from "../../apps/vestra-cli/src/task/task-budget.ts";
import { openRunRecord } from "../../apps/vestra-cli/src/task/task-run-record.ts";
import { RuntimeCheckpointStore } from "../../packages/platform-node/src/index.ts";
import { cleanup, opened } from "../helpers/runtime-store-fixture.mjs";
import { OTHER_RUN_ID, RUN_ID, TASK_ID, WORKSPACE_ID, filled } from "../helpers/task-run-record-fixture.mjs";

afterEach(cleanup);

const IDENTITY = Object.freeze({ workspaceId: WORKSPACE_ID, runId: RUN_ID, taskId: TASK_ID });
// why: a requirement ID spelled out here would enter the requirements register
// scan as evidence for a requirement these suites do not test.
const REQUIREMENT_ID = ["VES", "EXE", "001"].join("-");
const BILLED = Object.freeze({
  consumedCostUsd: 0.25,
  consumedTokens: 1200,
  consumedDurationMs: 3400,
  usageEvents: 3,
  stopReason: null
});

async function run(runId = RUN_ID) {
  const { root, dbPath, store } = await opened();
  const runRecord = openRunRecord({ workspaceId: WORKSPACE_ID, tasksRoot: join(root, "tasks") }, runId);
  return { tasksRoot: join(root, "tasks"), dbPath, store, checkpoints: runRecord.checkpoints(store, TASK_ID) };
}

const executorRow = (sequence, stage, data) => ({ ...IDENTITY, stage, sequence, data });
const gateRow = (stage, fields, changeDigest = filled("9")) => ({
  ...IDENTITY,
  gatePlanDigest: filled("4"),
  changeDigest,
  stage,
  ...fields
});
const repairState = (budgetLedger, stage = "repair") => ({
  stage,
  attempts: 1,
  attemptCapsuleDigests: [filled("7")],
  budgetLedger
});

function malformed(error) {
  assert.equal(error.envelope.code, "VES_TASK_STATE_INVALID");
  assert.equal(error.envelope.safeDetails.reason, "VES_TASK_STATE_MALFORMED");
  return true;
}

test("a run with no checkpoint has no projection", async () => {
  const { checkpoints } = await run();
  assert.equal(await checkpoints.executor(), undefined);
  assert.equal(checkpoints.gate(), undefined);
  assert.equal(await checkpoints.repair(), undefined);
});

test("the executor projection is the latest checkpoint: stage, ref, change digest, and receipt refs", async () => {
  const { checkpoints } = await run();
  await checkpoints.executorPort().save(executorRow(1, "driver-progress", { turn: 1 }));
  assert.deepEqual(await checkpoints.executor(), {
    stage: "driver-progress",
    checkpointRef: (await checkpoints.executorPort().load(...Object.values(IDENTITY))).checkpointRef,
    changeDigest: undefined,
    toolReceiptRefs: []
  });

  const saved = await checkpoints.executorPort().save(
    executorRow(2, "awaiting-gate", {
      changeDigest: filled("9"),
      changedPaths: ["src/value.txt"],
      toolReceiptRefs: ["receipt:1", "receipt:2"]
    })
  );
  assert.match(saved.checkpointRef, /^checkpoint:executor:[a-f0-9]{64}$/u);
  assert.deepEqual(await checkpoints.executor(), {
    stage: "awaiting-gate",
    checkpointRef: saved.checkpointRef,
    changeDigest: filled("9"),
    toolReceiptRefs: ["receipt:1", "receipt:2"]
  });
});

test("executor data of any other shape yields no change digest and only text receipt refs", async () => {
  const { checkpoints } = await run();
  const shapes = [
    [null, []],
    ["text", []],
    [[{ changeDigest: filled("9") }], []],
    [{ changeDigest: 7, toolReceiptRefs: "receipt:1" }, []],
    [
      { changeDigest: null, toolReceiptRefs: ["receipt:1", 7, null, ["receipt:2"], "receipt:3"] },
      ["receipt:1", "receipt:3"]
    ]
  ];
  let sequence = 0;
  for (const [data, toolReceiptRefs] of shapes) {
    await checkpoints.executorPort().save(executorRow((sequence += 1), "awaiting-gate", data));
    const projection = await checkpoints.executor();
    assert.equal(projection.changeDigest, undefined, JSON.stringify(data));
    assert.deepEqual(projection.toolReceiptRefs, toolReceiptRefs, JSON.stringify(data));
    assert.equal(projection.stage, "awaiting-gate");
  }
});

test("the gate projection reports every stage, and a commit ID only once the gate committed", async () => {
  const { checkpoints } = await run();
  await checkpoints.gatePort().save(
    gateRow("gate-failed", {
      gateId: "gate:unit",
      requirementIds: [REQUIREMENT_ID],
      evidenceRef: `gate-evidence:${"e".repeat(32)}`,
      evidenceDigest: filled("5")
    })
  );
  assert.deepEqual(checkpoints.gate(), { stage: "gate-failed", changeDigest: filled("9"), commitId: undefined });
  assert.equal(
    await checkpoints.gatePort().load(...Object.values(IDENTITY)),
    undefined,
    "the port hides a failed gate"
  );

  await checkpoints
    .gatePort()
    .save(
      gateRow(
        "gates-passed",
        { gateEvidenceDigest: filled("5"), gateEvidenceRefs: [`gate-evidence:${"e".repeat(32)}`] },
        filled("8")
      )
    );
  assert.deepEqual(checkpoints.gate(), { stage: "gates-passed", changeDigest: filled("8"), commitId: undefined });

  for (const commitId of ["c".repeat(40), "c".repeat(64)]) {
    await checkpoints.gatePort().save(gateRow("committed", { commitId, idempotencyKey: filled("3") }, filled("8")));
    assert.deepEqual(checkpoints.gate(), { stage: "committed", changeDigest: filled("8"), commitId });
  }
});

test("the repair projection carries its stage and the ledger exactly as it was stored", async () => {
  const { checkpoints } = await run();
  await checkpoints.repairPort().saveState(repairState(null));
  assert.deepEqual(await checkpoints.repair(), { stage: "repair", budgetLedger: undefined });

  const subscription = {
    ...BILLED,
    consumedCostUsd: 0,
    consumedTokens: 18,
    unbilledTokens: 18,
    stopReason: "token-threshold"
  };
  for (const [ledger, stage] of [
    [BILLED, "converged"],
    [subscription, "budget-exceeded"]
  ]) {
    await checkpoints.repairPort().saveState(repairState(ledger, stage));
    assert.deepEqual(await checkpoints.repair(), { stage, budgetLedger: ledger });
    assert.deepEqual(
      await checkpoints.repairPort().loadState(),
      repairState(ledger, stage),
      "the port is the store's own"
    );
  }
});

// invariant: these are the reports the commands printed and sealed before the
// ledger was read through the typed projection, recorded from the sources at
// revision 0158e48 for the same four ledgers.
test("status and the Run Capsule report a stored ledger as they did before", async () => {
  const { checkpoints } = await run();
  const stored = async (ledger) => {
    await checkpoints.repairPort().saveState(repairState(ledger));
    return (await checkpoints.repair()).budgetLedger;
  };
  const counts = { tokens: 1200, durationMs: 3400, usageEvents: 3 };

  const billed = await stored(BILLED);
  assert.deepEqual(budgetStatus(billed), BILLED);
  assert.deepEqual(capsuleBudgetConsumption(billed), { consumed: { costUsd: 0.25, ...counts } });

  const billedOnly = await stored({ ...BILLED, unbilledTokens: 0 });
  assert.deepEqual(budgetStatus(billedOnly), { ...BILLED, unbilledTokens: 0 });
  assert.deepEqual(capsuleBudgetConsumption(billedOnly), { consumed: { costUsd: 0.25, ...counts } });

  const mixed = await stored({ ...BILLED, unbilledTokens: 18 });
  assert.deepEqual(budgetStatus(mixed), { ...BILLED, unbilledTokens: 18, billing: "mixed" });
  assert.deepEqual(capsuleBudgetConsumption(mixed), {
    consumed: { costUsd: 0.25, ...counts, unbilledTokens: 18 },
    billing: "mixed"
  });

  const subscription = await stored({
    ...BILLED,
    consumedCostUsd: 0,
    consumedTokens: 18,
    unbilledTokens: 18,
    stopReason: "token-threshold"
  });
  assert.deepEqual(budgetStatus(subscription), {
    consumedCostUsd: "not billed (subscription)",
    consumedTokens: 18,
    consumedDurationMs: 3400,
    usageEvents: 3,
    stopReason: "token-threshold",
    unbilledTokens: 18,
    billing: "subscription"
  });
  assert.deepEqual(capsuleBudgetConsumption(subscription), {
    consumed: { tokens: 18, durationMs: 3400, usageEvents: 3, unbilledTokens: 18 },
    billing: "subscription"
  });
  assert.equal(budgetStatus(undefined), null);
});

test("a stored ledger that is not a ledger is refused, never reported or resumed", async () => {
  const cases = [
    {},
    { ...BILLED, consumedTokens: "many" },
    { ...BILLED, consumedTokens: 1.5 },
    { ...BILLED, consumedCostUsd: -1 },
    { ...BILLED, consumedDurationMs: null },
    { ...BILLED, usageEvents: undefined },
    { ...BILLED, stopReason: "because" },
    { ...BILLED, stopReason: undefined },
    { ...BILLED, unbilledTokens: "18" },
    { ...BILLED, unbilledTokens: -1 },
    { ...BILLED, unbilledTokens: BILLED.consumedTokens + 1 }
  ];
  for (const ledger of cases) {
    const { checkpoints } = await run();
    await checkpoints.repairPort().saveState(repairState(JSON.parse(JSON.stringify(ledger))));
    await assert.rejects(checkpoints.repair(), malformed, JSON.stringify(ledger));
  }
});

test("a projection reads only its own run and task", async () => {
  const first = await run();
  await first.checkpoints.executorPort().save(executorRow(1, "awaiting-gate", { changeDigest: filled("9") }));
  await first.checkpoints.repairPort().saveState(repairState(BILLED));
  const workspace = { workspaceId: WORKSPACE_ID, tasksRoot: first.tasksRoot };
  for (const checkpoints of [
    openRunRecord(workspace, OTHER_RUN_ID).checkpoints(first.store, TASK_ID),
    openRunRecord(workspace, RUN_ID).checkpoints(first.store, "T2")
  ]) {
    assert.equal(await checkpoints.executor(), undefined);
    assert.equal(checkpoints.gate(), undefined);
    assert.equal(await checkpoints.repair(), undefined);
  }
});

test("a row the store finds corrupt stays the store's refusal", async () => {
  const { dbPath, checkpoints } = await run();
  await checkpoints.executorPort().save(executorRow(1, "awaiting-gate", { changeDigest: filled("9") }));
  await checkpoints.repairPort().saveState(repairState(BILLED));
  const database = new DatabaseSync(dbPath);
  try {
    database.prepare("UPDATE execution_checkpoints SET record_json = replace(record_json, '1200', '1')").run();
    database.prepare("UPDATE execution_checkpoints SET record_json = replace(record_json, '9999', '0000')").run();
  } finally {
    database.close();
  }
  await assert.rejects(checkpoints.executor(), { code: "VES_RUNTIME_CHECKPOINT_CORRUPT" });
  await assert.rejects(checkpoints.repair(), { code: "VES_RUNTIME_CHECKPOINT_CORRUPT" });
});

test("the projections add nothing to what the store's ports hold", async () => {
  const { store, checkpoints } = await run();
  const row = executorRow(1, "awaiting-gate", { changeDigest: filled("9"), toolReceiptRefs: ["receipt:1"] });
  const { checkpointRef } = await checkpoints.executorPort().save(row);
  const direct = await new RuntimeCheckpointStore(store).executorCheckpoints().load(...Object.values(IDENTITY));
  assert.deepEqual(direct, { ...row, checkpointRef });
});

// invariant: a Run has one account of usage, the ledger its latest repair
// state carries. Usage is recorded there as it is metered, through
// `recordBudgetLedger`: only the ledger moves, it is stored when the call
// returns, and it never moves backwards.
const SPENT_MORE = Object.freeze({
  consumedCostUsd: 0.5,
  consumedTokens: 1208,
  consumedDurationMs: 3900,
  usageEvents: 4,
  stopReason: null
});

function mismatch(error) {
  assert.equal(error.envelope.code, "VES_TASK_STATE_INVALID");
  assert.equal(error.envelope.safeDetails.reason, "VES_TASK_STATE_MISMATCH");
  return true;
}

test("usage recorded outside the loop's own saves moves only the ledger of the latest repair state", async () => {
  for (const stage of ["converged", "repair"]) {
    const { checkpoints } = await run();
    await checkpoints.repairPort().saveState(repairState(BILLED, stage));
    assert.equal(checkpoints.recordBudgetLedger(SPENT_MORE), undefined, "the record is stored when the call returns");
    assert.deepEqual(await checkpoints.repair(), { stage, budgetLedger: SPENT_MORE });
    assert.deepEqual(await checkpoints.repairPort().loadState(), repairState(SPENT_MORE, stage));
  }
});

// invariant: a run whose repair loop has saved no state is filed under what its
// gate checkpoint proves: `repair` while an attempt is in flight, `converged`
// once the task is committed. No attempt is recorded in either case.
test("a run whose repair loop saved no state is filed under repair until its task is committed", async () => {
  const unrecorded = (stage) => ({ stage, attempts: 0, attemptCapsuleDigests: [], budgetLedger: BILLED });
  const gates = [
    undefined,
    gateRow("gate-failed", {
      gateId: "gate:unit",
      requirementIds: [REQUIREMENT_ID],
      evidenceRef: `gate-evidence:${"e".repeat(32)}`,
      evidenceDigest: filled("5")
    }),
    gateRow("gates-passed", { gateEvidenceDigest: filled("5"), gateEvidenceRefs: [`gate-evidence:${"e".repeat(32)}`] })
  ];
  for (const gate of gates) {
    const { checkpoints } = await run();
    if (gate !== undefined) await checkpoints.gatePort().save(gate);
    checkpoints.recordBudgetLedger(BILLED);
    assert.deepEqual(await checkpoints.repairPort().loadState(), unrecorded("repair"), gate?.stage ?? "no gate");
    assert.deepEqual(await checkpoints.repair(), { stage: "repair", budgetLedger: BILLED });
  }

  const { checkpoints } = await run();
  await checkpoints.gatePort().save(gateRow("committed", { commitId: "c".repeat(40), idempotencyKey: filled("3") }));
  checkpoints.recordBudgetLedger(BILLED);
  assert.deepEqual(await checkpoints.repairPort().loadState(), unrecorded("converged"));
  assert.deepEqual(await checkpoints.repair(), { stage: "converged", budgetLedger: BILLED });
});

test("a state that carried no ledger takes the first one recorded", async () => {
  const { checkpoints } = await run();
  await checkpoints.repairPort().saveState(repairState(null, "converged"));
  checkpoints.recordBudgetLedger(BILLED);
  assert.deepEqual(await checkpoints.repairPort().loadState(), repairState(BILLED, "converged"));
});

test("the recorded ledger keeps its unbilled tokens, and status and the Run Capsule report the whole of it", async () => {
  const { checkpoints } = await run();
  const implementer = { ...BILLED, consumedCostUsd: 0, consumedTokens: 18, unbilledTokens: 18, usageEvents: 1 };
  await checkpoints.repairPort().saveState(repairState(implementer, "converged"));

  const subscription = { ...implementer, consumedTokens: 26, unbilledTokens: 26, usageEvents: 2 };
  checkpoints.recordBudgetLedger(subscription);
  const stored = (await checkpoints.repair()).budgetLedger;
  assert.deepEqual(budgetStatus(stored), {
    ...subscription,
    consumedCostUsd: "not billed (subscription)",
    billing: "subscription"
  });
  assert.deepEqual(capsuleBudgetConsumption(stored), {
    consumed: { tokens: 26, durationMs: 3400, usageEvents: 2, unbilledTokens: 26 },
    billing: "subscription"
  });

  // why: a billed verifier after an unbilled implementer is the mixed block:
  // the cost of the billed part beside the tokens that were not billed.
  const mixed = { ...subscription, consumedCostUsd: 0.00005075, consumedTokens: 34, usageEvents: 3 };
  checkpoints.recordBudgetLedger(mixed);
  const billedPart = (await checkpoints.repair()).budgetLedger;
  assert.deepEqual(budgetStatus(billedPart), { ...mixed, billing: "mixed" });
  assert.deepEqual(capsuleBudgetConsumption(billedPart), {
    consumed: { costUsd: 0.00005075, tokens: 34, durationMs: 3400, usageEvents: 3, unbilledTokens: 26 },
    billing: "mixed"
  });
});

test("a ledger that does not continue the recorded one is refused and the recorded one stays", async () => {
  const { checkpoints } = await run();
  const recorded = { ...SPENT_MORE, unbilledTokens: 8 };
  await checkpoints.repairPort().saveState(repairState(recorded, "converged"));
  for (const backwards of [
    { ...recorded, consumedTokens: recorded.consumedTokens - 1 },
    { ...recorded, usageEvents: recorded.usageEvents - 1 },
    { ...recorded, consumedCostUsd: recorded.consumedCostUsd - 0.01 },
    { ...recorded, unbilledTokens: recorded.unbilledTokens - 1 },
    { ...SPENT_MORE },
    // why: a meter that was not resumed from the run's ledger starts at zero.
    { consumedCostUsd: 0, consumedTokens: 8, consumedDurationMs: 9000, usageEvents: 1, stopReason: null }
  ]) {
    assert.throws(() => checkpoints.recordBudgetLedger(backwards), mismatch, JSON.stringify(backwards));
    assert.deepEqual((await checkpoints.repair()).budgetLedger, recorded);
  }
  for (const ledger of [null, undefined])
    assert.throws(() => checkpoints.recordBudgetLedger(ledger), mismatch, String(ledger));
  for (const ledger of [{}, { ...recorded, consumedTokens: "many" }, { ...recorded, stopReason: "because" }])
    assert.throws(() => checkpoints.recordBudgetLedger(ledger), malformed, JSON.stringify(ledger));
  assert.deepEqual(await checkpoints.repairPort().loadState(), repairState(recorded, "converged"));

  // why: the duration is a clock's, so an earlier one is still recorded, and
  // the same ledger again is the same record.
  const earlier = { ...recorded, consumedDurationMs: 1 };
  checkpoints.recordBudgetLedger(earlier);
  checkpoints.recordBudgetLedger(earlier);
  assert.deepEqual((await checkpoints.repair()).budgetLedger, earlier);
});

test("a recorded ledger is read only by its own run and task", async () => {
  const first = await run();
  first.checkpoints.recordBudgetLedger(BILLED);
  const workspace = { workspaceId: WORKSPACE_ID, tasksRoot: first.tasksRoot };
  for (const checkpoints of [
    openRunRecord(workspace, OTHER_RUN_ID).checkpoints(first.store, TASK_ID),
    openRunRecord(workspace, RUN_ID).checkpoints(first.store, "T2")
  ])
    assert.equal(await checkpoints.repair(), undefined);
});

test("a repair state the store finds corrupt stops the record with the store's refusal", async () => {
  const { dbPath, checkpoints } = await run();
  await checkpoints.repairPort().saveState(repairState(BILLED, "converged"));
  const database = new DatabaseSync(dbPath);
  try {
    database.prepare("UPDATE execution_checkpoints SET record_json = replace(record_json, '1200', '1')").run();
  } finally {
    database.close();
  }
  assert.throws(() => checkpoints.recordBudgetLedger(SPENT_MORE), { code: "VES_RUNTIME_CHECKPOINT_CORRUPT" });
});
