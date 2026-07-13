import assert from "node:assert/strict";
import { test } from "node:test";
import { ClaudeCodeDriver } from "../../packages/drivers/src/claude-code-driver.ts";
import { claudeFixture } from "../helpers/claude-driver-fixture.mjs";

test("incompatible Claude CLI blocks before execution resolution and spawn", async () => {
  const fixture = claudeFixture();
  const driver = new ClaudeCodeDriver(fixture.dependencies({ probeEnvironment: { FAKE_CLAUDE_VERSION: "3.0.0" } }));
  await assert.rejects(
    driver.start(fixture.request(), () => {}, new AbortController().signal),
    (error) => error.code === "VES_CLAUDE_VERSION_UNSUPPORTED"
  );
  assert.equal(fixture.calls.resolve, 0);
  assert.equal(fixture.calls.spawn, 0);
});

test("live abort terminates the Claude process tree and emits redacted evidence", async () => {
  const fixture = claudeFixture({ environment: { FAKE_CLAUDE_MODE: "hang" } });
  let spawnedResolve;
  const spawned = new Promise((resolve) => (spawnedResolve = resolve));
  const events = [];
  const driver = new ClaudeCodeDriver(
    fixture.dependencies({
      onSpawn: () => {
        fixture.calls.spawn += 1;
        spawnedResolve();
      }
    })
  );
  const controller = new AbortController();
  const start = driver.start(fixture.request(), (event) => events.push(event), controller.signal);
  await spawned;
  controller.abort();
  await start;
  assert.equal(fixture.calls.terminate, 1);
  assert.equal(
    events.some((event) => event.type === "error" && event.code === "VES_CLAUDE_ABORTED"),
    true
  );
});

test("Claude close is idempotent and emits one terminal event", async () => {
  const fixture = claudeFixture();
  const events = [];
  const driver = new ClaudeCodeDriver(fixture.dependencies());
  const session = await driver.start(fixture.request(), (event) => events.push(event), new AbortController().signal);
  await driver.close(session);
  await driver.close(session);
  assert.equal(events.filter((event) => event.type === "session.closed").length, 1);
});

test("Claude session reference is local to one adapter instance", async () => {
  const fixture = claudeFixture();
  const owner = new ClaudeCodeDriver(fixture.dependencies());
  const session = await owner.start(fixture.request(), () => {}, new AbortController().signal);
  await assert.rejects(
    new ClaudeCodeDriver(fixture.dependencies()).close(session),
    (error) => error.code === "VES_DRIVER_SESSION_UNKNOWN"
  );
});

test("Claude portable results contain no credential or provider session state", async () => {
  const secret = "machine-only-secret";
  const fixture = claudeFixture({
    environment: { FAKE_CLAUDE_MODE: "success", ANTHROPIC_API_KEY: secret },
    sensitiveValues: [secret]
  });
  const events = [];
  const driver = new ClaudeCodeDriver(fixture.dependencies());
  const session = await driver.start(fixture.request(), (event) => events.push(event), new AbortController().signal);
  const closed = await driver.close(session);
  const portable = JSON.stringify({ events, session, closed });
  assert.equal(portable.includes(secret), false);
  assert.equal(portable.includes("private-session-id"), false);
});
