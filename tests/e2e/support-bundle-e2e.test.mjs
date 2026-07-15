import assert from "node:assert/strict";
import { test } from "node:test";

import { StableErrorDiagnosticAdapter } from "../../packages/evidence/src/index.ts";
import { recipient } from "../helpers/recovery-bundle-fixture.mjs";
import {
  defaultDiagnostics,
  supportCoordinator,
  supportExportPorts,
  supportHarness,
  supportCodeRegistry,
  supportNow,
  supportRun,
  supportWorkspace
} from "../helpers/support-bundle-fixture.mjs";

test("inspection exposes the exact allowlisted diagnostic manifest before export", async () => {
  const { inspection } = await supportHarness();
  assert.equal(inspection.fieldCount, 10);
  assert.equal(
    inspection.diagnostics.some((entry) => entry.fieldId === "release.digest"),
    true
  );
  assert.equal(inspection.redactionSummary.pathsPseudonymized, 1);
});

test("machine paths become deterministic non-reversible pseudonyms", async () => {
  const first = await supportHarness();
  const second = await supportHarness();
  const value = first.inspection.diagnostics.find((entry) => entry.fieldId === "diagnostic.path").value;
  assert.match(value, /^path:sha256:[a-f0-9]{64}$/u);
  assert.equal(value, second.inspection.diagnostics.find((entry) => entry.fieldId === "diagnostic.path").value);
  assert.equal(JSON.stringify(first.plan).includes("Users"), false);
});

test("stable error adapter ignores message stack cause and private details", () => {
  const adapted = new StableErrorDiagnosticAdapter({ registry: supportCodeRegistry() }).adapt({
    code: "VES_RUNTIME_FAILURE",
    message: "secret source text",
    stack: "C:\\private\\source.ts:1",
    cause: new Error("token"),
    details: { password: "hidden" }
  });
  assert.deepEqual(adapted, [{ fieldId: "error.codes", value: ["VES_RUNTIME_FAILURE"] }]);
});

test("explicit export verifies inspection then Approval then egress before publication", async () => {
  const fixture = await supportHarness();
  const { state, ports } = supportExportPorts();
  const result = await supportCoordinator(fixture.builder, ports).export(
    fixture.plan,
    fixture.inspection,
    fixture.recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey })),
    { approvalRef: "approval:support:001", destinationId: "support:vendor" }
  );
  assert.deepEqual(state.calls, ["approval", "egress", "publish"]);
  assert.equal(result.status, "published");
});

test("authorized recipient opens the signed encrypted diagnostic closure", async () => {
  const fixture = await supportHarness();
  const { state, ports } = supportExportPorts();
  await supportCoordinator(fixture.builder, ports).export(
    fixture.plan,
    fixture.inspection,
    fixture.recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey })),
    { approvalRef: "approval:support:001", destinationId: "support:vendor" }
  );
  const opened = await fixture.builder.open(state.published.bundle, fixture.trust, fixture.recipients[0], {
    workspaceId: supportWorkspace,
    runId: supportRun,
    now: supportNow
  });
  assert.equal(opened.diagnostics.length, 10);
  assert.equal(JSON.stringify(opened).includes("runtime.sqlite"), false);
});

test("multiple recipients open one identical Support Bundle", async () => {
  const alice = await recipient("alice");
  const bob = await recipient("bob");
  const fixture = await supportHarness({ recipients: [alice, bob] });
  const { state, ports } = supportExportPorts();
  await supportCoordinator(fixture.builder, ports).export(
    fixture.plan,
    fixture.inspection,
    [alice, bob].map(({ recipientId, publicKey }) => ({ recipientId, publicKey })),
    { approvalRef: "approval:support:001", destinationId: "support:vendor" }
  );
  for (const receiver of [alice, bob]) {
    const opened = await fixture.builder.open(state.published.bundle, fixture.trust, receiver, {
      workspaceId: supportWorkspace,
      runId: supportRun,
      now: supportNow
    });
    assert.deepEqual(opened.diagnostics, fixture.inspection.diagnostics);
  }
});

test("denied Approval produces no encryption or publication", async () => {
  const fixture = await supportHarness();
  const { state, ports } = supportExportPorts({ approval: { verify: async () => ({ valid: false }) } });
  await assert.rejects(
    supportCoordinator(fixture.builder, ports).export(fixture.plan, fixture.inspection, [], {
      approvalRef: "approval:denied",
      destinationId: "support:vendor"
    }),
    { code: "VES_SUPPORT_APPROVAL_DENIED" }
  );
  assert.equal(state.published, undefined);
});

test("denied Data Egress produces no encryption or publication", async () => {
  const fixture = await supportHarness();
  const { state, ports } = supportExportPorts({ egress: { authorize: async () => ({ allowed: false }) } });
  await assert.rejects(
    supportCoordinator(fixture.builder, ports).export(
      fixture.plan,
      fixture.inspection,
      fixture.recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey })),
      { approvalRef: "approval:support:001", destinationId: "support:vendor" }
    ),
    { code: "VES_SUPPORT_EGRESS_DENIED" }
  );
  assert.equal(state.published, undefined);
});

test("equivalent diagnostic and recipient permutations produce one plan", async () => {
  const receiver = await recipient("support-team");
  const first = await supportHarness({ recipients: [receiver], diagnostics: defaultDiagnostics() });
  const second = await supportHarness({ recipients: [receiver], diagnostics: [...defaultDiagnostics()].reverse() });
  assert.equal(first.plan.planId, second.plan.planId);
});

test("planning and inspection have no export side effect or upload API", async () => {
  const fixture = await supportHarness();
  assert.equal("upload" in fixture.builder, false);
  assert.equal("publish" in fixture.builder, false);
  assert.equal(fixture.inspection.planId, fixture.plan.planId);
});
