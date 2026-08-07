// The only place that wires the sealed-holdout evaluator together (T74, #15).
// Application owns the promotion rules; this composition root constructs the
// evaluator's distinct signing identity, seals the holdout oracle before the
// candidate is evaluated (the candidate is bound to the digest, never the
// contents), and seals the promotion report with the existing ArtifactSealer.
import { createHash } from "node:crypto";

import {
  buildPromotionReport,
  canonicalizeOracle,
  evaluatePromotion,
  type HoldoutOracle,
  type PromotionDecision,
  type PromotionInput,
  type PromotionReportPayload
} from "@verchestra/application";
import { ArtifactSealer, NodeEd25519Signer } from "@verchestra/evidence";

const sha256 = (input: string): string => createHash("sha256").update(input).digest("hex");

// A fixed, distinct evaluator identity: the promotion decision is signed by an
// identity that is not, and cannot be, a candidate's.
export const EVALUATOR_KEY_ID = "holdout-evaluator";

export interface CandidateFacts {
  readonly candidateDigestAtSeal: string;
  readonly candidateDigestNow: string;
  readonly candidateKeyId: string;
  readonly contaminated: boolean;
  readonly results: PromotionInput["results"];
}

// The sealer works over its own JsonValue type; the strongly-typed report is a
// valid JSON object, so it is cast to the sealer's payload type at the one seal
// call and travels strongly-typed alongside in `report`.
type SealablePayload = Parameters<ArtifactSealer["seal"]>[0];
export type SealedPromotionArtifact = Awaited<ReturnType<ArtifactSealer["seal"]>>;

export interface PromotionOutcome {
  readonly decision: PromotionDecision;
  readonly report: PromotionReportPayload;
  readonly artifact: SealedPromotionArtifact;
}

// Seals the oracle before evaluation. The candidate receives only this digest.
export function sealHoldout(oracle: HoldoutOracle): string {
  return `sha256:${sha256(canonicalizeOracle(oracle))}`;
}

export async function runPromotion(oracle: HoldoutOracle, candidate: CandidateFacts): Promise<PromotionOutcome> {
  const input: PromotionInput = {
    oracle,
    sealedHoldoutDigest: sealHoldout(oracle),
    candidateDigestAtSeal: candidate.candidateDigestAtSeal,
    candidateDigestNow: candidate.candidateDigestNow,
    evaluatorKeyId: EVALUATOR_KEY_ID,
    candidateKeyId: candidate.candidateKeyId,
    contaminated: candidate.contaminated,
    results: candidate.results
  };
  const decision = evaluatePromotion(input, sha256);
  const report = buildPromotionReport(input, decision, sha256);
  const signer = NodeEd25519Signer.generate({ keyId: EVALUATOR_KEY_ID, purposes: ["promotion-report"] });
  const sealer = new ArtifactSealer({ signer, now: () => new Date() });
  const artifact = await sealer.seal(report as unknown as SealablePayload, {
    schema: { name: "promotion-report", version: 1 },
    purpose: "promotion-report",
    bindingId: "promotion-gate",
    sourceStateDigest: sha256(canonicalizeOracle(oracle))
  });
  return Object.freeze({ decision, report, artifact });
}
