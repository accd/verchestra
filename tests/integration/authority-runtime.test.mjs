import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { ApprovalService, CapabilityBroker } from "../../packages/application/src/index.ts";
import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import { RuntimeAuthorityStore, RuntimeStore } from "../../packages/platform-node/src/index.ts";
import { authorityFixture, grantRequest, intent, now } from "../helpers/authority-fixture.mjs";
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

async function persisted() {
  const fixture = authorityFixture();
  const openedRuntime = await opened();
  const input = intent();
  openedRuntime.store.createRun(run(input.runId));
  const authorityStore = new RuntimeAuthorityStore(openedRuntime.store);
  const approvals = new ApprovalService({ ...fixture, store: authorityStore });
  const approval = await approvals.record(approvals.request(input), approver);
  const policy = { authorize: async () => ({ decision: "allow", policyViewDigest: approval.binding.policyDigest }) };
  const broker = new CapabilityBroker({ ...fixture, store: authorityStore, approvals, policy });
  const grant = await broker.grant(grantRequest(approval));
  return { ...fixture, ...openedRuntime, approval, approvals, authorityStore, broker, grant, policy };
}

test("signed Approval and Capability Grant survive runtime restart", async () => {
  const value = await persisted();
  value.store.close();
  const runtime = new RuntimeStore({ dbPath: value.dbPath, now: () => now });
  runtime.open();
  const store = new RuntimeAuthorityStore(runtime);
  const approvals = new ApprovalService({ ...value, store });
  const broker = new CapabilityBroker({ ...value, store, approvals, policy: value.policy });
  assert.equal((await approvals.verify(value.approval.approvalId, value.approval.binding)).valid, true);
  assert.equal(
    await broker.invoke(
      {
        grantId: value.grant.grantId,
        principal: value.grant.principal,
        action: value.grant.action,
        resource: value.grant.resource,
        workspaceId: value.grant.workspaceId,
        runId: value.grant.runId,
        constraints: value.grant.constraints,
        capability: value.grant.capability,
        currentApprovalBinding: value.approval.binding,
        policyRequest: {}
      },
      async () => "applied"
    ),
    "applied"
  );
  runtime.close();
});

test("Approval revocation persists across restart", async () => {
  const value = await persisted();
  await value.approvals.revoke(value.approval.approvalId, "reviewer-withdrew");
  value.store.close();
  const runtime = new RuntimeStore({ dbPath: value.dbPath, now: () => now });
  runtime.open();
  const approvals = new ApprovalService({ ...value, store: new RuntimeAuthorityStore(runtime) });
  assert.equal(
    (await approvals.verify(value.approval.approvalId, value.approval.binding)).code,
    "VES_APPROVAL_REVOKED"
  );
  runtime.close();
});

test("Capability revocation persists across restart", async () => {
  const value = await persisted();
  await value.broker.revoke(value.grant.grantId, "task-complete");
  value.store.close();
  const runtime = new RuntimeStore({ dbPath: value.dbPath, now: () => now });
  runtime.open();
  const store = new RuntimeAuthorityStore(runtime);
  assert.equal((await store.loadGrant(value.grant.grantId)).revocationReason, "task-complete");
  runtime.close();
});

test("tampered Approval JSON fails runtime integrity before verification", async () => {
  const value = await persisted();
  value.store.close();
  const database = new DatabaseSync(value.dbPath);
  database
    .prepare("UPDATE authority_approvals SET record_json=? WHERE approval_id=?")
    .run("{}", value.approval.approvalId);
  database.close();
  const runtime = new RuntimeStore({ dbPath: value.dbPath, now: () => now });
  runtime.open();
  await assert.rejects(new RuntimeAuthorityStore(runtime).loadApproval(value.approval.approvalId), {
    code: "VES_RUNTIME_CORRUPT"
  });
  runtime.close();
});

test("duplicate authority identity is idempotent only for identical bytes", async () => {
  const value = await persisted();
  assert.deepEqual(await value.authorityStore.saveApproval(value.approval), { created: false });
  await assert.rejects(
    value.authorityStore.saveApproval({ ...value.approval, expiresAt: "2026-07-13T14:00:00.000Z" }),
    { code: "VES_RUNTIME_CONSTRAINT" }
  );
  value.store.close();
});

// Issue #58: the durable authority row used to be whatever JSON.stringify
// emitted, so its bytes — and the record_digest derived from them — depended
// on the member order the calling service happened to build the record with.
// They are now the qualified canonical contract (canonicalizeJsonV2, RFC 8785
// JCS): a function of the record's content only.
function storedRecordJson(dbPath, table, idColumn, id) {
  const database = new DatabaseSync(dbPath);
  try {
    return database.prepare(`SELECT record_json FROM ${table} WHERE ${idColumn}=?`).get(id).record_json;
  } finally {
    database.close();
  }
}

test("a persisted Approval is stored with its members in code-unit order", async () => {
  const value = await persisted();
  value.store.close();
  const stored = storedRecordJson(value.dbPath, "authority_approvals", "approval_id", value.approval.approvalId);
  const members = Object.keys(JSON.parse(stored));
  assert.deepEqual(members, [...members].sort());
  assert.equal(stored, canonicalizeJsonV2(value.approval));
});

test("the same Approval built in a different member order persists identical bytes", async () => {
  const value = await persisted();
  const reordered = Object.fromEntries(Object.entries(value.approval).reverse());
  assert.notDeepEqual(Object.keys(reordered), Object.keys(value.approval));
  // Same content, different construction order: the store must see this as the
  // record it already holds, not as conflicting content.
  assert.deepEqual(await value.authorityStore.saveApproval(reordered), { created: false });
  value.store.close();
  assert.equal(
    storedRecordJson(value.dbPath, "authority_approvals", "approval_id", value.approval.approvalId),
    canonicalizeJsonV2(value.approval)
  );
});

test("a persisted Capability Grant is stored under the same canonical contract", async () => {
  const value = await persisted();
  value.store.close();
  assert.equal(
    storedRecordJson(value.dbPath, "authority_grants", "grant_id", value.grant.grantId),
    canonicalizeJsonV2(value.grant)
  );
});

test("persisted authority bytes do not depend on the ambient locale collation", async () => {
  const value = await persisted();
  value.store.close();
  const stored = storedRecordJson(value.dbPath, "authority_approvals", "approval_id", value.approval.approvalId);
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = function hostileLocaleCompare(other) {
    const left = String(this);
    return left < other ? 1 : left > other ? -1 : 0;
  };
  try {
    assert.equal(canonicalizeJsonV2(value.approval), stored);
  } finally {
    String.prototype.localeCompare = original;
  }
});
