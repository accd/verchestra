import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import { NodeEd25519Signer } from "../../packages/evidence/src/index.ts";
import {
  signQualificationEvidenceIndex,
  signedQualificationEvidenceIndex,
  verifyQualificationEvidenceIndex
} from "../../scripts/t75-evidence-attestation.mjs";

const revision = "a".repeat(40);
const purpose = "qualification-evidence-index";

function index() {
  const body = {
    schemaVersion: 1,
    canonicalizationVersion: 2,
    task: "T75",
    revision,
    summary: { cases: 52, qualified: 42, contractQualified: 8, notQualified: 2, environmental: 0, contradictions: 0 },
    digestProvenance: { identityDigest: "recomputed", legDigest: "recomputed for passing legs" },
    dimensions: [],
    profiles: []
  };
  return {
    ...body,
    bodyDigest: `sha256:${createHash("sha256").update(canonicalizeJsonV2(body)).digest("hex")}`,
    signingState: { signed: false, reason: "test fixture only" }
  };
}

function fixture() {
  const signer = NodeEd25519Signer.generate({ keyId: "qualification-test-2026", purposes: [purpose] });
  return {
    index: index(),
    publicKeyRef: signer.publicKeyRef,
    protectedEnvironment: Object.freeze({
      VESTRA_T75_EVIDENCE_SIGNING_KEY_PKCS8_BASE64: Buffer.from(signer.exportPkcs8()).toString("base64")
    })
  };
}

test("a protected PKCS#8 Ed25519 key produces an externally verifiable qualification-index DSSE envelope", async () => {
  const input = fixture();
  const envelope = await signQualificationEvidenceIndex({
    ...input,
    revision,
    issuedAt: "2026-08-22T21:10:00.000Z"
  });
  assert.deepEqual(Object.keys(envelope).sort(), ["payload", "payloadType", "signatures"]);
  assert.equal(envelope.signatures[0].keyid, input.publicKeyRef.keyId);
  assert.equal(
    JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8")).predicateType,
    "https://accd.github.io/verchestra/attestation/qualification-evidence-index/v1"
  );
  assert.equal(
    verifyQualificationEvidenceIndex({ index: input.index, envelope, publicKeyRef: input.publicKeyRef, revision }),
    true
  );
  const signed = signedQualificationEvidenceIndex({
    index: input.index,
    envelope,
    publicKeyRef: input.publicKeyRef,
    revision
  });
  assert.equal(signed.signingState.signed, true);
  assert.equal(
    verifyQualificationEvidenceIndex({ index: signed, envelope, publicKeyRef: input.publicKeyRef, revision }),
    true,
    "the published signed index remains bound to the independently verified envelope"
  );
});

test("the verifier rejects one-field changes to the index, candidate, predicate, or key identity", async () => {
  const input = fixture();
  const envelope = await signQualificationEvidenceIndex({
    ...input,
    revision,
    issuedAt: "2026-08-22T21:10:00.000Z"
  });
  const statement = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
  const changedIndex = { ...input.index, summary: { ...input.index.summary, qualified: 41 } };
  const other = NodeEd25519Signer.generate({ keyId: input.publicKeyRef.keyId, purposes: [purpose] });
  for (const [name, candidate] of [
    ["index", { index: changedIndex, envelope, publicKeyRef: input.publicKeyRef, revision }],
    ["revision", { index: input.index, envelope, publicKeyRef: input.publicKeyRef, revision: "b".repeat(40) }],
    [
      "predicate",
      {
        index: input.index,
        envelope: {
          ...envelope,
          payload: Buffer.from(JSON.stringify({ ...statement, predicateType: "https://example.invalid" })).toString(
            "base64"
          )
        },
        publicKeyRef: input.publicKeyRef,
        revision
      }
    ],
    ["key", { index: input.index, envelope, publicKeyRef: other.publicKeyRef, revision }]
  ])
    assert.equal(verifyQualificationEvidenceIndex(candidate), false, name);
});

test("missing protected configuration and a mismatched public reference fail before an envelope is returned", async () => {
  const input = fixture();
  await assert.rejects(
    signQualificationEvidenceIndex({
      ...input,
      protectedEnvironment: {},
      revision,
      issuedAt: "2026-08-22T21:10:00.000Z"
    }),
    /protected signing key is not configured/u
  );
  const other = NodeEd25519Signer.generate({ keyId: "other-key", purposes: [purpose] });
  await assert.rejects(
    signQualificationEvidenceIndex({
      ...input,
      publicKeyRef: other.publicKeyRef,
      revision,
      issuedAt: "2026-08-22T21:10:00.000Z"
    }),
    /does not match the committed public reference/u
  );
});
