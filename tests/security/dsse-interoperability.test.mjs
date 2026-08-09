import assert from "node:assert/strict";
import { createPublicKey, verify as verifyBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  ArtifactSealer,
  FileExecutionPackageStore,
  NodeEd25519Signer,
  dsseEnvelopeOf,
  sealedArtifactFromEnvelope
} from "../../packages/evidence/src/index.ts";
import { executionHarness, packageInput } from "../helpers/execution-package-fixture.mjs";

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const temporary = async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-dsse-interop-"));
  roots.push(root);
  return root;
};

// AD-014's stated benefit is that an enterprise can verify a Verchestra
// artifact with tooling it already runs. That claim is only true if the thing
// on disk is a DSSE envelope and nothing else, and if its signature checks out
// against the standard Pre-Authentication Encoding without any Verchestra
// code in the loop. This file is written from the outside for exactly that
// reason: it deliberately does NOT use the sealer to verify.

const pae = (payloadType, payload) => {
  const type = Buffer.from(payloadType, "utf8");
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${type.length} `, "utf8"),
    type,
    Buffer.from(` ${payload.length} `, "utf8"),
    payload
  ]);
};

test("a persisted artifact is a bare DSSE envelope and nothing else", async () => {
  const root = await temporary();
  const { builder } = executionHarness();
  const sealed = await builder.build(packageInput());
  await new FileExecutionPackageStore({ root }).put(sealed);

  const onDisk = JSON.parse(await readFile(join(root, `${sealed.artifactId}.json`), "utf8"));
  // No flat projection beside the envelope: an external tool is handed the file
  // and needs no Verchestra-specific extraction step.
  assert.deepEqual(Object.keys(onDisk).sort(), ["payload", "payloadType", "signatures"]);
  assert.equal(onDisk.payloadType, "application/vnd.in-toto+json");
});

test("an outside verifier checks the signature with only the standard envelope", async () => {
  const root = await temporary();
  const signer = NodeEd25519Signer.generate({ keyId: "release-key", purposes: ["execution-package"] });
  const sealer = new ArtifactSealer({ signer, now: () => new Date("2026-07-13T10:00:00.000Z") });
  const sealed = await sealer.seal(
    { plan: ["build"] },
    {
      schema: { name: "execution-package", version: 1 },
      purpose: "execution-package",
      bindingId: "ticket:VES-42",
      sourceStateDigest: "a".repeat(64)
    }
  );
  await new FileExecutionPackageStore({ root }).put(sealed);
  const envelope = JSON.parse(await readFile(join(root, `${sealed.artifactId}.json`), "utf8"));

  // Everything below is generic DSSE: decode the payload, rebuild the PAE,
  // check Ed25519. No sealer, no projection, no repository types.
  const payload = Buffer.from(envelope.payload, "base64");
  const publicKey = createPublicKey({
    key: Buffer.from(signer.publicKeyRef.publicKey, "base64url"),
    type: "spki",
    format: "der"
  });
  assert.equal(
    verifyBytes(
      null,
      pae(envelope.payloadType, payload),
      publicKey,
      Buffer.from(envelope.signatures[0].sig, "base64url")
    ),
    true,
    "the envelope must verify under a generic DSSE implementation"
  );

  const statement = JSON.parse(payload.toString("utf8"));
  assert.equal(statement._type, "https://in-toto.io/Statement/v1");
  assert.equal(statement.predicateType, "https://accd.github.io/verchestra/attestation/execution-package/v1");
  assert.equal(statement.subject[0].digest.sha256, sealed.payloadDigest);
});

// The read path derives every flat field from the envelope, so a forged or
// corrupted file must fail closed rather than produce a plausible artifact.
//
// Each forgery below changes exactly ONE thing away from a genuine envelope.
// That is deliberate: a blunt forgery (garbage payload, wrong everything) trips
// several guards at once and returns the same code whichever fires first, so
// removing any single guard would leave the test passing. Surgical inputs make
// each guard individually falsifiable — the repository already recorded this as
// lesson L-001 after the same trap in the safe-init work.
const reencode = (envelope, statement) => ({
  ...envelope,
  payload: Buffer.from(JSON.stringify(statement), "utf8").toString("base64")
});

const forgeries = {
  "payload type that is not in-toto": (envelope) => ({ ...envelope, payloadType: "application/json" }),
  "payload that is not decodable JSON": (envelope) => ({ ...envelope, payload: "}{not-json" }),
  "no signature at all": (envelope) => ({ ...envelope, signatures: [] }),
  "two signatures where the envelope admits one": (envelope) => ({
    ...envelope,
    signatures: [envelope.signatures[0], envelope.signatures[0]]
  }),
  "a statement type that is not in-toto": (envelope, statement) =>
    reencode(envelope, { ...statement, _type: "https://example.invalid/Other/v1" }),
  "a predicate type that does not match the sealed kind": (envelope, statement) =>
    reencode(envelope, { ...statement, predicateType: "https://accd.github.io/verchestra/attestation/run-capsule/v1" }),
  "a subject with no payload digest": (envelope, statement) =>
    reencode(envelope, { ...statement, subject: [{ name: "execution-package", digest: {} }] })
};

test("each single-field forgery of a stored envelope is refused on read", async () => {
  const { builder } = executionHarness();
  const sealed = await builder.build(packageInput());
  const envelope = dsseEnvelopeOf(sealed);
  const statement = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));

  // Sanity: the unmodified envelope must reconstruct, or the forgeries below
  // would be proving nothing.
  assert.equal(sealedArtifactFromEnvelope(envelope).artifactId, sealed.artifactId);

  for (const [name, forge] of Object.entries(forgeries)) {
    assert.throws(
      () => sealedArtifactFromEnvelope(forge(envelope, statement)),
      { code: "VES_ENVELOPE_UNSUPPORTED" },
      name
    );
  }
});
