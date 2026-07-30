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
