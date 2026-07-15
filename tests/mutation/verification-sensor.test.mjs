import assert from "node:assert/strict";
import { test } from "node:test";

import { coordinator, sha, verificationInput, verificationPorts } from "../helpers/verification-fixture.mjs";

for (const [name, mutationResult, expectedStatus] of [
  ["killed behavior fault", { scratchIsolationVerified: true, killed: true, expectedFailureObserved: true }, "KILLED"],
  [
    "surviving behavior fault",
    { scratchIsolationVerified: true, killed: false, expectedFailureObserved: false },
    "SURVIVED"
  ],
  [
    "wrong failure detected",
    { scratchIsolationVerified: true, killed: true, expectedFailureObserved: false },
    "SURVIVED"
  ],
  [
    "unverified scratch",
    { scratchIsolationVerified: false, killed: true, expectedFailureObserved: true },
    "INVALID_SENSOR"
  ],
  [
    "active state changed",
    {
      scratchIsolationVerified: true,
      killed: true,
      expectedFailureObserved: true,
      activeStateAfterDigest: sha("changed")
    },
    "INVALID_SENSOR"
  ]
]) {
  test(`sensor classifies ${name} as ${expectedStatus}`, async () => {
    const { state, ports } = verificationPorts({
      sensor: {
        run: async (request) => ({
          evidenceRef: `evidence:${request.mutation.mutationId}`,
          activeStateBeforeDigest: sha("active-state"),
          activeStateAfterDigest: sha("active-state"),
          ...mutationResult
        })
      }
    });
    const result = await coordinator(ports).verify(verificationInput());
    assert.equal(state.reports[0].mutations[0].status, expectedStatus);
    assert.equal(result.verdict, expectedStatus === "KILLED" ? "PASS" : "FAIL");
  });
}

test("sensor evidence must be a bounded stable reference", async () => {
  const { ports } = verificationPorts({
    sensor: {
      run: async () => ({
        scratchIsolationVerified: true,
        killed: true,
        expectedFailureObserved: true,
        evidenceRef: "raw mutation output with spaces",
        activeStateBeforeDigest: sha("active-state"),
        activeStateAfterDigest: sha("active-state")
      })
    }
  });
  await assert.rejects(coordinator(ports).verify(verificationInput()), { code: "VES_VERIFIER_SENSOR_INVALID" });
});

test("mutation cannot target a criterion outside the reviewed specification", async () => {
  const input = verificationInput();
  input.mutations[0].criterionId = "AC-999";
  const { state, ports } = verificationPorts();
  await assert.rejects(coordinator(ports).verify(input), { code: "VES_VERIFIER_INPUT_INVALID" });
  assert.equal(state.sensorRuns, 0);
});

test("sensor cannot hide a final active-workspace state change", async () => {
  let readings = 0;
  const { state, ports } = verificationPorts({
    sensor: {
      activeStateDigest: async () => (readings++ === 0 ? sha("active-state") : sha("changed"))
    }
  });
  const result = await coordinator(ports).verify(verificationInput());
  assert.equal(result.verdict, "FAIL");
  assert.deepEqual(
    state.reports[0].mutations.map((entry) => entry.status),
    ["INVALID_SENSOR", "INVALID_SENSOR"]
  );
});
