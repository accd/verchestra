import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  DEFAULT_RUNTIME_MIGRATIONS,
  RuntimeStore,
  inspectRuntimeDatabase
} from "../../packages/platform-node/src/index.ts";
import { cleanup, event, now, opened, run, runId, transition } from "../helpers/runtime-store-fixture.mjs";

afterEach(cleanup);

test("migration checksum drift fails closed", async () => {
  const { dbPath, store } = await opened();
  store.close();
  const migrations = [{ ...DEFAULT_RUNTIME_MIGRATIONS[0], up: `${DEFAULT_RUNTIME_MIGRATIONS[0].up}\nSELECT 1;` }];
  const drifted = new RuntimeStore({ dbPath, migrations, now: () => now });
  assert.throws(() => drifted.open(), { code: "VES_RUNTIME_MIGRATION_DRIFT" });
});

test("failed raw migration rolls back its schema and ledger row", async () => {
  const { root } = await opened().then(({ root, store }) => {
    store.close();
    return { root };
  });
  const dbPath = join(root, "failed.sqlite");
  const migrations = [
    { id: "001_ok", up: "CREATE TABLE stable(id TEXT PRIMARY KEY) STRICT;" },
    { id: "002_fail", up: "CREATE TABLE partial(id TEXT); THIS IS NOT SQL;" }
  ];
  const failed = new RuntimeStore({ dbPath, migrations, now: () => now });
  assert.throws(() => failed.open());
  const db = new DatabaseSync(dbPath, { defensive: true });
  assert.equal(db.prepare("SELECT count(*) AS count FROM ves_migrations").get().count, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='partial'").get().count, 0);
  db.close();
});

test("injected failure after event insert rolls back event and projection", async () => {
  const { store } = await opened({
    hooks: {
      afterEventInsert: () => {
        throw new Error("crash");
      }
    }
  });
  store.createRun(run());
  assert.throws(() => store.applyTransition(runId, transition(), event()));
  assert.equal(store.getRun(runId).state, "CREATED");
  assert.equal(store.listEvents(runId).length, 0);
  store.close();
});

test("duplicate event ID rolls back the competing projection update", async () => {
  const { store } = await opened();
  store.createRun(run());
  const shared = event();
  store.applyTransition(runId, transition(), shared);
  const second = transition("READY", "SPECIFYING", 2);
  assert.throws(() => store.applyTransition(runId, second, shared), { code: "VES_RUNTIME_CONSTRAINT" });
  assert.equal(store.getRun(runId).state, "READY");
  assert.equal(store.getRun(runId).version, 1);
  store.close();
});

test("two database connections racing the same version produce one winner", async () => {
  const { dbPath, store } = await opened();
  store.createRun(run());
  const contender = new RuntimeStore({ dbPath, timeoutMs: 10, now: () => now });
  contender.open();
  store.applyTransition(runId, transition(), event());
  assert.throws(
    () =>
      contender.applyTransition(
        runId,
        transition("CREATED", "INTAKE_REQUIRED", 1),
        event("event_018f0b6d-7b1a-7abc-8def-3123456789ab")
      ),
    { code: "VES_RUNTIME_VERSION_CONFLICT" }
  );
  assert.equal(contender.listEvents(runId).length, 1);
  contender.close();
  store.close();
});

test("exclusive writer lock maps to recoverable busy error", async () => {
  const { dbPath, store } = await opened();
  const locker = new DatabaseSync(dbPath, { timeout: 10, defensive: true });
  locker.exec("BEGIN EXCLUSIVE");
  assert.throws(() => store.createRun(run()), { code: "VES_RUNTIME_BUSY", recoverable: true });
  locker.exec("ROLLBACK");
  locker.close();
  store.close();
});

test("corrupt runtime bytes map to recoverable integrity error", async () => {
  const { root, store } = await opened();
  store.close();
  const path = join(root, "corrupt.sqlite");
  await writeFile(path, "not sqlite");
  assert.throws(() => inspectRuntimeDatabase(path), { code: "VES_RUNTIME_CORRUPT", recoverable: true });
});

test("backup validation failure publishes no backup", async () => {
  const { root, store } = await opened({
    hooks: {
      validateBackup: () => {
        throw new Error("invalid staging");
      }
    }
  });
  store.createRun(run());
  const before = store.stateDigest();
  await assert.rejects(() => store.backupTo(join(root, "backup.sqlite")), { code: "VES_RUNTIME_BACKUP_INVALID" });
  assert.equal(store.stateDigest(), before);
  store.close();
});

test("backup publication failure preserves active runtime state", async () => {
  const { root, store } = await opened({
    hooks: {
      publishBackup: async () => {
        throw new Error("rename denied");
      }
    }
  });
  store.createRun(run());
  const before = store.stateDigest();
  await assert.rejects(() => store.backupTo(join(root, "backup.sqlite")), {
    code: "VES_RUNTIME_BACKUP_PUBLISH_FAILED"
  });
  assert.equal(store.stateDigest(), before);
  assert.equal(store.getRun(runId).state, "CREATED");
  store.close();
});

test("invalid transition snapshot rolls back before journal write", async () => {
  const { store } = await opened();
  store.createRun(run());
  const invalid = transition();
  invalid.snapshot.version = 99;
  assert.throws(() => store.applyTransition(runId, invalid, event()), { code: "VES_RUNTIME_TRANSITION_INVALID" });
  assert.equal(store.listEvents(runId).length, 0);
  store.close();
});

test("SQLite state constraint rejects an unknown workflow state", async () => {
  const { store } = await opened();
  assert.throws(() => store.createRun({ ...run(), state: "BROKEN" }), {
    code: "VES_RUNTIME_CONSTRAINT"
  });
  store.close();
});

test("backup manifest remains bound to staging during a concurrent active write", async () => {
  let activeStore;
  const { root, store } = await opened({
    hooks: {
      validateBackup: (path) => {
        inspectRuntimeDatabase(path);
        activeStore.createRun({
          ...run(),
          runId: "run_018f0b6d-7b1a-7abc-8def-1123456789ab"
        });
      }
    }
  });
  activeStore = store;
  store.createRun(run());
  const result = await store.backupTo(join(root, "concurrent.sqlite"));
  const copied = new RuntimeStore({ dbPath: result.path, now: () => now });
  copied.open();
  assert.equal(result.manifest.stateDigest, copied.stateDigest());
  assert.notEqual(result.manifest.stateDigest, store.stateDigest());
  copied.close();
  store.close();
});

test("claim release by wrong owner leaves claim active", async () => {
  const { store } = await opened();
  const claim = {
    claimId: "claim_018f0b6d-7b1a-7abc-8def-9123456789ab",
    workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-7123456789ab",
    scopeDigest: "a".repeat(64),
    ownerId: "machine:a",
    now,
    expiresAt: "2026-07-13T13:00:00.000Z"
  };
  store.acquireClaim(claim);
  assert.throws(() => store.releaseClaim(claim.claimId, "machine:b"), {
    code: "VES_RUNTIME_CLAIM_OWNER_MISMATCH"
  });
  assert.throws(() => store.acquireClaim({ ...claim, ownerId: "machine:b" }), {
    code: "VES_RUNTIME_CLAIM_CONFLICT"
  });
  store.close();
});

test("closing and reopening after failed CAS preserves canonical digest", async () => {
  const { dbPath, store } = await opened();
  store.createRun(run());
  const before = store.stateDigest();
  assert.throws(() => store.applyTransition(runId, transition("CREATED", "READY", 2), event()), {
    code: "VES_RUNTIME_VERSION_CONFLICT"
  });
  store.close();
  const reopened = new RuntimeStore({ dbPath, now: () => now });
  reopened.open();
  assert.equal(reopened.stateDigest(), before);
  reopened.close();
});
