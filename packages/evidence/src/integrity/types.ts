export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[];

export interface SchemaRef {
  readonly name: string;
  readonly version: number;
}

export interface ArtifactBinding {
  readonly schema: SchemaRef;
  readonly purpose: string;
  readonly bindingId: string;
  readonly sourceStateDigest: string;
}

export interface PublicKeyRef {
  readonly keyId: string;
  readonly algorithm: "Ed25519";
  readonly encoding: "spki-der-base64url";
  readonly publicKey: string;
  readonly purposes: readonly string[];
  readonly validFrom?: string;
  readonly validUntil?: string;
}

export interface TrustRoot {
  readonly trustRootId: string;
  readonly version: number;
  readonly keys: readonly PublicKeyRef[];
  readonly revokedKeyIds: readonly string[];
}

// AD-014: the signed form is a DSSE envelope carrying an in-toto Statement.
// These three fields are the whole interoperable object — what an external
// verifier (cosign, Kyverno, an in-toto tool) is handed. `dsseEnvelopeOf`
// extracts exactly this from a sealed artifact.
export interface DsseEnvelope {
  readonly payloadType: string;
  /** base64 of the canonical in-toto Statement bytes. */
  readonly payload: string;
  readonly signatures: readonly { readonly keyid: string; readonly sig: string }[];
}

export interface InTotoSubject {
  readonly name: string;
  readonly digest: { readonly sha256: string };
}

export interface InTotoStatement<T extends JsonValue = JsonValue> {
  readonly _type: string;
  readonly subject: readonly InTotoSubject[];
  readonly predicateType: string;
  readonly predicate: {
    // The binding stays INSIDE the signed payload. Five verification error
    // codes are derived from comparing these fields against expectation; moving
    // any of them outside the signature would silently drop that cover.
    readonly binding: {
      readonly schema: SchemaRef;
      readonly purpose: string;
      readonly bindingId: string;
      readonly sourceStateDigest: string;
      readonly algorithm: "Ed25519";
      readonly issuedAt: string;
    };
    readonly content: T;
  };
}

/**
 * A sealed artifact.
 *
 * `dsse` is the authoritative signed object. Every other field is a **decoded
 * projection** of the Statement inside it, kept flat because the whole
 * repository reads artifacts that way. The projection is not trusted: `verify`
 * rebuilds the Statement from these fields and requires it to equal the signed
 * bytes exactly, so a projection that disagrees with what was signed is a
 * verification failure rather than a quiet inconsistency.
 */
export interface SealedArtifact<T extends JsonValue = JsonValue> extends ArtifactBinding {
  readonly artifactId: string;
  readonly algorithm: "Ed25519";
  readonly keyId: string;
  readonly issuedAt: string;
  readonly payloadDigest: string;
  readonly payload: T;
  readonly dsse: DsseEnvelope;
}

export interface VerificationExpectation extends ArtifactBinding {
  readonly now: Date;
}

export type VerificationResult =
  | { readonly ok: true; readonly artifactId: string; readonly keyId: string }
  | { readonly ok: false; readonly code: VerificationErrorCode };

export type VerificationErrorCode =
  | "VES_INTEGRITY_PAYLOAD_DIGEST_MISMATCH"
  | "VES_INTEGRITY_ARTIFACT_ID_MISMATCH"
  | "VES_INTEGRITY_SCHEMA_MISMATCH"
  | "VES_INTEGRITY_PURPOSE_MISMATCH"
  | "VES_INTEGRITY_SOURCE_STATE_MISMATCH"
  | "VES_INTEGRITY_BINDING_MISMATCH"
  | "VES_TRUST_KEY_UNKNOWN"
  | "VES_TRUST_KEY_REVOKED"
  | "VES_TRUST_PURPOSE_DENIED"
  | "VES_TRUST_KEY_NOT_YET_VALID"
  | "VES_TRUST_KEY_EXPIRED"
  | "VES_TRUST_KEY_INVALID"
  | "VES_SIGNATURE_INVALID"
  // Not a recognized DSSE envelope, wrong payloadType, wrong Statement type,
  // an unknown predicate type, or a legacy pre-DSSE artifact. Fail closed:
  // there is no legacy verification path to fall back to.
  | "VES_ENVELOPE_UNSUPPORTED";
