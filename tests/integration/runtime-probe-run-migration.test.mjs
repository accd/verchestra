import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { WorkflowMachine } from "../../packages/domain/src/index.ts";
import { DEFAULT_RUNTIME_MIGRATIONS, RuntimeStore } from "../../packages/platform-node/src/index.ts";
import { applyRuntimeMigration } from "../../packages/platform-node/src/runtime-store/runtime-migration-runner.ts";
import { cleanup, event, now, opened } from "../helpers/runtime-store-fixture.mjs";

afterEach(cleanup);

const BEFORE_013 = DEFAULT_RUNTIME_MIGRATIONS.slice(0, 12);
const FEATURE_RUN = "run_018f0b6d-7b1a-7abc-8def-0123456789ab";
const RECOVERY_RUN = "run_018f0b6d-7b1a-7abc-8def-1123456789ab";
const PROBE_RUN = "run_018f0b6d-7b1a-7abc-8def-2123456789ab";
const WORKSPACE = "workspace_018f0b6d-7b1a-7abc-8def-7123456789ab";
const DIGEST = "b".repeat(64);
// The eight tables whose foreign key references runs(run_id).
const REFERENCING_TABLES = [
  "approvals",
  "artifact_refs",
  "authority_approvals",
  "authority_grants",
  "effect_intents",
  "grants",
  "run_capsule_seals",
  "state_events"
];

function run(runId, runKind, state) {
  return {
    runId,
    runKind,
    state,
    version: 0,
    repairCycles: 0,
    approval: undefined,
    terminalCapsuleRequired: false
  };
}

function advance(store, runId, type, eventId) {
  const decision = WorkflowMachine.decide(store.getRun(runId), {
    type,
    expectedVersion: store.getRun(runId).version,
    actorRole: "controller",
    actorId: "controller:local",
    evidence: []
  });
  assert.equal(decision.accepted, true, type);
  store.applyTransition(runId, decision, event(eventId));
}

function authorityRow(id, action) {
  return {
    workspaceId: WORKSPACE,
    runId: FEATURE_RUN,
    action,
    recordJson: JSON.stringify({ id, action }),
    issuedAt: now,
    expiresAt: "2026-07-13T13:00:00.000Z"
  };
}

// why: the store an older build leaves behind. The runtime store writes runs,
// state events and authority records; the legacy approval, grant and artifact
// tables of 001, the effect intents and the capsule seals have no writer in
// this path, so they get one row each with foreign keys on, which every one of
// the eight tables that references runs then holds across the rebuild.
async function storeAt012() {
  const { dbPath, store } = await opened({ migrations: BEFORE_013 });
  store.createRun(run(FEATURE_RUN, "feature", "CREATED"));
  advance(store, FEATURE_RUN, "READY_WITHOUT_INTAKE", "event_018f0b6d-7b1a-7abc-8def-0000000000a1");
  advance(store, FEATURE_RUN, "START_SPECIFICATION", "event_018f0b6d-7b1a-7abc-8def-0000000000a2");
  store.saveAuthorityApproval({
    approvalId: "approval_018f0b6d-7b1a-7abc-8def-4123456789ab",
    ...authorityRow("approval", "execution")
  });
  store.saveAuthorityGrant({
    grantId: "grant_018f0b6d-7b1a-7abc-8def-6123456789ab",
    ...authorityRow("grant", "workspace.write")
  });
  store.createRun({ ...run(RECOVERY_RUN, "recovery", "RECOVERED"), version: 1, terminalCapsuleRequired: true });
  store.close();
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA foreign_keys=ON");
    db.prepare("INSERT INTO approvals VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "legacy-approval",
      FEATURE_RUN,
      "execution",
      DIGEST,
      now,
      now,
      null
    );
    db.prepare("INSERT INTO grants VALUES (?, ?, ?, ?, ?, ?)").run(
      "legacy-grant",
      FEATURE_RUN,
      "execute",
      DIGEST,
      now,
      now
    );
    db.prepare("INSERT INTO artifact_refs VALUES (?, ?, ?, ?, ?, ?)").run(
      "artifact-ref",
      FEATURE_RUN,
      "spec",
      DIGEST,
      "specs/feature.md",
      now
    );
    db.prepare(
      `INSERT INTO effect_intents(effect_id, idempotency_key, operation_kind, workspace_id, run_id, logical_target,
        canonical_input_digest, semantic_identity, risk_tier, grant_ref, status, attempt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "effect",
      "effect-key",
      "jira.issue",
      WORKSPACE,
      FEATURE_RUN,
      "jira:ORD-1",
      DIGEST,
      "issue",
      "low",
      "g",
      "planned",
      0,
      now
    );
    db.prepare("INSERT INTO run_capsule_seals VALUES (?, ?, ?, ?, ?, ?)").run(
      RECOVERY_RUN,
      1,
      "RECOVERED",
      "c".repeat(64),
      "d".repeat(64),
      now
    );
  } finally {
    db.close();
  }
  return dbPath;
}

// invariant: every row of every table, with its rowid, in rowid order, so a
// copy that reorders, renumbers or alters a row is told apart from the original.
function tableRows(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const names = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => row.name);
    return Object.fromEntries(
      names.map((name) => [
        name,
        db
          .prepare(`SELECT rowid AS row_id, * FROM "${name}" ORDER BY rowid`)
          .all()
          .map((row) => ({ ...row }))
      ])
    );
  } finally {
    db.close();
  }
}

function inspect(dbPath, sql) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db
      .prepare(sql)
      .all()
      .map((row) => ({ ...row }));
  } finally {
    db.close();
  }
}

function runsDefinition(dbPath) {
  return inspect(dbPath, "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'runs'")[0].sql;
}

test("migration 013 keeps every row and admits the probe kind", async () => {
  const dbPath = await storeAt012();
  const before = tableRows(dbPath);
  for (const table of [...REFERENCING_TABLES, "runs"]) assert.ok(before[table].length > 0, `${table} holds a row`);
  const definitionBefore = runsDefinition(dbPath);
  const columnsBefore = inspect(dbPath, "SELECT * FROM pragma_table_info('runs')");

  const store = new RuntimeStore({ dbPath, timeoutMs: 10, now: () => now });
  try {
    assert.equal(store.open().appliedMigrations, 1);
  } finally {
    store.close();
  }

  const after = tableRows(dbPath);
  const ledgerAfter = after.ves_migrations.map((row) => row.id);
  assert.deepEqual(
    ledgerAfter,
    DEFAULT_RUNTIME_MIGRATIONS.map((migration) => migration.id)
  );
  assert.deepEqual({ ...after, ves_migrations: after.ves_migrations.slice(0, 12) }, before);
  assert.deepEqual(inspect(dbPath, "PRAGMA foreign_key_check"), []);
  // The rebuilt table is 001's definition with the run kind's CHECK widened,
  // and nothing else: every column, constraint and STRICT typing is kept.
  assert.equal(
    runsDefinition(dbPath),
    definitionBefore
      .replace("CREATE TABLE runs (", 'CREATE TABLE "runs" (')
      .replace("CHECK (run_kind IN ('feature', 'recovery'))", "CHECK (run_kind IN ('feature', 'recovery', 'probe'))")
  );
  assert.notEqual(runsDefinition(dbPath), definitionBefore);
  assert.deepEqual(inspect(dbPath, "SELECT * FROM pragma_table_info('runs')"), columnsBefore);
  assert.deepEqual(inspect(dbPath, "SELECT strict FROM pragma_table_list WHERE name = 'runs'"), [{ strict: 1 }]);

  const reopened = new RuntimeStore({ dbPath, timeoutMs: 10, now: () => now });
  try {
    assert.equal(reopened.open().appliedMigrations, 0);
    reopened.createRun(run(PROBE_RUN, "probe", "AWAITING_EXECUTION_APPROVAL"));
    assert.equal(reopened.getRun(PROBE_RUN).runKind, "probe");
    const refusal = (() => {
      try {
        reopened.createRun(run("run_018f0b6d-7b1a-7abc-8def-3123456789ab", "other", "CREATED"));
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    assert.equal(refusal?.code, "VES_RUNTIME_CONSTRAINT");
    assert.match(refusal.cause.message, /CHECK constraint failed: run_kind IN/u);
    assert.throws(() => reopened.getRun("run_018f0b6d-7b1a-7abc-8def-3123456789ab"), { code: "VES_RUNTIME_NOT_FOUND" });
  } finally {
    reopened.close();
  }
});

test("migration 013 is the last migration and older binaries refuse it", async () => {
  assert.equal(DEFAULT_RUNTIME_MIGRATIONS.length, 13);
  assert.equal(DEFAULT_RUNTIME_MIGRATIONS.at(-1).id, "013_probe_runs");
  const { dbPath, store } = await opened();
  assert.equal(store.migrationLedger().at(-1).id, "013_probe_runs");
  store.close();

  const older = new RuntimeStore({ dbPath, migrations: DEFAULT_RUNTIME_MIGRATIONS.slice(0, 12), now: () => now });
  assert.throws(() => older.open(), { code: "VES_RUNTIME_MIGRATION_INCOMPATIBLE" });
  const current = new RuntimeStore({ dbPath, now: () => now });
  try {
    assert.equal(current.open().appliedMigrations, 0);
    assert.deepEqual(
      current.migrationLedger().map((entry) => entry.id),
      DEFAULT_RUNTIME_MIGRATIONS.map((migration) => migration.id)
    );
  } finally {
    current.close();
  }
});

// A rebuild that drops every run, so each of the eight referencing tables is
// left holding rows whose run no longer exists.
const DANGLING_REBUILD = Object.freeze({
  id: "014_rebuild_dropping_runs",
  tableRebuild: true,
  up: `CREATE TABLE runs_next (run_id TEXT PRIMARY KEY) STRICT;
DROP TABLE runs;
ALTER TABLE runs_next RENAME TO runs;`
});

// A rebuild that keeps every run and records the foreign-key setting it ran
// under.
const OBSERVED_REBUILD = Object.freeze({
  id: "014_observed_rebuild",
  tableRebuild: true,
  up: `CREATE TABLE rebuild_observation AS SELECT foreign_keys AS foreign_keys FROM pragma_foreign_keys;
CREATE TABLE runs_next (run_id TEXT PRIMARY KEY) STRICT;
INSERT INTO runs_next (rowid, run_id) SELECT rowid, run_id FROM runs;
DROP TABLE runs;
ALTER TABLE runs_next RENAME TO runs;`
});

test("a rebuild migration runs with foreign keys off and commits only without violations", async () => {
  // Refused: the runner rolls the rebuild back and the store is as it was.
  const refusedPath = await storeAt012();
  const upgraded = new RuntimeStore({ dbPath: refusedPath, timeoutMs: 10, now: () => now });
  assert.equal(upgraded.open().appliedMigrations, 1);
  upgraded.close();
  const before = tableRows(refusedPath);
  const failing = new RuntimeStore({
    dbPath: refusedPath,
    timeoutMs: 10,
    migrations: [...DEFAULT_RUNTIME_MIGRATIONS, DANGLING_REBUILD],
    now: () => now
  });
  assert.throws(() => failing.open(), { code: "VES_RUNTIME_MIGRATION_FOREIGN_KEY" });
  assert.deepEqual(tableRows(refusedPath), before);

  // The same refusal on a connection the test holds, which reads foreign keys
  // back on once the runner has returned.
  const connection = new DatabaseSync(refusedPath);
  try {
    connection.exec("PRAGMA foreign_keys=ON");
    assert.throws(() => applyRuntimeMigration(connection, DANGLING_REBUILD, now), {
      code: "VES_RUNTIME_MIGRATION_FOREIGN_KEY"
    });
    assert.equal(connection.isTransaction, false);
    assert.deepEqual({ ...connection.prepare("PRAGMA foreign_keys").get() }, { foreign_keys: 1 });
  } finally {
    connection.close();
  }
  assert.deepEqual(tableRows(refusedPath), before);

  // Committed: the rebuild saw foreign keys off, and they are on again after.
  const committedPath = await storeAt012();
  const store = new RuntimeStore({
    dbPath: committedPath,
    timeoutMs: 10,
    migrations: [...DEFAULT_RUNTIME_MIGRATIONS, OBSERVED_REBUILD],
    now: () => now
  });
  try {
    assert.equal(store.open().appliedMigrations, 2);
    assert.deepEqual(inspect(committedPath, "SELECT foreign_keys FROM rebuild_observation"), [{ foreign_keys: 0 }]);
    assert.equal(store.migrationLedger().at(-1).id, "014_observed_rebuild");
    assert.equal(store.safetySettings().foreignKeys, 1);
    assert.throws(
      () =>
        store.saveAuthorityApproval({
          approvalId: "approval_018f0b6d-7b1a-7abc-8def-5123456789ab",
          ...authorityRow("dangling", "execution"),
          runId: "run_018f0b6d-7b1a-7abc-8def-9123456789ab"
        }),
      (error) => error.code === "VES_RUNTIME_CONSTRAINT" && /FOREIGN KEY constraint failed/u.test(error.cause.message)
    );
  } finally {
    store.close();
  }
});
