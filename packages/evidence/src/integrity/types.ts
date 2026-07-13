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

export interface SealedArtifact<T extends JsonValue = JsonValue> extends ArtifactBinding {
  readonly envelopeVersion: 1;
  readonly artifactId: string;
  readonly algorithm: "Ed25519";
  readonly keyId: string;
  readonly issuedAt: string;
  readonly payloadDigest: string;
  readonly payload: T;
  readonly signature: string;
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
  | "VES_SIGNATURE_INVALID";
