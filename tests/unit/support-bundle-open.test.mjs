import assert from "node:assert/strict";
import { test } from "node:test";

import { recipient } from "../helpers/recovery-bundle-fixture.mjs";
import {
  supportCoordinator,
  supportExportPorts,
  supportHarness,
  supportNow,
  supportRun,
  supportWorkspace
} from "../helpers/support-bundle-fixture.mjs";

async function exported() {
  const fixture = await supportHarness();
  const { state, ports } = supportExportPorts();
  await supportCoordinator(fixture.builder, ports).export(
    fixture.plan,
    fixture.inspection,
    fixture.recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey })),
    { approvalRef: "approval:support:001", destinationId: "support:vendor" }
  );
  return { ...fixture, bundle: state.published.bundle };
}

const expected = (overrides = {}) => ({
  workspaceId: supportWorkspace,
  runId: supportRun,
  now: supportNow,
  ...overrides
});

test("an exported bundle opens for its recipient and returns the planned manifest", async () => {
  const { builder, bundle, trust, recipients, plan } = await exported();
  const manifest = await builder.open(bundle, trust, recipients[0], expected());
  assert.equal(manifest.planId, plan.planId);
  assert.deepEqual(manifest.diagnostics, plan.manifest.diagnostics);
});

test("a malformed envelope is refused before any verification", async () => {
  const { builder, trust, recipients } = await exported();
  await assert.rejects(builder.open({ payload: null }, trust, recipients[0], expected()), {
    code: "VES_SUPPORT_INVALID",
    message: "Support Bundle envelope is malformed"
  });
});

for (const [label, overrides, code, message] of [
  [
    "another Workspace",
    { workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-999999999999" },
    "VES_SUPPORT_WORKSPACE_MISMATCH",
    "Support Bundle belongs to another Workspace"
  ],
  [
    "another run",
    { runId: "run_018f0b6d-7b1a-7abc-8def-999999999999" },
    "VES_SUPPORT_RUN_MISMATCH",
    "Support Bundle belongs to another run"
  ],
  [
    "a time before creation",
    { now: "2026-07-15T21:00:00.000Z" },
    "VES_SUPPORT_NOT_YET_VALID",
    "Support Bundle is not yet valid"
  ],
  ["a time after expiry", { now: "2026-07-16T22:00:00.000Z" }, "VES_SUPPORT_EXPIRED", "Support Bundle expired"]
]) {
  test(`opening for ${label} is refused with its own reason`, async () => {
    const { builder, bundle, trust, recipients } = await exported();
    await assert.rejects(builder.open(bundle, trust, recipients[0], expected(overrides)), { code, message });
  });
}

test("the declared recipient holding the wrong private key cannot decrypt", async () => {
  const { builder, bundle, trust, recipients } = await exported();
  const impostor = await recipient("impostor");
  await assert.rejects(
    builder.open(
      bundle,
      trust,
      { recipientId: recipients[0].recipientId, privateKey: impostor.privateKey },
      expected()
    ),
    { code: "VES_SUPPORT_DECRYPT_FAILED", message: "Support Bundle decryption failed" }
  );
});

test("a public key presented as the private key is refused as an unauthorized recipient", async () => {
  const { builder, bundle, trust, recipients } = await exported();
  await assert.rejects(
    builder.open(
      bundle,
      trust,
      { recipientId: recipients[0].recipientId, privateKey: recipients[0].publicKey },
      expected()
    ),
    { code: "VES_SUPPORT_RECIPIENT_DENIED", message: "Support Bundle recipient is not authorized" }
  );
});
