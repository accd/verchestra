// The only place that wires the sealed-holdout evaluator together (T74, #15).
// Application owns the promotion rules; this composition root constructs the
// evaluator's distinct signing identity, seals the holdout oracle before the
// candidate is evaluated (the candidate is bound to the digest, never the
// contents), and seals the promotion report with the existing ArtifactSealer.
import { createHash } from "node:crypto";

import {
  buildPromotionReport,
  canonicalizePromotionObservations,
  canonicalizeOracle,
  collectPromotionObservations,
  createEvaluatorCandidateGrant,
  type CandidateGrant,
  evaluatePromotion,
  type HoldoutOracle,
  type PromotionDecision,
  type PromotionInput,
  type PromotionObservationPort,
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
  /**
   * The candidate's own hook. It receives the surface the evaluator issues and
   * may attempt anything on it; every attempt is denied by authority. Optional
   * because a candidate that declines to try is not thereby granted anything.
   */
  readonly attempt?: (grant: CandidateGrant) => void;
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

export async function runPromotion(
  oracle: HoldoutOracle,
  candidate: CandidateFacts,
  observationPort: PromotionObservationPort
): Promise<PromotionOutcome> {
  // Snapshot evaluator-owned outcomes before exposing any surface to the
  // candidate. A candidate callback can no longer replace or mutate the
  // evidence used to authorize its own promotion.
  const observations = collectPromotionObservations(oracle, observationPort);
  // PROM-09 / AD-018. The grant is issued over the evaluator's REAL assets and
  // handed to the candidate, because a boundary nothing crosses proves nothing:
  // an independent verifier found the surface built but unwired, so PROM-09's
  // antecedent was never satisfied and the requirement was vacuously true.
  //
  // Whatever the candidate does with it, it holds no authority. Its attempts
  // throw inside its own hook; a candidate that lets one escape fails its own
  // promotion rather than the evaluator's, so the evaluator neither swallows
  // nor is destabilized by it.
  const grant = createEvaluatorCandidateGrant({
    oracle,
    criteria: oracle.entries,
    "evaluator-state": { evaluatorKeyId: EVALUATOR_KEY_ID, sealedHoldoutDigest: sealHoldout(oracle) },
    "pre-seal-report": null
  });
  candidate.attempt?.(grant);

  const input: PromotionInput = {
    oracle,
    sealedHoldoutDigest: sealHoldout(oracle),
    candidateDigestAtSeal: candidate.candidateDigestAtSeal,
    candidateDigestNow: candidate.candidateDigestNow,
    evaluatorKeyId: EVALUATOR_KEY_ID,
    candidateKeyId: candidate.candidateKeyId,
    contaminated: candidate.contaminated,
    observations
  };
  const decision = evaluatePromotion(input, sha256);
  const report = buildPromotionReport(input, decision, sha256);
  const signer = NodeEd25519Signer.generate({ keyId: EVALUATOR_KEY_ID, purposes: ["promotion-report"] });
  const sealer = new ArtifactSealer({ signer, now: () => new Date() });
  const artifact = await sealer.seal(report as unknown as SealablePayload, {
    schema: { name: "promotion-report", version: 1 },
    purpose: "promotion-report",
    bindingId: "promotion-gate",
    // T74 finding F2: the source state a promotion rests on is the oracle AND
    // the admitted campaign evidence. Binding the oracle alone left two runs on
    // materially different evidence sharing a sourceStateDigest, so the sealed
    // artifact could not distinguish them.
    sourceStateDigest: sha256(`${canonicalizeOracle(oracle)}\n${canonicalizePromotionObservations(observations)}`)
  });
  return Object.freeze({ decision, report, artifact });
}
