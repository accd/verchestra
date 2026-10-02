import assert from "node:assert/strict";
import { test } from "node:test";
import { AssistantMessageEventStream, createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { PiDriver } from "../../packages/drivers/src/pi-driver.ts";
import { piFixture } from "../helpers/pi-driver-fixture.mjs";

test("Pi Driver creates a fresh Pi transcript for every start", async () => {
  // invariant: since Pi 0.86 the authorized tools reach the provider as a leading
  // system message rather than a separate context field, so freshness is the
  // exact provider-visible transcript, not its raw length: one tool declaration
  // with an empty system prompt, then this start's single user prompt.
  const observed = [];
  const respond = (context) => {
    observed.push(
      context.messages.map((message) =>
        message.role === "system"
          ? { role: "system", content: message.content, tools: (message.toolsAdded ?? []).map((tool) => tool.name) }
          : { role: message.role }
      )
    );
    const visible = context.messages.filter((message) => message.role !== "system").length;
    return fauxAssistantMessage(`visible:${visible}`);
  };
  const fixture = piFixture([respond, respond]);
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
  const freshTranscript = [{ role: "system", content: "", tools: ["vestra_read"] }, { role: "user" }];
  assert.deepEqual(observed, [freshTranscript, freshTranscript]);
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
