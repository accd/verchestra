import assert from "node:assert/strict";
import { test } from "node:test";

import {
  coordinator,
  humanReviewInput,
  sha,
  verificationInput,
  verificationPorts
} from "../helpers/verification-fixture.mjs";

test("PASS verification enters HUMAN_REVIEW but never COMPLETED", async () => {
  const { state, ports } = verificationPorts();
  const result = await coordinator(ports).verify(verificationInput());
  assert.equal(result.nextState, "HUMAN_REVIEW");
  assert.equal(state.decisions[0].snapshot.state, "HUMAN_REVIEW");
  assert.notEqual(state.decisions[0].snapshot.state, "COMPLETED");
});

for (const repairCycles of [0, 1, 2]) {
  test(`verification gap starts approved repair cycle ${repairCycles + 1}`, async () => {
    const input = verificationInput();
    input.run.repairCycles = repairCycles;
    input.evidenceClaims.pop();
    const { state, ports } = verificationPorts();
    const result = await coordinator(ports).verify(input);
    assert.equal(result.nextState, "REPAIRING");
    assert.equal(state.decisions[0].snapshot.repairCycles, repairCycles + 1);
    assert.deepEqual(state.decisions[0].snapshot.approval, input.run.approval);
  });
}

test("fourth unresolved gap enters HUMAN_RESOLUTION_REQUIRED", async () => {
  const input = verificationInput();
  input.run.repairCycles = 3;
  input.evidenceClaims.pop();
  const { state, ports } = verificationPorts();
  const result = await coordinator(ports).verify(input);
  assert.equal(result.nextState, "HUMAN_RESOLUTION_REQUIRED");
  assert.equal(state.decisions[0].snapshot.repairCycles, 3);
});

test("accepted Human Review is the only service path to COMPLETED", async () => {
  const { state, ports } = verificationPorts();
  const result = await coordinator(ports).review(humanReviewInput());
  assert.equal(result.status, "COMPLETED");
  assert.equal(state.decisions[0].snapshot.state, "COMPLETED");
  assert.equal(state.decisions[0].snapshot.terminalCapsuleRequired, true);
});

test("rejected Human Review persists the outcome and never completes", async () => {
  const input = humanReviewInput();
  input.outcome = "rejected";
  input.findingRefs = ["finding:changes-required"];
  const { state, ports } = verificationPorts();
  const result = await coordinator(ports).review(input);
  assert.equal(result.status, "REVIEW_REJECTED");
  assert.equal(state.decisions.length, 0);
  assert.equal(state.reviews[0].outcome, "rejected");
});

test("non-human reviewer cannot authorize final completion", async () => {
  const input = humanReviewInput();
  input.reviewer.actorKind = "model";
  const { state, ports } = verificationPorts();
  await assert.rejects(coordinator(ports).review(input), { code: "VES_HUMAN_REVIEW_ACTOR_INVALID" });
  assert.equal(state.reviews.length, 0);
});

test("stale Human Review surface cannot authorize completion", async () => {
  const input = humanReviewInput();
  input.currentSurfaceDigest = sha("changed-surface");
  const { state, ports } = verificationPorts();
  await assert.rejects(coordinator(ports).review(input), { code: "VES_HUMAN_REVIEW_STALE" });
  assert.equal(state.reviews.length, 0);
});

test("non-PASS verification report cannot reach Human Review completion", async () => {
  const input = humanReviewInput({ verdict: "FAIL" });
  const { state, ports } = verificationPorts();
  await assert.rejects(coordinator(ports).review(input), { code: "VES_HUMAN_REVIEW_REPORT_INVALID" });
  assert.equal(state.decisions.length, 0);
});

test("caller-declared PASS cannot replace an authenticated verification report", async () => {
  const { state, ports } = verificationPorts({
    reports: {
      verify: async (verification) => ({ ...verification, valid: false })
    }
  });
  await assert.rejects(coordinator(ports).review(humanReviewInput()), {
    code: "VES_HUMAN_REVIEW_REPORT_INVALID"
  });
  assert.equal(state.reviews.length, 0);
  assert.equal(state.decisions.length, 0);
});

test("denied or forged Human Review authority creates no record", async () => {
  const { state, ports } = verificationPorts({
    humanAuthority: { verify: async () => ({ authorized: false }) }
  });
  await assert.rejects(coordinator(ports).review(humanReviewInput()), { code: "VES_HUMAN_REVIEW_AUTHORITY_DENIED" });
  assert.equal(state.reviews.length, 0);
  assert.equal(state.decisions.length, 0);
});

test("Human Review record binds exact verifier report commit and review surface", async () => {
  const input = humanReviewInput();
  const { state, ports } = verificationPorts();
  await coordinator(ports).review(input);
  assert.equal(state.reviews[0].verificationReportDigest, input.verification.reportDigest);
  assert.equal(state.reviews[0].commitId, input.verification.commitId);
  assert.equal(state.reviews[0].reviewSurfaceDigest, input.reviewSurfaceDigest);
  assert.equal(state.reviews[0].authorizationRef, "human-review-authorization:001");
});
