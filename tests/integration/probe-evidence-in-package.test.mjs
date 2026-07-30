// Issue #34 (external-review item R8): promoteProbeEvidence was complete and
// unreferenced. These tests pin the sealed reference in the Execution Package and
// the resume-time verification that makes the reproducibility claim real rather
// than decorative.

import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyProbeEvidence } from "../../packages/application/src/execution/probe-evidence.ts";
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

// A port backed by a plain map, so "the stored result moved" is expressible.
function probePort(stored) {
  return {
    resolve: async ({ protectedResultRef }) => stored.get(protectedResultRef) ?? null
  };
}

const resolved = (overrides = {}) => ({
  resultDigest: digest("probe-result"),
  classification: "internal",
  redactionApplied: true,
  ...overrides
});

test("promoted probe evidence seals into the package verbatim", async () => {
  const { builder } = executionHarness();
  const sealed = await builder.build(packageInput({ probeEvidence: [probe()] }));
  assert.deepEqual(sealed.payload.probeEvidence, [probe()]);
});

test("a package with no probe evidence still seals, so existing packages stay valid", async () => {
  const { builder } = executionHarness();
  const sealed = await builder.build(packageInput());
  assert.equal(sealed.payload.probeEvidence, undefined);
});

test("probe evidence is covered by the package digest", async () => {
  const { builder } = executionHarness();
  const withProbe = await builder.build(packageInput({ probeEvidence: [probe()] }));
  const changed = await builder.build(packageInput({ probeEvidence: [probe({ sanitizedClaimCount: 4 })] }));
  // A reference that did not change the digest could be swapped after sealing,
  // which would make the whole reproducibility promise unenforceable.
  assert.match(withProbe.payloadDigest, /^[a-f0-9]{64}$/u);
  assert.notEqual(withProbe.payloadDigest, changed.payloadDigest);
});

for (const [label, corrupt] of [
  ["a non-digest result", probe({ resultDigest: "not-a-digest" })],
  ["a non-digest query fingerprint", probe({ queryFingerprint: "abc" })],
  ["an undeclared classification", probe({ classification: "secret" })],
  ["a stringly redaction flag", probe({ redactionApplied: "yes" })],
  ["a negative claim count", probe({ sanitizedClaimCount: -1 })],
  ["a fractional claim count", probe({ sanitizedClaimCount: 1.5 })],
  ["an unknown field", { ...probe(), probedValue: "salary=100000" }],
  [
    "a missing protected result ref",
    (() => {
      const incomplete = probe();
      delete incomplete.protectedResultRef;
      return incomplete;
    })()
  ]
]) {
  test(`probe evidence with ${label} is rejected`, async () => {
    const { builder } = executionHarness();
    await assert.rejects(builder.build(packageInput({ probeEvidence: [corrupt] })), {
      code: "VES_EXECUTION_PACKAGE_INVALID"
    });
  });
}

test("an empty probe evidence list is rejected rather than sealed as meaningless", async () => {
  const { builder } = executionHarness();
  await assert.rejects(builder.build(packageInput({ probeEvidence: [] })), {
    code: "VES_EXECUTION_PACKAGE_INVALID"
  });
});

test("a repeated result digest is rejected", async () => {
  const { builder } = executionHarness();
  await assert.rejects(builder.build(packageInput({ probeEvidence: [probe(), probe()] })), {
    code: "VES_EXECUTION_PACKAGE_INVALID"
  });
});

// The redaction sensor the issue asks for: anything above public must already
// have been redacted before promotion, or the sealed package carries the
// decision's inputs past the boundary that classified them.
for (const classification of ["internal", "confidential", "restricted"]) {
  test(`unredacted ${classification} probe evidence cannot be sealed`, async () => {
    const { builder } = executionHarness();
    await assert.rejects(
      builder.build(packageInput({ probeEvidence: [probe({ classification, redactionApplied: false })] })),
      { code: "VES_EXECUTION_PACKAGE_INVALID" }
    );
  });
}

test("unredacted public probe evidence is allowed, because there was nothing to redact", async () => {
  const { builder } = executionHarness();
  const sealed = await builder.build(
    packageInput({ probeEvidence: [probe({ classification: "public", redactionApplied: false })] })
  );
  assert.equal(sealed.payload.probeEvidence[0].redactionApplied, false);
});

test("resume verifies sealed probe evidence against the stored result", async () => {
  const stored = new Map([["probe:protected/result-1", resolved()]]);
  const verdict = await verifyProbeEvidence([probe()], probePort(stored));
  assert.deepEqual(verdict, { ok: true, verified: 1 });
});

test("absent probe evidence verifies trivially, so older packages resume", async () => {
  const verdict = await verifyProbeEvidence(undefined, probePort(new Map()));
  assert.deepEqual(verdict, { ok: true, verified: 0 });
});

test("a probe result that no longer resolves fails verification", async () => {
  const verdict = await verifyProbeEvidence([probe()], probePort(new Map()));
  assert.equal(verdict.ok, false);
  assert.equal(verdict.failures[0].reason, "unresolvable");
  assert.equal(verdict.failures[0].observedDigest, null);
});

test("a probe result whose content changed fails verification", async () => {
  const stored = new Map([["probe:protected/result-1", resolved({ resultDigest: digest("different") })]]);
  const verdict = await verifyProbeEvidence([probe()], probePort(stored));
  assert.equal(verdict.ok, false);
  assert.equal(verdict.failures[0].reason, "digest-mismatch");
  assert.equal(verdict.failures[0].observedDigest, digest("different"));
});

test("a probe reclassified after sealing fails verification", async () => {
  // The plan was cleared against internal data. Restricted is not that.
  const stored = new Map([["probe:protected/result-1", resolved({ classification: "restricted" })]]);
  const verdict = await verifyProbeEvidence([probe()], probePort(stored));
  assert.equal(verdict.ok, false);
  assert.equal(verdict.failures[0].reason, "classification-changed");
});

test("a probe that lost its redaction is reported as a leak, not a mismatch", async () => {
  const stored = new Map([["probe:protected/result-1", resolved({ redactionApplied: false })]]);
  const verdict = await verifyProbeEvidence([probe()], probePort(stored));
  assert.equal(verdict.ok, false);
  assert.equal(verdict.failures[0].reason, "redaction-lost");
});

test("every failing reference is reported, so one bad probe does not hide the rest", async () => {
  const references = [
    probe(),
    probe({ resultDigest: digest("second"), protectedResultRef: "probe:protected/result-2" }),
    probe({ resultDigest: digest("third"), protectedResultRef: "probe:protected/result-3" })
  ];
  // The first is fine; the second moved; the third is gone.
  const stored = new Map([
    ["probe:protected/result-1", resolved()],
    ["probe:protected/result-2", resolved({ resultDigest: digest("moved") })]
  ]);
  const verdict = await verifyProbeEvidence(references, probePort(stored));
  assert.equal(verdict.ok, false);
  assert.deepEqual(
    verdict.failures.map((entry) => entry.reason),
    ["digest-mismatch", "unresolvable"]
  );
});

for (const [label, corrupt] of [
  ["a non-object reference", "probe:protected/result-1"],
  ["a non-digest result", probe({ resultDigest: "nope" })],
  ["an undeclared classification", probe({ classification: "secret" })],
  ["an unsafe protected ref", probe({ protectedResultRef: "../../etc/passwd" })]
]) {
  test(`verification rejects ${label} before contacting the port`, async () => {
    let touched = false;
    const port = {
      resolve: async () => {
        touched = true;
        return null;
      }
    };
    await assert.rejects(verifyProbeEvidence([corrupt], port), { code: "VES_PROBE_EVIDENCE_INVALID" });
    assert.equal(touched, false, "a malformed reference must not reach the port");
  });
}
