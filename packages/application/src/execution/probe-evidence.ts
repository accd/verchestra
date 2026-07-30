// An Execution Package can seal references to the read-only probe evidence that
// informed its plan (R8). Sealing the reference is only half the promise: on
// resume, the referenced state has to still be the state that was decided from,
// or the reproducibility claim is decoration.
//
// This verifier lives in application because it is the only layer that may see
// both sides. `packages/evidence` seals the reference and `packages/data-probe`
// produced it, and those two are siblings that cannot import each other.

export type ProbeEvidenceErrorCode = "VES_PROBE_EVIDENCE_INVALID" | "VES_PROBE_EVIDENCE_UNVERIFIED";

export class ProbeEvidenceError extends Error {
  readonly code: ProbeEvidenceErrorCode;

  constructor(code: ProbeEvidenceErrorCode, message: string) {
    super(message);
    this.name = "ProbeEvidenceError";
    this.code = code;
  }
}

export type ProbeClassification = "public" | "internal" | "confidential" | "restricted";

export interface ProbeEvidenceReference {
  readonly resultDigest: string;
  readonly schemaIdentityDigest: string;
  readonly registrationDigest: string;
  readonly queryFingerprint: string;
  readonly producingRunId: string;
  readonly protectedResultRef: string;
  readonly classification: ProbeClassification;
  readonly redactionApplied: boolean;
  readonly sanitizedClaimCount: number;
}

export interface ResolvedProbeResult {
  readonly resultDigest: string;
  readonly classification: ProbeClassification;
  readonly redactionApplied: boolean;
}

export interface ProbeEvidencePort {
  // Re-reads the protected result and recomputes its digest. A null result means
  // the evidence is gone, which is a verification failure rather than an absence
  // to shrug at: the package promised it.
  resolve(reference: { readonly protectedResultRef: string }): Promise<ResolvedProbeResult | null>;
}

export type ProbeEvidenceFailureReason =
  "unresolvable" | "digest-mismatch" | "classification-changed" | "redaction-lost";

export interface ProbeEvidenceFailure {
  readonly protectedResultRef: string;
  readonly reason: ProbeEvidenceFailureReason;
  readonly sealedDigest: string;
  readonly observedDigest: string | null;
}

export type ProbeEvidenceVerdict =
  | { readonly ok: true; readonly verified: number }
  | { readonly ok: false; readonly failures: readonly ProbeEvidenceFailure[] };

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u;
const CLASSES: readonly ProbeClassification[] = ["public", "internal", "confidential", "restricted"];

function fail(code: ProbeEvidenceErrorCode, message: string): never {
  throw new ProbeEvidenceError(code, message);
}

function normalizeReference(value: unknown, index: number): ProbeEvidenceReference {
  if (value === null || typeof value !== "object")
    fail("VES_PROBE_EVIDENCE_INVALID", `probe evidence reference ${index} is not an object`);
  const row = value as Record<string, unknown>;
  for (const field of ["resultDigest", "schemaIdentityDigest", "registrationDigest", "queryFingerprint"])
    if (typeof row[field] !== "string" || !DIGEST.test(row[field] as string))
      fail("VES_PROBE_EVIDENCE_INVALID", `probe evidence ${field} is not a digest`);
  for (const field of ["producingRunId", "protectedResultRef"])
    if (typeof row[field] !== "string" || !SAFE.test(row[field] as string))
      fail("VES_PROBE_EVIDENCE_INVALID", `probe evidence ${field} is invalid`);
  if (!CLASSES.includes(row["classification"] as ProbeClassification))
    fail("VES_PROBE_EVIDENCE_INVALID", "probe evidence classification is not a declared class");
  if (typeof row["redactionApplied"] !== "boolean")
    fail("VES_PROBE_EVIDENCE_INVALID", "probe evidence redactionApplied must be a boolean");
  if (!Number.isSafeInteger(row["sanitizedClaimCount"]) || (row["sanitizedClaimCount"] as number) < 0)
    fail("VES_PROBE_EVIDENCE_INVALID", "probe evidence sanitizedClaimCount is invalid");
  return Object.freeze({
    resultDigest: row["resultDigest"] as string,
    schemaIdentityDigest: row["schemaIdentityDigest"] as string,
    registrationDigest: row["registrationDigest"] as string,
    queryFingerprint: row["queryFingerprint"] as string,
    producingRunId: row["producingRunId"] as string,
    protectedResultRef: row["protectedResultRef"] as string,
    classification: row["classification"] as ProbeClassification,
    redactionApplied: row["redactionApplied"] as boolean,
    sanitizedClaimCount: row["sanitizedClaimCount"] as number
  });
}

// A resume must not silently proceed on probe evidence that moved. Every
// reference is checked, and every failure is reported, so one bad reference does
// not hide the others behind an early return.
export async function verifyProbeEvidence(
  references: readonly unknown[] | undefined,
  port: ProbeEvidencePort
): Promise<ProbeEvidenceVerdict> {
  if (references === undefined) return Object.freeze({ ok: true, verified: 0 });
  if (!Array.isArray(references)) fail("VES_PROBE_EVIDENCE_INVALID", "probe evidence is not a list");
  const normalized = references.map((entry, index) => normalizeReference(entry, index));
  const failures: ProbeEvidenceFailure[] = [];

  for (const reference of normalized) {
    const observed = await port.resolve({ protectedResultRef: reference.protectedResultRef });
    const record = (reason: ProbeEvidenceFailureReason, observedDigest: string | null): void => {
      failures.push(
        Object.freeze({
          protectedResultRef: reference.protectedResultRef,
          reason,
          sealedDigest: reference.resultDigest,
          observedDigest
        })
      );
    };
    if (observed === null) {
      record("unresolvable", null);
      continue;
    }
    if (observed.resultDigest !== reference.resultDigest) {
      record("digest-mismatch", observed.resultDigest);
      continue;
    }
    // Reclassification after sealing means the package's data-access reasoning
    // was decided against a class that no longer applies. Fail closed: a probe
    // that became restricted is not a probe the old plan was cleared for.
    if (observed.classification !== reference.classification) {
      record("classification-changed", observed.resultDigest);
      continue;
    }
    // Losing redaction is the leak case, not merely a mismatch.
    if (reference.redactionApplied && !observed.redactionApplied) record("redaction-lost", observed.resultDigest);
  }

  return failures.length === 0
    ? Object.freeze({ ok: true, verified: normalized.length })
    : Object.freeze({ ok: false, failures: Object.freeze([...failures]) });
}
