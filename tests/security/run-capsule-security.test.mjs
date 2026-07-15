import assert from "node:assert/strict";
import { test } from "node:test";

import { capsuleExpectation, capsuleHarness, capsuleInput, capsuleRef } from "../helpers/run-capsule-fixture.mjs";

const criticalSections = [
  "decisions",
  "modelSelections",
  "contexts",
  "capabilityGrants",
  "approvals",
  "claims",
  "tasks",
  "gates",
  "operationReceipts",
  "outputs",
  "terminal"
];

for (const section of criticalSections) {
  test(`critical Capsule rejects missing ${section} evidence`, async () => {
    const input = capsuleInput("COMPLETED", "critical");
    input.evidence[section] = [];
    const { builder } = capsuleHarness();
    await assert.rejects(builder.build(input), { code: "VES_RUN_CAPSULE_EVIDENCE_INCOMPLETE" });
  });
}

for (const [status, field] of [
  ["COMPLETED", "verificationRef"],
  ["COMPLETED", "humanReviewRef"],
  ["FAILED", "terminalErrorRef"],
  ["ABORTED", "terminalErrorRef"],
  ["INTERRUPTED", "terminalErrorRef"],
  ["HANDED_OFF", "handoff"],
  ["RECOVERED", "recoveryRef"]
]) {
  test(`${status} rejects missing ${field}`, async () => {
    const input = capsuleInput(status);
    delete input[field];
    const { builder } = capsuleHarness();
    await assert.rejects(builder.build(input), { code: "VES_RUN_CAPSULE_EVIDENCE_INCOMPLETE" });
  });
}

for (const field of [
  "provider",
  "backendId",
  "modelId",
  "sessionId",
  "threadId",
  "transcript",
  "credential",
  "secretValue",
  "providerToken",
  "localPath"
]) {
  test(`Capsule recursively rejects private field ${field}`, async () => {
    const input = capsuleInput();
    input.evidence.decisions[0][field] = "forbidden";
    const { builder } = capsuleHarness();
    await assert.rejects(builder.build(input), { code: "VES_RUN_CAPSULE_INVALID" });
  });
}

for (const path of ["C:\\Users\\person\\repo", "/home/person/repo", "file:///private/repo"]) {
  test(`Capsule rejects absolute path ${path}`, async () => {
    const input = capsuleInput();
    input.evidence.decisions[0].note = path;
    const { builder } = capsuleHarness();
    await assert.rejects(builder.build(input), { code: "VES_RUN_CAPSULE_INVALID" });
  });
}

test("signature tamper fails before Capsule semantics", async () => {
  const input = capsuleInput();
  const { builder, trust } = capsuleHarness();
  const sealed = await builder.build(input);
  const replacement = sealed.signature.startsWith("A") ? "B" : "A";
  const result = await builder.verify({ ...sealed, signature: `${replacement}${sealed.signature.slice(1)}` }, trust, {
    ...capsuleExpectation(input),
    status: "FAILED"
  });
  assert.deepEqual(result, { ok: false, code: "VES_SIGNATURE_INVALID" });
});

test("payload tamper fails before status comparison", async () => {
  const input = capsuleInput();
  const { builder, trust } = capsuleHarness();
  const sealed = await builder.build(input);
  const tampered = structuredClone(sealed);
  tampered.payload.status = "FAILED";
  const result = await builder.verify(tampered, trust, capsuleExpectation(input));
  assert.deepEqual(result, { ok: false, code: "VES_INTEGRITY_PAYLOAD_DIGEST_MISMATCH" });
});

test("valid Capsule cannot verify for a different run", async () => {
  const input = capsuleInput();
  const { builder, trust } = capsuleHarness();
  const sealed = await builder.build(input);
  const result = await builder.verify(sealed, trust, { ...capsuleExpectation(input), runId: "run:foreign" });
  assert.deepEqual(result, { ok: false, code: "VES_RUN_CAPSULE_EXPECTATION_MISMATCH" });
});

test("handoff can never inherit receiver Approval", async () => {
  const input = capsuleInput("HANDED_OFF");
  input.handoff.receiverApprovalInherited = true;
  const { builder } = capsuleHarness();
  await assert.rejects(builder.build(input), { code: "VES_RUN_CAPSULE_INVALID" });
});

test("handoff requires actual publication receipts", async () => {
  const input = capsuleInput("HANDED_OFF");
  input.handoff.publicationReceiptRefs = [];
  const { builder } = capsuleHarness();
  await assert.rejects(builder.build(input), { code: "VES_RUN_CAPSULE_EVIDENCE_INCOMPLETE" });
});

test("non-completed status cannot forge Human Review", async () => {
  const input = capsuleInput("FAILED");
  input.humanReviewRef = capsuleRef("forged-review");
  const { builder } = capsuleHarness();
  await assert.rejects(builder.build(input), { code: "VES_RUN_CAPSULE_INVALID" });
});

test("completed status cannot bypass HUMAN_REVIEW", async () => {
  const input = capsuleInput("COMPLETED");
  input.terminalTransition.fromState = "VERIFYING";
  const { builder } = capsuleHarness();
  await assert.rejects(builder.build(input), { code: "VES_RUN_CAPSULE_INVALID" });
});
