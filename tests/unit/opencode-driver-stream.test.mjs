import assert from "node:assert/strict";
import { test } from "node:test";

import { OpenCodeDriver } from "../../packages/drivers/src/opencode-driver.ts";
import { fakeOpenCodeFactory, openCodeFixture } from "../helpers/opencode-driver-fixture.mjs";

const SESSION = "private-session";

// A provider whose event stream is exactly `script`.
function scriptedFactory(fixture, script) {
  return async (options) => {
    const instance = await fakeOpenCodeFactory("success", fixture.calls)(options);
    const stream = async function* () {
      yield* script;
    };
    return { ...instance, client: { ...instance.client, event: { subscribe: async () => ({ stream: stream() }) } } };
  };
}

async function run(script) {
  const fixture = openCodeFixture();
  const events = [];
  const driver = new OpenCodeDriver(fixture.dependencies({ serverFactory: scriptedFactory(fixture, script) }));
  const session = await driver.start(fixture.request(), (event) => events.push(event), new AbortController().signal);
  await driver.close(session);
  return events;
}

const text = (value) => ({
  type: "message.part.updated",
  properties: { sessionID: SESSION, part: { type: "text", text: value, time: { end: 1 } } }
});
const idle = { type: "session.status", properties: { sessionID: SESSION, status: { type: "idle" } } };

test("a resolution failure refuses the start before any provider server exists", async () => {
  const fixture = openCodeFixture();
  const driver = new OpenCodeDriver(
    fixture.dependencies({
      resolveExecution: async () => {
        throw new Error("resolver secret detail");
      }
    })
  );
  await assert.rejects(
    driver.start(fixture.request(), () => {}, new AbortController().signal),
    {
      code: "VES_OPENCODE_RESOLUTION_FAILED",
      message: "OpenCode execution resolution failed"
    }
  );
  assert.equal(
    fixture.calls.some(([name]) => name === "server"),
    false
  );
});

test("a stream that ends before the session is idle fails the run", async () => {
  const events = await run([text("partial")]);
  assert.deepEqual(
    events.map((event) => [event.type, event.code]),
    [
      ["session.started", undefined],
      ["model.resolved", undefined],
      ["content.delta", undefined],
      ["error", "VES_OPENCODE_STREAM_INCOMPLETE"],
      ["session.closed", undefined]
    ]
  );
  assert.equal(events.at(-1).outcome, "failed");
});

test("a busy status and unrelated events do not end the stream; idle does", async () => {
  const events = await run([
    { type: "session.status", properties: { sessionID: SESSION, status: { type: "busy" } } },
    { type: "session.updated", properties: { sessionID: SESSION } },
    { type: "message.part.updated", properties: { sessionID: SESSION, part: { type: "reasoning" } } },
    text("done"),
    idle,
    text("after idle")
  ]);
  assert.deepEqual(
    events.map((event) => event.type),
    ["session.started", "model.resolved", "content.delta", "session.closed"]
  );
  assert.equal(events[2].text, "done");
  assert.equal(events.at(-1).outcome, "completed");
});

test("a text part that has not finished is not emitted", async () => {
  const events = await run([
    { type: "message.part.updated", properties: { sessionID: SESSION, part: { type: "text", text: "draft" } } },
    text("final"),
    idle
  ]);
  assert.deepEqual(
    events.filter((event) => event.type === "content.delta").map((event) => event.text),
    ["final"]
  );
});

for (const [name, raw] of [
  ["a non-object event", "not an event"],
  ["an event without a type", { properties: { sessionID: SESSION } }],
  ["a permission event without an identity", { type: "permission.asked", properties: { sessionID: SESSION } }]
]) {
  test(`${name} fails the run as an invalid stream`, async () => {
    const events = await run([raw, idle]);
    const error = events.find((event) => event.type === "error");
    assert.equal(error.code, "VES_OPENCODE_STREAM_INVALID");
    assert.equal(events.at(-1).outcome, "failed");
  });
}
