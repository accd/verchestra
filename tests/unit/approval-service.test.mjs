import assert from "node:assert/strict";
import { test } from "node:test";

import { ApprovalService } from "../../packages/application/src/index.ts";
import { authorityFixture, intent, review } from "../helpers/authority-fixture.mjs";

const approver = { kind: "human", id: "reviewer@example.test" };

async function approved() {
  const fixture = authorityFixture();
  const service = new ApprovalService(fixture);
  const request = service.request(intent());
  const approval = await service.record(request, approver);
  return { ...fixture, service, request, approval };
}

test("approval request exposes the complete human review surface", () => {
  const service = new ApprovalService(authorityFixture());
  const request = service.request(intent());
  assert.deepEqual(request.review, review());
  assert.match(request.bindingDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(request.action, "execution");
  assert.equal(Object.isFrozen(request.review), true);
});

test("human record creates a signed inspectable approval", async () => {
  const context = await approved();
  assert.equal(context.approval.approver.id, approver.id);
  assert.equal(context.approval.artifact.payload.bindingDigest, context.approval.bindingDigest);
  assert.match(context.approval.artifact.signature, /^[A-Za-z0-9_-]+$/u);
  assert.equal(context.store.approvals.size, 1);
});

test("non-human identity cannot approve", async () => {
  const fixture = authorityFixture();
  const service = new ApprovalService(fixture);
  await assert.rejects(service.record(service.request(intent()), { kind: "controller", id: "system" }), {
    code: "VES_APPROVAL_HUMAN_REQUIRED"
  });
  assert.equal(fixture.store.approvals.size, 0);
});

test("expired request cannot be recorded", async () => {
  const fixture = authorityFixture();
  const service = new ApprovalService(fixture);
  await assert.rejects(service.record(service.request(intent({ expiresAt: "2026-07-13T11:00:00.000Z" })), approver), {
    code: "VES_APPROVAL_EXPIRED"
  });
});

test("valid approval verifies immediately before effect", async () => {
  const context = await approved();
  assert.deepEqual(await context.service.verify(context.approval.approvalId, context.approval.binding), {
    valid: true,
    approvalId: context.approval.approvalId,
    bindingDigest: context.approval.bindingDigest
  });
});

test("revocation is immediate and idempotent", async () => {
  const context = await approved();
  assert.equal(await context.service.revoke(context.approval.approvalId, "scope-withdrawn"), true);
  assert.equal(await context.service.revoke(context.approval.approvalId, "again"), false);
  assert.equal(
    (await context.service.verify(context.approval.approvalId, context.approval.binding)).code,
    "VES_APPROVAL_REVOKED"
  );
});

test("signature tampering fails closed", async () => {
  const context = await approved();
  const stored = context.store.approvals.get(context.approval.approvalId);
  context.store.approvals.set(context.approval.approvalId, {
    ...stored,
    artifact: { ...stored.artifact, signature: `${stored.artifact.signature}tampered` }
  });
  assert.equal(
    (await context.service.verify(context.approval.approvalId, context.approval.binding)).code,
    "VES_APPROVAL_SIGNATURE_INVALID"
  );
});

for (const action of ["execution", "handoff-publication", "support-export", "recovery"]) {
  test(`${action} approval is action-exact`, async () => {
    const fixture = authorityFixture();
    const service = new ApprovalService(fixture);
    const approval = await service.record(service.request(intent({ action })), approver);
    const wrong = { ...approval.binding, action: action === "execution" ? "recovery" : "execution" };
    assert.equal((await service.verify(approval.approvalId, wrong)).code, "VES_APPROVAL_STALE");
  });
}
