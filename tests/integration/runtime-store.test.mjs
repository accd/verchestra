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
  rawDigest,
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
  assert.equal(result.appliedMigrations, 1);
  assert.equal(store.migrationLedger().length, DEFAULT_RUNTIME_MIGRATIONS.length);
  assert.match(store.migrationLedger()[0].checksum, /^[a-f0-9]{64}$/u);
  store.close();
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

test("approval repository round-trips and revokes authority", async () => {
  const { store } = await opened();
  store.createRun(run());
  const approval = {
    approvalId: "approval_018f0b6d-7b1a-7abc-8def-4123456789ab",
    runId,
    action: "execution",
    bindingDigest,
    issuedAt: now,
    expiresAt: "2026-07-13T13:00:00.000Z"
  };
  store.putApproval(approval);
  assert.deepEqual(store.getApproval(approval.approvalId), { ...approval, revokedAt: null });
  store.revokeApproval(approval.approvalId, "2026-07-13T12:30:00.000Z");
  assert.equal(store.getApproval(approval.approvalId).revokedAt, "2026-07-13T12:30:00.000Z");
  store.close();
});

test("grant repository returns only active grants", async () => {
  const { store } = await opened();
  store.createRun(run());
  store.putGrant({
    grantId: "grant_018f0b6d-7b1a-7abc-8def-5123456789ab",
    runId,
    action: "workspace.write",
    bindingDigest,
    issuedAt: now,
    expiresAt: "2026-07-13T13:00:00.000Z"
  });
  assert.equal(store.listActiveGrants(runId, "2026-07-13T12:30:00.000Z").length, 1);
  assert.equal(store.listActiveGrants(runId, "2026-07-13T14:00:00.000Z").length, 0);
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

test("work claim enforces one active owner per scope", async () => {
  const { store } = await opened();
  const claim = {
    claimId: "claim_018f0b6d-7b1a-7abc-8def-9123456789ab",
    workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-7123456789ab",
    scopeDigest: rawDigest,
    ownerId: "machine:a",
    now,
    expiresAt: "2026-07-13T13:00:00.000Z"
  };
  store.acquireClaim(claim);
  assert.throws(
    () => store.acquireClaim({ ...claim, claimId: "claim_018f0b6d-7b1a-7abc-8def-a123456789ab", ownerId: "machine:b" }),
    { code: "VES_RUNTIME_CLAIM_CONFLICT" }
  );
  assert.equal(store.releaseClaim(claim.claimId, "machine:a"), true);
  store.close();
});

test("artifact refs are append-only and ordered", async () => {
  const { store } = await opened();
  store.createRun(run());
  store.putArtifactRef({
    refId: "ref_018f0b6d-7b1a-7abc-8def-b123456789ab",
    runId,
    kind: "execution-package",
    digest: bindingDigest,
    logicalPath: ".verchestra/packages/T42.json",
    createdAt: now
  });
  assert.equal(store.listArtifactRefs(runId)[0].kind, "execution-package");
  assert.throws(
    () =>
      store.putArtifactRef({
        refId: "ref_018f0b6d-7b1a-7abc-8def-b123456789ab",
        runId,
        kind: "other",
        digest: bindingDigest,
        logicalPath: "other.json",
        createdAt: now
      }),
    { code: "VES_RUNTIME_CONSTRAINT" }
  );
  store.close();
});

test("integrity check reports ok on active database", async () => {
  const { store } = await opened();
  assert.equal(store.integrityCheck(), "ok");
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
    {
      approvalId: "approval_018f0b6d-7b1a-7abc-8def-4123456789ab",
      runId,
      action: "execution",
      bindingDigest,
      issuedAt: now,
      expiresAt: "2026-07-13T13:00:00.000Z"
    },
    {
      approvalId: "approval_018f0b6d-7b1a-7abc-8def-5123456789ab",
      runId,
      action: "handoff-publication",
      bindingDigest,
      issuedAt: now,
      expiresAt: "2026-07-13T13:00:00.000Z"
    }
  ];
  approvals.forEach((approval) => first.store.putApproval(approval));
  approvals.toReversed().forEach((approval) => second.store.putApproval(approval));
  assert.equal(first.store.stateDigest(), second.store.stateDigest());
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
    migrations: 1
  });
  store.close();
});

test("foreign-key enforcement rejects orphan authority records", async () => {
  const { dbPath, store } = await opened();
  assert.throws(
    () =>
      store.putApproval({
        approvalId: "approval_018f0b6d-7b1a-7abc-8def-4123456789ab",
        runId,
        action: "execution",
        bindingDigest,
        issuedAt: now,
        expiresAt: "2026-07-13T13:00:00.000Z"
      }),
    { code: "VES_RUNTIME_CONSTRAINT" }
  );
  assert.equal(inspectRuntimeDatabase(dbPath).integrity, "ok");
  store.close();
});

test("runtime public-error catalog is complete and schema-valid", async () => {
  assert.equal(runtimePublicErrorRegistry.codes.length, 17);
  const schemas = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));
  for (const code of runtimePublicErrorRegistry.codes) {
    assert.equal(schemas.validate("public-error", "1", runtimePublicErrorRegistry.create(code, {})).code, code);
  }
});
