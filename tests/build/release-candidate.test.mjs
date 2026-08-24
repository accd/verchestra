import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildHermeticDistributionBundle,
  buildReleaseCandidate,
  verifyReleaseCandidate
} from "../../packages/distribution/src/index.ts";
import { bundleInput, sha } from "../helpers/hermetic-bundle-fixture.mjs";

const revision = "a".repeat(40);

function candidateInput(overrides = {}) {
  const bundle = buildHermeticDistributionBundle(bundleInput());
  return {
    schemaVersion: 1,
    candidateId: "candidate:verchestra:2026-07-16:win32-x64",
    revision,
    semanticVersion: bundle.semanticVersion,
    bundle,
    views: [
      {
        mode: "online",
        sourceId: "source:primary",
        releaseDigest: bundle.releaseDigest,
        metadataDigest: sha("online-metadata"),
        targetDigest: sha("online-target")
      },
      {
        mode: "mirror",
        sourceId: "source:mirror",
        releaseDigest: bundle.releaseDigest,
        metadataDigest: sha("mirror-metadata"),
        targetDigest: sha("mirror-target")
      },
      {
        mode: "offline",
        sourceId: "source:offline",
        releaseDigest: bundle.releaseDigest,
        metadataDigest: sha("offline-metadata"),
        targetDigest: sha("offline-target")
      },
      {
        mode: "air-gapped",
        sourceId: "source:airgap",
        releaseDigest: bundle.releaseDigest,
        metadataDigest: sha("airgap-metadata"),
        targetDigest: sha("airgap-target")
      }
    ],
    evidence: bundle.components
      .filter((entry) => ["license", "sbom", "provenance", "evaluation"].includes(entry.kind))
      .map((entry) => ({ kind: entry.kind, digest: entry.contentDigest, sizeBytes: entry.sizeBytes })),
    rollback: {
      previousReleaseDigest: sha("previous-release"),
      verified: true,
      verificationDigest: sha("rollback-proof")
    },
    ...overrides
  };
}

test("complete candidate binds bundle, all four views, evidence, and rollback", () => {
  const candidate = buildReleaseCandidate(candidateInput());
  assert.match(candidate.candidateDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(
    candidate.views.map((entry) => entry.mode),
    ["air-gapped", "mirror", "offline", "online"]
  );
  assert.deepEqual(
    candidate.evidence.map((entry) => entry.kind),
    ["evaluation", "license", "provenance", "sbom"]
  );
  assert.equal(verifyReleaseCandidate(candidate).candidateDigest, candidate.candidateDigest);
});

test("candidate identity is independent of view and evidence input order", () => {
  const first = candidateInput();
  const second = candidateInput({ views: [...first.views].reverse(), evidence: [...first.evidence].reverse() });
  assert.deepEqual(buildReleaseCandidate(first), buildReleaseCandidate(second));
});

test("candidate verification rejects a changed canonical digest", () => {
  const candidate = buildReleaseCandidate(candidateInput());
  assert.throws(() => verifyReleaseCandidate({ ...candidate, candidateDigest: sha("tampered") }), {
    code: "VES_RELEASE_CANDIDATE_INTEGRITY"
  });
});

test("candidate requires every release view exactly once", () => {
  const input = candidateInput();
  assert.throws(() => buildReleaseCandidate({ ...input, views: input.views.slice(1) }), {
    code: "VES_RELEASE_CANDIDATE_VIEWS_INCOMPLETE"
  });
  assert.throws(
    () => buildReleaseCandidate({ ...input, views: input.views.map((entry) => ({ ...entry, mode: "online" })) }),
    {
      code: "VES_RELEASE_CANDIDATE_VIEWS_INCOMPLETE"
    }
  );
});

test("candidate rejects a view bound to a different release", () => {
  const input = candidateInput();
  input.views[0].releaseDigest = sha("other-release");
  assert.throws(() => buildReleaseCandidate(input), { code: "VES_RELEASE_CANDIDATE_VIEW_MISMATCH" });
});

test("candidate evidence must match the bundle's signed closure", () => {
  const input = candidateInput();
  input.evidence[0].digest = sha("forged-evidence");
  assert.throws(() => buildReleaseCandidate(input), { code: "VES_RELEASE_CANDIDATE_EVIDENCE_MISMATCH" });
});

test("candidate rejects an unverified or self-referential rollback", () => {
  const input = candidateInput();
  assert.throws(() => buildReleaseCandidate({ ...input, rollback: { ...input.rollback, verified: false } }), {
    code: "VES_RELEASE_CANDIDATE_ROLLBACK_INVALID"
  });
  assert.throws(
    () =>
      buildReleaseCandidate({
        ...input,
        rollback: { ...input.rollback, previousReleaseDigest: input.bundle.releaseDigest }
      }),
    {
      code: "VES_RELEASE_CANDIDATE_ROLLBACK_INVALID"
    }
  );
});

test("candidate revision is an exact immutable source binding", () => {
  assert.throws(() => buildReleaseCandidate({ ...candidateInput(), revision: "not-a-sha" }), {
    code: "VES_RELEASE_CANDIDATE_INPUT_INVALID"
  });
  const candidate = buildReleaseCandidate(candidateInput());
  assert.equal(Object.isFrozen(candidate), true);
  assert.equal(Object.isFrozen(candidate.views), true);
  assert.equal(Object.isFrozen(candidate.evidence), true);
});
