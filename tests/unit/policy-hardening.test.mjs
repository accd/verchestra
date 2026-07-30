import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  CedarPolicyAdapter,
  buildPolicyBundle,
  explainDecision,
  redactSecretShapes,
  runPolicyTestCases,
  verifyPolicyBundle
} from "../../packages/policy/src/index.ts";
import { baseRequest, cedar, view } from "../helpers/policy-fixture.mjs";

const adapter = () => new CedarPolicyAdapter({ engine: cedar });

const passingRequest = baseRequest();
const testCase = (overrides = {}) => ({
  name: "allows an approved invocation",
  principal: passingRequest.principal,
  action: passingRequest.action,
  resource: passingRequest.resource,
  context: passingRequest.context,
  expect: "allow",
  expectCode: "VES_POLICY_ALLOW",
  ...overrides
});

test("declarative cases evaluate through the production adapter, not a parallel evaluator", () => {
  const implicitDeny = {
    ...testCase({ name: "denies an unapproved invocation", expect: "deny", expectCode: "VES_POLICY_IMPLICIT_DENY" }),
    context: { ...passingRequest.context, approved: false }
  };
  const forbidDeny = {
    ...testCase({ name: "denies a foreign workspace", expect: "deny", expectCode: "VES_POLICY_FORBID_DENY" }),
    context: { ...passingRequest.context, workspace: "w2" }
  };
  const report = runPolicyTestCases([testCase(), implicitDeny, forbidDeny], { adapter: adapter(), view: view() });
  assert.deepEqual(
    { total: report.total, passed: report.passed, failed: report.failed },
    { total: 3, passed: 3, failed: 0 }
  );
});

test("a mismatch is reported per case with the actual decision and code", () => {
  const wrong = testCase({ name: "expects the wrong decision", expect: "deny" });
  const report = runPolicyTestCases([wrong], { adapter: adapter(), view: view() });
  assert.equal(report.failed, 1);
  assert.deepEqual(report.results[0], {
    name: "expects the wrong decision",
    expected: "deny",
    actual: "allow",
    code: "VES_POLICY_ALLOW",
    passed: false
  });
});

test("an expected code mismatch fails the case even when the decision matches", () => {
  const wrongCode = testCase({ name: "expects the wrong code", expectCode: "VES_POLICY_FORBID_DENY" });
  const report = runPolicyTestCases([wrongCode], { adapter: adapter(), view: view() });
  assert.equal(report.failed, 1);
});

for (const [label, corrupt] of [
  ["an empty suite", []],
  ["a typoed expectation", [testCase({ expect: "alow" })]],
  ["a duplicate case name", [testCase(), testCase()]],
  ["an unknown field", [testCase({ retries: 3 })]],
  ["a non-VES expected code", [testCase({ expectCode: "ALLOW" })]]
]) {
  test(`the case format rejects ${label}`, () => {
    assert.throws(() => runPolicyTestCases(corrupt, { adapter: adapter(), view: view() }), {
      code: "VES_POLICY_TEST_INVALID"
    });
  });
}

const forbidDenied = () =>
  adapter().authorize({
    view: view(),
    request: { ...passingRequest, context: { ...passingRequest.context, workspace: "w2" } }
  });

test("explanations name the determining policy, its layer, and its statement", () => {
  const denied = forbidDenied();
  assert.equal(denied.code, "VES_POLICY_FORBID_DENY");
  const explanation = explainDecision(denied, view());
  assert.equal(explanation.decision, "deny");
  assert.equal(explanation.code, denied.code);
  assert.ok(explanation.determining.length > 0, "a forbid deny must name its determining policies");
  for (const entry of explanation.determining) {
    assert.notEqual(entry.layer, "unknown");
    assert.ok(entry.statement.length > 0);
  }
  assert.match(explanation.summary, /^denied: /u);
});

test("a determining policy missing from the view is surfaced, not hidden", () => {
  const explanation = explainDecision(forbidDenied(), view({ layers: {} }));
  assert.ok(explanation.determining.every((entry) => entry.layer === "unknown"));
});

test("secret-shaped values never leave an explanation unredacted", () => {
  const poisoned = {
    decision: "deny",
    code: "VES_POLICY_FORBID_DENY",
    explanation: "denied for sk-ABCDEFGHIJKLMNOP123456 with key ghp_ABCDEFGHIJKLMNOPQRST12",
    determiningPolicies: ["organization.leaky"],
    policyViewDigest: "sha256:" + "0".repeat(64),
    requestDigest: "sha256:" + "0".repeat(64),
    engineVersion: "4.12.0",
    languageVersion: "4.5",
    evidenceDigest: "sha256:" + "0".repeat(64)
  };
  const leakyView = view({
    layers: {
      organization: {
        leaky: 'forbid(principal, action, resource) when { context.token == "sk-QRSTUVWXYZ1234567890" };'
      }
    }
  });
  const explanation = explainDecision(poisoned, leakyView);
  assert.doesNotMatch(JSON.stringify(explanation), /sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}/u);
  // Redaction is recorded, never silent.
  assert.ok(explanation.redactions >= 3);
});

test("redaction reports how much was withheld", () => {
  const outcome = redactSecretShapes("clean text");
  assert.deepEqual(outcome, { value: "clean text", redactions: 0 });
});

const bundleCrypto = () => {
  const sha256 = (value) => createHash("sha256").update(value).digest("hex");
  return {
    sha256,
    sign: (digestValue) => ({ signature: `sig:${sha256(digestValue)}`, publicKeyRef: "key:test" }),
    verify: (digestValue, signature) => signature === `sig:${sha256(digestValue)}`
  };
};

const bundleInput = () => ({
  version: "1.0.0",
  policies: [
    { id: "workspace-forbid", cedar: "forbid(principal, action, resource);" },
    { id: "approved-permit", cedar: "permit(principal, action, resource) when { context.approved == true };" }
  ],
  createdAt: "2026-07-30T00:00:00.000Z"
});

test("a bundle digest is deterministic and order-independent", () => {
  const crypto = bundleCrypto();
  const forward = buildPolicyBundle(bundleInput(), crypto);
  const reversed = buildPolicyBundle({ ...bundleInput(), policies: [...bundleInput().policies].reverse() }, crypto);
  assert.equal(forward.bundleDigest, reversed.bundleDigest);
  assert.deepEqual(verifyPolicyBundle(forward, crypto).bundleDigest, forward.bundleDigest);
});

for (const [label, tamper] of [
  [
    "a modified policy source",
    (bundle) => ({
      ...bundle,
      policies: [{ ...bundle.policies[0], cedar: "permit(principal, action, resource);" }, bundle.policies[1]]
    })
  ],
  ["a swapped bundle digest", (bundle) => ({ ...bundle, bundleDigest: "sha256:" + "f".repeat(64) })],
  ["a forged signature", (bundle) => ({ ...bundle, signature: "sig:forged" })],
  ["an added unknown field", (bundle) => ({ ...bundle, currency: "USD" })]
]) {
  test(`bundle verification fails closed on ${label}`, () => {
    const crypto = bundleCrypto();
    const bundle = buildPolicyBundle(bundleInput(), crypto);
    assert.throws(() => verifyPolicyBundle(tamper(bundle), crypto), { code: "VES_POLICY_BUNDLE_INVALID" });
  });
}

test("a bundle whose digest does not reproduce fails even with a valid signature", () => {
  // Signing the tampered digest is exactly what an attacker with the key does.
  // Only recomputation from the sources catches it, so this case must not be
  // satisfiable by the signature check alone.
  const crypto = bundleCrypto();
  const bundle = buildPolicyBundle(bundleInput(), crypto);
  const swapped = "sha256:" + "a".repeat(64);
  const resigned = { ...bundle, bundleDigest: swapped, ...crypto.sign(swapped) };
  assert.equal(crypto.verify(resigned.bundleDigest, resigned.signature, resigned.publicKeyRef), true);
  assert.throws(() => verifyPolicyBundle(resigned, crypto), {
    code: "VES_POLICY_BUNDLE_INVALID",
    message: /does not reproduce/u
  });
});

test("bundle construction rejects malformed input", () => {
  const crypto = bundleCrypto();
  assert.throws(() => buildPolicyBundle({ ...bundleInput(), version: "v1" }, crypto), {
    code: "VES_POLICY_BUNDLE_INVALID"
  });
  assert.throws(() => buildPolicyBundle({ ...bundleInput(), policies: [] }, crypto), {
    code: "VES_POLICY_BUNDLE_INVALID"
  });
  assert.throws(
    () =>
      buildPolicyBundle({ ...bundleInput(), policies: [...bundleInput().policies, bundleInput().policies[0]] }, crypto),
    { code: "VES_POLICY_BUNDLE_INVALID" }
  );
});
