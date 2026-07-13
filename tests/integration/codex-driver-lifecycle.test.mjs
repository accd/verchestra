import assert from "node:assert/strict";
import { test } from "node:test";
import { CodexDriver } from "../../packages/drivers/src/codex-driver.ts";
import { codexFixture } from "../helpers/codex-driver-fixture.mjs";

test("incompatible Codex blocks before resolution and app-server spawn", async () => {
  const fixture = codexFixture();
  const driver = new CodexDriver(fixture.dependencies({ probeEnvironment: { FAKE_CODEX_VERSION: "1.0.0" } }));
  await assert.rejects(
    driver.start(fixture.request(), () => {}, new AbortController().signal),
    (error) => error.code === "VES_CODEX_VERSION_UNSUPPORTED"
  );
  assert.equal(fixture.calls.resolve, 0);
  assert.equal(fixture.calls.spawn, 0);
});

test("Codex performs handshake and sends prompt only through JSONL stdin", async () => {
  const fixture = codexFixture();
  const sent = [];
  const driver = new CodexDriver(fixture.dependencies({ onMessageSent: (message) => sent.push(message) }));
  const session = await driver.start(fixture.request(), () => {}, new AbortController().signal);
  assert.equal(sent[0].method, "initialize");
  assert.equal(sent[1].method, "initialized");
  assert.equal(sent.find((message) => message.method === "thread/start").params.ephemeral, true);
  assert.equal(sent.find((message) => message.method === "turn/start").params.input[0].text, "private prompt");
  assert.equal(JSON.stringify(session).includes("private prompt"), false);
});

test("Codex abort sends protocol interrupt before process-tree termination", async () => {
  const fixture = codexFixture({ environment: { FAKE_CODEX_MODE: "hang" }, cancelGraceMs: 30 });
  const sent = [];
  const controller = new AbortController();
  const events = [];
  const driver = new CodexDriver(
    fixture.dependencies({
      onMessageSent: (message) => {
        sent.push(message);
        if (message.method === "turn/start") setTimeout(() => controller.abort(), 10);
      }
    })
  );
  await driver.start(fixture.request(), (event) => events.push(event), controller.signal);
  assert.equal(
    sent.some((message) => message.method === "turn/interrupt"),
    true
  );
  assert.equal(fixture.calls.terminate, 1);
  assert.equal(
    events.some((event) => event.type === "error" && event.code === "VES_CODEX_ABORTED"),
    true
  );
});

test("Codex close is idempotent and emits one terminal event", async () => {
  const fixture = codexFixture();
  const events = [];
  const driver = new CodexDriver(fixture.dependencies());
  const session = await driver.start(fixture.request(), (event) => events.push(event), new AbortController().signal);
  await driver.close(session);
  await driver.close(session);
  assert.equal(events.filter((event) => event.type === "session.closed").length, 1);
});

test("Codex session reference is local to one adapter instance", async () => {
  const fixture = codexFixture();
  const owner = new CodexDriver(fixture.dependencies());
  const session = await owner.start(fixture.request(), () => {}, new AbortController().signal);
  await assert.rejects(
    new CodexDriver(fixture.dependencies()).close(session),
    (error) => error.code === "VES_DRIVER_SESSION_UNKNOWN"
  );
});

test("Codex portable lifecycle contains no credential, thread, or turn state", async () => {
  const secret = "machine-only-secret";
  const fixture = codexFixture({
    environment: { FAKE_CODEX_MODE: "success", OPENAI_API_KEY: secret },
    sensitiveValues: [secret]
  });
  const events = [];
  const driver = new CodexDriver(fixture.dependencies());
  const session = await driver.start(fixture.request(), (event) => events.push(event), new AbortController().signal);
  const closed = await driver.close(session);
  const portable = JSON.stringify({ events, session, closed });
  assert.equal(portable.includes(secret), false);
  assert.equal(portable.includes("private-thread-id"), false);
  assert.equal(portable.includes("private-turn-id"), false);
});
