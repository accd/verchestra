// Sealed-holdout promotion gate (T74, #15). Pure: the oracle serialization, the
// block checks, the decision, and the report integrity all live here so they are
// unit-testable without a filesystem or a signer. The composition root supplies
// the distinct evaluator identity and the sha256 hash; nothing here can read a
// candidate's authority — the candidate reaches the gate only as a digest and a
// contamination fact.

import { canonicalizeJsonV2, normalizeDeclaredSet } from "@verchestra/domain";

import type { CampaignRunResult } from "../regression/campaigns.ts";

export type PromotionErrorCode =
  "VES_PROMOTION_INPUT_INVALID" | "VES_PROMOTION_REPORT_INVALID" | "VES_PROMOTION_REPORT_TAMPERED";

export type PromotionBlockCode =
  | "VES_PROMOTION_ORACLE_TAMPERED"
  | "VES_PROMOTION_CANDIDATE_MUTATED"
  | "VES_PROMOTION_SHARED_IDENTITY"
  | "VES_PROMOTION_CONTAMINATED"
  | "VES_PROMOTION_INSUFFICIENT_REPETITION"
  | "VES_PROMOTION_CAMPAIGN_FAILED";

const BLOCK_CODES: ReadonlySet<string> = new Set([
  "VES_PROMOTION_ORACLE_TAMPERED",
  "VES_PROMOTION_CANDIDATE_MUTATED",
  "VES_PROMOTION_SHARED_IDENTITY",
  "VES_PROMOTION_CONTAMINATED",
  "VES_PROMOTION_INSUFFICIENT_REPETITION",
  "VES_PROMOTION_CAMPAIGN_FAILED"
]);

export class PromotionError extends Error {
  readonly code: PromotionErrorCode;

  constructor(code: PromotionErrorCode, message: string) {
    super(message);
    this.name = "PromotionError";
    this.code = code;
  }
}

function fail(code: PromotionErrorCode, message: string): never {
  throw new PromotionError(code, message);
}

export interface HoldoutEntry {
  readonly campaignId: string;
  readonly threshold: number;
  readonly repetitionCount: number;
}

export interface HoldoutOracle {
  readonly policyId: string;
  readonly entries: readonly HoldoutEntry[];
}

export type Sha256Hex = (input: string) => string;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[a-z][a-z0-9-]*$/u;

function assertOracleEntry(entry: HoldoutEntry): void {
  if (!ID.test(entry.campaignId)) fail("VES_PROMOTION_INPUT_INVALID", "holdout entry campaign id is invalid");
  if (typeof entry.threshold !== "number" || entry.threshold < 0 || entry.threshold > 1)
    fail("VES_PROMOTION_INPUT_INVALID", `holdout ${entry.campaignId} threshold is out of range`);
  if (!Number.isSafeInteger(entry.repetitionCount) || entry.repetitionCount < 1)
    fail("VES_PROMOTION_INPUT_INVALID", `holdout ${entry.campaignId} repetition count is invalid`);
}

function assertOracle(oracle: HoldoutOracle): void {
  if (oracle === null || typeof oracle !== "object" || !ID.test(oracle.policyId))
    fail("VES_PROMOTION_INPUT_INVALID", "holdout policy id is invalid");
  if (!Array.isArray(oracle.entries) || oracle.entries.length === 0)
    fail("VES_PROMOTION_INPUT_INVALID", "holdout oracle has no entries");
  for (const entry of oracle.entries) assertOracleEntry(entry);
}

// PROM-01/PROM-04: the deterministic serialization sealed into the holdout
// digest. Thresholds and repetition counts are part of it, so drift changes the
// digest and is detected at decision time. Entries are a declared set keyed by
// campaignId, so they are normalized to code-unit order (CJ4-03) before V2
// encoding — ambient locale never determines this digest.
export function canonicalizeOracle(oracle: HoldoutOracle): string {
  assertOracle(oracle);
  return canonicalizeJsonV2({
    entries: normalizeDeclaredSet(oracle.entries, (entry) => entry.campaignId).map((entry) => ({
      campaignId: entry.campaignId,
      repetitionCount: entry.repetitionCount,
      threshold: entry.threshold
    })),
    policyId: oracle.policyId
  });
}

// PROM-06 / T74 finding F2. The admitted campaign evidence is what authorized a
// promotion, so the signed decision has to bind it. Without this the same
// candidate and oracle promoted on materially different evidence — (samples=100,
// lowerBound=0.99) versus (samples=90, lowerBound=0.81) — produced byte-identical
// reports and digests, so the artifact could not say which evidence it rested on.
//
// Results are a declared set keyed by campaign id, exactly as the oracle entries
// and the block codes already are (CJ4-03), so they are normalized to code-unit
// order before V2 encoding. Reordering the same evidence is therefore identity-
// preserving while any content change is not — a digest that moved with
// iteration order would make the same evidence sign differently on different
// machines, which is the reproducibility the product exists to promise.
//
// SPEC_DEVIATION: F2's remediation text asks for assertions that "evidence order"
// changes the digest. Normalizing is the deliberate opposite, for the reason
// above; the content-sensitivity F2 actually protects is fully asserted.
export function canonicalizeCampaignEvidence(results: readonly CampaignRunResult[]): string {
  if (!Array.isArray(results)) fail("VES_PROMOTION_INPUT_INVALID", "campaign results are invalid");
  return canonicalizeJsonV2({
    results: normalizeDeclaredSet(results, (result) => result.id).map((result) => ({
      id: result.id,
      lowerConfidenceBound: result.lowerConfidenceBound,
      passRate: result.passRate,
      passes: result.passes,
      samples: result.samples,
      verdict: result.verdict
    }))
  });
}

export type PromotionVerdict = "PROMOTED" | "BLOCKED";

export interface PromotionInput {
  readonly oracle: HoldoutOracle;
  readonly sealedHoldoutDigest: string;
  readonly candidateDigestAtSeal: string;
  readonly candidateDigestNow: string;
  readonly evaluatorKeyId: string;
  readonly candidateKeyId: string;
  readonly contaminated: boolean;
  readonly results: readonly CampaignRunResult[];
}

export interface PromotionDecision {
  readonly verdict: PromotionVerdict;
  readonly blocks: readonly PromotionBlockCode[];
}

function assertInput(input: PromotionInput): void {
  assertOracle(input.oracle);
  for (const digest of [input.sealedHoldoutDigest, input.candidateDigestAtSeal, input.candidateDigestNow])
    if (!DIGEST.test(digest)) fail("VES_PROMOTION_INPUT_INVALID", "a bound digest is not a sha256 value");
  if (!ID.test(input.evaluatorKeyId) || !ID.test(input.candidateKeyId))
    fail("VES_PROMOTION_INPUT_INVALID", "an identity key id is invalid");
  if (typeof input.contaminated !== "boolean" || !Array.isArray(input.results))
    fail("VES_PROMOTION_INPUT_INVALID", "contamination fact or results are invalid");
}

function integrityBlocks(input: PromotionInput, hash: Sha256Hex): PromotionBlockCode[] {
  const blocks: PromotionBlockCode[] = [];
  if (`sha256:${hash(canonicalizeOracle(input.oracle))}` !== input.sealedHoldoutDigest)
    blocks.push("VES_PROMOTION_ORACLE_TAMPERED");
  if (input.candidateDigestAtSeal !== input.candidateDigestNow) blocks.push("VES_PROMOTION_CANDIDATE_MUTATED");
  if (input.evaluatorKeyId === input.candidateKeyId) blocks.push("VES_PROMOTION_SHARED_IDENTITY");
  if (input.contaminated === true) blocks.push("VES_PROMOTION_CONTAMINATED");
  return blocks;
}

function campaignBlocks(input: PromotionInput): PromotionBlockCode[] {
  const blocks: PromotionBlockCode[] = [];
  const byId = new Map(input.results.map((result) => [result.id, result]));
  for (const entry of input.oracle.entries) {
    const result = byId.get(entry.campaignId);
    if (result === undefined || result.samples < entry.repetitionCount)
      blocks.push("VES_PROMOTION_INSUFFICIENT_REPETITION");
    else if (result.lowerConfidenceBound < entry.threshold) blocks.push("VES_PROMOTION_CAMPAIGN_FAILED");
  }
  return blocks;
}

// PROM-07: PROMOTED only when no integrity block holds and every campaign clears
// its sealed threshold via its lower confidence bound. The block set is a
// declared set (order carries no meaning beyond stable presentation), so it is
// normalized to code-unit order (CJ4-03) rather than sorted by ambient locale.
export function evaluatePromotion(input: PromotionInput, hash: Sha256Hex): PromotionDecision {
  assertInput(input);
  const blocks = normalizeDeclaredSet(
    [...new Set([...integrityBlocks(input, hash), ...campaignBlocks(input)])],
    (code) => code
  );
  return Object.freeze({ verdict: blocks.length === 0 ? "PROMOTED" : "BLOCKED", blocks: Object.freeze(blocks) });
}

export const PROMOTION_REPORT_FIELDS = Object.freeze([
  "verdict",
  "candidateDigest",
  "holdoutDigest",
  "policyId",
  "evaluatorKeyId",
  "evidenceDigest",
  "blocks",
  "bodyDigest"
] as const);

export interface PromotionReportPayload {
  readonly verdict: PromotionVerdict;
  readonly candidateDigest: string;
  readonly holdoutDigest: string;
  readonly policyId: string;
  readonly evaluatorKeyId: string;
  /** Digest of the admitted campaign evidence this decision rested on (F2). */
  readonly evidenceDigest: string;
  readonly blocks: readonly string[];
  readonly bodyDigest: string;
}

// The deterministic body over which the integrity digest is taken; the same
// serialization is used to build and to verify, so any altered field changes it.
function canonicalBody(fields: Omit<PromotionReportPayload, "bodyDigest">): string {
  return JSON.stringify({
    blocks: [...fields.blocks],
    candidateDigest: fields.candidateDigest,
    evaluatorKeyId: fields.evaluatorKeyId,
    evidenceDigest: fields.evidenceDigest,
    holdoutDigest: fields.holdoutDigest,
    policyId: fields.policyId,
    verdict: fields.verdict
  });
}

export function buildPromotionReport(
  input: PromotionInput,
  decision: PromotionDecision,
  hash: Sha256Hex
): PromotionReportPayload {
  const body = {
    verdict: decision.verdict,
    candidateDigest: input.candidateDigestNow,
    holdoutDigest: input.sealedHoldoutDigest,
    policyId: input.oracle.policyId,
    evaluatorKeyId: input.evaluatorKeyId,
    evidenceDigest: `sha256:${hash(canonicalizeCampaignEvidence(input.results))}`,
    blocks: [...decision.blocks]
  };
  const payload = Object.freeze({ ...body, bodyDigest: `sha256:${hash(canonicalBody(body))}` });
  assertPromotionReport(payload);
  return payload;
}

export function assertPromotionReport(payload: PromotionReportPayload): void {
  assertReportShape(payload);
  if (!Array.isArray(payload.blocks) || payload.blocks.some((code) => !BLOCK_CODES.has(code)))
    fail("VES_PROMOTION_REPORT_INVALID", "promotion report carries an unregistered block code");
  if ((payload.verdict === "PROMOTED") !== (payload.blocks.length === 0))
    fail("VES_PROMOTION_REPORT_INVALID", "promotion verdict does not agree with its block set");
}

function assertReportScalars(payload: PromotionReportPayload): void {
  if (payload.verdict !== "PROMOTED" && payload.verdict !== "BLOCKED")
    fail("VES_PROMOTION_REPORT_INVALID", "promotion verdict is invalid");
  for (const digest of [payload.candidateDigest, payload.holdoutDigest, payload.evidenceDigest, payload.bodyDigest])
    if (!DIGEST.test(digest)) fail("VES_PROMOTION_REPORT_INVALID", "a bound digest is invalid");
  if (!ID.test(payload.policyId) || !ID.test(payload.evaluatorKeyId))
    fail("VES_PROMOTION_REPORT_INVALID", "policy id or evaluator identity is invalid");
}

function assertReportShape(payload: PromotionReportPayload): void {
  if (payload === null || typeof payload !== "object")
    fail("VES_PROMOTION_REPORT_INVALID", "promotion report is malformed");
  for (const field of Object.keys(payload))
    if (!PROMOTION_REPORT_FIELDS.includes(field as (typeof PROMOTION_REPORT_FIELDS)[number]))
      fail("VES_PROMOTION_REPORT_INVALID", `promotion report field ${field} is outside the allowlist`);
  assertReportScalars(payload);
}

// PROM-06: a report whose body was altered no longer reproduces its digest.
export function assertReportUntampered(payload: PromotionReportPayload, hash: Sha256Hex): void {
  assertPromotionReport(payload);
  if (`sha256:${hash(canonicalBody(payload))}` !== payload.bodyDigest)
    fail("VES_PROMOTION_REPORT_TAMPERED", "promotion report body digest does not verify");
}
