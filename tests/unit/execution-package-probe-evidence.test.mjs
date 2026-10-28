import assert from "node:assert/strict";
import { test } from "node:test";

import { digest, executionHarness, packageInput } from "../helpers/execution-package-fixture.mjs";

const probe = (overrides = {}) => ({
  resultDigest: digest("probe-result"),
  schemaIdentityDigest: digest("schema-identity"),
  registrationDigest: digest("registration"),
  queryFingerprint: digest("query"),
  producingRunId: "run_018f0b6d-7b1a-7abc-8def-0123456789ac",
  protectedResultRef: "probe:protected/result-1",
  classification: "internal",
  redactionApplied: true,
  sanitizedClaimCount: 3,
  ...overrides
});

const refused = (message) => ({ code: "VES_EXECUTION_PACKAGE_INVALID", message });

test("sealed probe evidence keeps every declared field in its normalized form", async () => {
  const { builder } = executionHarness();
  const second = probe({ resultDigest: digest("probe-result-2"), classification: "public", redactionApplied: false });
  const sealed = await builder.build(packageInput({ probeEvidence: [probe(), second] }));
  assert.deepEqual(sealed.payload.probeEvidence, [probe(), second]);
  assert.ok(Object.isFrozen(sealed.payload.probeEvidence));
});

test("absent probe evidence is omitted from the sealed package", async () => {
  const { builder } = executionHarness();
  const sealed = await builder.build(packageInput());
  assert.equal(Object.hasOwn(sealed.payload, "probeEvidence"), false);
});

for (const [label, probeEvidence, message] of [
  ["an empty list", [], "probeEvidence is present but empty"],
  [
    "an undeclared classification",
    [probe({ classification: "secret" })],
    "probeEvidence classification is not a declared class"
  ],
  [
    "a redaction flag that is not a boolean",
    [probe({ redactionApplied: "yes" })],
    "probeEvidence redactionApplied must be a boolean"
  ],
  ["a negative claim count", [probe({ sanitizedClaimCount: -1 })], "probeEvidence sanitizedClaimCount is invalid"],
  ["a fractional claim count", [probe({ sanitizedClaimCount: 1.5 })], "probeEvidence sanitizedClaimCount is invalid"],
  [
    "unredacted evidence above public",
    [probe({ classification: "confidential", redactionApplied: false })],
    "probeEvidence above public class must be redacted"
  ],
  ["a repeated result digest", [probe(), probe()], "probeEvidence repeats a result digest"]
]) {
  test(`probe evidence with ${label} is refused with its own reason`, async () => {
    const { builder } = executionHarness();
    await assert.rejects(builder.build(packageInput({ probeEvidence })), refused(message));
  });
}

test("the classification check runs before the redaction and claim-count checks", async () => {
  const { builder } = executionHarness();
  await assert.rejects(
    builder.build(
      packageInput({
        probeEvidence: [probe({ classification: "secret", redactionApplied: "yes", sanitizedClaimCount: -1 })]
      })
    ),
    refused("probeEvidence classification is not a declared class")
  );
});

test("a probe digest field that is not a digest is refused", async () => {
  const { builder } = executionHarness();
  await assert.rejects(builder.build(packageInput({ probeEvidence: [probe({ queryFingerprint: "abc" })] })), {
    code: "VES_EXECUTION_PACKAGE_INVALID"
  });
});
