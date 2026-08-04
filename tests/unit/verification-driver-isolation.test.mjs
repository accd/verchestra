// #35: structural verifier isolation. resolveVerifierDriver and
// assertReadOnlyGrant are pure rules; the tool-invocation rejection (SVI-04)
// runs against a real DeterministicMockDriver session so the rejection is
// proven at the driver-session boundary rather than hand-waved.
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNoToolRequests,
  assertReadOnlyGrant,
  resolveVerifierDriver
} from "../../packages/application/src/index.ts";
import { DeterministicMockDriver } from "../../packages/drivers/src/index.ts";

// --- SVI-02 / SVI-07: verifier driver resolution ---

test("resolution excludes the implementer's own id and picks deterministically", () => {
  const result = resolveVerifierDriver(
    [
      { driverId: "driver-b", available: true },
      { driverId: "driver-a", available: true }
    ],
    "driver-c"
  );
  assert.deepEqual(result, { status: "resolved", driverId: "driver-a" });
});

test("the implementer's own id is excluded even when it reports available", () => {
  const result = resolveVerifierDriver(
    [
      { driverId: "driver-a", available: true },
      { driverId: "driver-b", available: false }
    ],
    "driver-a"
  );
  assert.deepEqual(result, { status: "not-configured" });
});

test("an unavailable candidate is not eligible even if it is not the implementer", () => {
  const result = resolveVerifierDriver([{ driverId: "driver-b", available: false }], "driver-a");
  assert.deepEqual(result, { status: "not-configured" });
});

test("no candidates at all resolves to not-configured, never a silent fallback", () => {
  assert.deepEqual(resolveVerifierDriver([], "driver-a"), { status: "not-configured" });
});

test("resolution is deterministic across repeated calls with the same input", () => {
  const candidates = [
    { driverId: "zebra", available: true },
    { driverId: "alpha", available: true },
    { driverId: "mid", available: true }
  ];
  const first = resolveVerifierDriver(candidates, "implementer");
  const second = resolveVerifierDriver(candidates, "implementer");
  assert.deepEqual(first, second);
  assert.equal(first.driverId, "alpha");
});

// --- SVI-03: read-only grant is zero tools, not a name classifier ---

test("a zero-tool grant passes", () => {
  assertReadOnlyGrant([]);
});

test("any nonempty grant fails closed naming the count", () => {
  assert.throws(
    () => assertReadOnlyGrant([{ name: "one-tool" }]),
    (error) => {
      assert.equal(error.code, "VES_VERIFIER_GRANT_INVALID");
      assert.match(error.message, /received 1/u);
      return true;
    }
  );
});

function startVerifierSession(driver, events) {
  return driver.start(
    {
      workspaceId: "workspace_verifier",
      runId: "run_verifier",
      passportRef: { passportId: "passport_verifier", revision: 1 },
      serializedContextRef: { manifestId: `sha256:${"a".repeat(64)}`, target: "context" },
      tools: []
    },
    (event) => events.push(event),
    new AbortController().signal
  );
}

test("a real driver session started with an empty tool grant produces no tool.requested events to reject", async () => {
  const driver = new DeterministicMockDriver({ scenario: [] });
  const events = [];
  const session = await startVerifierSession(driver, events);
  await driver.close(session);
  assertNoToolRequests(events);
});

// --- SVI-04: a tool-invocation attempt under a zero-tool grant is rejected ---

test("a scenario emitting tool.requested against a zero-tool session is rejected by the grant rule", async () => {
  // DeterministicMockDriver.start() replays its scripted scenario into the
  // sink immediately, exactly as a real driver session's own event stream
  // would already contain the request by the time a caller inspects it.
  const driver = new DeterministicMockDriver({
    scenario: [{ type: "tool.requested", toolCallId: "call-1", name: "any-tool", input: {} }]
  });
  const events = [];
  const session = await startVerifierSession(driver, events);
  await driver.close(session);
  const requested = events.filter((event) => event.type === "tool.requested");
  assert.equal(requested.length, 1, "the scenario must actually have produced the tool-requested event");
  assert.throws(
    () => assertNoToolRequests(events),
    (error) => {
      assert.equal(error.code, "VES_VERIFIER_GRANT_INVALID");
      assert.match(error.message, /requested 1 tool/u);
      return true;
    }
  );
});

test("a session with two tool-requests is reported with the exact count, not just a boolean", async () => {
  const driver = new DeterministicMockDriver({
    scenario: [
      { type: "tool.requested", toolCallId: "call-1", name: "tool-a", input: {} },
      { type: "tool.requested", toolCallId: "call-2", name: "tool-b", input: {} }
    ]
  });
  const events = [];
  const session = await startVerifierSession(driver, events);
  await driver.close(session);
  assert.throws(() => assertNoToolRequests(events), /requested 2 tool/u);
});

// --- SVI-07: full cross-driver scenario, end to end ---
//
// Two real, distinct DeterministicMockDriver instances play "Claude Code
// wrote, Codex verifies" without any live paid call: probe availability,
// resolve the verifier driver, start its session under a read-only grant,
// and prove the session's own event stream carries no tool request.

test("cross-driver scenario: probe, resolve, and run a read-only verifier session under a different driver", async () => {
  const implementer = new DeterministicMockDriver({ scenario: [] });
  const verifier = new DeterministicMockDriver({ scenario: [] });
  const implementerProbe = await implementer.probe();
  const verifierProbe = await verifier.probe();
  assert.equal(implementerProbe.driverId, "mock");
  assert.equal(verifierProbe.driverId, "mock");

  // Two sessions of the same driver type still carry distinct identities in
  // this scenario (labeled by the composition root, not the driver package,
  // exactly as T71+ composition will label real ClaudeCodeDriver vs
  // CodexDriver instances) — resolution must still refuse a same-label match.
  const implementerDriverId = "claude-code";
  const resolution = resolveVerifierDriver(
    [
      { driverId: implementerDriverId, available: true },
      { driverId: "codex", available: true }
    ],
    implementerDriverId
  );
  assert.deepEqual(resolution, { status: "resolved", driverId: "codex" });
  assert.notEqual(resolution.driverId, implementerDriverId);

  assertReadOnlyGrant([]);
  const events = [];
  const session = await startVerifierSession(verifier, events);
  await verifier.close(session);
  assertNoToolRequests(events);
});

test("cross-driver scenario: a single available driver (equal to the implementer) resolves not-configured, never a same-runtime fallback", () => {
  const resolution = resolveVerifierDriver([{ driverId: "claude-code", available: true }], "claude-code");
  assert.deepEqual(resolution, { status: "not-configured" });
});
