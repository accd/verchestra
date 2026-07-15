import { createPublicKey, verify as verifyBytes } from "node:crypto";

import { canonicalizeJson, IntegrityError, sha256Digest } from "./canonical.ts";
import type { NodeEd25519Signer } from "./signer.ts";
import type {
  ArtifactBinding,
  JsonValue,
  PublicKeyRef,
  SealedArtifact,
  TrustRoot,
  VerificationExpectation,
  VerificationResult
} from "./types.ts";

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;

interface SealerOptions {
  readonly signer: NodeEd25519Signer;
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

function unsignedArtifact<T extends JsonValue>(artifact: SealedArtifact<T>) {
  return {
    envelopeVersion: artifact.envelopeVersion,
    schema: artifact.schema,
    purpose: artifact.purpose,
    bindingId: artifact.bindingId,
    sourceStateDigest: artifact.sourceStateDigest,
    algorithm: artifact.algorithm,
    keyId: artifact.keyId,
    issuedAt: artifact.issuedAt,
    payloadDigest: artifact.payloadDigest,
    payload: artifact.payload
  } as const;
}

function signedArtifact<T extends JsonValue>(artifact: SealedArtifact<T>) {
  return { artifactId: artifact.artifactId, ...unsignedArtifact(artifact) } as const;
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
  readonly #signer: NodeEd25519Signer;
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
    const base = {
      envelopeVersion: 1,
      schema: Object.freeze({ ...binding.schema }),
      purpose: binding.purpose,
      bindingId: binding.bindingId,
      sourceStateDigest: binding.sourceStateDigest,
      algorithm: "Ed25519",
      keyId: this.#signer.publicKeyRef.keyId,
      issuedAt,
      payloadDigest: sha256Digest(payload),
      payload
    } as const;
    const artifactId = sha256Digest(base);
    const signature = await this.#signer.sign(
      binding.purpose,
      Buffer.from(canonicalizeJson({ artifactId, ...base }), "utf8")
    );
    return Object.freeze({ artifactId, ...base, signature });
  }

  async verify<T extends JsonValue>(
    artifact: SealedArtifact<T>,
    trust: TrustRoot,
    expected: VerificationExpectation
  ): Promise<VerificationResult> {
    try {
      if (sha256Digest(artifact.payload) !== artifact.payloadDigest) {
        return { ok: false, code: "VES_INTEGRITY_PAYLOAD_DIGEST_MISMATCH" };
      }
      if (sha256Digest(unsignedArtifact(artifact)) !== artifact.artifactId) {
        return { ok: false, code: "VES_INTEGRITY_ARTIFACT_ID_MISMATCH" };
      }
    } catch {
      return { ok: false, code: "VES_INTEGRITY_PAYLOAD_DIGEST_MISMATCH" };
    }

    if (artifact.schema.name !== expected.schema.name || artifact.schema.version !== expected.schema.version) {
      return { ok: false, code: "VES_INTEGRITY_SCHEMA_MISMATCH" };
    }
    if (artifact.purpose !== expected.purpose) {
      return { ok: false, code: "VES_INTEGRITY_PURPOSE_MISMATCH" };
    }
    if (artifact.sourceStateDigest !== expected.sourceStateDigest) {
      return { ok: false, code: "VES_INTEGRITY_SOURCE_STATE_MISMATCH" };
    }
    if (artifact.bindingId !== expected.bindingId) {
      return { ok: false, code: "VES_INTEGRITY_BINDING_MISMATCH" };
    }

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
      const valid = verifyBytes(
        null,
        Buffer.from(canonicalizeJson(signedArtifact(artifact)), "utf8"),
        publicKey,
        Buffer.from(artifact.signature, "base64url")
      );
      return valid
        ? { ok: true, artifactId: artifact.artifactId, keyId: artifact.keyId }
        : { ok: false, code: "VES_SIGNATURE_INVALID" };
    } catch {
      return { ok: false, code: "VES_TRUST_KEY_INVALID" };
    }
  }
}
