import assert from "node:assert/strict";
import { test } from "node:test";
import { DeterministicMockDriver } from "../../packages/drivers/src/index.ts";
import { mockRequest } from "../helpers/driver-protocol-fixture.mjs";

test("Mock Driver emits the complete ordered success lifecycle", async () => {
  const driver = new DeterministicMockDriver({
    scenario: [
      { type: "content.delta", text: "hello" },
      { type: "usage.updated", inputTokens: 10, outputTokens: 2 }
    ]
  });
  const events = [];
  const session = await driver.start(mockRequest(), (event) => events.push(event), new AbortController().signal);
  await driver.close(session);
  assert.deepEqual(
    events.map((entry) => entry.type),
    ["session.started", "model.resolved", "content.delta", "usage.updated", "session.closed"]
  );
  assert.deepEqual(
    events.map((entry) => entry.sequence),
    [0, 1, 2, 3, 4]
  );
});

for (const event of [
  { type: "content.delta", text: "x" },
  { type: "tool.requested", toolCallId: "call:1", name: "vestra_read", input: { path: "README.md" } },
  { type: "usage.updated", inputTokens: 1, outputTokens: 2 },
  { type: "result.structured", value: { outcome: "done", summary: "s" }, bytes: 32 },
  { type: "quota.exhausted", scope: "five_hour" },
  { type: "warning", code: "MOCK_WARNING", message: "bounded warning" },
  { type: "error", code: "MOCK_ERROR", message: "bounded error", retryable: false }
]) {
  test(`Mock Driver scripts ${event.type}`, async () => {
    const events = [];
    const driver = new DeterministicMockDriver({ scenario: [event] });
    const session = await driver.start(mockRequest(), (value) => events.push(value), new AbortController().signal);
    await driver.close(session);
    assert.deepEqual(events[2], { ...event, sequence: 2 });
  });
}

test("Mock Driver rejects send after close", async () => {
  const driver = new DeterministicMockDriver({ scenario: [] });
  const session = await driver.start(mockRequest(), () => {}, new AbortController().signal);
  await driver.close(session);
  await assert.rejects(
    driver.send(session, { type: "user.input", text: "late" }),
    (error) => error.code === "VES_DRIVER_SESSION_CLOSED"
  );
});

test("Mock Driver cancellation is idempotent and closes once", async () => {
  const events = [];
  const driver = new DeterministicMockDriver({ scenario: [] });
  const session = await driver.start(mockRequest(), (value) => events.push(value), new AbortController().signal);
  await driver.cancel(session, "user-request");
  await driver.cancel(session, "user-request");
  assert.equal(events.filter((entry) => entry.type === "session.closed").length, 1);
});

test("Mock Driver abort signal cancels before scenario events", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    new DeterministicMockDriver({ scenario: [{ type: "content.delta", text: "never" }] }).start(
      mockRequest(),
      () => {},
      controller.signal
    ),
    (error) => error.code === "VES_DRIVER_CANCELLED"
  );
});

test("Mock Driver rejects unknown scenario event fields", () => {
  assert.throws(
    () => new DeterministicMockDriver({ scenario: [{ type: "content.delta", text: "x", authority: "expanded" }] }),
    (error) => error.code === "VES_DRIVER_EVENT_INVALID"
  );
});

test("Mock Driver refuses a scripted count the usage rule does not read as that count", () => {
  for (const inputTokens of [-1, 1.5, "12", null, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(
      () => new DeterministicMockDriver({ scenario: [{ type: "usage.updated", inputTokens, outputTokens: 1 }] }),
      { code: "VES_DRIVER_EVENT_INVALID", message: "Mock usage event is invalid" },
      String(inputTokens)
    );
});

// invariant: a scripted structured result is one the structured-result rule
// emits as itself, and a scripted quota scope is one the quota rule keeps, so
// the mock emits no result or quota event a driver could not.
test("Mock Driver refuses a scripted structured result whose size is not its canonical size", () => {
  for (const [value, bytes] of [
    [{ outcome: "done", summary: "s" }, 31],
    [{ outcome: "done", summary: "s" }, "32"],
    [{ summary: "s", outcome: "done" }, 33],
    [Number.NaN, 3]
  ])
    assert.throws(
      () => new DeterministicMockDriver({ scenario: [{ type: "result.structured", value, bytes }] }),
      { code: "VES_DRIVER_EVENT_INVALID", message: "Mock structured result is invalid" },
      JSON.stringify([value, bytes])
    );
});

test("Mock Driver refuses a scripted quota scope the quota rule would not keep", () => {
  for (const scope of ["", "Five Hour", "unknown!", 5])
    assert.throws(
      () => new DeterministicMockDriver({ scenario: [{ type: "quota.exhausted", scope }] }),
      { code: "VES_DRIVER_EVENT_INVALID", message: "Mock quota event is invalid" },
      String(scope)
    );
  assert.throws(
    () => new DeterministicMockDriver({ scenario: [{ type: "quota.exhausted", scope: "five_hour", resetsAt: "x" }] }),
    { code: "VES_DRIVER_EVENT_INVALID", message: "Mock Driver scenario event fields are invalid" }
  );
});

for (const [name, overrides] of [
  ["Workspace identity", { workspaceId: "project_018f0000-0000-7000-8000-000000001501" }],
  ["Passport revision", { passportRef: { passportId: "passport_018f0000-0000-7000-8000-000000001504", revision: 0 } }],
  ["manifest digest", { serializedContextRef: { manifestId: "raw", target: "mock" } }],
  ["tool schema digest", { tools: [{ name: "vestra_read", inputSchemaDigest: "raw" }] }],
  ["unknown start field", { instructions: "expand authority" }]
]) {
  test(`Mock Driver rejects invalid ${name}`, async () => {
    await assert.rejects(
      new DeterministicMockDriver({ scenario: [] }).start(
        mockRequest(overrides),
        () => {},
        new AbortController().signal
      ),
      (error) => error.code === "VES_DRIVER_START_INVALID"
    );
  });
}
