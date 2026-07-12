import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OpaqueKeyStore,
  inspectSupportBundle,
  planSupportBundle,
  qualifyPlatformKeyStore,
  sealRecipientEnvelope,
  verifyAndOpenRecipientEnvelope,
  authorizeSupportExport
} from "../src/crypto-bundles.mjs";

function recoveryManifest(overrides = {}) {
  return {
    workspaceId: "workspace-a",
    inclusion: ["runtime.sqlite", "memory.sqlite", "objects/abc"],
    exclusion: ["credential-values", "machine-authentication", "raw-probe-rows"],
    snapshotDigests: { runtime: "a".repeat(64), memory: "b".repeat(64) },
    expiresAt: "2030-01-01T00:00:00.000Z",
    ...overrides
  };
}

function stores() {
  const signer = new OpaqueKeyStore();
  signer.createSigningKey("release");
  const alice = new OpaqueKeyStore();
  const bob = new OpaqueKeyStore();
  alice.createRecipientKey("alice");
  bob.createRecipientKey("bob");
  return { signer, alice, bob };
}

test("Ed25519 signing verifies canonical structured content", () => {
  const store = new OpaqueKeyStore();
  store.createSigningKey("signer");
  const signature = store.sign("signer", { z: 1, a: 2 });
  assert.equal(OpaqueKeyStore.verify(store.publicSigningKey("signer"), { a: 2, z: 1 }, signature), true);
});

test("Ed25519 verification rejects content tampering and the wrong key", () => {
  const first = new OpaqueKeyStore();
  const second = new OpaqueKeyStore();
  first.createSigningKey("first");
  second.createSigningKey("second");
  const signature = first.sign("first", { release: "1.0.0" });
  assert.equal(OpaqueKeyStore.verify(first.publicSigningKey("first"), { release: "2.0.0" }, signature), false);
  assert.equal(OpaqueKeyStore.verify(second.publicSigningKey("second"), { release: "1.0.0" }, signature), false);
});

test("private signing and recipient keys are non-exportable through the adapter", () => {
  const store = new OpaqueKeyStore();
  store.createSigningKey("signer");
  store.createRecipientKey("recipient");
  assert.throws(() => store.exportPrivateKey("signer"), { code: "VES_PRIVATE_KEY_NON_EXPORTABLE" });
  assert.equal(JSON.stringify(store.describe()).includes("PRIVATE KEY"), false);
});

test("platform key store remains unavailable without complete attested controls", () => {
  assert.deepEqual(qualifyPlatformKeyStore({ platform: "win32" }), { platform: "win32", available: false, adapter: null });
  assert.throws(() => qualifyPlatformKeyStore({ platform: "win32", evidence: { digest: "a".repeat(64), controls: ["dpapi"] } }), { code: "VES_KEY_STORE_UNQUALIFIED" });
});

test("complete platform evidence selects the platform key-store adapter", () => {
  const fixtures = [
    ["win32", "windows-cng", ["cng-ksp", "non-exportable", "user-scope", "access-control"]],
    ["darwin", "apple-keychain", ["keychain", "non-exportable", "user-scope", "access-control"]],
    ["linux", "secret-service", ["secret-service", "locked-collection", "user-scope", "access-control"]]
  ];
  for (const [platform, adapter, controls] of fixtures) {
    assert.deepEqual(qualifyPlatformKeyStore({ platform, evidence: { digest: "d".repeat(64), controls } }), { platform, available: true, adapter, evidenceDigest: "d".repeat(64) });
  }
});

test("recipient envelope round-trips for every explicit recipient", () => {
  const { signer, alice, bob } = stores();
  const bundle = sealRecipientEnvelope({ plaintext: Buffer.from("recovery"), manifest: recoveryManifest(), recipients: [alice.publicRecipient("alice"), bob.publicRecipient("bob")], signer, signingKeyId: "release" });
  assert.equal(verifyAndOpenRecipientEnvelope({ bundle, recipientStore: alice, recipientId: "alice", now: new Date("2026-07-12") }).toString(), "recovery");
  assert.equal(verifyAndOpenRecipientEnvelope({ bundle, recipientStore: bob, recipientId: "bob", now: new Date("2026-07-12") }).toString(), "recovery");
});

test("wrong recipient cannot open an encrypted bundle", () => {
  const { signer, alice, bob } = stores();
  const bundle = sealRecipientEnvelope({ plaintext: Buffer.from("recovery"), manifest: recoveryManifest(), recipients: [alice.publicRecipient("alice")], signer, signingKeyId: "release" });
  assert.throws(() => verifyAndOpenRecipientEnvelope({ bundle, recipientStore: bob, recipientId: "bob", now: new Date("2026-07-12") }), { code: "VES_RECIPIENT_NOT_AUTHORIZED" });
});

test("ciphertext, authentication tag, wrapped key, or manifest tampering is rejected", () => {
  const fields = ["ciphertext", "tag"];
  for (const field of fields) {
    const { signer, alice } = stores();
    const bundle = sealRecipientEnvelope({ plaintext: Buffer.from("recovery"), manifest: recoveryManifest(), recipients: [alice.publicRecipient("alice")], signer, signingKeyId: "release" });
    bundle.payload[field] = "00";
    assert.throws(() => verifyAndOpenRecipientEnvelope({ bundle, recipientStore: alice, recipientId: "alice", now: new Date("2026-07-12") }), { code: "VES_BUNDLE_SIGNATURE_INVALID" });
  }
  const { signer, alice } = stores();
  const bundle = sealRecipientEnvelope({ plaintext: Buffer.from("recovery"), manifest: recoveryManifest(), recipients: [alice.publicRecipient("alice")], signer, signingKeyId: "release" });
  bundle.manifest.workspaceId = "workspace-b";
  assert.throws(() => verifyAndOpenRecipientEnvelope({ bundle, recipientStore: alice, recipientId: "alice", now: new Date("2026-07-12") }), { code: "VES_BUNDLE_SIGNATURE_INVALID" });
  const wrappedBundle = sealRecipientEnvelope({ plaintext: Buffer.from("recovery"), manifest: recoveryManifest(), recipients: [alice.publicRecipient("alice")], signer, signingKeyId: "release" });
  wrappedBundle.recipients[0].wrappedKey = "00";
  assert.throws(() => verifyAndOpenRecipientEnvelope({ bundle: wrappedBundle, recipientStore: alice, recipientId: "alice", now: new Date("2026-07-12") }), { code: "VES_BUNDLE_SIGNATURE_INVALID" });
});

test("expired recipient bundle is rejected before decryption", () => {
  const { signer, alice } = stores();
  const bundle = sealRecipientEnvelope({ plaintext: Buffer.from("recovery"), manifest: recoveryManifest({ expiresAt: "2026-01-01T00:00:00.000Z" }), recipients: [alice.publicRecipient("alice")], signer, signingKeyId: "release" });
  assert.throws(() => verifyAndOpenRecipientEnvelope({ bundle, recipientStore: alice, recipientId: "alice", now: new Date("2026-07-12") }), { code: "VES_BUNDLE_EXPIRED" });
});

test("recovery manifest rejects credential values, machine authentication, environment values, and raw rows", () => {
  for (const forbidden of [
    { credentialValue: "secret" }, { machineAuthentication: "token" }, { environmentValues: { PATH: "x" } }, { rawRows: [{ id: 1 }] }
  ]) {
    const { signer, alice } = stores();
    assert.throws(() => sealRecipientEnvelope({ plaintext: Buffer.from("recovery"), manifest: recoveryManifest(forbidden), recipients: [alice.publicRecipient("alice")], signer, signingKeyId: "release" }), { code: "VES_BUNDLE_PROHIBITED_CONTENT" });
  }
});

test("Support Bundle collection is allowlisted and excludes prohibited diagnostic content", () => {
  const plan = planSupportBundle({ version: "1.0.0", platform: "win32", health: "ok", source: "code", prompt: "secret", credentials: "secret", environmentValues: { PATH: "x" }, rawRows: [1], transcript: "secret", logs: "raw" }, ["version", "platform", "health"]);
  assert.deepEqual(plan.fields, { version: "1.0.0", platform: "win32", health: "ok" });
  assert.deepEqual(plan.excluded.sort(), ["credentials", "environmentValues", "logs", "prompt", "rawRows", "source", "transcript"]);
  assert.equal(plan.autoUpload, false);
});

test("prohibited Support Bundle fields remain excluded even if misconfigured into the allowlist", () => {
  const prohibited = ["source", "prompt", "context", "credentials", "environmentValues", "rawRows", "rawProbeOutput", "transcript", "rawStateDatabase", "logs"];
  const diagnostics = Object.fromEntries(prohibited.map((field) => [field, "secret"]));
  const plan = planSupportBundle(diagnostics, prohibited);
  assert.deepEqual(plan.fields, {});
  assert.deepEqual(plan.excluded, prohibited.slice().sort());
});

test("Support Bundle exposes an inspection manifest before export", () => {
  const plan = planSupportBundle({ version: "1.0.0", health: "ok" }, ["version", "health"]);
  const inspection = inspectSupportBundle(plan);
  assert.deepEqual(inspection, { digest: plan.digest, includedFields: ["health", "version"], excludedFields: [], redactionSummary: { prohibitedCollected: 0 }, autoUpload: false });
});

test("Support Bundle export requires state-bound Approval and Data Egress allow", () => {
  const plan = planSupportBundle({ version: "1.0.0" }, ["version"]);
  assert.throws(() => authorizeSupportExport(plan, { approvedDigest: "wrong", egress: "allow" }), { code: "VES_SUPPORT_APPROVAL_REQUIRED" });
  assert.throws(() => authorizeSupportExport(plan, { approvedDigest: plan.digest, egress: "deny" }), { code: "VES_SUPPORT_EGRESS_DENIED" });
  assert.deepEqual(authorizeSupportExport(plan, { approvedDigest: plan.digest, egress: "allow" }), { authorized: true, digest: plan.digest, uploadPerformed: false });
});
