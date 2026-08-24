import { createHash } from "node:crypto";

import { canonicalizeJsonV2 } from "@verchestra/domain";

import { verifyHermeticDistributionBundle, type HermeticDistributionBundle } from "./hermetic-bundle.ts";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9:._@+/-]{0,255}$/u;
const MODES = ["online", "mirror", "offline", "air-gapped"] as const;
const MODE_SET = new Set<string>(MODES);
const EVIDENCE_KINDS = ["license", "sbom", "provenance", "evaluation"] as const;
const EVIDENCE_SET = new Set<string>(EVIDENCE_KINDS);

export type ReleaseViewMode = (typeof MODES)[number];
export type ReleaseEvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface ReleaseCandidateView {
  readonly mode: ReleaseViewMode;
  readonly sourceId: string;
  readonly releaseDigest: string;
  readonly metadataDigest: string;
  readonly targetDigest: string;
}

export interface ReleaseCandidateEvidence {
  readonly kind: ReleaseEvidenceKind;
  readonly digest: string;
  readonly sizeBytes: number;
}

export interface ReleaseCandidateRollback {
  readonly previousReleaseDigest: string;
  readonly verified: true;
  readonly verificationDigest: string;
}

export interface ReleaseCandidate {
  readonly schemaVersion: 1;
  readonly candidateId: string;
  readonly revision: string;
  readonly semanticVersion: string;
  readonly bundle: HermeticDistributionBundle;
  readonly views: readonly ReleaseCandidateView[];
  readonly evidence: readonly ReleaseCandidateEvidence[];
  readonly rollback: ReleaseCandidateRollback;
  readonly candidateDigest: string;
}

export class ReleaseCandidateError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReleaseCandidateError";
    this.code = code;
  }
}

type RecordValue = Readonly<Record<string, unknown>>;

const fail = (code: string, message: string, cause?: unknown): never => {
  throw new ReleaseCandidateError(code, message, cause === undefined ? undefined : { cause });
};

const record = (value: unknown, label: string): RecordValue => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("VES_RELEASE_CANDIDATE_INPUT_INVALID", `${label} must be an object`);
  return value as RecordValue;
};

// Candidate identity uses UTF-16 code-unit order, never localeCompare. The
// order is part of candidateDigest and must be identical on every host.
const codeUnitCompare = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const exact = (value: RecordValue, keys: readonly string[], label: string): void => {
  const actual = Object.keys(value).sort(codeUnitCompare);
  const expected = [...keys].sort(codeUnitCompare);
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    fail("VES_RELEASE_CANDIDATE_INPUT_INVALID", `${label} has missing or unknown fields`);
};

const text = (value: unknown, label: string, pattern = SAFE_ID): string => {
  if (typeof value !== "string" || !pattern.test(value))
    fail("VES_RELEASE_CANDIDATE_INPUT_INVALID", `${label} is invalid`);
  return value as string;
};

const digest = (value: unknown, label: string): string => text(value, label, DIGEST);

const hash = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const compareViews = (left: ReleaseCandidateView, right: ReleaseCandidateView): number =>
  codeUnitCompare(left.mode, right.mode);

const compareEvidence = (left: ReleaseCandidateEvidence, right: ReleaseCandidateEvidence): number =>
  codeUnitCompare(left.kind, right.kind);

const normalizeViews = (value: unknown, releaseDigest: string): readonly ReleaseCandidateView[] => {
  if (!Array.isArray(value) || value.length !== MODES.length)
    fail("VES_RELEASE_CANDIDATE_VIEWS_INCOMPLETE", "candidate must carry exactly four release views");
  const views = (value as unknown[]).map((entry) => {
    const item = record(entry, "release view");
    exact(item, ["mode", "sourceId", "releaseDigest", "metadataDigest", "targetDigest"], "release view");
    const mode = text(item["mode"], "release view mode");
    if (!MODE_SET.has(mode)) fail("VES_RELEASE_CANDIDATE_VIEW_INVALID", "release view mode is unsupported");
    const viewReleaseDigest = digest(item["releaseDigest"], "release view releaseDigest");
    if (viewReleaseDigest !== releaseDigest)
      fail("VES_RELEASE_CANDIDATE_VIEW_MISMATCH", "release view points at another release");
    const sourceId = text(item["sourceId"], "release view sourceId");
    if (sourceId.includes("://"))
      fail("VES_RELEASE_CANDIDATE_INPUT_INVALID", "release view sourceId must not contain a URL");
    return Object.freeze({
      mode: mode as ReleaseViewMode,
      sourceId,
      releaseDigest: viewReleaseDigest,
      metadataDigest: digest(item["metadataDigest"], "release view metadataDigest"),
      targetDigest: digest(item["targetDigest"], "release view targetDigest")
    });
  });
  if (new Set(views.map((view) => view.mode)).size !== MODES.length)
    fail("VES_RELEASE_CANDIDATE_VIEWS_INCOMPLETE", "candidate release views must cover each source mode once");
  return Object.freeze([...views].sort(compareViews));
};

const normalizeEvidence = (value: unknown, bundle: HermeticDistributionBundle): readonly ReleaseCandidateEvidence[] => {
  if (!Array.isArray(value) || value.length !== EVIDENCE_KINDS.length)
    fail("VES_RELEASE_CANDIDATE_EVIDENCE_INCOMPLETE", "candidate evidence must cover the four required kinds");
  const evidence = (value as unknown[]).map((entry) => {
    const item = record(entry, "candidate evidence");
    exact(item, ["kind", "digest", "sizeBytes"], "candidate evidence");
    const kind = text(item["kind"], "candidate evidence kind");
    if (!EVIDENCE_SET.has(kind))
      fail("VES_RELEASE_CANDIDATE_EVIDENCE_INVALID", "candidate evidence kind is unsupported");
    const sizeBytes = item["sizeBytes"];
    if (!Number.isSafeInteger(sizeBytes) || (sizeBytes as number) <= 0)
      fail("VES_RELEASE_CANDIDATE_EVIDENCE_INVALID", "candidate evidence size is invalid");
    const component = bundle.components.filter((entry) => entry.kind === kind);
    if (component.length !== 1)
      fail("VES_RELEASE_CANDIDATE_EVIDENCE_INVALID", `${kind} must have one bundle component`);
    const evidenceDigest = digest(item["digest"], `candidate ${kind} digest`);
    if (component[0]!.contentDigest !== evidenceDigest || component[0]!.sizeBytes !== sizeBytes)
      fail("VES_RELEASE_CANDIDATE_EVIDENCE_MISMATCH", `${kind} evidence does not match the bundle closure`);
    return Object.freeze({ kind: kind as ReleaseEvidenceKind, digest: evidenceDigest, sizeBytes: sizeBytes as number });
  });
  if (new Set(evidence.map((entry) => entry.kind)).size !== EVIDENCE_KINDS.length)
    fail("VES_RELEASE_CANDIDATE_EVIDENCE_INCOMPLETE", "candidate evidence kinds must be unique");
  return Object.freeze([...evidence].sort(compareEvidence));
};

const normalizeRollback = (value: unknown, releaseDigest: string): ReleaseCandidateRollback => {
  const item = record(value, "rollback proof");
  exact(item, ["previousReleaseDigest", "verified", "verificationDigest"], "rollback proof");
  const previousReleaseDigest = digest(item["previousReleaseDigest"], "rollback previousReleaseDigest");
  if (previousReleaseDigest === releaseDigest)
    fail("VES_RELEASE_CANDIDATE_ROLLBACK_INVALID", "rollback target must differ from the candidate release");
  if (item["verified"] !== true)
    fail("VES_RELEASE_CANDIDATE_ROLLBACK_INVALID", "rollback target is not independently verified");
  return Object.freeze({
    previousReleaseDigest,
    verified: true,
    verificationDigest: digest(item["verificationDigest"], "rollback verificationDigest")
  });
};

type ReleaseCandidateBody = Omit<ReleaseCandidate, "candidateDigest">;

const normalizeBody = (value: unknown): ReleaseCandidateBody => {
  const input = record(value, "release candidate");
  exact(
    input,
    ["schemaVersion", "candidateId", "revision", "semanticVersion", "bundle", "views", "evidence", "rollback"],
    "release candidate"
  );
  if (input["schemaVersion"] !== 1)
    fail("VES_RELEASE_CANDIDATE_INPUT_INVALID", "release candidate schemaVersion must be 1");
  const candidateId = text(input["candidateId"], "candidateId");
  const revision = text(input["revision"], "revision", REVISION);
  const bundle = (() => {
    try {
      return verifyHermeticDistributionBundle(input["bundle"]);
    } catch (error) {
      return fail("VES_RELEASE_CANDIDATE_BUNDLE_INVALID", "release candidate bundle is invalid", error);
    }
  })();
  const semanticVersion = text(input["semanticVersion"], "semanticVersion");
  if (semanticVersion !== bundle.semanticVersion)
    fail("VES_RELEASE_CANDIDATE_BUNDLE_MISMATCH", "candidate semanticVersion differs from bundle");
  return Object.freeze({
    schemaVersion: 1,
    candidateId,
    revision,
    semanticVersion,
    bundle,
    views: normalizeViews(input["views"], bundle.releaseDigest),
    evidence: normalizeEvidence(input["evidence"], bundle),
    rollback: normalizeRollback(input["rollback"], bundle.releaseDigest)
  });
};

export function buildReleaseCandidate(value: unknown): ReleaseCandidate {
  const body = normalizeBody(value);
  return Object.freeze({ ...body, candidateDigest: hash(canonicalizeJsonV2(body)) });
}

export function verifyReleaseCandidate(value: unknown): ReleaseCandidate {
  const input = record(value, "release candidate");
  exact(
    input,
    [
      "schemaVersion",
      "candidateId",
      "revision",
      "semanticVersion",
      "bundle",
      "views",
      "evidence",
      "rollback",
      "candidateDigest"
    ],
    "release candidate"
  );
  const candidateDigest = digest(input["candidateDigest"], "candidateDigest");
  const rebuilt = buildReleaseCandidate({
    schemaVersion: input["schemaVersion"],
    candidateId: input["candidateId"],
    revision: input["revision"],
    semanticVersion: input["semanticVersion"],
    bundle: input["bundle"],
    views: input["views"],
    evidence: input["evidence"],
    rollback: input["rollback"]
  });
  if (rebuilt.candidateDigest !== candidateDigest)
    fail("VES_RELEASE_CANDIDATE_INTEGRITY", "candidate digest does not match its canonical closure");
  return rebuilt;
}
