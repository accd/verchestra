import assert from "node:assert/strict";
import { test } from "node:test";

import { withHostileLocaleCompare } from "../helpers/hostile-locale.mjs";
import {
  capsuleDigest,
  capsuleExpectation,
  capsuleHarness,
  capsuleInput,
  capsuleRef
} from "../helpers/run-capsule-fixture.mjs";

const tamperSignature = (sealed) => {
  const sig = sealed.dsse.signatures[0].sig;
  const replacement = sig.startsWith("A") ? "B" : "A";
  return {
    ...sealed,
    dsse: { ...sealed.dsse, signatures: [{ ...sealed.dsse.signatures[0], sig: `${replacement}${sig.slice(1)}` }] }
  };
};

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
  const result = await builder.verify(tamperSignature(sealed), trust, {
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

// Issue #58 signed-evidence vertical: the Run Capsule's set-like reference
// arrays were ordered with ambient `String.prototype.localeCompare`, so a
// Capsule's identity depended on the collation of the machine that sealed it.
// Schema V2 orders by UTF-16 code unit; schema V1 keeps its comparator because
// verification re-sorts and re-digests `sourceStateRefs` (see `compareIdentity`
// in run-capsule.ts).

const mixedCaseCapsuleInput = (overrides = {}) =>
  capsuleInput("COMPLETED", "low", {
    sourceStateRefs: [
      { artifactId: "Source-API", digest: capsuleDigest("source-api") },
      { artifactId: "source-control", digest: capsuleDigest("source-control") }
    ],
    ...overrides
  });

test("schemaVersion: 2 Capsule bytes are byte-identical across two divergent locale collations", async () => {
  const { builder } = capsuleHarness();
  const input = mixedCaseCapsuleInput({ schemaVersion: 2 });
  const plain = await builder.build(input);
  const underHostileLocale = await withHostileLocaleCompare(() =>
    builder.build(mixedCaseCapsuleInput({ schemaVersion: 2 }))
  );
  assert.equal(plain.artifactId, underHostileLocale.artifactId);
  assert.equal(plain.payloadDigest, underHostileLocale.payloadDigest);
  assert.equal(plain.sourceStateDigest, underHostileLocale.sourceStateDigest);
  // Code-unit order specifically, not merely "some" deterministic order:
  // uppercase sorts before lowercase in UTF-16, so a locale that folds case
  // would put "source-control" first.
  assert.deepEqual(
    plain.payload.sourceStateRefs.map((entry) => entry.artifactId),
    ["Source-API", "source-control"]
  );
});

test("a schemaVersion: 2 Capsule verifies under a hostile collation, proving V2 identity is portable", async () => {
  const { builder, trust } = capsuleHarness();
  const input = mixedCaseCapsuleInput({ schemaVersion: 2 });
  const sealed = await builder.build(input);
  const verified = await withHostileLocaleCompare(() => builder.verify(sealed, trust, capsuleExpectation(input)));
  assert.equal(verified.ok, true);
});

test("a stored schemaVersion: 1 Capsule still verifies unchanged", async () => {
  const { builder, trust } = capsuleHarness();
  const input = mixedCaseCapsuleInput({ schemaVersion: 1 });
  const sealed = await builder.build(input);
  assert.equal(sealed.payload.schemaVersion, 1);
  assert.equal(sealed.schema.version, 1);
  const verified = await builder.verify(sealed, trust, capsuleExpectation(input));
  assert.equal(verified.ok, true);
  // V1 keeps ambient collation, so its ordering is the historical one. This
  // pins that the V1 comparator was retained rather than normalized: under the
  // hostile mock the re-sorted `sourceStateRefs` no longer reproduce the signed
  // `sourceStateDigest`, which is exactly why V1 could not be normalized.
  const underHostileLocale = await withHostileLocaleCompare(() =>
    builder.verify(sealed, trust, capsuleExpectation(input))
  );
  assert.equal(underHostileLocale.ok, false);
  assert.equal(underHostileLocale.code, "VES_RUN_CAPSULE_BINDING_INVALID");
});

test("RunCapsuleBuilder.build() defaults to schemaVersion: 2 when the caller omits it", async () => {
  const { builder } = capsuleHarness();
  const input = mixedCaseCapsuleInput();
  delete input.schemaVersion;
  const sealed = await builder.build(input);
  assert.equal(sealed.payload.schemaVersion, 2);
  assert.equal(sealed.schema.version, 2);
});

test("an explicit schemaVersion: 1 Capsule is never silently upgraded", async () => {
  const { builder } = capsuleHarness();
  const sealed = await builder.build(mixedCaseCapsuleInput({ schemaVersion: 1 }));
  assert.equal(sealed.payload.schemaVersion, 1);
});

test("an unknown Capsule schemaVersion fails closed rather than defaulting", async () => {
  const { builder } = capsuleHarness();
  for (const schemaVersion of [0, 3, "2", null]) {
    await assert.rejects(builder.build(mixedCaseCapsuleInput({ schemaVersion })), {
      code: "VES_RUN_CAPSULE_INVALID"
    });
  }
});

test("a schemaVersion: 1 Capsule cannot be reinterpreted as V2, or the reverse", async () => {
  const { builder, trust } = capsuleHarness();
  const v1 = await builder.build(mixedCaseCapsuleInput({ schemaVersion: 1 }));
  const v2 = await builder.build(mixedCaseCapsuleInput({ schemaVersion: 2 }));
  // Distinct signed documents: different predicate types, different identities.
  assert.notEqual(v1.artifactId, v2.artifactId);
  // Relabelling the envelope's schema version does not convert the artifact:
  // the version is bound into the signed Statement, so the projection no
  // longer matches what was signed.
  const relabelled = { ...v1, schema: { ...v1.schema, version: 2 } };
  const result = await builder.verify(
    relabelled,
    trust,
    capsuleExpectation(mixedCaseCapsuleInput({ schemaVersion: 1 }))
  );
  assert.equal(result.ok, false);
  const reverse = { ...v2, schema: { ...v2.schema, version: 1 } };
  const reverseResult = await builder.verify(
    reverse,
    trust,
    capsuleExpectation(mixedCaseCapsuleInput({ schemaVersion: 2 }))
  );
  assert.equal(reverseResult.ok, false);
});
