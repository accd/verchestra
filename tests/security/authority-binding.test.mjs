import assert from "node:assert/strict";
import { test } from "node:test";

import { ApprovalService, CapabilityBroker } from "../../packages/application/src/index.ts";
import { authorityFixture, grantRequest, intent } from "../helpers/authority-fixture.mjs";

const approver = { kind: "human", id: "reviewer@example.test" };

async function context() {
  const fixture = authorityFixture();
  const approvals = new ApprovalService(fixture);
  const approval = await approvals.record(approvals.request(intent()), approver);
  const policy = { authorize: async () => ({ decision: "allow", policyViewDigest: approval.binding.policyDigest }) };
  const broker = new CapabilityBroker({ ...fixture, approvals, policy });
  return { ...fixture, approval, approvals, broker, policy };
}

const bindingFields = [
  "workspaceId",
  "runId",
  "action",
  "packageDigest",
  "sourceStateDigest",
  "scopeDigest",
  "protectedPathsDigest",
  "tasksDigest",
  "dataAccessDigest",
  "capabilitiesDigest",
  "selectedPassportsDigest",
  "destinationsDigest",
  "budgetsDigest",
  "claimsDigest",
  "gatesDigest",
  "risksDigest",
  "assumptionsDigest",
  "completionCriteriaDigest",
  "evidenceDigest",
  "policyDigest",
  "contextRecipeDigest",
  "semanticObligationsDigest",
  "contextManifestDigest"
];

for (const field of bindingFields) {
  test(`approval mutation fails before effect: ${field}`, async () => {
    const value = await context();
    const current = {
      ...value.approval.binding,
      [field]: field.endsWith("Digest") ? `sha256:${"f".repeat(64)}` : "changed"
    };
    const verdict = await value.approvals.verify(value.approval.approvalId, current);
    assert.equal(verdict.valid, false);
    assert.equal(verdict.code, "VES_APPROVAL_STALE");
  });
}

// Issue #58: ApprovalService.request()'s bindingDigest must not depend on
// the machine's ambient locale.
test("bindingDigest is byte-identical under two different ambient locales", async () => {
  const fixture = authorityFixture();
  const approvals = new ApprovalService(fixture);
  const priorLang = process.env.LANG;
  const priorLcAll = process.env.LC_ALL;
  try {
    process.env.LANG = "en_US.UTF-8";
    process.env.LC_ALL = "en_US.UTF-8";
    const first = approvals.request(intent());
    process.env.LANG = "fr_FR.UTF-8";
    process.env.LC_ALL = "fr_FR.UTF-8";
    const second = approvals.request(intent());
    assert.equal(first.bindingDigest, second.bindingDigest);
    assert.deepEqual(first.binding, second.binding);
  } finally {
    if (priorLang === undefined) delete process.env.LANG;
    else process.env.LANG = priorLang;
    if (priorLcAll === undefined) delete process.env.LC_ALL;
    else process.env.LC_ALL = priorLcAll;
  }
});

test("exact grant invokes one effect after current approval and policy checks", async () => {
  const value = await context();
  const grant = await value.broker.grant(grantRequest(value.approval));
  let effects = 0;
  const result = await value.broker.invoke(
    {
      grantId: grant.grantId,
      principal: grant.principal,
      action: grant.action,
      resource: grant.resource,
      workspaceId: grant.workspaceId,
      runId: grant.runId,
      constraints: grant.constraints,
      capability: grant.capability,
      currentApprovalBinding: value.approval.binding,
      policyRequest: { purpose: "execute" }
    },
    async () => ((effects += 1), "applied")
  );
  assert.equal(result, "applied");
  assert.equal(effects, 1);
});

for (const field of ["principal", "action", "resource", "workspaceId", "runId", "constraints", "capability"]) {
  test(`grant mutation fails before effect: ${field}`, async () => {
    const value = await context();
    const grant = await value.broker.grant(grantRequest(value.approval));
    const invocation = {
      grantId: grant.grantId,
      principal: grant.principal,
      action: grant.action,
      resource: grant.resource,
      workspaceId: grant.workspaceId,
      runId: grant.runId,
      constraints: grant.constraints,
      capability: grant.capability,
      currentApprovalBinding: value.approval.binding,
      policyRequest: {}
    };
    invocation[field] =
      field === "constraints"
        ? ["changed"]
        : typeof invocation[field] === "string"
          ? "changed"
          : { ...invocation[field], id: "changed" };
    let effects = 0;
    await assert.rejects(
      value.broker.invoke(invocation, async () => (effects += 1)),
      { code: "VES_CAPABILITY_BINDING_MISMATCH" }
    );
    assert.equal(effects, 0);
  });
}

for (const wildcard of ["*", "Vestra::*", "project/**", "inherit", "inherited"]) {
  test(`wildcard or inherited grant is rejected: ${wildcard}`, async () => {
    const value = await context();
    await assert.rejects(
      value.broker.grant(grantRequest(value.approval, { resource: { type: "Vestra::Resource", id: wildcard } })),
      {
        code: "VES_CAPABILITY_SCOPE_INVALID"
      }
    );
  });
}

test("revoked grant cannot invoke", async () => {
  const value = await context();
  const grant = await value.broker.grant(grantRequest(value.approval));
  await value.broker.revoke(grant.grantId, "task-complete");
  await assert.rejects(
    value.broker.invoke(
      { ...grant, grantId: grant.grantId, currentApprovalBinding: value.approval.binding, policyRequest: {} },
      async () => undefined
    ),
    { code: "VES_CAPABILITY_REVOKED" }
  );
});

test("capability absent from the signed review surface is rejected", async () => {
  const value = await context();
  await assert.rejects(
    value.broker.grant(grantRequest(value.approval, { capability: "filesystem.write:another-project" })),
    { code: "VES_CAPABILITY_APPROVAL_INVALID" }
  );
});

test("Handoff Publication Approval cannot authorize code mutation", async () => {
  const fixture = authorityFixture();
  const approvals = new ApprovalService(fixture);
  const approval = await approvals.record(
    approvals.request(
      intent({
        action: "handoff-publication",
        review: { ...intent().review, capabilities: ["handoff.publish:package"] }
      })
    ),
    approver
  );
  const policy = { authorize: async () => ({ decision: "allow", policyViewDigest: approval.binding.policyDigest }) };
  const broker = new CapabilityBroker({ ...fixture, approvals, policy });
  await assert.rejects(broker.grant(grantRequest(approval)), { code: "VES_CAPABILITY_APPROVAL_INVALID" });
});

test("policy downgrade after grant fails before effect", async () => {
  const value = await context();
  const grant = await value.broker.grant(grantRequest(value.approval));
  value.policy.authorize = async () => ({ decision: "deny", policyViewDigest: value.approval.binding.policyDigest });
  let effects = 0;
  await assert.rejects(
    value.broker.invoke(
      { ...grant, currentApprovalBinding: value.approval.binding, policyRequest: {} },
      async () => (effects += 1)
    ),
    { code: "VES_CAPABILITY_POLICY_DENIED" }
  );
  assert.equal(effects, 0);
});
