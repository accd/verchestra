import { createPublicKey, verify as verifyBytes } from "node:crypto";

import { canonicalizeJson, IntegrityError, sha256Digest } from "./canonical.ts";
import {
  buildStatement,
  DSSE_PAYLOAD_TYPE,
  IN_TOTO_STATEMENT_TYPE,
  preAuthenticationEncoding,
  predicateTypeFor,
  statementBytes
} from "./dsse.ts";
import type { EvidenceSigner } from "./key-provider.ts";
import type {
  ArtifactBinding,
  DsseEnvelope,
  InTotoStatement,
  JsonValue,
  PublicKeyRef,
  SealedArtifact,
  TrustRoot,
  VerificationExpectation,
  VerificationResult
} from "./types.ts";

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;

interface SealerOptions {
  readonly signer: EvidenceSigner;
  readonly now?: () => Date;
}

interface SealOptions {
  readonly issuedAt?: string;
}

interface TrustRootInput {
  readonly trustRootId: string;
  readonly version: number;
  readonly keys: readonly PublicKeyRef[];
  readonly revokedKeyIds?: readonly string[];
}

function invalidBinding(message: string): never {
  throw new IntegrityError("VES_INTEGRITY_INVALID_BINDING", message);
}

function assertBinding(binding: ArtifactBinding): void {
  if (
    binding.schema.name.trim().length === 0 ||
    !Number.isSafeInteger(binding.schema.version) ||
    binding.schema.version < 1 ||
    binding.purpose.trim().length === 0 ||
    binding.bindingId.trim().length === 0 ||
    !DIGEST_PATTERN.test(binding.sourceStateDigest)
  ) {
    invalidBinding("Artifact binding is incomplete or malformed");
  }
}

function parseInstant(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : undefined;
}

/**
 * Rebuild the Statement the sealed artifact's flat projection claims was
 * signed. `verify` compares these bytes against the envelope's own payload, so
 * a projection that drifted from what was signed fails rather than being
 * silently believed.
 */
function projectedStatement<T extends JsonValue>(artifact: SealedArtifact<T>, predicateType: string) {
  return buildStatement({
    schema: artifact.schema,
    purpose: artifact.purpose,
    bindingId: artifact.bindingId,
    sourceStateDigest: artifact.sourceStateDigest,
    issuedAt: artifact.issuedAt,
    payloadDigest: artifact.payloadDigest,
    predicateType,
    content: artifact.payload
  });
}

/**
 * The identity of what a sealed artifact claims was signed: the sha256 of the
 * Statement rebuilt from its projection.
 *
 * Exported because the evidence modules each re-check storage integrity
 * independently of the sealer. They used to do that by duplicating the envelope
 * shape, four copies that could drift from the sealer and from each other; now
 * there is one definition and the duplication is gone.
 */
export function sealedArtifactId(artifact: SealedArtifact): string {
  const predicateType = predicateTypeFor(artifact.schema);
  if (predicateType === undefined) {
    throw new IntegrityError("VES_INTEGRITY_INVALID_BINDING", "Artifact schema has no declared predicate type");
  }
  return sha256Digest(projectedStatement(artifact, predicateType));
}

/**
 * Whether a sealed artifact's flat projection agrees with the signed envelope.
 *
 * The key id needs its own clause: under DSSE it lives in `signatures[].keyid`,
 * which is envelope metadata rather than Statement content, so the content
 * address cannot cover it the way the pre-DSSE digest did. Verification would
 * still catch a swap (the trust lookup finds a different key and the signature
 * fails), but storage-integrity checks run without a trust root and would not —
 * so the binding is asserted here instead of being quietly lost in the move.
 */
export function sealedProjectionMatches(artifact: SealedArtifact): boolean {
  return artifact.keyId === artifact.dsse.signatures[0]?.keyid && sealedArtifactId(artifact) === artifact.artifactId;
}

/**
 * Open a sealed artifact's envelope, refusing anything that is not a DSSE
 * envelope carrying an in-toto Statement of a declared predicate type.
 *
 * There is deliberately no fallback path: AD-014 chose rejection over
 * dual-format verification, so a legacy pre-DSSE artifact stops here.
 *
 * The projection-equality check is the last clause rather than a separate
 * `_type` guard. It rebuilds the Statement from the artifact's flat fields —
 * `_type` included — and requires byte equality with what the envelope
 * carries, so the flat fields stop being taken on trust here, and an explicit
 * type check could never be reached by input this does not already reject. A
 * discrimination sensor proved that: deleting such a guard killed no test, and
 * defensive code no test can kill is not defence.
 */
function hasDsseShape(artifact: SealedArtifact): boolean {
  const envelope = artifact.dsse;
  return (
    envelope !== null &&
    typeof envelope === "object" &&
    envelope.payloadType === DSSE_PAYLOAD_TYPE &&
    typeof envelope.payload === "string" &&
    Array.isArray(envelope.signatures) &&
    envelope.signatures.length === 1 &&
    // Under DSSE the key id is envelope metadata, outside the Statement, so the
    // content address cannot cover it; bind it explicitly instead.
    artifact.keyId === envelope.signatures[0]?.keyid
  );
}

function bindingMismatch(
  artifact: SealedArtifact,
  expected: VerificationExpectation
):
  | "VES_INTEGRITY_SCHEMA_MISMATCH"
  | "VES_INTEGRITY_PURPOSE_MISMATCH"
  | "VES_INTEGRITY_SOURCE_STATE_MISMATCH"
  | "VES_INTEGRITY_BINDING_MISMATCH"
  | undefined {
  if (artifact.schema.name !== expected.schema.name || artifact.schema.version !== expected.schema.version)
    return "VES_INTEGRITY_SCHEMA_MISMATCH";
  if (artifact.purpose !== expected.purpose) return "VES_INTEGRITY_PURPOSE_MISMATCH";
  if (artifact.sourceStateDigest !== expected.sourceStateDigest) return "VES_INTEGRITY_SOURCE_STATE_MISMATCH";
  if (artifact.bindingId !== expected.bindingId) return "VES_INTEGRITY_BINDING_MISMATCH";
  return undefined;
}

function openEnvelope<T extends JsonValue>(
  artifact: SealedArtifact<T>
):
  | { readonly code: "VES_ENVELOPE_UNSUPPORTED" }
  | {
      readonly envelope: DsseEnvelope;
      readonly signedBytes: Buffer;
      readonly signedStatement: JsonValue;
    } {
  const refused = { code: "VES_ENVELOPE_UNSUPPORTED" } as const;
  if (!hasDsseShape(artifact)) return refused;
  const envelope = artifact.dsse;
  // Derived from the artifact's own schema: a kind AD-014 never declared has no
  // attestation type, so it is refused rather than given a minted one.
  //
  // A runtime sensor cannot kill this clause — an undeclared kind also breaks
  // projection equality below, which refuses with the same code. Unlike the
  // `_type` guard that was removed for exactly that reason, this one stays
  // because the compiler kills it: without it `predicateType` is
  // `string | undefined` and the call below fails to typecheck. Compile-time
  // enforcement is a stronger guarantee than a test, not a missing one.
  const predicateType = predicateTypeFor(artifact.schema);
  if (predicateType === undefined) return refused;
  try {
    const signedBytes = Buffer.from(envelope.payload, "base64");
    const signedStatement = JSON.parse(signedBytes.toString("utf8")) as JsonValue;
    if (!statementBytes(projectedStatement(artifact, predicateType)).equals(signedBytes)) return refused;
    return { envelope, signedBytes, signedStatement };
  } catch {
    return refused;
  }
}

/**
 * Rebuild a sealed artifact from nothing but its DSSE envelope.
 *
 * This is the inverse of sealing, and it is what lets the envelope be the only
 * thing persisted. Every flat field is *derived* from the signed Statement
 * rather than stored beside it, so a stored projection cannot disagree with
 * what was signed — the disagreement is not detected, it is impossible.
 *
 * Throws `VES_ENVELOPE_UNSUPPORTED` for anything that is not a DSSE envelope
 * carrying an in-toto Statement of a declared predicate type. Callers convert
 * that to their own storage-integrity code.
 */
function assertEnvelopeShape(value: unknown): asserts value is DsseEnvelope {
  const envelope = value as DsseEnvelope;
  if (
    envelope === null ||
    typeof envelope !== "object" ||
    envelope.payloadType !== DSSE_PAYLOAD_TYPE ||
    typeof envelope.payload !== "string" ||
    !Array.isArray(envelope.signatures) ||
    envelope.signatures.length !== 1 ||
    typeof envelope.signatures[0]?.keyid !== "string"
  ) {
    throw new IntegrityError("VES_ENVELOPE_UNSUPPORTED", "Stored artifact is not a DSSE envelope");
  }
}

function decodeStatement<T extends JsonValue>(envelope: DsseEnvelope): InTotoStatement<T> {
  let statement: InTotoStatement<T>;
  try {
    statement = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8")) as InTotoStatement<T>;
  } catch (error) {
    throw new IntegrityError("VES_ENVELOPE_UNSUPPORTED", "Stored envelope payload is not JSON", { cause: error });
  }
  if (!isDeclaredAttestation(statement)) {
    throw new IntegrityError("VES_ENVELOPE_UNSUPPORTED", "Stored envelope is not a declared Verchestra attestation");
  }
  return statement;
}

function isDeclaredAttestation(statement: InTotoStatement | undefined): boolean {
  const binding = statement?.predicate?.binding;
  return (
    statement?._type === IN_TOTO_STATEMENT_TYPE &&
    binding !== undefined &&
    typeof statement.subject?.[0]?.digest?.sha256 === "string" &&
    predicateTypeFor(binding.schema) === statement.predicateType
  );
}

export function sealedArtifactFromEnvelope<T extends JsonValue = JsonValue>(value: unknown): SealedArtifact<T> {
  assertEnvelopeShape(value);
  const envelope = value;
  const statement = decodeStatement<T>(envelope);
  const binding = statement.predicate.binding;
  const payloadDigest = statement.subject[0]?.digest.sha256 as string;
  return Object.freeze({
    artifactId: sha256Digest(statement),
    schema: Object.freeze({ ...binding.schema }),
    purpose: binding.purpose,
    bindingId: binding.bindingId,
    sourceStateDigest: binding.sourceStateDigest,
    algorithm: "Ed25519" as const,
    keyId: envelope.signatures[0]?.keyid as string,
    issuedAt: binding.issuedAt,
    payloadDigest,
    payload: statement.predicate.content,
    dsse: Object.freeze({
      payloadType: envelope.payloadType,
      payload: envelope.payload,
      signatures: Object.freeze([Object.freeze({ ...(envelope.signatures[0] as { keyid: string; sig: string }) })])
    })
  });
}

/** The interoperable object: exactly the three DSSE fields, nothing else. */
export function dsseEnvelopeOf(artifact: SealedArtifact): DsseEnvelope {
  return Object.freeze({
    payloadType: artifact.dsse.payloadType,
    payload: artifact.dsse.payload,
    signatures: artifact.dsse.signatures
  });
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(canonicalizeJson(value)) as T;
}

export function createTrustRoot(input: TrustRootInput): TrustRoot {
  const ids = input.keys.map((key) => key.keyId);
  const revoked = input.revokedKeyIds ?? [];
  if (
    input.trustRootId.trim().length === 0 ||
    !Number.isSafeInteger(input.version) ||
    input.version < 1 ||
    input.keys.length === 0 ||
    ids.some((id) => id.trim().length === 0) ||
    new Set(ids).size !== ids.length ||
    new Set(revoked).size !== revoked.length
  ) {
    throw new IntegrityError("VES_TRUST_ROOT_INVALID", "Trust root is malformed");
  }
  const keys = input.keys.map((key) => Object.freeze({ ...key, purposes: Object.freeze([...key.purposes]) }));
  return Object.freeze({
    trustRootId: input.trustRootId,
    version: input.version,
    keys: Object.freeze(keys),
    revokedKeyIds: Object.freeze([...revoked])
  });
}

export class ArtifactSealer {
  readonly #signer: EvidenceSigner;
  readonly #now: () => Date;

  constructor(options: SealerOptions) {
    this.#signer = options.signer;
    this.#now = options.now ?? (() => new Date());
  }

  async seal<T extends JsonValue>(
    payloadInput: T,
    binding: ArtifactBinding,
    options: SealOptions = {}
  ): Promise<SealedArtifact<T>> {
    assertBinding(binding);
    const issuedAt = options.issuedAt ?? this.#now().toISOString();
    if (parseInstant(issuedAt) === undefined || new Date(issuedAt).toISOString() !== issuedAt) {
      invalidBinding("Artifact issue time is not a canonical instant");
    }
    const payload = cloneJson(payloadInput);
    const predicateType = predicateTypeFor(binding.schema);
    // A schema with no predicate type is an artifact kind AD-014 never named.
    // Minting a URI here would create an attestation type nobody can verify.
    if (predicateType === undefined) {
      invalidBinding(`Artifact schema has no declared predicate type: ${binding.schema.name}`);
    }
    const statement = buildStatement({
      schema: Object.freeze({ ...binding.schema }),
      purpose: binding.purpose,
      bindingId: binding.bindingId,
      sourceStateDigest: binding.sourceStateDigest,
      issuedAt,
      payloadDigest: sha256Digest(payload),
      predicateType,
      content: payload
    });
    const bytes = statementBytes(statement);
    // The artifact id is the identity of what was signed. Deriving it from the
    // Statement rather than storing an independent value means it cannot name
    // one thing while the signature covers another.
    const artifactId = sha256Digest(statement);
    const signature = await this.#signer.sign(binding.purpose, preAuthenticationEncoding(DSSE_PAYLOAD_TYPE, bytes));
    const dsse: DsseEnvelope = Object.freeze({
      payloadType: DSSE_PAYLOAD_TYPE,
      payload: bytes.toString("base64"),
      signatures: Object.freeze([Object.freeze({ keyid: this.#signer.publicKeyRef.keyId, sig: signature })])
    });
    return Object.freeze({
      artifactId,
      schema: statement.predicate.binding.schema,
      purpose: binding.purpose,
      bindingId: binding.bindingId,
      sourceStateDigest: binding.sourceStateDigest,
      algorithm: "Ed25519" as const,
      keyId: this.#signer.publicKeyRef.keyId,
      issuedAt,
      payloadDigest: statement.subject[0]?.digest.sha256 as string,
      payload,
      dsse
    });
  }

  async verify<T extends JsonValue>(
    artifact: SealedArtifact<T>,
    trust: TrustRoot,
    expected: VerificationExpectation
  ): Promise<VerificationResult> {
    // Payload digest first, before the envelope is opened. A tampered payload
    // also breaks projection equality, so opening first would report every such
    // case as an envelope problem and lose the specific code this contract has
    // always returned.
    try {
      if (sha256Digest(artifact.payload) !== artifact.payloadDigest) {
        return { ok: false, code: "VES_INTEGRITY_PAYLOAD_DIGEST_MISMATCH" };
      }
    } catch {
      return { ok: false, code: "VES_INTEGRITY_PAYLOAD_DIGEST_MISMATCH" };
    }

    const opened = openEnvelope(artifact);
    if ("code" in opened) return { ok: false, code: opened.code };
    const { envelope, signedBytes, signedStatement } = opened;
    if (sha256Digest(signedStatement) !== artifact.artifactId) {
      return { ok: false, code: "VES_INTEGRITY_ARTIFACT_ID_MISMATCH" };
    }

    const mismatch = bindingMismatch(artifact, expected);
    if (mismatch !== undefined) return { ok: false, code: mismatch };

    const key = trust.keys.find((candidate) => candidate.keyId === artifact.keyId);
    if (key === undefined) return { ok: false, code: "VES_TRUST_KEY_UNKNOWN" };
    if (trust.revokedKeyIds.includes(key.keyId)) {
      return { ok: false, code: "VES_TRUST_KEY_REVOKED" };
    }
    if (!key.purposes.includes(artifact.purpose)) {
      return { ok: false, code: "VES_TRUST_PURPOSE_DENIED" };
    }

    const now = expected.now.getTime();
    const validFrom = parseInstant(key.validFrom);
    const validUntil = parseInstant(key.validUntil);
    if (key.validFrom !== undefined && validFrom === undefined) {
      return { ok: false, code: "VES_TRUST_KEY_INVALID" };
    }
    if (key.validUntil !== undefined && validUntil === undefined) {
      return { ok: false, code: "VES_TRUST_KEY_INVALID" };
    }
    if (validFrom !== undefined && now < validFrom) {
      return { ok: false, code: "VES_TRUST_KEY_NOT_YET_VALID" };
    }
    if (validUntil !== undefined && now > validUntil) {
      return { ok: false, code: "VES_TRUST_KEY_EXPIRED" };
    }

    try {
      const publicKey = createPublicKey({
        key: Buffer.from(key.publicKey, "base64url"),
        type: "spki",
        format: "der"
      });
      // Verify over the PAE, never the raw payload: binding the payload type
      // into the signed bytes is what stops a signature over an in-toto
      // Statement being replayed as a signature over some other document type.
      const valid = verifyBytes(
        null,
        preAuthenticationEncoding(envelope.payloadType, signedBytes),
        publicKey,
        Buffer.from(envelope.signatures[0]?.sig ?? "", "base64url")
      );
      return valid
        ? { ok: true, artifactId: artifact.artifactId, keyId: artifact.keyId }
        : { ok: false, code: "VES_SIGNATURE_INVALID" };
    } catch {
      return { ok: false, code: "VES_TRUST_KEY_INVALID" };
    }
  }
}
