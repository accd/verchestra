import assert from "node:assert/strict";
import { test } from "node:test";

import {
  recipient,
  recoveryHarness,
  recoveryNow,
  recoveryWorkspace,
  restoreCoordinator,
  restorePorts
} from "../helpers/recovery-bundle-fixture.mjs";

test("wrong recipient cannot decrypt", async () => {
  const { builder, bundle, trust } = await recoveryHarness();
  const mallory = await recipient("mallory");
  await assert.rejects(builder.open(bundle, trust, mallory, { workspaceId: recoveryWorkspace, now: recoveryNow }), {
    code: "VES_RECOVERY_RECIPIENT_DENIED"
  });
});

test("expired bundle is rejected before staging", async () => {
  const { builder, bundle, trust, recipients } = await recoveryHarness();
  await assert.rejects(
    builder.open(bundle, trust, recipients[0], { workspaceId: recoveryWorkspace, now: "2026-07-17T20:00:00.000Z" }),
    { code: "VES_RECOVERY_EXPIRED" }
  );
});

test("future-created bundle is rejected before staging", async () => {
  const { builder, bundle, trust, recipients } = await recoveryHarness();
  await assert.rejects(
    builder.open(bundle, trust, recipients[0], { workspaceId: recoveryWorkspace, now: "2026-07-14T20:00:00.000Z" }),
    { code: "VES_RECOVERY_NOT_YET_VALID" }
  );
});

test("cross-Workspace restore is rejected", async () => {
  const { builder, bundle, trust, recipients } = await recoveryHarness();
  await assert.rejects(
    builder.open(bundle, trust, recipients[0], { workspaceId: "workspace:foreign", now: recoveryNow }),
    { code: "VES_RECOVERY_WORKSPACE_MISMATCH" }
  );
});

for (const field of [
  "credential",
  "secretValue",
  "providerToken",
  "sessionId",
  "transcript",
  "environmentValue",
  "row",
  "localPath"
]) {
  test(`planner rejects prohibited field ${field}`, async () => {
    const fixture = await recoveryHarness();
    const input = structuredClone(fixture.plan.manifest);
    input[field] = "forbidden";
    await assert.rejects(
      fixture.builder.plan({
        ...input,
        objects: fixture.objects,
        recipients: fixture.recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey }))
      }),
      { code: "VES_RECOVERY_INVALID" }
    );
  });
}

test("ciphertext tamper fails authentication before restore", async () => {
  const { builder, bundle, trust, recipients } = await recoveryHarness();
  const tampered = structuredClone(bundle);
  tampered.payload.jwe.ciphertext = `${tampered.payload.jwe.ciphertext[0] === "A" ? "B" : "A"}${tampered.payload.jwe.ciphertext.slice(1)}`;
  await assert.rejects(
    builder.open(tampered, trust, recipients[0], { workspaceId: recoveryWorkspace, now: recoveryNow })
  );
});

test("planner requires every mandatory exclusion", async () => {
  const fixture = await recoveryHarness();
  await assert.rejects(
    fixture.builder.plan({
      ...fixture.plan.manifest,
      excludedClasses: fixture.plan.manifest.excludedClasses.filter((value) => value !== "secret-values"),
      objects: fixture.objects,
      recipients: fixture.recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey }))
    }),
    { code: "VES_RECOVERY_INVALID" }
  );
});

test("planner rejects overlapping inclusion and exclusion decisions", async () => {
  const fixture = await recoveryHarness();
  await assert.rejects(
    fixture.builder.plan({
      ...fixture.plan.manifest,
      includedClasses: [...fixture.plan.manifest.includedClasses, "secret-values"],
      objects: fixture.objects,
      recipients: fixture.recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey }))
    }),
    { code: "VES_RECOVERY_INVALID" }
  );
});

test("planner rejects duplicate recipient identities", async () => {
  const fixture = await recoveryHarness();
  const receiver = fixture.recipients[0];
  await assert.rejects(
    fixture.builder.plan({
      ...fixture.plan.manifest,
      objects: fixture.objects,
      recipients: [
        { recipientId: receiver.recipientId, publicKey: receiver.publicKey },
        { recipientId: receiver.recipientId, publicKey: receiver.publicKey }
      ]
    }),
    { code: "VES_RECOVERY_INVALID" }
  );
});

for (const mutation of ["missing", "extra", "changed"]) {
  test(`builder rejects ${mutation} content-addressed closure`, async () => {
    const fixture = await recoveryHarness();
    const objects = fixture.objects.map((entry) => ({ ...entry }));
    if (mutation === "missing") objects.pop();
    if (mutation === "extra") objects.push({ objectId: "extra", kind: "evidence", bytes: new Uint8Array([1]) });
    if (mutation === "changed") objects[0] = { ...objects[0], bytes: new Uint8Array([9]) };
    await assert.rejects(
      fixture.builder.build(
        fixture.plan,
        objects,
        fixture.recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey }))
      ),
      { code: "VES_RECOVERY_CLOSURE_INVALID" }
    );
  });
}

test("planner rejects a bundle that expires before it is created", async () => {
  const fixture = await recoveryHarness();
  await assert.rejects(
    fixture.builder.plan({
      ...fixture.plan.manifest,
      createdAt: "2026-07-16T20:00:00.000Z",
      expiresAt: "2026-07-15T20:00:00.000Z",
      objects: fixture.objects,
      recipients: fixture.recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey }))
    }),
    { code: "VES_RECOVERY_INVALID" }
  );
});

test("missing logical secret rebinding blocks activation", async () => {
  const { builder, bundle, trust, recipients } = await recoveryHarness();
  const { state, ports } = restorePorts({ secrets: { isBound: async (name) => name !== "database.primary" } });
  await assert.rejects(
    restoreCoordinator(builder, ports).restore(bundle, trust, recipients[0], {
      workspaceId: recoveryWorkspace,
      now: recoveryNow
    }),
    { code: "VES_RECOVERY_SECRET_REBIND_REQUIRED" }
  );
  assert.equal(state.active, "original");
});
