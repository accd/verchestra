// DSSE envelope and in-toto Statement construction (AD-014).
//
// The signed bytes are the DSSE Pre-Authentication Encoding, not the payload
// itself. That distinction is the whole security value of DSSE: the payload
// type is bound into what gets signed, so a signature made over an in-toto
// Statement cannot be replayed as a signature over a document of some other
// type that happens to share bytes. An implementation that signs the raw
// payload looks identical in every happy-path test and loses exactly this.

import { canonicalizeJsonForVersion } from "./canonical.ts";
import type { InTotoStatement, JsonValue, SchemaRef } from "./types.ts";

export const DSSE_PAYLOAD_TYPE = "application/vnd.in-toto+json";
export const IN_TOTO_STATEMENT_TYPE = "https://in-toto.io/Statement/v1";

// Hosted at the domain the project provably controls today (AD-001). Predicate
// type URIs are identifiers and need not resolve, but using an uncontrolled
// domain invites collision and misattribution. The trailing /v1 exists so that
// moving to a custom domain later is a versioned migration, not a redefinition.
const PREDICATE_BASE = "https://accd.github.io/verchestra/attestation";

// Closed by construction: an attestation this product cannot name is one it
// will not verify. Keyed by the sealed artifact's schema name.
const PREDICATE_TYPES_V1 = Object.freeze({
  "execution-package": `${PREDICATE_BASE}/execution-package/v1`,
  "run-capsule": `${PREDICATE_BASE}/run-capsule/v1`,
  "recovery-bundle": `${PREDICATE_BASE}/recovery-bundle/v1`,
  "support-bundle": `${PREDICATE_BASE}/support-bundle/v1`,
  "doctor-report": `${PREDICATE_BASE}/doctor-report/v1`,
  "promotion-report": `${PREDICATE_BASE}/promotion-report/v1`,
  "self-test-report": `${PREDICATE_BASE}/self-test-report/v1`,
  "approval-grant": `${PREDICATE_BASE}/approval-grant/v1`,
  "qualification-evidence-index": `${PREDICATE_BASE}/qualification-evidence-index/v1`
} as const);

// Schema V2 artifacts order every declared set by UTF-16 code unit and
// canonicalize through the domain RFC 8785 facade. Each gets its own predicate
// type rather than reusing /v1: the predicate is bound into the signed
// Statement bytes, so a V1 attestation and a V2 attestation of the same kind
// are distinct signed documents and neither can be read as the other.
const PREDICATE_TYPES_V2 = Object.freeze({
  "execution-package": `${PREDICATE_BASE}/execution-package/v2`,
  "run-capsule": `${PREDICATE_BASE}/run-capsule/v2`,
  "recovery-bundle": `${PREDICATE_BASE}/recovery-bundle/v2`,
  "support-bundle": `${PREDICATE_BASE}/support-bundle/v2`
} as const);

export type PredicateSchemaName = keyof typeof PREDICATE_TYPES_V1;

export function canonicalizationVersionForSchema(schema: SchemaRef): 1 | 2 | undefined {
  if (schema.version === 1 && schema.name in PREDICATE_TYPES_V1) return 1;
  if (schema.version === 2 && schema.name in PREDICATE_TYPES_V2) return 2;
  return undefined;
}

export function predicateTypeFor(schema: SchemaRef): string | undefined {
  if (schema.version === 1) return PREDICATE_TYPES_V1[schema.name as PredicateSchemaName];
  if (schema.version === 2) return PREDICATE_TYPES_V2[schema.name as keyof typeof PREDICATE_TYPES_V2];
  return undefined;
}

export function isKnownPredicateType(value: unknown): boolean {
  return (
    typeof value === "string" &&
    [...Object.values(PREDICATE_TYPES_V1), ...Object.values(PREDICATE_TYPES_V2)].includes(value as never)
  );
}

export function buildStatement<T extends JsonValue>(input: {
  readonly schema: SchemaRef;
  readonly purpose: string;
  readonly bindingId: string;
  readonly sourceStateDigest: string;
  readonly issuedAt: string;
  readonly payloadDigest: string;
  readonly predicateType: string;
  readonly content: T;
}): InTotoStatement<T> {
  return {
    _type: IN_TOTO_STATEMENT_TYPE,
    // The subject is the payload itself, named by its schema, addressed by the
    // digest the sealer already computed — so the payload-digest check survives
    // as a Statement-native property rather than a bespoke field.
    subject: [{ name: input.schema.name, digest: { sha256: input.payloadDigest } }],
    predicateType: input.predicateType,
    predicate: {
      binding: {
        schema: input.schema,
        purpose: input.purpose,
        bindingId: input.bindingId,
        sourceStateDigest: input.sourceStateDigest,
        algorithm: "Ed25519",
        issuedAt: input.issuedAt
      },
      content: input.content
    }
  };
}

export function statementBytes(statement: InTotoStatement): Buffer {
  const version = canonicalizationVersionForSchema(statement.predicate.binding.schema);
  if (version === undefined) throw new Error("Statement schema has no canonicalization version");
  return Buffer.from(canonicalizeJsonForVersion(version, statement as unknown as JsonValue), "utf8");
}

/**
 * DSSE Pre-Authentication Encoding.
 *
 *   PAE = "DSSEv1" SP len(payloadType) SP payloadType SP len(payload) SP payload
 *
 * Lengths are ASCII decimal byte counts, and `payload` here is the raw
 * Statement bytes, never the base64 text.
 */
export function preAuthenticationEncoding(payloadType: string, payload: Buffer): Buffer {
  const type = Buffer.from(payloadType, "utf8");
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${type.length} `, "utf8"),
    type,
    Buffer.from(` ${payload.length} `, "utf8"),
    payload
  ]);
}
