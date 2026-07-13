import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenCodeDriver } from "../../packages/drivers/src/opencode-driver.ts";
import { openCodeFixture } from "../helpers/opencode-driver-fixture.mjs";

test("OpenCode Qwen-only machine completes without another provider", async () => {
  const fixture = openCodeFixture();
  const events = [];
  const driver = new OpenCodeDriver(fixture.dependencies());
  const session = await driver.start(fixture.request(), (event) => events.push(event), new AbortController().signal);
  const closed = await driver.close(session);
  assert.equal(events.find((event) => event.type === "model.resolved").resolvedModel, "qwen3-coder-480b");
  assert.equal(closed.outcome, "completed");
});

test("OpenCode generic resolver also executes a non-Qwen model", async () => {
  const fixture = openCodeFixture({
    passport: {
      passportId: "passport_018f0000-0000-7000-8000-000000001504",
      revision: 1,
      provider: "company",
      resolvedModel: "other-coder"
    },
    model: "company/other-coder"
  });
  const events = [];
  await new OpenCodeDriver(fixture.dependencies()).start(
    fixture.request(),
    (event) => events.push(event),
    new AbortController().signal
  );
  assert.equal(events.find((event) => event.type === "model.resolved").resolvedModel, "other-coder");
});

test("OpenCode aborts SDK session before closing isolated server", async () => {
  const fixture = openCodeFixture({}, "hang");
  const controller = new AbortController();
  const events = [];
  const run = new OpenCodeDriver(fixture.dependencies()).start(
    fixture.request(),
    (event) => events.push(event),
    controller.signal
  );
  while (!fixture.calls.some(([name]) => name === "create")) await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  await run;
  assert.equal(
    fixture.calls.findIndex(([name]) => name === "abort") < fixture.calls.findIndex(([name]) => name === "close"),
    true
  );
  assert.equal(
    events.some((event) => event.type === "error" && event.code === "VES_OPENCODE_ABORTED"),
    true
  );
});

test("OpenCode close is idempotent and emits one terminal event", async () => {
  const fixture = openCodeFixture();
  const events = [];
  const driver = new OpenCodeDriver(fixture.dependencies());
  const session = await driver.start(fixture.request(), (event) => events.push(event), new AbortController().signal);
  await driver.close(session);
  await driver.close(session);
  assert.equal(events.filter((event) => event.type === "session.closed").length, 1);
});

test("OpenCode session reference is local to one adapter instance", async () => {
  const fixture = openCodeFixture();
  const owner = new OpenCodeDriver(fixture.dependencies());
  const session = await owner.start(fixture.request(), () => {}, new AbortController().signal);
  await assert.rejects(
    new OpenCodeDriver(fixture.dependencies()).close(session),
    (error) => error.code === "VES_DRIVER_SESSION_UNKNOWN"
  );
});
