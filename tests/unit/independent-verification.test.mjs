import assert from "node:assert/strict";
import { test } from "node:test";

import { coordinator, sha, verificationInput, verificationPorts } from "../helpers/verification-fixture.mjs";

test("independent verifier covers every criterion with exact evidence and killed mutation", async () => {
  const { state, ports } = verificationPorts();
  const result = await coordinator(ports).verify(verificationInput());
  assert.equal(result.verdict, "PASS");
  assert.equal(result.nextState, "HUMAN_REVIEW");
  assert.deepEqual(
    state.reports[0].criteria.map((entry) => entry.status),
    ["COVERED", "COVERED"]
  );
  assert.deepEqual(
    state.reports[0].mutations.map((entry) => entry.status),
    ["KILLED", "KILLED"]
  );
});

test("same implementation author cannot act as Verifier", async () => {
  const input = verificationInput();
  input.verifier.actorId = input.commit.authorActorId;
  const { state, ports } = verificationPorts();
  await assert.rejects(coordinator(ports).verify(input), { code: "VES_VERIFIER_IDENTITY_CONFLICT" });
  assert.deepEqual(state.calls, []);
});

test("the implementer driver cannot also be the verifier driver, even with distinct actors", async () => {
  const input = verificationInput();
  input.verifierDriverId = input.implementerDriverId;
  const { state, ports } = verificationPorts();
  await assert.rejects(coordinator(ports).verify(input), (error) => {
    assert.equal(error.code, "VES_VERIFIER_DRIVER_CONFLICT");
    assert.match(error.message, new RegExp(input.implementerDriverId, "u"));
    return true;
  });
  assert.deepEqual(state.calls, []);
});

test("distinct driver identities are recorded on the sealed report under schemaVersion 2", async () => {
  const input = verificationInput();
  const { state, ports } = verificationPorts();
  await coordinator(ports).verify(input);
  assert.equal(state.reports[0].schemaVersion, 2);
  assert.deepEqual(state.reports[0].driverBinding, {
    implementerDriverId: input.implementerDriverId,
    verifierDriverId: input.verifierDriverId
  });
});

test("a stale schemaVersion 1 input is rejected, never silently upgraded", async () => {
  const input = verificationInput();
  input.schemaVersion = 1;
  const { state, ports } = verificationPorts();
  await assert.rejects(coordinator(ports).verify(input), { code: "VES_VERIFIER_INPUT_INVALID" });
  assert.deepEqual(state.calls, []);
});

test("verification input missing driver identities is rejected as invalid, not defaulted", async () => {
  const input = verificationInput();
  delete input.verifierDriverId;
  const { state, ports } = verificationPorts();
  await assert.rejects(coordinator(ports).verify(input), { code: "VES_VERIFIER_INPUT_INVALID" });
  assert.deepEqual(state.calls, []);
});

test("missing criterion evidence is evidence-or-zero and requests repair", async () => {
  const input = verificationInput();
  input.evidenceClaims = input.evidenceClaims.filter((claim) => claim.criterionId !== "AC-002");
  const { state, ports } = verificationPorts();
  const result = await coordinator(ports).verify(input);
  assert.equal(result.verdict, "FAIL");
  assert.equal(result.nextState, "REPAIRING");
  assert.deepEqual(state.reports[0].criteria[1], {
    criterionId: "AC-002",
    requirementId: "VES-VFY-004",
    status: "UNCOVERED",
    expectedOutcomeRef: "expected:AC-002",
    expectedOutcomeDigest: sha("expected:AC-002"),
    evidence: []
  });
});

test("evidence from another criterion is rejected before inspection", async () => {
  const input = verificationInput();
  input.evidenceClaims[0].criterionId = "AC-999";
  const { state, ports } = verificationPorts();
  await assert.rejects(coordinator(ports).verify(input), { code: "VES_VERIFIER_INPUT_INVALID" });
  assert.deepEqual(state.calls, []);
});

test("claim expected outcome must equal independently derived outcome", async () => {
  const input = verificationInput();
  input.evidenceClaims[0].expectedOutcomeDigest = sha("author-guessed-outcome");
  const { state, ports } = verificationPorts();
  const result = await coordinator(ports).verify(input);
  assert.equal(result.verdict, "FAIL");
  assert.equal(state.reports[0].criteria[0].status, "OUTCOME_MISMATCH");
});

for (const [name, inspection] of [
  ["invalid line assertion", { valid: false }],
  ["stale commit evidence", { valid: true, commitId: "c".repeat(40) }],
  ["wrong inspected outcome", { valid: true, expectedOutcomeDigest: sha("wrong") }]
]) {
  test(`${name} counts as uncovered and cannot pass`, async () => {
    const input = verificationInput();
    const { state, ports } = verificationPorts({
      evidence: {
        inspect: async (request) => ({
          valid: true,
          commitId: request.commitId,
          expectedOutcomeDigest: request.expectedOutcomeDigest,
          assertionDigest: sha(request.claim.assertionRef),
          ...inspection
        })
      }
    });
    const result = await coordinator(ports).verify(input);
    assert.equal(result.verdict, "FAIL");
    assert.notEqual(state.reports[0].criteria[0].status, "COVERED");
  });
}

test("every acceptance criterion requires a declared discrimination mutation", async () => {
  const input = verificationInput();
  input.mutations.pop();
  const { state, ports } = verificationPorts();
  const result = await coordinator(ports).verify(input);
  assert.equal(result.verdict, "FAIL");
  assert.equal(state.reports[0].mutations.at(-1).status, "MISSING");
});

test("surviving mutant creates a verification gap and reusable lesson", async () => {
  const { state, ports } = verificationPorts({
    sensor: {
      run: async (request) => ({
        scratchIsolationVerified: true,
        killed: request.mutation.criterionId !== "AC-002",
        expectedFailureObserved: request.mutation.criterionId !== "AC-002",
        evidenceRef: `evidence:${request.mutation.mutationId}`,
        activeStateBeforeDigest: sha("active-state"),
        activeStateAfterDigest: sha("active-state")
      })
    }
  });
  const result = await coordinator(ports).verify(verificationInput());
  assert.equal(result.verdict, "FAIL");
  assert.equal(state.reports[0].mutations[1].status, "SURVIVED");
  assert.ok(state.lessons.some((lesson) => lesson.code === "SURVIVING_MUTANT"));
});

test("clean PASS records no lesson", async () => {
  const { state, ports } = verificationPorts();
  await coordinator(ports).verify(verificationInput());
  assert.deepEqual(state.lessons, []);
});

test("verification report binds package commit gates actors and every requirement", async () => {
  const input = verificationInput();
  const { state, ports } = verificationPorts();
  await coordinator(ports).verify(input);
  const report = state.reports[0];
  assert.equal(report.packageDigest, input.packageDigest);
  assert.equal(report.commitId, input.commit.commitId);
  assert.equal(report.gateEvidenceDigest, input.commit.gateEvidenceDigest);
  assert.deepEqual(report.actorBinding, { authorActorId: "actor:implementer", verifierActorId: "actor:verifier" });
  assert.deepEqual(report.requirementIds, ["VES-VFY-003", "VES-VFY-004"]);
});
