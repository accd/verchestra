import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReleaseCandidate } from "../../packages/distribution/src/index.ts";
import { bundleInput, sha } from "../helpers/hermetic-bundle-fixture.mjs";
import { buildHermeticDistributionBundle } from "../../packages/distribution/src/hermetic-bundle.ts";

const revision = "b".repeat(40);

function input() {
  const bundle = buildHermeticDistributionBundle(bundleInput());
  const views = ["online", "mirror", "offline", "air-gapped"].map((mode) => ({
    mode,
    sourceId: `source:${mode}`,
    releaseDigest: bundle.releaseDigest,
    metadataDigest: sha(`${mode}:metadata`),
    targetDigest: sha(`${mode}:target`)
  }));
  return {
    schemaVersion: 1,
    candidateId: "candidate:security-fixture",
    revision,
    semanticVersion: bundle.semanticVersion,
    bundle,
    views,
    evidence: bundle.components
      .filter((entry) => ["license", "sbom", "provenance", "evaluation"].includes(entry.kind))
      .map((entry) => ({ kind: entry.kind, digest: entry.contentDigest, sizeBytes: entry.sizeBytes })),
    rollback: {
      previousReleaseDigest: sha("security-previous"),
      verified: true,
      verificationDigest: sha("security-rollback-proof")
    }
  };
}

test("candidate refuses a source identity that could escape the pinned source boundary", () => {
  const value = input();
  value.views[0].sourceId = "https://attacker.invalid";
  assert.throws(() => buildReleaseCandidate(value), { code: "VES_RELEASE_CANDIDATE_INPUT_INVALID" });
});

test("candidate refuses a forged evidence size even when the digest is unchanged", () => {
  const value = input();
  value.evidence[0].sizeBytes += 1;
  assert.throws(() => buildReleaseCandidate(value), { code: "VES_RELEASE_CANDIDATE_EVIDENCE_MISMATCH" });
});

test("candidate refuses a rollback proof that points at the candidate itself", () => {
  const value = input();
  value.rollback.previousReleaseDigest = value.bundle.releaseDigest;
  assert.throws(() => buildReleaseCandidate(value), { code: "VES_RELEASE_CANDIDATE_ROLLBACK_INVALID" });
});
