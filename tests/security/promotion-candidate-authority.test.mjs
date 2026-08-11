import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createCandidateGrant,
  createEvaluatorCandidateGrant,
  EVALUATOR_PROTECTED_ASSETS
} from "../../packages/application/src/index.ts";

// PROM-09 / AD-018, remediating T74 finding F1. The candidate used to be an
// inert record inside the evaluator's own process: it could not ATTEMPT the
// forbidden access, so no fixture could discriminate a missing boundary. These
// tests give a candidate the surface it actually holds and make it try.
//
// Every denial below comes from the attempt itself. Nothing here asserts a
// caller-supplied `contaminated` fact — that stays a supplied input and is
// explicitly NOT upgraded by AD-018.

const protectedValues = {
  oracle: { policyId: "release-policy", entries: [{ campaignId: "alpha", threshold: 0.8, repetitionCount: 50 }] },
  criteria: { minimumLowerBound: 0.8 },
  "evaluator-state": { sealedAt: "2026-08-11T00:00:00.000Z" },
  "pre-seal-report": { verdict: "PROMOTED" }
};

test("the evaluator grants the candidate no authority at all", () => {
  // The zero-authority claim, visible as data rather than trusted to a
  // hardcoded refusal being written everywhere (AD-011's definition).
  assert.deepEqual(createEvaluatorCandidateGrant(protectedValues).grantedAssets, []);
});

test("every protected asset is reachable by name, so a candidate can genuinely try", () => {
  // A boundary that cannot be attempted cannot be proven. This is the property
  // whose absence F1 identified.
  assert.deepEqual([...EVALUATOR_PROTECTED_ASSETS], ["oracle", "criteria", "evaluator-state", "pre-seal-report"]);
  for (const asset of EVALUATOR_PROTECTED_ASSETS) {
    assert.ok(Object.hasOwn(protectedValues, asset), `${asset} must exist for a candidate to attempt`);
  }
});

for (const asset of EVALUATOR_PROTECTED_ASSETS) {
  test(`a candidate reading ${asset} is denied`, () => {
    const grant = createEvaluatorCandidateGrant(protectedValues);
    assert.throws(() => grant.read(asset), { code: "VES_PROMOTION_AUTHORITY_DENIED", asset });
  });

  test(`a candidate mutating ${asset} is denied and changes nothing`, () => {
    // Read authority without write authority, so the read-back goes through the
    // SAME store the mutation would have written to. A second grant would have
    // its own copy and could not detect a denial that still wrote — a denial in
    // name only.
    const grant = createCandidateGrant({ read: [asset], mutate: [] }, protectedValues);
    assert.throws(() => grant.mutate(asset, "tampered"), { code: "VES_PROMOTION_AUTHORITY_DENIED", asset });
    assert.deepEqual(grant.read(asset), protectedValues[asset]);
  });

  test(`the evaluator's grant denies reading and mutating ${asset}`, () => {
    const grant = createEvaluatorCandidateGrant(protectedValues);
    assert.throws(() => grant.mutate(asset, "tampered"), { code: "VES_PROMOTION_AUTHORITY_DENIED", asset });
  });
}

test("the gate really consults the grant rather than always refusing", () => {
  // Without this, a refusal written into every path would be indistinguishable
  // from a real authority check, and the zero-authority claim above would prove
  // nothing.
  const granted = createCandidateGrant({ read: ["oracle"], mutate: [] }, protectedValues);
  assert.deepEqual(granted.read("oracle"), protectedValues.oracle);
  // Authority is per asset, not a global on/off.
  assert.throws(() => granted.read("criteria"), { code: "VES_PROMOTION_AUTHORITY_DENIED" });
});

test("a granted mutation takes effect, so a denied one is a real refusal", () => {
  const granted = createCandidateGrant({ read: ["criteria"], mutate: ["criteria"] }, protectedValues);
  granted.mutate("criteria", { minimumLowerBound: 0.1 });
  assert.deepEqual(granted.read("criteria"), { minimumLowerBound: 0.1 });
  // ...and the evaluator's own values are untouched by a candidate's grant.
  assert.deepEqual(protectedValues.criteria, { minimumLowerBound: 0.8 });
});

test("an asset the evaluator never declared is denied like any other", () => {
  const grant = createEvaluatorCandidateGrant(protectedValues);
  assert.throws(() => grant.read("some-asset-nobody-declared"), { code: "VES_PROMOTION_AUTHORITY_DENIED" });
});
