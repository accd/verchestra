import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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

// why: #408 rotated the evidence key. The retired reference keeps its key and
// gains `validUntil`, so it verifies what it signed before that instant and
// signs nothing after it, whatever `issuedAt` a caller asserts.
const RETIRED_AT = "2026-09-30T21:25:00.000Z";

test("a retired reference verifies what it signed before retirement and signs nothing new", async () => {
  const input = fixture();
  const retired = { ...input.publicKeyRef, validUntil: RETIRED_AT };
  const before = await signQualificationEvidenceIndex({
    ...input,
    revision,
    issuedAt: "2026-08-25T18:41:00.000Z",
    now: new Date("2026-08-25T18:41:00.000Z")
  });
  assert.equal(
    verifyQualificationEvidenceIndex({ index: input.index, envelope: before, publicKeyRef: retired, revision }),
    true
  );
  const after = await signQualificationEvidenceIndex({
    ...input,
    revision,
    issuedAt: "2026-10-01T00:00:00.000Z",
    now: new Date("2026-10-01T00:00:00.000Z")
  });
  assert.equal(
    verifyQualificationEvidenceIndex({ index: input.index, envelope: after, publicKeyRef: retired, revision }),
    false,
    "an attestation issued after retirement does not verify under the retired reference"
  );
  for (const [issuedAt, now] of [
    ["2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"],
    // hazard: a backdated issuedAt must not reopen the window on a later clock.
    ["2026-08-25T18:41:00.000Z", "2026-10-01T00:00:00.000Z"]
  ])
    await assert.rejects(
      signQualificationEvidenceIndex({ ...input, publicKeyRef: retired, revision, issuedAt, now: new Date(now) }),
      /retired or not yet valid and admits no new signature/u
    );
});

test("the committed T75 evidence verifies under its retired anchor, not the rotated one, which signs nothing new", async () => {
  const read = (path) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));
  const feature = ".specs/features/platform-qualification-matrix/";
  const committed = {
    index: read(`${feature}signed-evidence-index.json`),
    envelope: read(`${feature}qualification-evidence-index.dsse.json`),
    revision: "be92397ca0a5caaf7ff8b70dad23659b09899d7d"
  };
  const retired = read("docs/qualification/trust/retired/t75-evidence-20260825.json");
  const active = read("docs/qualification/trust/t75-evidence-public-key.json");
  assert.equal(verifyQualificationEvidenceIndex({ ...committed, publicKeyRef: retired }), true);
  assert.equal(verifyQualificationEvidenceIndex({ ...committed, publicKeyRef: active }), false);
  await assert.rejects(
    signQualificationEvidenceIndex({
      index: index(),
      publicKeyRef: retired,
      revision,
      issuedAt: "2026-08-25T18:41:00.000Z",
      protectedEnvironment: {}
    }),
    /retired or not yet valid and admits no new signature/u
  );
});
