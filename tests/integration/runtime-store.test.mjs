import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  DEFAULT_RUNTIME_MIGRATIONS,
  RuntimeStore,
  inspectRuntimeDatabase,
  runtimePublicErrorRegistry
} from "../../packages/platform-node/src/index.ts";
import { WorkflowMachine } from "../../packages/domain/src/index.ts";
import { SchemaRegistry } from "../../packages/contracts/src/index.ts";
import {
  bindingDigest,
  cleanup,
  event,
  now,
  opened,
  run,
  runId,
  transition
} from "../helpers/runtime-store-fixture.mjs";

afterEach(cleanup);

test("runtime store opens runtime.sqlite with qualified safety settings", async () => {
  const { store } = await opened();
  assert.deepEqual(store.safetySettings(), {
    journalMode: "wal",
    foreignKeys: 1,
    busyTimeoutMs: 10,
    writableSchema: 0
  });
  store.close();
});

test("default raw migration applies once and records its checksum", async () => {
  const { store, result } = await opened();
  assert.equal(result.appliedMigrations, DEFAULT_RUNTIME_MIGRATIONS.length);
  assert.equal(store.migrationLedger().length, DEFAULT_RUNTIME_MIGRATIONS.length);
  assert.match(store.migrationLedger()[0].checksum, /^[a-f0-9]{64}$/u);
  store.close();
});

test("the migration registry is pinned to twelve entries ending at the execution checkpoints", () => {
  assert.equal(DEFAULT_RUNTIME_MIGRATIONS.length, 12);
  assert.deepEqual(
    DEFAULT_RUNTIME_MIGRATIONS.slice(-2).map((migration) => migration.id),
    ["011_effect_identity_canonicalization", "012_execution_checkpoints"]
  );
});

test("reopening is migration-idempotent", async () => {
  const { dbPath, store } = await opened();
  store.close();
  const reopened = new RuntimeStore({ dbPath, now: () => now });
  assert.equal(reopened.open().appliedMigrations, 0);
  reopened.close();
});

test("runtime store refuses automatic downgrade", async () => {
  const { store } = await opened();
  assert.throws(() => store.downgradeTo("000"), { code: "VES_RUNTIME_DOWNGRADE_UNSUPPORTED" });
  store.close();
});

test("run repository round-trips a canonical snapshot", async () => {
  const { store } = await opened();
  store.createRun(run());
  assert.deepEqual(store.getRun(runId), run());
  store.close();
});

test("duplicate run ID fails without replacing the original", async () => {
  const { store } = await opened();
  store.createRun(run());
  assert.throws(() => store.createRun(run("READY")), { code: "VES_RUNTIME_CONSTRAINT" });
  assert.equal(store.getRun(runId).state, "CREATED");
  store.close();
});

test("CAS transition updates projection and appends one event atomically", async () => {
  const { store } = await opened();
  store.createRun(run());
  const decision = transition();
  store.applyTransition(runId, decision, event());
  assert.deepEqual(store.getRun(runId), decision.snapshot);
  assert.equal(store.listEvents(runId).length, 1);
  assert.equal(store.listEvents(runId)[0].nextState, "READY");
  store.close();
});

test("real workflow decision persists through the same CAS contract", async () => {
  const { store } = await opened();
  const current = run();
  store.createRun(current);
  const decision = WorkflowMachine.decide(current, {
    type: "READY_WITHOUT_INTAKE",
    expectedVersion: 0,
    actorRole: "controller",
    actorId: "controller:local",
    evidence: []
  });
  assert.equal(decision.accepted, true);
  store.applyTransition(runId, decision, event());
  assert.equal(store.getRun(runId).state, "READY");
  store.close();
});

test("stale CAS transition changes neither run nor journal", async () => {
  const { store } = await opened();
  store.createRun(run());
  store.applyTransition(runId, transition(), event());
  assert.throws(
    () =>
      store.applyTransition(
        runId,
        transition("CREATED", "INTAKE_REQUIRED", 1),
        event("event_018f0b6d-7b1a-7abc-8def-3123456789ab")
      ),
    { code: "VES_RUNTIME_VERSION_CONFLICT" }
  );
  assert.equal(store.getRun(runId).state, "READY");
  assert.equal(store.listEvents(runId).length, 1);
  store.close();
});

test("terminal transition persists capsule intent in the same transaction", async () => {
  const { store } = await opened();
  store.createRun(run());
  const decision = transition("CREATED", "FAILED", 1);
  decision.snapshot.terminalCapsuleRequired = true;
  store.applyTransition(runId, decision, event());
  assert.equal(store.getRun(runId).terminalCapsuleRequired, true);
  store.close();
});

test("workspace lease acquisition starts a fencing sequence", async () => {
  const { store } = await opened();
  const lease = store.acquireLease({
    leaseId: "lease_018f0b6d-7b1a-7abc-8def-6123456789ab",
    workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-7123456789ab",
    ownerId: "machine:a",
    now,
    expiresAt: "2026-07-13T13:00:00.000Z"
  });
  assert.equal(lease.fencingToken, 1);
  store.close();
});

test("active workspace lease blocks a competing owner", async () => {
  const { store } = await opened();
  const base = {
    leaseId: "lease_018f0b6d-7b1a-7abc-8def-6123456789ab",
    workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-7123456789ab",
    ownerId: "machine:a",
    now,
    expiresAt: "2026-07-13T13:00:00.000Z"
  };
  store.acquireLease(base);
  assert.throws(() => store.acquireLease({ ...base, ownerId: "machine:b" }), { code: "VES_RUNTIME_LEASE_CONFLICT" });
  store.close();
});

test("expired lease takeover increments fencing token", async () => {
  const { store } = await opened();
  const base = {
    leaseId: "lease_018f0b6d-7b1a-7abc-8def-6123456789ab",
    workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-7123456789ab",
    ownerId: "machine:a",
    now,
    expiresAt: "2026-07-13T12:01:00.000Z"
  };
  store.acquireLease(base);
  const takeover = store.acquireLease({
    ...base,
    leaseId: "lease_018f0b6d-7b1a-7abc-8def-8123456789ab",
    ownerId: "machine:b",
    now: "2026-07-13T12:02:00.000Z",
    expiresAt: "2026-07-13T13:00:00.000Z"
  });
  assert.equal(takeover.fencingToken, 2);
  store.close();
});

test("lease release requires the current owner", async () => {
  const { store } = await opened();
  const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-7123456789ab";
  store.acquireLease({
    leaseId: "lease_018f0b6d-7b1a-7abc-8def-6123456789ab",
    workspaceId,
    ownerId: "machine:a",
    now,
    expiresAt: "2026-07-13T13:00:00.000Z"
  });
  assert.throws(() => store.releaseLease(workspaceId, "machine:b"), { code: "VES_RUNTIME_LEASE_OWNER_MISMATCH" });
  assert.equal(store.releaseLease(workspaceId, "machine:a"), true);
  store.close();
});

test("canonical runtime state digest is stable across reopen", async () => {
  const { dbPath, store } = await opened();
  store.createRun(run());
  const digest = store.stateDigest();
  store.close();
  const reopened = new RuntimeStore({ dbPath, now: () => now });
  reopened.open();
  assert.equal(reopened.stateDigest(), digest);
  reopened.close();
});

test("canonical runtime digest is independent of authority insertion order", async () => {
  const first = await opened();
  const second = await opened();
  for (const store of [first.store, second.store]) store.createRun(run());
  const approvals = [
    { approvalId: "approval_018f0b6d-7b1a-7abc-8def-4123456789ab", ...authorityRow("execution") },
    { approvalId: "approval_018f0b6d-7b1a-7abc-8def-5123456789ab", ...authorityRow("handoff-publication") }
  ];
  const grants = [
    { grantId: "grant_018f0b6d-7b1a-7abc-8def-6123456789ab", ...authorityRow("workspace.write") },
    { grantId: "grant_018f0b6d-7b1a-7abc-8def-7123456789ab", ...authorityRow("workspace.read") }
  ];
  for (const approval of approvals) assert.equal(first.store.saveAuthorityApproval(approval).created, true);
  for (const grant of grants) assert.equal(first.store.saveAuthorityGrant(grant).created, true);
  for (const grant of grants.toReversed()) assert.equal(second.store.saveAuthorityGrant(grant).created, true);
  for (const approval of approvals.toReversed()) {
    assert.equal(second.store.saveAuthorityApproval(approval).created, true);
  }
  assert.equal(first.store.stateDigest(), second.store.stateDigest());
  // invariant: the digest still discriminates content, or the equality above
  // would prove nothing about ordering.
  assert.equal(second.store.revokeAuthorityApproval(approvals[0].approvalId, now, "reviewer-withdrew"), true);
  assert.notEqual(first.store.stateDigest(), second.store.stateDigest());
  first.store.close();
  second.store.close();
});

test("online backup has integrity, byte digest, migration and state metadata", async () => {
  const { root, store } = await opened();
  store.createRun(run());
  const backup = await store.backupTo(join(root, "backup.sqlite"));
  assert.match(backup.manifest.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(backup.manifest.stateDigest, store.stateDigest());
  assert.equal(backup.manifest.migrations.length, DEFAULT_RUNTIME_MIGRATIONS.length);
  assert.equal(inspectRuntimeDatabase(backup.path).integrity, "ok");
  await access(backup.path);
  store.close();
});

test("online backup includes committed WAL rows", async () => {
  const { root, store } = await opened();
  store.createRun(run());
  const backup = await store.backupTo(join(root, "backup.sqlite"));
  assert.equal(inspectRuntimeDatabase(backup.path).runs, 1);
  store.close();
});

test("read-only inspector keeps extension loading unavailable", async () => {
  const { dbPath, store } = await opened();
  assert.deepEqual(inspectRuntimeDatabase(dbPath, { assertExtensionsDisabled: true }), {
    integrity: "ok",
    runs: 0,
    migrations: DEFAULT_RUNTIME_MIGRATIONS.length
  });
  store.close();
});

test("foreign-key enforcement rejects orphan authority records", async () => {
  const { dbPath, store } = await opened();
  const approvalId = "approval_018f0b6d-7b1a-7abc-8def-4123456789ab";
  const grantId = "grant_018f0b6d-7b1a-7abc-8def-6123456789ab";
  assert.throws(() => store.saveAuthorityApproval({ approvalId, ...authorityRow("execution") }), {
    code: "VES_RUNTIME_CONSTRAINT"
  });
  assert.throws(() => store.saveAuthorityGrant({ grantId, ...authorityRow("workspace.write") }), {
    code: "VES_RUNTIME_CONSTRAINT"
  });
  assert.equal(store.loadAuthorityApproval(approvalId), undefined);
  assert.equal(store.loadAuthorityGrant(grantId), undefined);
  assert.equal(inspectRuntimeDatabase(dbPath).integrity, "ok");
  store.close();
});

test("runtime public-error catalog is complete and schema-valid", async () => {
  assert.equal(runtimePublicErrorRegistry.codes.length, 19);
  assert.ok(runtimePublicErrorRegistry.codes.includes("VES_RUNTIME_CHECKPOINT_CONFLICT"));
  assert.ok(runtimePublicErrorRegistry.codes.includes("VES_RUNTIME_CHECKPOINT_CORRUPT"));
  const schemas = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));
  for (const code of runtimePublicErrorRegistry.codes) {
    assert.equal(schemas.validate("public-error", "1", runtimePublicErrorRegistry.create(code, {})).code, code);
  }
});

// why: the store treats the record text as opaque and only the run binding is
// relational, so a minimal row reaches both the state digest and the foreign key.
function authorityRow(action) {
  return {
    workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-7123456789ab",
    runId,
    action,
    recordJson: JSON.stringify({ action, bindingDigest }),
    issuedAt: now,
    expiresAt: "2026-07-13T13:00:00.000Z"
  };
}

// why: `downgradeTo` refuses an in-place downgrade; this is the refusal the
// product meets. An older build that opens a database a newer build migrated
// refuses it on open, before it applies or records anything.
test("an older build refuses a database a newer build migrated, and changes nothing", async () => {
  const { dbPath, store } = await opened();
  store.close();
  const older = new RuntimeStore({ dbPath, migrations: DEFAULT_RUNTIME_MIGRATIONS.slice(0, -1), now: () => now });
  assert.throws(() => older.open(), { code: "VES_RUNTIME_MIGRATION_INCOMPATIBLE" });
  const reopened = new RuntimeStore({ dbPath, now: () => now });
  assert.equal(reopened.open().appliedMigrations, 0);
  assert.deepEqual(
    reopened.migrationLedger().map((entry) => entry.id),
    DEFAULT_RUNTIME_MIGRATIONS.map((migration) => migration.id)
  );
  reopened.close();
});
