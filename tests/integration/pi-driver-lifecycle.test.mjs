import assert from "node:assert/strict";
import { test } from "node:test";
import { AssistantMessageEventStream, createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { PiDriver } from "../../packages/drivers/src/pi-driver.ts";
import { piFixture } from "../helpers/pi-driver-fixture.mjs";

test("Pi Driver creates a fresh Pi transcript for every start", async () => {
  const fixture = piFixture([
    (context) => fauxAssistantMessage(`visible:${context.messages.length}`),
    (context) => fauxAssistantMessage(`visible:${context.messages.length}`)
  ]);
  const driver = new PiDriver(fixture.dependencies());
  const outputs = [];
  for (const request of [fixture.request(), fixture.request({ runId: "run_018f0000-0000-7000-8000-000000001599" })]) {
    const events = [];
    const session = await driver.start(request, (event) => events.push(event), new AbortController().signal);
    outputs.push(
      events
        .filter((event) => event.type === "content.delta")
        .map((event) => event.text)
        .join("")
    );
    await driver.close(session);
  }
  assert.deepEqual(outputs, ["visible:1", "visible:1"]);
});

test("Pi Driver sends a follow-up through the same session and event sequence", async () => {
  const fixture = piFixture([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
  const events = [];
  const driver = new PiDriver(fixture.dependencies());
  const session = await driver.start(fixture.request(), (event) => events.push(event), new AbortController().signal);
  await driver.send(session, { type: "user.input", text: "continue" });
  await driver.close(session);
  assert.equal(
    events
      .filter((event) => event.type === "content.delta")
      .map((event) => event.text)
      .join(""),
    "firstsecond"
  );
  assert.deepEqual(
    events.map((event) => event.sequence),
    events.map((_, index) => index)
  );
});

test("Pi Driver abort signal reaches the active provider run", async () => {
  const model = createFauxCore({ provider: "abort-test" }).getModel();
  let readyResolve;
  const ready = new Promise((resolve) => (readyResolve = resolve));
  const streamFn = (_model, _context, options) => {
    const stream = new AssistantMessageEventStream();
    options.signal.addEventListener(
      "abort",
      () =>
        stream.push({ type: "error", reason: "aborted", error: fauxAssistantMessage("", { stopReason: "aborted" }) }),
      { once: true }
    );
    readyResolve();
    return stream;
  };
  const fixture = piFixture();
  const events = [];
  const driver = new PiDriver(
    fixture.dependencies({
      model,
      streamFn,
      passport: { ...fixture.execution.passport, provider: model.provider, api: model.api, resolvedModel: model.id }
    })
  );
  const controller = new AbortController();
  const start = driver.start(fixture.request(), (event) => events.push(event), controller.signal);
  await ready;
  controller.abort();
  await start;
  assert.equal(
    events.some((event) => event.type === "error" && event.code === "VES_PI_ABORTED"),
    true
  );
});

test("Pi Driver close is idempotent and emits one terminal event", async () => {
  const fixture = piFixture();
  const events = [];
  const driver = new PiDriver(fixture.dependencies());
  const session = await driver.start(fixture.request(), (event) => events.push(event), new AbortController().signal);
  await driver.close(session);
  await driver.close(session);
  assert.equal(events.filter((event) => event.type === "session.closed").length, 1);
});

test("Pi Driver cancellation is idempotent after execution", async () => {
  const fixture = piFixture();
  const events = [];
  const driver = new PiDriver(fixture.dependencies());
  const session = await driver.start(fixture.request(), (event) => events.push(event), new AbortController().signal);
  await driver.cancel(session, "user-request");
  await driver.cancel(session, "user-request");
  assert.equal(events.filter((event) => event.type === "session.closed").length, 1);
  assert.equal(events.at(-1).outcome, "cancelled");
});

test("Pi Driver rejects a session reference from another adapter instance", async () => {
  const fixture = piFixture();
  const owner = new PiDriver(fixture.dependencies());
  const session = await owner.start(fixture.request(), () => {}, new AbortController().signal);
  await assert.rejects(
    new PiDriver(fixture.dependencies()).close(session),
    (error) => error.code === "VES_DRIVER_SESSION_UNKNOWN"
  );
});
