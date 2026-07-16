import assert from "node:assert/strict";
import { test } from "node:test";

import { runCrossBackendJourney } from "../helpers/cross-backend-journey-fixture.mjs";

test("portable package and Handoff contain no backend session or transcript identity", async () => {
  const result = await runCrossBackendJourney();
  const portable = JSON.stringify([result.sealedPackage, result.portableHandoff]).toLowerCase();
  for (const forbidden of ["claude", "codex", "opencode", "qwen", "provider", "session", "transcript"]) {
    assert.equal(portable.includes(forbidden), false);
  }
});

test("independent verifier differs from commit author and PASS still stops for Human Review", async () => {
  const result = await runCrossBackendJourney();
  assert.notEqual(result.verificationInput.verifier.actorId, result.verificationInput.commit.authorActorId);
  assert.equal(result.verification.verdict, "PASS");
  assert.equal(result.verification.nextState, "HUMAN_REVIEW");
  assert.equal(result.reviewInput.reviewer.actorKind, "human");
});

test("machine profiles remain local while shared artifacts are backend-neutral", async () => {
  const result = await runCrossBackendJourney();
  assert.notDeepEqual(result.sourceProfileStore.profile, result.receiverProfileStore.profile);
  assert.equal(result.sharedArtifactDigestBeforeProfiles, result.sharedArtifactDigestAfterProfiles);
  const shared = JSON.stringify(result.sharedArtifacts).toLowerCase();
  for (const forbidden of ["credential", "secretvalue", "machineprofile", "qwen3-coder", "claude-opus"]) {
    assert.equal(shared.includes(forbidden), false);
  }
});
