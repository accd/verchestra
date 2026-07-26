import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { PiDriver } from "../../packages/drivers/src/pi-driver.ts";
import { piFixture } from "../helpers/pi-driver-fixture.mjs";

test("Pi Driver probes its exact runtime and common capabilities", async () => {
  const probe = await new PiDriver(piFixture().dependencies()).probe();
  assert.deepEqual(probe, {
    driverId: "pi",
    package: "@earendil-works/pi-agent-core",
    version: "0.82.1",
    capabilities: ["stream", "tools", "usage", "abort"]
  });
});

test("Pi Driver emits common lifecycle, resolved identity, content, and usage", async () => {
  const fixture = piFixture();
  const events = [];
  const driver = new PiDriver(fixture.dependencies());
  const session = await driver.start(fixture.request(), (event) => events.push(event), new AbortController().signal);
  await driver.close(session);
  assert.deepEqual(
    events.map((event) => event.type),
    ["session.started", "model.resolved", "content.delta", "usage.updated", "session.closed"]
  );
  assert.deepEqual(
    events.map((event) => event.sequence),
    [0, 1, 2, 3, 4]
  );
  assert.equal(events[1].resolvedModel, fixture.model.id);
  assert.equal(events[3].inputTokens > 0, true);
});

test("Pi Driver preserves streamed delta order", async () => {
  const fixture = piFixture([fauxAssistantMessage("ordered output")], { tokensPerSecond: 1_000 });
  const events = [];
  await new PiDriver(fixture.dependencies()).start(
    fixture.request(),
    (event) => events.push(event),
    new AbortController().signal
  );
  assert.equal(
    events
      .filter((event) => event.type === "content.delta")
      .map((event) => event.text)
      .join(""),
    "ordered output"
  );
});

for (const [name, mutate] of [
  ["Passport reference", (fixture) => ({ passport: { ...fixture.execution.passport, revision: 2 } })],
  ["resolved provider", (fixture) => ({ passport: { ...fixture.execution.passport, provider: "other" } })],
  ["resolved API", (fixture) => ({ passport: { ...fixture.execution.passport, api: "other" } })],
  ["resolved model", (fixture) => ({ passport: { ...fixture.execution.passport, resolvedModel: "other" } })]
]) {
  test(`Pi Driver rejects mismatched ${name}`, async () => {
    const fixture = piFixture();
    await assert.rejects(
      new PiDriver(fixture.dependencies(mutate(fixture))).start(
        fixture.request(),
        () => {},
        new AbortController().signal
      ),
      (error) => error.code === "VES_PI_IDENTITY_MISMATCH"
    );
  });
}

test("Pi Driver rejects undeclared concrete tools", async () => {
  const fixture = piFixture();
  await assert.rejects(
    new PiDriver(fixture.dependencies()).start(fixture.request({ tools: [] }), () => {}, new AbortController().signal),
    (error) => error.code === "VES_PI_TOOLSET_MISMATCH"
  );
});

test("Pi Driver rejects a concrete tool schema digest mismatch", async () => {
  const fixture = piFixture();
  const tools = [{ ...fixture.execution.tools[0], inputSchemaDigest: "sha256:" + "c".repeat(64) }];
  await assert.rejects(
    new PiDriver(fixture.dependencies({ tools })).start(fixture.request(), () => {}, new AbortController().signal),
    (error) => error.code === "VES_PI_TOOLSET_MISMATCH"
  );
});

test("Pi Driver rejects capacity overflow before provider invocation", async () => {
  const fixture = piFixture([fauxAssistantMessage("never")], {
    models: [{ id: "tiny", contextWindow: 8, maxTokens: 4 }]
  });
  await assert.rejects(
    new PiDriver(fixture.dependencies({ prompt: "x".repeat(80) })).start(
      fixture.request(),
      () => {},
      new AbortController().signal
    ),
    (error) => error.code === "VES_PI_CONTEXT_CAPACITY_EXCEEDED"
  );
  assert.equal(fixture.faux.state.callCount, 0);
});

test("Pi Driver rejects a separate system prompt outside the serialized context", async () => {
  const fixture = piFixture();
  await assert.rejects(
    new PiDriver(fixture.dependencies({ systemPrompt: "extra controller instructions" })).start(
      fixture.request(),
      () => {},
      new AbortController().signal
    ),
    (error) => error.code === "VES_PI_CONTEXT_INVALID"
  );
  assert.equal(fixture.faux.state.callCount, 0);
});

test("Pi Driver normalizes provider failure without leaking provider text", async () => {
  const secret = "credential=top-secret";
  const fixture = piFixture([fauxAssistantMessage("", { stopReason: "error", errorMessage: secret })]);
  const events = [];
  await new PiDriver(fixture.dependencies()).start(
    fixture.request(),
    (event) => events.push(event),
    new AbortController().signal
  );
  const error = events.find((event) => event.type === "error");
  assert.equal(error.code, "VES_PI_PROVIDER_ERROR");
  assert.equal(error.message, "Pi provider failed");
  assert.equal(error.retryable, true);
  assert.equal(Number.isSafeInteger(error.sequence), true);
  assert.equal(JSON.stringify(events).includes(secret), false);
});

test("Pi Driver reports output overflow with stable redacted evidence", async () => {
  const fixture = piFixture([fauxAssistantMessage("partial", { stopReason: "length" })]);
  const events = [];
  await new PiDriver(fixture.dependencies()).start(
    fixture.request(),
    (event) => events.push(event),
    new AbortController().signal
  );
  assert.equal(
    events.some((event) => event.type === "warning" && event.code === "VES_PI_OUTPUT_LIMIT"),
    true
  );
});

test("Pi Driver rejects a pre-aborted start before resolution", async () => {
  const fixture = piFixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    new PiDriver(fixture.dependencies()).start(fixture.request(), () => {}, controller.signal),
    (error) => error.code === "VES_DRIVER_CANCELLED"
  );
  assert.equal(fixture.calls.resolve, 0);
});

test("Pi Driver mediates an allowed tool and emits its common request", async () => {
  const fixture = piFixture([
    fauxAssistantMessage(fauxToolCall("vestra_read", { path: "README.md" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done")
  ]);
  const events = [];
  await new PiDriver(fixture.dependencies()).start(
    fixture.request(),
    (event) => events.push(event),
    new AbortController().signal
  );
  assert.equal(fixture.calls.authorize, 1);
  assert.equal(fixture.calls.execute, 1);
  assert.deepEqual(events.find((event) => event.type === "tool.requested")?.input, { path: "README.md" });
});

test("Pi Driver blocks a denied tool before execution", async () => {
  const fixture = piFixture([
    fauxAssistantMessage(fauxToolCall("vestra_read", { path: "secret" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("denied")
  ]);
  const events = [];
  const driver = new PiDriver(
    fixture.dependencies({
      authorizeTool: async () => {
        fixture.calls.authorize += 1;
        return { allowed: false, reason: "controller denied" };
      }
    })
  );
  await driver.start(fixture.request(), (event) => events.push(event), new AbortController().signal);
  assert.equal(fixture.calls.authorize, 1);
  assert.equal(fixture.calls.execute, 0);
  assert.equal(
    events.some((event) => event.type === "tool.requested"),
    true
  );
});

test("Pi Driver session references and close result contain no private context", async () => {
  const fixture = piFixture();
  const driver = new PiDriver(fixture.dependencies());
  const session = await driver.start(fixture.request(), () => {}, new AbortController().signal);
  const closed = await driver.close(session);
  const serialized = JSON.stringify({ session, closed });
  assert.equal(session.sessionId.startsWith("pi-session:"), true);
  assert.equal(serialized.includes("private prompt"), false);
  assert.equal(Object.hasOwn(closed, "messages"), false);
});
