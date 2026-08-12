import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { ApprovalService } from "../../packages/application/src/index.ts";
import {
  DEFAULT_RUNTIME_MIGRATIONS,
  RuntimeAuthorityStore,
  RuntimeStore
} from "../../packages/platform-node/src/index.ts";
import { authorityFixture, intent, now } from "../helpers/authority-fixture.mjs";
import { cleanup, opened } from "../helpers/runtime-store-fixture.mjs";

afterEach(cleanup);

const approver = { kind: "human", id: "reviewer@example.test" };

function run(runId) {
  return {
    runId,
    runKind: "feature",
    state: "AWAITING_EXECUTION_APPROVAL",
    version: 1,
    repairCycles: 0,
    approval: undefined,
    terminalCapsuleRequired: false
  };
}

// The migration list an older build shipped: everything up to, but not
// including, the authority binding-digest re-encoding. Opening with it
// produces a database in exactly the state a developer would have had before
// pulling #58's T4b slice (PR #259).
const BEFORE_REENCODING = DEFAULT_RUNTIME_MIGRATIONS.filter(
  (migration) => migration.id !== "009_authority_binding_digest_reencoding"
);

test("the migration that discards re-encoded authority records is registered exactly once and after the tables exist", () => {
  const ids = DEFAULT_RUNTIME_MIGRATIONS.map((migration) => migration.id);
  assert.ok(ids.includes("009_authority_binding_digest_reencoding"));
  assert.equal(new Set(ids).size, ids.length, "migration ids must be unique");
  assert.ok(ids.indexOf("006_authority") < ids.indexOf("009_authority_binding_digest_reencoding"));
});

test("an Approval and Capability Grant written before the re-encoding do not outlive it", async () => {
  const fixture = authorityFixture();
  const older = await opened({ migrations: BEFORE_REENCODING });
  const input = intent();
  older.store.createRun(run(input.runId));
  const authorityStore = new RuntimeAuthorityStore(older.store);
  const approvals = new ApprovalService({ ...fixture, store: authorityStore });
  const approval = await approvals.record(approvals.request(input), approver);
  await authorityStore.saveGrant({
    schemaVersion: 1,
    grantId: "grant_018f0b6d-7b1a-7abc-8def-000000000001",
    principal: { type: "human", id: "reviewer@example.test" },
    action: { type: "capability", id: "read" },
    resource: { type: "workspace", id: input.workspaceId },
    workspaceId: input.workspaceId,
    runId: input.runId,
    constraints: ["scope:read"],
    capability: "filesystem.read",
    policyViewDigest: approval.binding.policyDigest,
    policyDecisionDigest: `sha256:${"1".repeat(64)}`,
    approvalRef: { approvalId: approval.approvalId, bindingDigest: approval.bindingDigest },
    bindingDigest: `sha256:${"2".repeat(64)}`,
    issuedAt: now,
    expiresAt: input.expiresAt,
    nonce: "nonce_018f0b6d-7b1a-7abc-8def-000000000002"
  });
  older.store.close();

  // Pulling the change applies the pending migration.
  const upgraded = new RuntimeStore({ dbPath: older.dbPath, now: () => now });
  const { appliedMigrations } = upgraded.open();
  assert.equal(appliedMigrations, 1, "exactly the authority re-encoding migration is pending");

  const reloaded = new RuntimeAuthorityStore(upgraded);
  assert.equal(await reloaded.loadApproval(approval.approvalId), undefined);
  assert.equal(await reloaded.loadGrant("grant_018f0b6d-7b1a-7abc-8def-000000000001"), undefined);
  upgraded.close();
});

test("the migration runs once, not on every open", async () => {
  const fixture = authorityFixture();
  const first = await opened();
  const input = intent();
  first.store.createRun(run(input.runId));
  const authorityStore = new RuntimeAuthorityStore(first.store);
  const approvals = new ApprovalService({ ...fixture, store: authorityStore });
  const approval = await approvals.record(approvals.request(input), approver);
  first.store.close();

  const second = new RuntimeStore({ dbPath: first.dbPath, now: () => now });
  assert.equal(second.open().appliedMigrations, 0, "no migration is pending on an already-current database");
  // An approval saved after the upgrade must survive re-opening, or the
  // migration would be quietly clearing authority records forever.
  const reloaded = await new RuntimeAuthorityStore(second).loadApproval(approval.approvalId);
  assert.equal(reloaded.approvalId, approval.approvalId);
  second.close();
});
