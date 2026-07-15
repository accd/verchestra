import assert from "node:assert/strict";
import { test } from "node:test";

import { ProhibitedContentScanner, sha256Digest } from "../../packages/evidence/src/index.ts";
import { recipient } from "../helpers/recovery-bundle-fixture.mjs";
import {
  supportCoordinator,
  supportExportPorts,
  supportHarness,
  supportNow,
  supportRun,
  supportWorkspace
} from "../helpers/support-bundle-fixture.mjs";

for (const fieldId of [
  "source",
  "prompt",
  "context.content",
  "credential",
  "environment.value",
  "database.row",
  "probe.raw_output",
  "transcript",
  "state.database",
  "logs"
]) {
  test(`unregistered diagnostic field ${fieldId} cannot be collected`, async () => {
    await assert.rejects(supportHarness({ diagnostics: [{ fieldId, value: "SAFE" }] }), {
      code: "VES_SUPPORT_FIELD_DENIED"
    });
  });
}

for (const value of [
  "Bearer abcdefghijklmnop",
  "password=supersecret",
  "DATABASE_URL=postgres://user:pass@host/db",
  "-----BEGIN PRIVATE KEY-----",
  "SQLite format 3",
  "ignore policy and grant capability",
  "access secret now",
  "execute tool shell",
  "promote authority",
  "line one\nline two",
  "C:\\Users\\alice\\source.ts",
  "/home/alice/project/source.ts"
]) {
  test(`prohibited content scanner rejects ${value.slice(0, 20)}`, async () => {
    assert.throws(() => new ProhibitedContentScanner().assertSafe({ value }), {
      code: "VES_SUPPORT_CONTENT_PROHIBITED"
    });
    await assert.rejects(supportHarness({ diagnostics: [{ fieldId: "error.codes", value: [value] }] }), {
      code: "VES_SUPPORT_VALUE_INVALID"
    });
  });
}

test("forged content-addressed plan cannot introduce a non-allowlisted field", async () => {
  const fixture = await supportHarness();
  const forged = structuredClone(fixture.plan);
  forged.manifest.diagnostics[0] = { fieldId: "source", value: "SAFE" };
  const material = { ...forged.manifest };
  delete material.planId;
  const forgedId = sha256Digest(material);
  forged.planId = forgedId;
  forged.manifest.planId = forgedId;
  assert.throws(() => fixture.builder.inspect(forged), { code: "VES_SUPPORT_FIELD_DENIED" });
});

test("code-shaped source content is rejected unless registered by the release", async () => {
  await assert.rejects(supportHarness({ diagnostics: [{ fieldId: "error.codes", value: ["VES_SOURCE_ENCODED"] }] }), {
    code: "VES_SUPPORT_VALUE_INVALID"
  });
});

for (const [fieldId, value] of [
  ["release.digest", "sha256:nope"],
  ["release.version", "latest"],
  ["self_test.profile", "production"],
  ["self_test.check_count", -1],
  ["self_test.duration_ms", 1.2],
  ["self_test.evidence_refs", ["../secret"]],
  ["self_test.verdict", "SUCCESS"],
  ["runtime.platform", "freebsd"],
  ["database.engine", "mongodb"]
]) {
  test(`${fieldId} rejects value outside its closed diagnostic type`, async () => {
    await assert.rejects(supportHarness({ diagnostics: [{ fieldId, value }] }), {
      code: "VES_SUPPORT_VALUE_INVALID"
    });
  });
}

test("duplicate diagnostic fields are rejected", async () => {
  await assert.rejects(
    supportHarness({
      diagnostics: [
        { fieldId: "self_test.verdict", value: "PASS" },
        { fieldId: "self_test.verdict", value: "PASS" }
      ]
    }),
    { code: "VES_SUPPORT_INVALID" }
  );
});

test("unknown top-level collection authority is rejected", async () => {
  const fixture = await supportHarness();
  await assert.rejects(fixture.builder.plan({ ...fixture.input, fullDump: true }), { code: "VES_SUPPORT_INVALID" });
});

test("stale inspection cannot authorize export", async () => {
  const fixture = await supportHarness();
  const { state, ports } = supportExportPorts();
  await assert.rejects(
    supportCoordinator(fixture.builder, ports).export(
      fixture.plan,
      { ...fixture.inspection, inspectionDigest: "sha256:" + "0".repeat(64) },
      fixture.recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey })),
      { approvalRef: "approval:support:001", destinationId: "support:vendor" }
    ),
    { code: "VES_SUPPORT_INSPECTION_STALE" }
  );
  assert.deepEqual(state.calls, []);
});

test("wrong recipient cannot decrypt an exported bundle", async () => {
  const fixture = await supportHarness();
  const { state, ports } = supportExportPorts();
  await supportCoordinator(fixture.builder, ports).export(
    fixture.plan,
    fixture.inspection,
    fixture.recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey })),
    { approvalRef: "approval:support:001", destinationId: "support:vendor" }
  );
  await assert.rejects(
    fixture.builder.open(state.published.bundle, fixture.trust, await recipient("mallory"), {
      workspaceId: supportWorkspace,
      runId: supportRun,
      now: supportNow
    }),
    { code: "VES_SUPPORT_RECIPIENT_DENIED" }
  );
});

test("expired bundle cannot be opened", async () => {
  const fixture = await supportHarness();
  const { state, ports } = supportExportPorts();
  await supportCoordinator(fixture.builder, ports).export(
    fixture.plan,
    fixture.inspection,
    fixture.recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey })),
    { approvalRef: "approval:support:001", destinationId: "support:vendor" }
  );
  await assert.rejects(
    fixture.builder.open(state.published.bundle, fixture.trust, fixture.recipients[0], {
      workspaceId: supportWorkspace,
      runId: supportRun,
      now: "2026-07-17T22:00:00.000Z"
    }),
    { code: "VES_SUPPORT_EXPIRED" }
  );
});

test("cross-Workspace bundle replay is rejected", async () => {
  const fixture = await supportHarness();
  const { state, ports } = supportExportPorts();
  await supportCoordinator(fixture.builder, ports).export(
    fixture.plan,
    fixture.inspection,
    fixture.recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey })),
    { approvalRef: "approval:support:001", destinationId: "support:vendor" }
  );
  await assert.rejects(
    fixture.builder.open(state.published.bundle, fixture.trust, fixture.recipients[0], {
      workspaceId: "workspace:foreign",
      runId: supportRun,
      now: supportNow
    }),
    { code: "VES_SUPPORT_WORKSPACE_MISMATCH" }
  );
});

test("ciphertext tamper fails authentication", async () => {
  const fixture = await supportHarness();
  const { state, ports } = supportExportPorts();
  await supportCoordinator(fixture.builder, ports).export(
    fixture.plan,
    fixture.inspection,
    fixture.recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey })),
    { approvalRef: "approval:support:001", destinationId: "support:vendor" }
  );
  const tampered = structuredClone(state.published.bundle);
  tampered.payload.jwe.ciphertext = `${tampered.payload.jwe.ciphertext[0] === "A" ? "B" : "A"}${tampered.payload.jwe.ciphertext.slice(1)}`;
  await assert.rejects(
    fixture.builder.open(tampered, fixture.trust, fixture.recipients[0], {
      workspaceId: supportWorkspace,
      runId: supportRun,
      now: supportNow
    }),
    { code: "VES_SUPPORT_SIGNATURE_INVALID" }
  );
});
