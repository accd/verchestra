import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyProbeEvidence } from "../../packages/application/src/execution/probe-evidence.ts";
import { SchemaRegistry } from "../../packages/contracts/src/schema-registry.ts";
import { normalizePolicyTestCase, verifyPolicyBundle } from "../../packages/policy/src/index.ts";

// SonarCloud S7776 (T8): four closed lists checked by membership are now Sets.
// These pin what each list admits and what it refuses.

const digest = `sha256:${"a".repeat(64)}`;
const reference = (classification) => ({
  resultDigest: digest,
  schemaIdentityDigest: digest,
  registrationDigest: digest,
  queryFingerprint: digest,
  producingRunId: "run_1",
  protectedResultRef: "result_1",
  classification,
  redactionApplied: true,
  sanitizedClaimCount: 0
});

test("probe evidence admits exactly the four declared classifications", async () => {
  const port = { resolve: async () => null };
  for (const classification of ["public", "internal", "confidential", "restricted"]) {
    const verdict = await verifyProbeEvidence([reference(classification)], port);
    assert.equal(verdict.ok, false, classification);
    assert.equal(verdict.failures[0].reason, "unresolvable");
  }
  for (const classification of ["secret", "Public", "", undefined, 0]) {
    await assert.rejects(verifyProbeEvidence([reference(classification)], port), {
      code: "VES_PROBE_EVIDENCE_INVALID",
      message: "probe evidence classification is not a declared class"
    });
  }
});

test("a policy test case lists exactly its unknown fields, in code-unit order", () => {
  assert.throws(() => normalizePolicyTestCase({ name: "case", zeta: 1, Alpha: 2, expect: "allow", constructor: 3 }), {
    message: /unknown fields: Alpha, constructor, zeta$/u
  });
});

test("a policy bundle with any field outside its seven is refused before its signature is read", () => {
  const crypto = {
    digest: () => assert.fail("no digest for an unknown field"),
    verify: () => assert.fail("no verify for an unknown field")
  };
  for (const extra of ["policy", "toString", "__proto__x"]) {
    assert.throws(() => verifyPolicyBundle({ schemaVersion: 1, [extra]: true }, crypto), /bundle has unknown fields/u);
  }
  assert.throws(() => verifyPolicyBundle({ schemaVersion: 2 }, crypto), /bundle schema version is unsupported/u);
});

test("schema negotiation picks the highest version both sides support", async () => {
  const registry = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));
  assert.equal(registry.negotiate("public-error", ["9", "1", "x"]), "1");
  assert.throws(() => registry.negotiate("public-error", ["2", "public-error@1"]), {
    code: "VES_SCHEMA_NEGOTIATION_FAILED"
  });
});
