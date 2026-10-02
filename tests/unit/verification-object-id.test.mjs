// invariant: independent verification and human review name the commit under
// review by a complete Git object ID in either object format (ADP-1): a
// SHA-256 repository is verified and reviewed exactly like a SHA-1 one, and
// nothing shorter, longer, or in between is admitted.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  coordinator,
  humanReviewCoordinator,
  humanReviewInput,
  humanReviewPorts,
  verificationInput,
  verificationPorts
} from "../helpers/verification-fixture.mjs";

const COMPLETE = Object.freeze({ "SHA-1": "b".repeat(40), "SHA-256": "c".repeat(64) });
const INCOMPLETE = Object.freeze(["b".repeat(39), "b".repeat(41), "c".repeat(63), "c".repeat(65), "B".repeat(64)]);

for (const [format, commitId] of Object.entries(COMPLETE)) {
  test(`a ${format} commit is verified and its ID is bound into the report`, async () => {
    const input = verificationInput();
    input.commit.commitId = commitId;
    const { state, ports } = verificationPorts();
    const result = await coordinator(ports).verify(input);
    assert.equal(result.verdict, "PASS");
    assert.equal(state.reports[0].commitId, commitId);
  });

  test(`a verified ${format} commit is accepted by human review`, async () => {
    const input = humanReviewInput();
    input.verification.commitId = commitId;
    const { state, ports } = humanReviewPorts();
    const result = await humanReviewCoordinator(ports).review(input);
    assert.equal(result.status, "COMPLETED");
    assert.equal(state.reviews[0].commitId, commitId);
  });
}

test("a commit ID that is not a complete object ID is refused before any verification effect", async () => {
  for (const commitId of INCOMPLETE) {
    const input = verificationInput();
    input.commit.commitId = commitId;
    const { state, ports } = verificationPorts();
    await assert.rejects(coordinator(ports).verify(input), { code: "VES_VERIFIER_INPUT_INVALID" }, commitId);
    assert.deepEqual(state.calls, []);
  }
});

test("human review of a report whose commit ID is not a complete object ID is refused", async () => {
  for (const commitId of INCOMPLETE) {
    const input = humanReviewInput();
    input.verification.commitId = commitId;
    const { state, ports } = humanReviewPorts();
    await assert.rejects(
      humanReviewCoordinator(ports).review(input),
      { code: "VES_HUMAN_REVIEW_REPORT_INVALID" },
      commitId
    );
    assert.deepEqual(state.reviews, []);
  }
});
