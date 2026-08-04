import assert from "node:assert/strict";
import { test } from "node:test";

import { DRIVER_CHECK_IDS } from "../../packages/application/src/index.ts";
import { runDriverScenario } from "../../apps/vestra-cli/src/self-test-driver-scenario.ts";

test("the approved Driver scenario exercises all three qualified boundaries", async () => {
  const result = await runDriverScenario();
  assert.deepEqual(
    result.invocations.slice(0, 3).map((entry) => [entry.review.providerId, entry.providerBoundaryEntries]),
    [
      ["anthropic", 1],
      ["openai", 1],
      ["opencode", 1]
    ]
  );
  assert.equal(result.events.filter((event) => event.type === "session.started").length, 3);
  assert.equal(result.events.filter((event) => event.type === "session.closed").length, 3);
});

test("the Driver scenario reports the closed check catalog", async () => {
  const result = await runDriverScenario();
  assert.deepEqual(
    result.facts.checks.map((entry) => entry.checkId),
    DRIVER_CHECK_IDS
  );
  assert.equal(
    result.facts.checks.every((entry) => entry.status === "pass"),
    true
  );
});

test("each displayed review exactly binds destination, cost, capabilities, Tools, and egress", async () => {
  const result = await runDriverScenario();
  for (const invocation of result.invocations) {
    assert.deepEqual(invocation.displayedReview, invocation.review);
    assert.equal(invocation.review.maximumCostUsd, 0.25);
    assert.deepEqual(invocation.review.modelCapabilities, ["read", "reason"]);
    assert.equal(invocation.review.classification, "internal");
    assert.equal(invocation.review.purpose, "self-test-read-only");
    assert.equal(invocation.review.retention, "none");
    assert.equal(invocation.review.egressMode, "online");
  }
});

test("the scenario includes a denied path with zero provider calls", async () => {
  const result = await runDriverScenario();
  const denied = result.invocations.at(-1);
  assert.equal(denied.authorized, false);
  assert.equal(denied.providerBoundaryEntries, 0);
});

test("every approved Tool is read-only and no writer request is emitted", async () => {
  const result = await runDriverScenario();
  for (const invocation of result.invocations) {
    assert.equal(invocation.writerToolReachable, false);
    assert.deepEqual(invocation.review.tools, [{ name: "vestra_read", access: "read" }]);
  }
  assert.equal(
    result.events.some((event) => event.type === "tool.requested"),
    false
  );
});
