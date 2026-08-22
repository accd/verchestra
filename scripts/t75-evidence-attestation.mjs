// Signs and verifies the T75 evidence-index body as a standalone DSSE/in-toto
// attestation. The canonical index remains the reconciler's output; this
// script neither creates a release key nor alters the qualification verdict.

import { createHash, createPublicKey, verify as verifyBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { canonicalizeJsonV2 } from "../packages/domain/src/index.ts";
import {
  buildStatement,
  DSSE_PAYLOAD_TYPE,
  IN_TOTO_STATEMENT_TYPE,
  NodeEd25519Signer,
  preAuthenticationEncoding,
  predicateTypeFor,
  statementBytes
} from "../packages/evidence/src/index.ts";

const KEY_ENVIRONMENT_NAME = "VESTRA_T75_EVIDENCE_SIGNING_KEY_PKCS8_BASE64";
const SCHEMA = Object.freeze({ name: "qualification-evidence-index", version: 1 });
const PURPOSE = "qualification-evidence-index";
const PREDICATE_TYPE = predicateTypeFor(SCHEMA);
const REVISION = /^[a-f0-9]{40}$/u;
const EVIDENCE_INDEX_KEYS = Object.freeze([
  "bodyDigest",
  "canonicalizationVersion",
  "digestProvenance",
  "dimensions",
  "profiles",
  "revision",
  "schemaVersion",
  "signingState",
  "summary",
  "task"
]);

function sourceStateDigest(revision) {
  return createHash("sha256").update(revision, "utf8").digest("hex");
}

function exactObjectKeys(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...expected].sort().join(",")
  );
}

function validityFields(value) {
  return ["validFrom", "validUntil"].filter((field) => value?.[field] !== undefined);
}

function hasQualificationPurpose(value) {
  if (!Array.isArray(value.purposes)) return false;
  if (value.purposes.length !== 1) return false;
  return value.purposes[0] === PURPOSE;
}

function hasEd25519KeyMaterial(value) {
  if (value.algorithm !== "Ed25519") return false;
  if (value.encoding !== "spki-der-base64url") return false;
  if (typeof value.keyId !== "string") return false;
  if (value.keyId.trim().length === 0) return false;
  if (typeof value.publicKey !== "string") return false;
  return /^[A-Za-z0-9_-]+$/u.test(value.publicKey);
}

function hasValidReferenceWindow(value, optional) {
  return optional.every((field) => typeof value[field] === "string" && !Number.isNaN(Date.parse(value[field])));
}

function assertPublicKeyRef(value) {
  const optional = validityFields(value);
  if (
    !exactObjectKeys(value, ["algorithm", "encoding", "keyId", "publicKey", "purposes", ...optional]) ||
    !hasEd25519KeyMaterial(value) ||
    !hasQualificationPurpose(value) ||
    !hasValidReferenceWindow(value, optional)
  )
    throw new Error("committed public reference is invalid for qualification evidence signing");
  return value;
}

function decodeProtectedPkcs8(environment) {
  const encoded = environment[KEY_ENVIRONMENT_NAME];
  if (typeof encoded !== "string" || encoded.length === 0) throw new Error("protected signing key is not configured");
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded) || encoded.length % 4 !== 0)
    throw new Error("protected signing key is not valid base64 PKCS#8 material");
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length === 0) throw new Error("protected signing key is not valid PKCS#8 material");
  return decoded;
}

function canonicalBodyDigest(body) {
  return `sha256:${createHash("sha256").update(canonicalizeJsonV2(body)).digest("hex")}`;
}

function assertEvidenceIndexShape(index) {
  if (!exactObjectKeys(index, EVIDENCE_INDEX_KEYS))
    throw new Error("qualification evidence index has an unexpected shape");
}

function assertEvidenceIndexMetadata(index) {
  if (index.schemaVersion !== 1) throw new Error("qualification evidence index schema version is invalid");
  if (index.canonicalizationVersion !== 2)
    throw new Error("qualification evidence index canonicalization version is invalid");
  if (index.task !== "T75") throw new Error("qualification evidence index task is invalid");
  if (!REVISION.test(index.revision)) throw new Error("qualification evidence index revision is invalid");
}

function assertEvidenceIndexSigningState(index, requireUnsigned) {
  const signed = index.signingState?.signed;
  if (![false, true].includes(signed)) throw new Error("qualification evidence index signing state is invalid");
  if (requireUnsigned !== true) return;
  if (signed !== false) throw new Error("qualification evidence index is already signed");
}

function bodyForIndex(index) {
  const body = { ...index };
  delete body.bodyDigest;
  delete body.signingState;
  return body;
}

function assertEvidenceIndexDigest(index, body) {
  if (typeof index.bodyDigest !== "string") throw new Error("qualification evidence index body digest is invalid");
  if (!/^sha256:[a-f0-9]{64}$/u.test(index.bodyDigest))
    throw new Error("qualification evidence index body digest is invalid");
  if (canonicalBodyDigest(body) !== index.bodyDigest)
    throw new Error("qualification evidence index body digest does not match canonical content");
}

export function evidenceIndexBody(index, options = {}) {
  assertEvidenceIndexShape(index);
  assertEvidenceIndexMetadata(index);
  assertEvidenceIndexSigningState(index, options.requireUnsigned);
  const body = bodyForIndex(index);
  assertEvidenceIndexDigest(index, body);
  return body;
}

function bindingFor(revision, issuedAt) {
  if (!REVISION.test(revision) || Number.isNaN(Date.parse(issuedAt)) || new Date(issuedAt).toISOString() !== issuedAt)
    throw new Error("qualification attestation binding is invalid");
  return Object.freeze({
    schema: SCHEMA,
    purpose: PURPOSE,
    bindingId: `qualification:T75:${revision}`,
    sourceStateDigest: sourceStateDigest(revision),
    issuedAt
  });
}

function keyReferenceEquals(left, right) {
  return canonicalizeJsonV2(left) === canonicalizeJsonV2(right);
}

function parseEnvelope(value) {
  if (
    !exactObjectKeys(value, ["payload", "payloadType", "signatures"]) ||
    value.payloadType !== DSSE_PAYLOAD_TYPE ||
    typeof value.payload !== "string" ||
    !Array.isArray(value.signatures) ||
    value.signatures.length !== 1 ||
    !exactObjectKeys(value.signatures[0], ["keyid", "sig"]) ||
    typeof value.signatures[0].keyid !== "string" ||
    typeof value.signatures[0].sig !== "string"
  )
    return undefined;
  try {
    return { envelope: value, statement: JSON.parse(Buffer.from(value.payload, "base64").toString("utf8")) };
  } catch {
    return undefined;
  }
}

function statementIdentityMatches(statement) {
  if (statement._type !== IN_TOTO_STATEMENT_TYPE) return false;
  return statement.predicateType === PREDICATE_TYPE;
}

function statementSubjectMatches(statement, body) {
  if (!Array.isArray(statement.subject)) return false;
  if (statement.subject.length !== 1) return false;
  const subject = statement.subject[0];
  if (subject?.name !== SCHEMA.name) return false;
  return subject.digest?.sha256 === canonicalBodyDigest(body).slice("sha256:".length);
}

function statementContentMatches(statement, body) {
  return canonicalizeJsonV2(statement.predicate.content) === canonicalizeJsonV2(body);
}

function statementBindingMatches(statement, revision) {
  const binding = statement.predicate.binding;
  if (binding?.schema?.name !== SCHEMA.name) return false;
  if (binding.schema.version !== SCHEMA.version) return false;
  if (binding.purpose !== PURPOSE) return false;
  if (binding.bindingId !== `qualification:T75:${revision}`) return false;
  if (binding.sourceStateDigest !== sourceStateDigest(revision)) return false;
  return binding.algorithm === "Ed25519";
}

function statementMatchesQualificationIndex(statement, body, revision) {
  if (!statementIdentityMatches(statement)) return false;
  if (!statementSubjectMatches(statement, body)) return false;
  if (!statementContentMatches(statement, body)) return false;
  return statementBindingMatches(statement, revision);
}

export async function signQualificationEvidenceIndex(input) {
  const publicKeyRef = assertPublicKeyRef(input.publicKeyRef);
  const body = evidenceIndexBody(input.index, { requireUnsigned: true });
  if (body.revision !== input.revision)
    throw new Error("qualification evidence index revision does not match requested revision");
  const binding = bindingFor(input.revision, input.issuedAt);
  const signer = NodeEd25519Signer.fromPkcs8(
    {
      keyId: publicKeyRef.keyId,
      purposes: publicKeyRef.purposes,
      ...(publicKeyRef.validFrom === undefined ? {} : { validFrom: publicKeyRef.validFrom }),
      ...(publicKeyRef.validUntil === undefined ? {} : { validUntil: publicKeyRef.validUntil })
    },
    decodeProtectedPkcs8(input.protectedEnvironment)
  );
  if (!keyReferenceEquals(signer.publicKeyRef, publicKeyRef))
    throw new Error("derived signing key does not match the committed public reference");
  const payloadDigest = createHash("sha256").update(canonicalizeJsonV2(body), "utf8").digest("hex");
  const statement = buildStatement({ ...binding, payloadDigest, predicateType: PREDICATE_TYPE, content: body });
  const payload = statementBytes(statement);
  const signature = await signer.sign(PURPOSE, preAuthenticationEncoding(DSSE_PAYLOAD_TYPE, payload));
  return Object.freeze({
    payloadType: DSSE_PAYLOAD_TYPE,
    payload: payload.toString("base64"),
    signatures: Object.freeze([Object.freeze({ keyid: publicKeyRef.keyId, sig: signature })])
  });
}

export function signedQualificationEvidenceIndex(input) {
  if (!verifyQualificationEvidenceIndex(input))
    throw new Error("qualification evidence attestation failed verification");
  return Object.freeze({
    ...input.index,
    signingState: Object.freeze({
      signed: true,
      attestation: Object.freeze({
        format: "DSSE/in-toto",
        predicateType: PREDICATE_TYPE,
        keyId: input.publicKeyRef.keyId,
        envelope: "qualification-evidence-index.dsse.json"
      })
    })
  });
}

export function verifyQualificationEvidenceIndex(input) {
  try {
    const publicKeyRef = assertPublicKeyRef(input.publicKeyRef);
    const body = evidenceIndexBody(input.index);
    if (body.revision !== input.revision) return false;
    const parsed = parseEnvelope(input.envelope);
    if (parsed === undefined) return false;
    const { envelope, statement } = parsed;
    if (!statementMatchesQualificationIndex(statement, body, input.revision)) return false;
    if (envelope.signatures[0].keyid !== publicKeyRef.keyId) return false;
    return verifyBytes(
      null,
      preAuthenticationEncoding(envelope.payloadType, Buffer.from(envelope.payload, "base64")),
      createPublicKey({ key: Buffer.from(publicKeyRef.publicKey, "base64url"), format: "der", type: "spki" }),
      Buffer.from(envelope.signatures[0].sig, "base64url")
    );
  } catch {
    return false;
  }
}

function option(args, name) {
  const at = args.indexOf(name);
  if (at === -1 || args[at + 1] === undefined) throw new Error(`${name} is required`);
  return args[at + 1];
}

async function runCli() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode !== "sign" && mode !== "verify")
    throw new Error(
      "usage: t75-evidence-attestation.mjs <sign|verify> --index <path> --public-key-ref <path> --revision <sha> [--out <path>] [--signed-index-out <path>] [--issued-at <iso>]"
    );
  const index = JSON.parse(await readFile(option(args, "--index"), "utf8"));
  const publicKeyRef = JSON.parse(await readFile(option(args, "--public-key-ref"), "utf8"));
  const revision = option(args, "--revision");
  if (mode === "verify") {
    const envelope = JSON.parse(await readFile(option(args, "--envelope"), "utf8"));
    if (!verifyQualificationEvidenceIndex({ index, envelope, publicKeyRef, revision }))
      throw new Error("qualification evidence attestation failed verification");
    console.log(`qualification evidence attestation verified for ${revision}`);
    return;
  }
  const envelope = await signQualificationEvidenceIndex({
    index,
    publicKeyRef,
    revision,
    issuedAt: option(args, "--issued-at"),
    protectedEnvironment: process.env
  });
  const out = option(args, "--out");
  const signedIndexOut = option(args, "--signed-index-out");
  const signedIndex = signedQualificationEvidenceIndex({ index, envelope, publicKeyRef, revision });
  await writeFile(out, `${JSON.stringify(envelope, null, 2)}\n`);
  await writeFile(signedIndexOut, `${JSON.stringify(signedIndex, null, 2)}\n`);
  console.log(`qualification evidence attestation written for ${revision}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
