import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ArtifactSealer,
  dsseEnvelopeOf,
  IntegrityError,
  NodeEd25519Signer,
  canonicalizeJson,
  sha256Digest
} from "../../packages/evidence/src/index.ts";
import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";

const binding = Object.freeze({
  schema: { name: "execution-package", version: 1 },
  purpose: "execution-package",
  bindingId: "ticket:VES-42",
  sourceStateDigest: "a".repeat(64)
});

const fixedNow = () => new Date("2026-07-13T10:00:00.000Z");

function makeSigner(purposes = ["execution-package", "run-capsule"]) {
  return NodeEd25519Signer.generate({ keyId: "team-key-2026", purposes });
}

test("Ed25519 signer round-trips encrypted-keystore PKCS#8 material without changing its public reference", async () => {
  const original = makeSigner(["execution-package"]);
  const restored = NodeEd25519Signer.fromPkcs8(
    { keyId: original.publicKeyRef.keyId, purposes: original.publicKeyRef.purposes },
    original.exportPkcs8()
  );

  assert.deepEqual(restored.publicKeyRef, original.publicKeyRef);
  assert.notEqual(await restored.sign("execution-package", Buffer.from("round-trip")), "");
});

test("RFC 8785 sorts object properties recursively", () => {
  assert.equal(canonicalizeJson({ z: 0, a: { y: 2, x: 1 } }), '{"a":{"x":1,"y":2},"z":0}');
});

test("RFC 8785 preserves array order", () => {
  assert.equal(canonicalizeJson([3, { b: 2, a: 1 }, 1]), '[3,{"a":1,"b":2},1]');
});

test("RFC 8785 uses ECMAScript number serialization", () => {
  assert.equal(
    canonicalizeJson([333333333.33333329, 1e30, 4.5, 2e-3, 1e-27, -0]),
    "[333333333.3333333,1e+30,4.5,0.002,1e-27,0]"
  );
});

test("RFC 8785 preserves Unicode without normalization", () => {
  assert.notEqual(canonicalizeJson("é"), canonicalizeJson("e\u0301"));
  assert.equal(canonicalizeJson("€\u000f\n"), '"€\\u000f\\n"');
});

test("canonicalization rejects non-finite numbers", () => {
  assert.throws(() => canonicalizeJson({ value: Number.POSITIVE_INFINITY }), {
    code: "VES_INTEGRITY_NON_JSON_VALUE"
  });
});

test("canonicalization rejects undefined instead of silently deleting it", () => {
  assert.throws(() => canonicalizeJson({ value: undefined }), {
    code: "VES_INTEGRITY_NON_JSON_VALUE"
  });
});

test("canonicalization rejects BigInt", () => {
  assert.throws(() => canonicalizeJson({ value: 1n }), {
    code: "VES_INTEGRITY_NON_JSON_VALUE"
  });
});

test("canonicalization rejects lone Unicode surrogates", () => {
  assert.throws(() => canonicalizeJson("\ud800"), {
    code: "VES_INTEGRITY_INVALID_UNICODE"
  });
});

// why: canonicalize 4 started throwing on lone surrogates, and canonicalize 5
// changed the output for sparse arrays, functions, boxed primitives and toJSON.
// V1 bytes stay those of canonicalize 3 only while every such shape is refused
// here, with this package's own code, before the library sees it.
test("canonicalization refuses, with its own code, every shape canonicalize 4 and 5 changed", () => {
  const cases = [
    ["a sparse array", [, , 1], "VES_INTEGRITY_NON_JSON_VALUE"],
    ["a function element", [function element() {}], "VES_INTEGRITY_NON_JSON_VALUE"],
    ["a boxed number", { value: new Number(5) }, "VES_INTEGRITY_NON_JSON_VALUE"],
    ["a boxed string", { value: new String("x") }, "VES_INTEGRITY_NON_JSON_VALUE"],
    ["a toJSON that returns undefined", { value: { toJSON: () => undefined } }, "VES_INTEGRITY_NON_JSON_VALUE"],
    ["a lone high surrogate in a key", { "\ud800": 1 }, "VES_INTEGRITY_INVALID_UNICODE"],
    ["a lone low surrogate in a nested string", { a: ["ok", "\udc00"] }, "VES_INTEGRITY_INVALID_UNICODE"]
  ];
  for (const [label, value, code] of cases)
    assert.throws(
      () => canonicalizeJson(value),
      (error) => error instanceof IntegrityError && error.code === code,
      label
    );
});

// invariant: V1 delegates to the canonicalize package and V2 is this
// repository's own RFC 8785 serializer, so they must write the same bytes for
// every value V1 accepts. A package release that changes valid output fails
// here before any stored digest stops verifying.
test("V1 and V2 write the same bytes for every JSON value V1 accepts", () => {
  const numbers = [0, -0, 1, -1, 0.1, 0.1 + 0.2, 1 / 3, 2 ** 53, 2 ** 53 + 2, 1e21, 1e-7, 5e-324, Number.MAX_VALUE];
  const corpus = [
    { b: 2, a: 1, c: { z: [3, 2, 1], y: null } },
    numbers,
    numbers.map((value) => -value),
    { "\u20ac": "\u20ac", "\ud83d\ude00": "\ud83d\ude00", "a\u0000b": "\u001f", "\u00e9": "e\u0301" },
    // UTF-16 code-unit order puts the surrogate pair before U+FFFF; code-point
    // order would not.
    { "\uffff": 1, "\ud83d\ude00": 2, "\u00c5": 3, A: 4, a: 5, 10: 6, 9: 7, "": 8 },
    'line\nbreak "quoted" \\ slash / tab\t',
    Object.assign(Object.create(null), { k: [true, false, null, { deep: { deeper: [] } }] })
  ];
  for (const value of corpus) assert.equal(canonicalizeJson(value), canonicalizeJsonV2(value));
});

test("canonicalization rejects cyclic values", () => {
  const value = {};
  value.self = value;
  assert.throws(() => canonicalizeJson(value), { code: "VES_INTEGRITY_CYCLIC_VALUE" });
});

test("cross-runtime fixture has a fixed canonical form and SHA-256 digest", () => {
  const fixture = { z: -0, n: 1.5, a: [true, null, "x"] };
  assert.equal(canonicalizeJson(fixture), '{"a":[true,null,"x"],"n":1.5,"z":0}');
  assert.equal(sha256Digest(fixture), "a6b95acebbcb91925dfd39b3eae637dc1da7b5ac393c31fc36190991510168a5");
});

test("digest is independent of insertion order", () => {
  assert.equal(sha256Digest({ b: 2, a: 1 }), sha256Digest({ a: 1, b: 2 }));
});

test("digest changes when a nested value changes", () => {
  assert.notEqual(sha256Digest({ a: { x: 1 } }), sha256Digest({ a: { x: 2 } }));
});

test("property: every insertion-order permutation has one canonical digest", () => {
  const entries = [
    ["alpha", 1],
    ["beta", 2],
    ["gamma", 3]
  ];
  const permutations = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0]
  ];
  const digests = permutations.map((order) => sha256Digest(Object.fromEntries(order.map((index) => entries[index]))));
  assert.equal(new Set(digests).size, 1);
});

test("property: distinct bounded leaf values produce distinct digests", () => {
  const digests = Array.from({ length: 128 }, (_, value) => sha256Digest({ nested: { value } }));
  assert.equal(new Set(digests).size, digests.length);
});

test("signer exposes only a public Ed25519 key reference", () => {
  const signer = makeSigner();
  assert.deepEqual(Object.keys(signer.publicKeyRef).sort(), [
    "algorithm",
    "encoding",
    "keyId",
    "publicKey",
    "purposes"
  ]);
  assert.equal(signer.publicKeyRef.algorithm, "Ed25519");
  assert.equal(signer.publicKeyRef.encoding, "spki-der-base64url");
  assert.equal("privateKey" in signer.publicKeyRef, false);
});

test("signer refuses a purpose outside its capability set", async () => {
  const signer = makeSigner(["run-capsule"]);
  await assert.rejects(signer.sign("execution-package", Buffer.from("payload")), {
    code: "VES_SIGNING_PURPOSE_DENIED"
  });
});

test("sealer creates a content-addressed signed envelope", async () => {
  const sealer = new ArtifactSealer({ signer: makeSigner(), now: fixedNow });
  const artifact = await sealer.seal({ plan: ["build", "verify"] }, binding);

  assert.equal(artifact.algorithm, "Ed25519");
  assert.equal(artifact.keyId, "team-key-2026");
  assert.equal(artifact.issuedAt, "2026-07-13T10:00:00.000Z");
  assert.match(artifact.artifactId, /^[a-f0-9]{64}$/u);
  assert.match(artifact.payloadDigest, /^[a-f0-9]{64}$/u);

  // AD-014: the signed object is a DSSE envelope carrying an in-toto
  // Statement. This replaces the old `envelopeVersion === 1` and flat
  // `signature` assertions — the envelope identity is still pinned, just to
  // the interoperable shape rather than to a project-private version number.
  assert.equal(artifact.dsse.payloadType, "application/vnd.in-toto+json");
  assert.equal(artifact.dsse.signatures.length, 1);
  assert.equal(artifact.dsse.signatures[0].keyid, "team-key-2026");
  assert.match(artifact.dsse.signatures[0].sig, /^[A-Za-z0-9_-]+$/u);

  const statement = JSON.parse(Buffer.from(artifact.dsse.payload, "base64").toString("utf8"));
  assert.equal(statement._type, "https://in-toto.io/Statement/v1");
  assert.equal(statement.predicateType, "https://accd.github.io/verchestra/attestation/execution-package/v1");
  assert.deepEqual(statement.subject, [{ name: "execution-package", digest: { sha256: artifact.payloadDigest } }]);
  // The binding lives inside the signed payload: five verification error codes
  // are derived from it, so moving any of it outside would drop that cover.
  assert.equal(statement.predicate.binding.purpose, artifact.purpose);
  assert.equal(statement.predicate.binding.bindingId, artifact.bindingId);
  assert.equal(statement.predicate.binding.sourceStateDigest, artifact.sourceStateDigest);
  assert.deepEqual(statement.predicate.content, artifact.payload);
});

test("the interoperable envelope is exactly the three DSSE fields", async () => {
  // What an external verifier is handed. The flat fields on the sealed artifact
  // are a decoded convenience and must never leak into it.
  const sealer = new ArtifactSealer({ signer: makeSigner(), now: fixedNow });
  const artifact = await sealer.seal({ plan: ["build"] }, binding);
  assert.deepEqual(Object.keys(dsseEnvelopeOf(artifact)).sort(), ["payload", "payloadType", "signatures"]);
});

test("sealing is deterministic for the same key, time, payload, and bindings", async () => {
  const sealer = new ArtifactSealer({ signer: makeSigner(), now: fixedNow });
  const first = await sealer.seal({ b: 2, a: 1 }, binding);
  const second = await sealer.seal({ a: 1, b: 2 }, binding);
  assert.deepEqual(second, first);
});

test("source-state changes invalidate the content address", async () => {
  const sealer = new ArtifactSealer({ signer: makeSigner(), now: fixedNow });
  const first = await sealer.seal({ plan: true }, binding);
  const second = await sealer.seal({ plan: true }, { ...binding, sourceStateDigest: "b".repeat(64) });
  assert.notEqual(first.artifactId, second.artifactId);
});

test("schema, purpose, and receiver binding are part of the content address", async () => {
  const sealer = new ArtifactSealer({ signer: makeSigner(), now: fixedNow });
  const base = await sealer.seal({ plan: true }, binding);
  const schema = await sealer.seal({ plan: true }, { ...binding, schema: { name: "execution-package", version: 2 } });
  const purpose = await sealer.seal({ plan: true }, { ...binding, purpose: "run-capsule" });
  const receiver = await sealer.seal({ plan: true }, { ...binding, bindingId: "ticket:VES-43" });
  assert.equal(new Set([base.artifactId, schema.artifactId, purpose.artifactId, receiver.artifactId]).size, 4);
});

test("invalid binding input fails with a stable integrity error", async () => {
  const sealer = new ArtifactSealer({ signer: makeSigner(), now: fixedNow });
  await assert.rejects(
    sealer.seal({ plan: true }, { ...binding, sourceStateDigest: "not-a-digest" }),
    (error) => error instanceof IntegrityError && error.code === "VES_INTEGRITY_INVALID_BINDING"
  );
});
