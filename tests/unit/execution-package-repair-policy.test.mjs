import assert from "node:assert/strict";
import { test } from "node:test";

import { executionHarness, packageInput } from "../helpers/execution-package-fixture.mjs";

const policy = (overrides = {}) => ({ maxAttempts: 3, feedbackToDriver: true, escalateAfter: 2, ...overrides });

test("a declared gate-repair policy seals into the package verbatim", async () => {
  const { builder } = executionHarness();
  const sealed = await builder.build(packageInput({ onGateFailure: policy() }));
  assert.deepEqual(sealed.payload.onGateFailure, policy());
});

test("a package without a repair policy still seals, so existing packages stay valid", async () => {
  const { builder } = executionHarness();
  const sealed = await builder.build(packageInput());
  assert.equal(sealed.payload.onGateFailure, undefined);
  assert.equal(sealed.payload.policyBundleDigest, undefined);
});

// T68c and T68d each added an optional package field independently. Neither
// branch could test them together, so the combination is asserted here.
test("the repair policy and the policy bundle digest coexist in one package", async () => {
  const bundleDigest = `sha256:${"a".repeat(64)}`;
  const { builder } = executionHarness();
  const sealed = await builder.build(packageInput({ onGateFailure: policy(), policyBundleDigest: bundleDigest }));
  assert.deepEqual(sealed.payload.onGateFailure, policy());
  assert.equal(sealed.payload.policyBundleDigest, bundleDigest);
});

test("a malformed policy bundle digest is rejected alongside a valid repair policy", async () => {
  const { builder } = executionHarness();
  await assert.rejects(builder.build(packageInput({ onGateFailure: policy(), policyBundleDigest: "not-a-digest" })), {
    code: "VES_EXECUTION_PACKAGE_INVALID"
  });
});

for (const [label, corrupt] of [
  ["zero attempts", policy({ maxAttempts: 0 })],
  ["six attempts", policy({ maxAttempts: 6 })],
  ["a fractional attempt count", policy({ maxAttempts: 2.5 })],
  ["escalation past the last attempt", policy({ maxAttempts: 2, escalateAfter: 3 })],
  ["a zero escalation point", policy({ escalateAfter: 0 })],
  ["a stringly boolean", policy({ feedbackToDriver: "yes" })],
  ["an unknown field", policy({ retryForever: true })]
]) {
  test(`a repair policy with ${label} is rejected`, async () => {
    const { builder } = executionHarness();
    await assert.rejects(builder.build(packageInput({ onGateFailure: corrupt })), {
      code: "VES_EXECUTION_PACKAGE_INVALID"
    });
  });
}
