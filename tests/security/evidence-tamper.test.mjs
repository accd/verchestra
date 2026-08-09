import assert from "node:assert/strict";
import { test } from "node:test";

import { ArtifactSealer, NodeEd25519Signer, createTrustRoot } from "../../packages/evidence/src/index.ts";

const binding = Object.freeze({
  schema: { name: "execution-package", version: 1 },
  purpose: "execution-package",
  bindingId: "handoff:team-a:VES-42",
  sourceStateDigest: "c".repeat(64)
});

const expected = Object.freeze({
  ...binding,
  now: new Date("2026-07-13T10:01:00.000Z")
});

async function fixture() {
  const signer = NodeEd25519Signer.generate({
    keyId: "release-key-1",
    purposes: ["execution-package", "run-capsule"]
  });
  const sealer = new ArtifactSealer({
    signer,
    now: () => new Date("2026-07-13T10:00:00.000Z")
  });
  const artifact = await sealer.seal({ task: "T12", approved: true }, binding);
  const trust = createTrustRoot({
    trustRootId: "team-a",
    version: 1,
    keys: [signer.publicKeyRef]
  });
  return { artifact, sealer, signer, trust };
}

test("valid artifact verifies with full binding", async () => {
  const { artifact, sealer, trust } = await fixture();
  assert.deepEqual(await sealer.verify(artifact, trust, expected), {
    ok: true,
    artifactId: artifact.artifactId,
    keyId: artifact.keyId
  });
});

test("verification is idempotent within the same receiver binding", async () => {
  const { artifact, sealer, trust } = await fixture();
  const first = await sealer.verify(artifact, trust, expected);
  const second = await sealer.verify(artifact, trust, expected);
  assert.deepEqual(second, first);
});

test("tampered payload is rejected", async () => {
  const { artifact, sealer, trust } = await fixture();
  const result = await sealer.verify(
    { ...artifact, payload: { ...artifact.payload, approved: false } },
    trust,
    expected
  );
  assert.deepEqual(result, { ok: false, code: "VES_INTEGRITY_PAYLOAD_DIGEST_MISMATCH" });
});

test("tampered payload digest is rejected", async () => {
  const { artifact, sealer, trust } = await fixture();
  const result = await sealer.verify({ ...artifact, payloadDigest: "d".repeat(64) }, trust, expected);
  assert.deepEqual(result, { ok: false, code: "VES_INTEGRITY_PAYLOAD_DIGEST_MISMATCH" });
});

test("tampered artifact id is rejected", async () => {
  const { artifact, sealer, trust } = await fixture();
  const result = await sealer.verify({ ...artifact, artifactId: "e".repeat(64) }, trust, expected);
  assert.deepEqual(result, { ok: false, code: "VES_INTEGRITY_ARTIFACT_ID_MISMATCH" });
});

test("tampered signature is rejected", async () => {
  const { artifact, sealer, trust } = await fixture();
  const sig = artifact.dsse.signatures[0].sig;
  const replacement = sig[0] === "A" ? "B" : "A";
  const result = await sealer.verify(
    {
      ...artifact,
      dsse: { ...artifact.dsse, signatures: [{ ...artifact.dsse.signatures[0], sig: `${replacement}${sig.slice(1)}` }] }
    },
    trust,
    expected
  );
  assert.deepEqual(result, { ok: false, code: "VES_SIGNATURE_INVALID" });
});

// AD-014 rejects rather than dual-verifies. These four cases are the envelope's
// own fail-closed contract; without them a naive implementation that signs raw
// payload bytes, or accepts any predicate it is handed, passes every
// happy-path test in this file.
test("a legacy pre-DSSE artifact is refused outright", async () => {
  const { artifact, sealer, trust } = await fixture();
  const { dsse, ...legacy } = artifact;
  const result = await sealer.verify(
    { ...legacy, envelopeVersion: 1, signature: dsse.signatures[0].sig },
    trust,
    expected
  );
  assert.deepEqual(result, { ok: false, code: "VES_ENVELOPE_UNSUPPORTED" });
});

test("a payload type other than in-toto is refused", async () => {
  const { artifact, sealer, trust } = await fixture();
  const result = await sealer.verify(
    { ...artifact, dsse: { ...artifact.dsse, payloadType: "application/json" } },
    trust,
    expected
  );
  assert.deepEqual(result, { ok: false, code: "VES_ENVELOPE_UNSUPPORTED" });
});

test("a payload that is not an in-toto Statement is refused", async () => {
  const { artifact, sealer, trust } = await fixture();
  const notAStatement = Buffer.from(JSON.stringify({ _type: "https://example.invalid/Other/v1" }), "utf8");
  const result = await sealer.verify(
    { ...artifact, dsse: { ...artifact.dsse, payload: notAStatement.toString("base64") } },
    trust,
    expected
  );
  assert.deepEqual(result, { ok: false, code: "VES_ENVELOPE_UNSUPPORTED" });
});

test("an artifact claiming an undeclared kind is refused", async () => {
  // The predicate type set is closed: an attestation this product cannot name
  // is one it will not verify. Such an artifact cannot be sealed either, so it
  // is constructed by hand here — which is exactly how a forged one would
  // arrive.
  const { artifact, sealer, trust } = await fixture();
  const result = await sealer.verify({ ...artifact, schema: { name: "not-a-declared-kind", version: 1 } }, trust, {
    ...expected,
    schema: { name: "not-a-declared-kind", version: 1 }
  });
  assert.deepEqual(result, { ok: false, code: "VES_ENVELOPE_UNSUPPORTED" });
});

test("sealing an undeclared kind is refused rather than minting a predicate type", async () => {
  const { sealer } = await fixture();
  await assert.rejects(
    sealer.seal(
      { any: "payload" },
      { schema: { name: "invented-kind", version: 1 }, purpose: "x", bindingId: "b", sourceStateDigest: "a".repeat(64) }
    ),
    { code: "VES_INTEGRITY_INVALID_BINDING" }
  );
});

test("a key id that disagrees with the envelope signature is refused", async () => {
  // Under DSSE the key id lives in signatures[].keyid, which is envelope
  // metadata rather than Statement content — so the content address cannot
  // cover it the way the pre-DSSE digest did. Without this binding a swapped
  // flat keyId would only be caught by the trust lookup, and not at all by the
  // storage-integrity checks that run without a trust root.
  const { artifact, sealer, trust } = await fixture();
  const result = await sealer.verify({ ...artifact, keyId: "some-other-key" }, trust, expected);
  assert.deepEqual(result, { ok: false, code: "VES_ENVELOPE_UNSUPPORTED" });
});

test("a projection that disagrees with the signed Statement is refused", async () => {
  // The flat fields are a decoded convenience, not a second source of truth.
  // Editing one without re-signing must fail rather than be believed.
  const { artifact, sealer, trust } = await fixture();
  const result = await sealer.verify({ ...artifact, issuedAt: "2001-01-01T00:00:00.000Z" }, trust, expected);
  assert.deepEqual(result, { ok: false, code: "VES_ENVELOPE_UNSUPPORTED" });
});

test("unknown signing key is rejected", async () => {
  const { artifact, sealer } = await fixture();
  const other = NodeEd25519Signer.generate({ keyId: "other", purposes: [binding.purpose] });
  const trust = createTrustRoot({ trustRootId: "other", version: 1, keys: [other.publicKeyRef] });
  assert.deepEqual(await sealer.verify(artifact, trust, expected), {
    ok: false,
    code: "VES_TRUST_KEY_UNKNOWN"
  });
});

test("same key id with the wrong public key cannot verify", async () => {
  const { artifact, sealer } = await fixture();
  const impostor = NodeEd25519Signer.generate({
    keyId: artifact.keyId,
    purposes: [binding.purpose]
  });
  const trust = createTrustRoot({
    trustRootId: "impostor",
    version: 1,
    keys: [impostor.publicKeyRef]
  });
  assert.deepEqual(await sealer.verify(artifact, trust, expected), {
    ok: false,
    code: "VES_SIGNATURE_INVALID"
  });
});

test("revoked signing key is rejected", async () => {
  const { artifact, sealer, signer } = await fixture();
  const trust = createTrustRoot({
    trustRootId: "team-a",
    version: 2,
    keys: [signer.publicKeyRef],
    revokedKeyIds: [signer.publicKeyRef.keyId]
  });
  assert.deepEqual(await sealer.verify(artifact, trust, expected), {
    ok: false,
    code: "VES_TRUST_KEY_REVOKED"
  });
});

test("key whose purpose does not match is rejected", async () => {
  const { artifact, sealer, signer } = await fixture();
  const trust = createTrustRoot({
    trustRootId: "team-a",
    version: 1,
    keys: [{ ...signer.publicKeyRef, purposes: ["run-capsule"] }]
  });
  assert.deepEqual(await sealer.verify(artifact, trust, expected), {
    ok: false,
    code: "VES_TRUST_PURPOSE_DENIED"
  });
});

test("wrong expected schema is rejected before use", async () => {
  const { artifact, sealer, trust } = await fixture();
  const result = await sealer.verify(artifact, trust, {
    ...expected,
    schema: { name: "execution-package", version: 2 }
  });
  assert.deepEqual(result, { ok: false, code: "VES_INTEGRITY_SCHEMA_MISMATCH" });
});

test("wrong expected purpose is rejected before use", async () => {
  const { artifact, sealer, trust } = await fixture();
  const result = await sealer.verify(artifact, trust, { ...expected, purpose: "run-capsule" });
  assert.deepEqual(result, { ok: false, code: "VES_INTEGRITY_PURPOSE_MISMATCH" });
});

test("changed source state invalidates approval deterministically", async () => {
  const { artifact, sealer, trust } = await fixture();
  const result = await sealer.verify(artifact, trust, {
    ...expected,
    sourceStateDigest: "f".repeat(64)
  });
  assert.deepEqual(result, { ok: false, code: "VES_INTEGRITY_SOURCE_STATE_MISMATCH" });
});

test("cross-context replay is rejected by receiver binding", async () => {
  const { artifact, sealer, trust } = await fixture();
  const result = await sealer.verify(artifact, trust, {
    ...expected,
    bindingId: "handoff:team-b:VES-42"
  });
  assert.deepEqual(result, { ok: false, code: "VES_INTEGRITY_BINDING_MISMATCH" });
});

test("key used before its validity window is rejected", async () => {
  const { artifact, sealer, signer } = await fixture();
  const trust = createTrustRoot({
    trustRootId: "team-a",
    version: 1,
    keys: [{ ...signer.publicKeyRef, validFrom: "2026-07-14T00:00:00.000Z" }]
  });
  assert.deepEqual(await sealer.verify(artifact, trust, expected), {
    ok: false,
    code: "VES_TRUST_KEY_NOT_YET_VALID"
  });
});

test("expired key is rejected", async () => {
  const { artifact, sealer, signer } = await fixture();
  const trust = createTrustRoot({
    trustRootId: "team-a",
    version: 1,
    keys: [{ ...signer.publicKeyRef, validUntil: "2026-07-12T00:00:00.000Z" }]
  });
  assert.deepEqual(await sealer.verify(artifact, trust, expected), {
    ok: false,
    code: "VES_TRUST_KEY_EXPIRED"
  });
});

test("malformed public key fails closed with a stable code", async () => {
  const { artifact, sealer, signer } = await fixture();
  const trust = createTrustRoot({
    trustRootId: "team-a",
    version: 1,
    keys: [{ ...signer.publicKeyRef, publicKey: "not-a-public-key" }]
  });
  assert.deepEqual(await sealer.verify(artifact, trust, expected), {
    ok: false,
    code: "VES_TRUST_KEY_INVALID"
  });
});

test("duplicate key ids make a trust root invalid", async () => {
  const { signer } = await fixture();
  assert.throws(
    () =>
      createTrustRoot({
        trustRootId: "team-a",
        version: 1,
        keys: [signer.publicKeyRef, signer.publicKeyRef]
      }),
    { code: "VES_TRUST_ROOT_INVALID" }
  );
});

test("trust root snapshots key metadata against later mutation", async () => {
  const { signer } = await fixture();
  const mutableKey = { ...signer.publicKeyRef, purposes: ["execution-package"] };
  const trust = createTrustRoot({ trustRootId: "team-a", version: 1, keys: [mutableKey] });
  mutableKey.purposes[0] = "run-capsule";
  mutableKey.publicKey = "replaced";
  assert.equal(trust.keys[0].purposes[0], "execution-package");
  assert.equal(trust.keys[0].publicKey, signer.publicKeyRef.publicKey);
  assert.throws(() => trust.keys[0].purposes.push("run-capsule"), TypeError);
});
