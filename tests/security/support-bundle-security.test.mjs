import assert from "node:assert/strict";
import { test } from "node:test";

import { ProhibitedContentScanner, sha256Digest } from "../../packages/evidence/src/index.ts";
import { withHostileLocaleCompare } from "../helpers/hostile-locale.mjs";
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

// Issue #58 signed-evidence vertical. Unlike the Run Capsule and the Recovery
// Bundle, the Support Bundle's ambient-locale sorts were removed outright with
// no version gate: `#assertPlan` — the only verifier, reached from `inspect`,
// `authorizedBuild` and `open` — already required `fieldIds` and `recipientIds`
// to equal `[...].sort()`, i.e. default UTF-16 code-unit order. `plan()` sorting
// with `localeCompare` therefore contradicted the contract its own validator
// enforced, and under a divergent collation produced a manifest that was
// immediately rejected.

test("a plan built under a hostile collation validates, orders by code unit, and can be exported", async () => {
  // Against the pre-migration source this fails at `inspect()` with
  // VES_SUPPORT_INVALID "Support Bundle diagnostic order is not canonical":
  // plan() ordered with localeCompare while #assertPlan required code-unit
  // order, so the builder rejected its own output.
  const recipients = [await recipient("Support-Team"), await recipient("auditor")];
  const { builder, plan, inspection } = await withHostileLocaleCompare(() => supportHarness({ recipients }));
  assert.equal(inspection.planId, plan.planId);
  assert.deepEqual(
    plan.manifest.diagnostics.map((entry) => entry.fieldId),
    [...plan.manifest.diagnostics.map((entry) => entry.fieldId)].sort()
  );
  // Code-unit order specifically: uppercase precedes lowercase in UTF-16.
  assert.deepEqual(
    plan.manifest.recipients.map((entry) => entry.recipientId),
    ["Support-Team", "auditor"]
  );
  const { ports } = supportExportPorts();
  const exported = await supportCoordinator(builder, ports).export(
    plan,
    inspection,
    recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey })),
    { approvalRef: "approval:support:001", destinationId: "destination:vendor" }
  );
  assert.equal(exported.status, "published");
});

test("Support Bundle plan identity is byte-identical across two divergent locale collations", async () => {
  const recipients = [await recipient("Support-Team"), await recipient("auditor")];
  const plain = await supportHarness({ recipients });
  const hostile = await withHostileLocaleCompare(() => supportHarness({ recipients }));
  assert.equal(plain.plan.planId, hostile.plan.planId);
  assert.equal(plain.inspection.inspectionDigest, hostile.inspection.inspectionDigest);
});

test("SupportBundleBuilder.plan() defaults to schemaVersion: 2 when the caller omits it", async () => {
  const { builder, input } = await supportHarness();
  const { schemaVersion, ...withoutVersion } = input;
  assert.equal(schemaVersion, 1);
  const plan = await builder.plan(withoutVersion);
  assert.equal(plan.manifest.schemaVersion, 2);
});

test("an explicit schemaVersion: 1 Support Bundle is never silently upgraded", async () => {
  const { plan } = await supportHarness();
  assert.equal(plan.manifest.schemaVersion, 1);
});

test("an unknown Support Bundle schemaVersion fails closed rather than defaulting", async () => {
  const { builder, input } = await supportHarness();
  for (const schemaVersion of [0, 3, "2", null]) {
    await assert.rejects(builder.plan({ ...input, schemaVersion }), { code: "VES_SUPPORT_INVALID" });
  }
});

test("a stored schemaVersion: 1 Support Bundle still exports and opens unchanged", async () => {
  const recipients = [await recipient("support-team")];
  const { builder, plan, inspection, trust } = await supportHarness({ recipients });
  assert.equal(plan.manifest.schemaVersion, 1);
  const { state, ports } = supportExportPorts();
  await supportCoordinator(builder, ports).export(
    plan,
    inspection,
    recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey })),
    { approvalRef: "approval:support:001", destinationId: "destination:vendor" }
  );
  const bundle = state.published.bundle;
  assert.equal(bundle.schema.version, 1);
  const manifest = await builder.open(bundle, trust, recipients[0], {
    workspaceId: supportWorkspace,
    runId: supportRun,
    now: supportNow
  });
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.planId, plan.planId);
});

test("a schemaVersion: 2 Support Bundle exports, opens, and is a distinct identity from V1", async () => {
  const recipients = [await recipient("support-team")];
  const v1 = await supportHarness({ recipients });
  const v2 = await supportHarness({ recipients, input: { schemaVersion: 2 } });
  assert.equal(v2.plan.manifest.schemaVersion, 2);
  // The version is part of the digested manifest material, so V1 and V2 of an
  // otherwise identical bundle are different plan identities.
  assert.notEqual(v1.plan.planId, v2.plan.planId);
  const { state, ports } = supportExportPorts();
  await supportCoordinator(v2.builder, ports).export(
    v2.plan,
    v2.inspection,
    recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey })),
    { approvalRef: "approval:support:001", destinationId: "destination:vendor" }
  );
  const bundle = state.published.bundle;
  assert.equal(bundle.schema.version, 2);
  const manifest = await v2.builder.open(bundle, v2.trust, recipients[0], {
    workspaceId: supportWorkspace,
    runId: supportRun,
    now: supportNow
  });
  assert.equal(manifest.schemaVersion, 2);
});

test("a Support Bundle summary relabelled to another schemaVersion fails closed", async () => {
  const recipients = [await recipient("support-team")];
  const { builder, plan, inspection, trust } = await supportHarness({ recipients });
  const { state, ports } = supportExportPorts();
  await supportCoordinator(builder, ports).export(
    plan,
    inspection,
    recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey })),
    { approvalRef: "approval:support:001", destinationId: "destination:vendor" }
  );
  const bundle = state.published.bundle;
  const relabelled = {
    ...bundle,
    payload: { ...bundle.payload, summary: { ...bundle.payload.summary, schemaVersion: 2 } }
  };
  await assert.rejects(
    builder.open(relabelled, trust, recipients[0], {
      workspaceId: supportWorkspace,
      runId: supportRun,
      now: supportNow
    }),
    { code: "VES_SUPPORT_SIGNATURE_INVALID" }
  );
});
