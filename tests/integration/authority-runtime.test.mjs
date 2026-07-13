import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { ApprovalService, CapabilityBroker } from "../../packages/application/src/index.ts";
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
