import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ArtifactSealer,
  NodeEd25519Signer,
  RecoveryBundleBuilder,
  createTrustRoot
} from "../../packages/evidence/src/index.ts";
import { withHostileLocaleCompare } from "../helpers/hostile-locale.mjs";
import {
  bytes,
  recipient,
  recoveryDigest,
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

// Issue #58 signed-evidence vertical: the manifest's `objects` and `recipients`
// arrays were ordered with ambient `String.prototype.localeCompare`, so a
// bundle's `planId` depended on the collation of the sealing machine. Schema V2
// orders by UTF-16 code unit; schema V1 keeps its comparator because
// `validateManifestShape` re-sorts both arrays and recomputes `planId` on every
// read path (see `compareIdentity` in recovery-bundle.ts).

const mixedCaseObjects = () => [
  { objectId: "Runtime.sqlite", kind: "runtime-snapshot", bytes: bytes("runtime-safe-snapshot") },
  { objectId: "memory.sqlite", kind: "memory-snapshot", bytes: bytes("memory-safe-snapshot") },
  { objectId: "capsules/Run.json", kind: "run-capsule", bytes: bytes("signed-run-capsule") }
];

async function versionedPlan(schemaVersion, recipients) {
  const signer = NodeEd25519Signer.generate({ keyId: "recovery-signer", purposes: ["recovery-bundle"] });
  const sealer = new ArtifactSealer({ signer, now: () => new Date(recoveryNow) });
  const builder = new RecoveryBundleBuilder({ sealer });
  const objects = mixedCaseObjects();
  const planInput = {
    workspaceId: recoveryWorkspace,
    snapshotBarrierId: "barrier:001",
    runtimeStateDigest: recoveryDigest("runtime-state"),
    memoryStateDigest: recoveryDigest("memory-state"),
    sourceStateDigest: recoveryDigest("source-state"),
    policyDigest: recoveryDigest("policy"),
    approvalBindingDigest: recoveryDigest("approval"),
    claimDigest: recoveryDigest("claim"),
    releaseDigest: recoveryDigest("release"),
    includedClasses: ["runtime", "memory", "evidence"],
    excludedClasses: [
      "credential-values",
      "machine-authentication",
      "provider-sessions",
      "secret-values",
      "vector-indexes"
    ],
    logicalSecretBindings: ["database.primary"],
    uncertainEffectIds: ["effect:remote-001"],
    objects,
    recipients: recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey })),
    createdAt: recoveryNow,
    expiresAt: "2026-07-16T20:00:00.000Z",
    ...(schemaVersion === undefined ? {} : { schemaVersion })
  };
  const plan = await builder.plan(planInput);
  const trust = createTrustRoot({ trustRootId: "recovery-root", version: 1, keys: [signer.publicKeyRef] });
  return { builder, plan, objects, trust, planInput };
}

test("schemaVersion: 2 recovery plan identity is byte-identical across two divergent locale collations", async () => {
  const recipients = [await recipient("Alice"), await recipient("bob")];
  const plain = await versionedPlan(2, recipients);
  const hostile = await withHostileLocaleCompare(() => versionedPlan(2, recipients));
  assert.equal(plain.plan.planId, hostile.plan.planId);
  // Code-unit order specifically: uppercase precedes lowercase in UTF-16.
  assert.deepEqual(
    plain.plan.manifest.objects.map((entry) => entry.objectId),
    ["Runtime.sqlite", "capsules/Run.json", "memory.sqlite"]
  );
  assert.deepEqual(
    plain.plan.manifest.recipients.map((entry) => entry.recipientId),
    ["Alice", "bob"]
  );
});

test("a schemaVersion: 2 bundle inspects and opens under a hostile collation", async () => {
  const recipients = [await recipient("Alice"), await recipient("bob")];
  const { builder, plan, objects, trust } = await versionedPlan(2, recipients);
  const bundle = await builder.build(
    plan,
    objects,
    recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey }))
  );
  const inspected = await withHostileLocaleCompare(() =>
    builder.inspect(bundle, trust, { workspaceId: recoveryWorkspace, now: recoveryNow })
  );
  assert.equal(inspected.planId, plan.planId);
  const opened = await withHostileLocaleCompare(() =>
    builder.open(bundle, trust, recipients[0], { workspaceId: recoveryWorkspace, now: recoveryNow })
  );
  assert.equal(opened.objects.length, 3);
});

test("a stored schemaVersion: 1 bundle still inspects and opens unchanged", async () => {
  const recipients = [await recipient("Alice"), await recipient("bob")];
  const { builder, plan, objects, trust } = await versionedPlan(1, recipients);
  assert.equal(plan.manifest.schemaVersion, 1);
  const bundle = await builder.build(
    plan,
    objects,
    recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey }))
  );
  assert.equal(bundle.schema.version, 1);
  const inspected = await builder.inspect(bundle, trust, { workspaceId: recoveryWorkspace, now: recoveryNow });
  assert.equal(inspected.planId, plan.planId);
  const opened = await builder.open(bundle, trust, recipients[0], {
    workspaceId: recoveryWorkspace,
    now: recoveryNow
  });
  assert.equal(opened.objects.length, 3);
  // V1 retains ambient collation, which is precisely why it could not be
  // normalized: re-sorting under a different collation no longer reproduces
  // the stored planId.
  await assert.rejects(
    withHostileLocaleCompare(() =>
      builder.inspect(bundle, trust, { workspaceId: recoveryWorkspace, now: recoveryNow })
    ),
    { code: "VES_RECOVERY_INVALID" }
  );
});

test("RecoveryBundleBuilder.plan() defaults to schemaVersion: 2 when the caller omits it", async () => {
  const recipients = [await recipient("Alice")];
  const { plan } = await versionedPlan(undefined, recipients);
  assert.equal(plan.manifest.schemaVersion, 2);
});

test("an explicit schemaVersion: 1 recovery plan is never silently upgraded", async () => {
  const recipients = [await recipient("Alice")];
  const { plan } = await versionedPlan(1, recipients);
  assert.equal(plan.manifest.schemaVersion, 1);
});

test("an unknown recovery schemaVersion fails closed rather than defaulting", async () => {
  const recipients = [await recipient("Alice")];
  for (const schemaVersion of [0, 3, "2", null]) {
    await assert.rejects(versionedPlan(schemaVersion, recipients), { code: "VES_RECOVERY_INVALID" });
  }
});

test("a schemaVersion: 1 bundle cannot be reinterpreted as V2, or the reverse", async () => {
  const recipients = [await recipient("Alice"), await recipient("bob")];
  const v1 = await versionedPlan(1, recipients);
  const v2 = await versionedPlan(2, recipients);
  // The version is part of the digested manifest material, so the two plans are
  // different identities even though every other field is equal.
  assert.notEqual(v1.plan.planId, v2.plan.planId);
  const bundle = await v1.builder.build(
    v1.plan,
    v1.objects,
    recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey }))
  );
  // Relabelling the manifest's schemaVersion breaks its own plan identity
  // before any signature check can be reached.
  const relabelled = {
    ...bundle,
    payload: { ...bundle.payload, manifest: { ...bundle.payload.manifest, schemaVersion: 2 } }
  };
  await assert.rejects(v1.builder.inspect(relabelled, v1.trust, { workspaceId: recoveryWorkspace, now: recoveryNow }), {
    code: "VES_RECOVERY_SIGNATURE_INVALID"
  });
});
