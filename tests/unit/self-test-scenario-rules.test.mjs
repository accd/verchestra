// T70 T1: scenario check, coverage, and convergence rules
// (.specs/features/self-test-profiles/spec.md PRF-03, PRF-04).
import assert from "node:assert/strict";
import test from "node:test";
import {
  SMOKE_CHECK_IDS,
  WORKSPACE_CHECK_IDS,
  WORKSPACE_SHAPES,
  assertConvergence,
  assertProfileCoverage,
  resolveSelfTestProfile,
  semanticFingerprint
} from "../../packages/application/src/index.ts";

function check(checkId, status = "pass", overrides = {}) {
  return { checkId, requirement: "test", status, ...overrides };
}

// --- PRF-03: closed registry declares required checks ---

test("smoke and workspace profiles declare their required check ids", () => {
  assert.deepEqual(resolveSelfTestProfile("smoke").requiredCheckIds, SMOKE_CHECK_IDS);
  assert.deepEqual(resolveSelfTestProfile("workspace").requiredCheckIds, WORKSPACE_CHECK_IDS);
});

test("full and drivers declare no required checks yet (T71 scope)", () => {
  assert.deepEqual(resolveSelfTestProfile("full").requiredCheckIds, []);
  assert.deepEqual(resolveSelfTestProfile("drivers").requiredCheckIds, []);
});

test("smoke and workspace combined register at least 25 checks", () => {
  assert.ok(SMOKE_CHECK_IDS.length + WORKSPACE_CHECK_IDS.length >= 25);
});

test("workspace check ids cover placement, init, bootstrap, sync, and reconcile for all five shapes", () => {
  for (const shape of WORKSPACE_SHAPES) {
    for (const category of ["placement", "init", "bootstrap", "sync", "reconcile"]) {
      assert.ok(
        WORKSPACE_CHECK_IDS.includes(`workspace.${shape}.${category}`),
        `missing workspace.${shape}.${category}`
      );
    }
  }
});

test("a profile with all required checks present passes coverage", () => {
  const profile = resolveSelfTestProfile("smoke");
  assert.doesNotThrow(() =>
    assertProfileCoverage(
      profile,
      profile.requiredCheckIds.map((id) => check(id))
    )
  );
});

test("a profile missing a required check fails closed naming it", () => {
  const profile = resolveSelfTestProfile("smoke");
  const checks = profile.requiredCheckIds.slice(1).map((id) => check(id));
  assert.throws(
    () => assertProfileCoverage(profile, checks),
    (error) => {
      assert.equal(error.code, "VES_SELFTEST_SCENARIO_MISSING");
      assert.match(error.message, new RegExp(profile.requiredCheckIds[0].replaceAll(".", "\\.")));
      return true;
    }
  );
});

test("a profile with no required checks accepts an empty result", () => {
  assert.doesNotThrow(() => assertProfileCoverage(resolveSelfTestProfile("drivers"), []));
});

// --- PRF-04: semantic fingerprint and convergence ---

test("semanticFingerprint orders by checkId regardless of execution order", () => {
  const a = semanticFingerprint([check("b.two"), check("a.one")]);
  const b = semanticFingerprint([check("a.one"), check("b.two")]);
  assert.deepEqual(a, b);
  assert.deepEqual(a, ["a.one:pass", "b.two:pass"]);
});

test("semanticFingerprint excludes any field beyond checkId and status", () => {
  const withExtra = semanticFingerprint([check("x", "pass", { requirement: "different-each-time" })]);
  const withoutExtra = semanticFingerprint([check("x", "pass")]);
  assert.deepEqual(withExtra, withoutExtra);
});

test("two identical fingerprints converge", () => {
  const first = semanticFingerprint([check("a", "pass"), check("b", "fail")]);
  const second = semanticFingerprint([check("b", "fail"), check("a", "pass")]);
  assert.doesNotThrow(() => assertConvergence(first, second));
});

test("a status flip between runs fails closed as non-convergent", () => {
  const first = semanticFingerprint([check("a", "pass")]);
  const second = semanticFingerprint([check("a", "fail")]);
  assert.throws(() => assertConvergence(first, second), { code: "VES_SELFTEST_NONCONVERGENT" });
});

test("an extra check in one run fails closed as non-convergent", () => {
  const first = semanticFingerprint([check("a", "pass")]);
  const second = semanticFingerprint([check("a", "pass"), check("b", "pass")]);
  assert.throws(() => assertConvergence(first, second), { code: "VES_SELFTEST_NONCONVERGENT" });
});
