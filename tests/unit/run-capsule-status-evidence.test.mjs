import assert from "node:assert/strict";
import { test } from "node:test";

import { capsuleHarness, capsuleInput, capsuleRef } from "../helpers/run-capsule-fixture.mjs";

const INVALID = "VES_RUN_CAPSULE_INVALID";
const INCOMPLETE = "VES_RUN_CAPSULE_EVIDENCE_INCOMPLETE";

function without(input, ...keys) {
  const copy = { ...input };
  for (const key of keys) delete copy[key];
  return copy;
}

const handoff = capsuleInput("HANDED_OFF").handoff;

for (const [label, input, code, message] of [
  [
    "an unknown terminal status",
    capsuleInput("COMPLETED", "low", { status: "PAUSED" }),
    INVALID,
    "Terminal status is invalid"
  ],
  ["an unknown risk tier", capsuleInput("COMPLETED", "extreme"), INVALID, "Risk tier is invalid"],
  ["an unknown run kind", capsuleInput("COMPLETED", "low", { runKind: "maintenance" }), INVALID, "Run kind is invalid"],
  [
    "no source state",
    capsuleInput("COMPLETED", "low", { sourceStateRefs: [] }),
    INCOMPLETE,
    "Source state is required"
  ],
  [
    "no policy digests",
    capsuleInput("COMPLETED", "low", { policyDigests: [] }),
    INCOMPLETE,
    "Policy evidence is required"
  ],
  [
    "policy digests that are not a list",
    capsuleInput("COMPLETED", "low", { policyDigests: "policy" }),
    INCOMPLETE,
    "Policy evidence is required"
  ],
  [
    "a seal before the terminal transition",
    capsuleInput("COMPLETED", "low", { sealedAt: "2026-07-15T17:00:00.000Z" }),
    INVALID,
    "Capsule cannot predate its terminal transition"
  ],
  [
    "a completed run without Human Review",
    without(capsuleInput("COMPLETED"), "humanReviewRef"),
    INCOMPLETE,
    "Completed runs require verification and Human Review"
  ],
  [
    "a completed run that did not close from Human Review",
    capsuleInput("COMPLETED", "low", {
      terminalTransition: { ...capsuleInput("COMPLETED").terminalTransition, fromState: "EXECUTION_READY" }
    }),
    INVALID,
    "Completed runs must close from HUMAN_REVIEW"
  ],
  [
    "a failed run without terminal error evidence",
    without(capsuleInput("FAILED"), "terminalErrorRef"),
    INCOMPLETE,
    "FAILED requires terminal error evidence"
  ],
  [
    "a handed-off run without handoff evidence",
    without(capsuleInput("HANDED_OFF"), "handoff"),
    INCOMPLETE,
    "Handed-off runs require publication and claim evidence"
  ],
  [
    "a recovered run without recovery evidence",
    without(capsuleInput("RECOVERED"), "recoveryRef"),
    INCOMPLETE,
    "Recovered runs require recovery evidence"
  ],
  [
    "a handed-off run without operation receipts",
    (() => {
      const input = capsuleInput("HANDED_OFF");
      return { ...input, evidence: { ...input.evidence, operationReceipts: [] } };
    })(),
    INCOMPLETE,
    "Handoff requires claim and operation evidence"
  ],
  [
    "a failed run carrying Human Review",
    capsuleInput("FAILED", "low", { humanReviewRef: capsuleRef("human-review") }),
    INVALID,
    "Only completed runs may carry final verification and Human Review"
  ],
  [
    "a completed run carrying terminal error evidence",
    capsuleInput("COMPLETED", "low", { terminalErrorRef: capsuleRef("failure") }),
    INVALID,
    "Terminal error evidence is not valid for this status"
  ],
  [
    "a failed run carrying recovery evidence",
    capsuleInput("FAILED", "low", { recoveryRef: capsuleRef("recovery") }),
    INVALID,
    "Recovery evidence is not valid for this status"
  ],
  [
    "a failed run carrying handoff evidence",
    capsuleInput("FAILED", "low", { handoff }),
    INVALID,
    "Handoff evidence is not valid for this status"
  ],
  [
    "a recovered status on a feature run",
    capsuleInput("RECOVERED", "low", { runKind: "feature" }),
    INVALID,
    "Recovered status requires a recovery run"
  ]
]) {
  test(`a Capsule with ${label} is refused with its own reason`, async () => {
    const { builder } = capsuleHarness();
    await assert.rejects(builder.build(input), { code, message });
  });
}

test("the first failing status rule is reported when several apply", async () => {
  const { builder } = capsuleHarness();
  const input = capsuleInput("FAILED", "low", {
    humanReviewRef: capsuleRef("human-review"),
    recoveryRef: capsuleRef("recovery"),
    handoff
  });
  await assert.rejects(builder.build(input), {
    code: INVALID,
    message: "Only completed runs may carry final verification and Human Review"
  });
});

test("optional members are sealed only when present", async () => {
  const { builder } = capsuleHarness();
  const predecessorRunId = "run_018f0b6d-7b1a-7abc-8def-112345678900";
  const handedOff = await builder.build(capsuleInput("HANDED_OFF", "low", { predecessorRunId }));
  assert.equal(handedOff.payload.predecessorRunId, predecessorRunId);
  assert.equal(handedOff.payload.successorRunId, "run_018f0b6d-7b1a-7abc-8def-112345678903");
  assert.deepEqual(handedOff.payload.handoff, handoff);
  for (const absent of ["verificationRef", "humanReviewRef", "terminalErrorRef", "recoveryRef", "budgetEvidence"])
    assert.equal(Object.hasOwn(handedOff.payload, absent), false, absent);

  const completed = await builder.build(capsuleInput("COMPLETED"));
  for (const absent of ["predecessorRunId", "successorRunId", "terminalErrorRef", "recoveryRef", "handoff"])
    assert.equal(Object.hasOwn(completed.payload, absent), false, absent);
  assert.deepEqual(completed.payload.verificationRef, capsuleRef("verification"));
  assert.deepEqual(completed.payload.humanReviewRef, capsuleRef("human-review"));
});
