import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenCodeDriver } from "../../packages/drivers/src/opencode-driver.ts";
import { openCodeFixture } from "../helpers/opencode-driver-fixture.mjs";

test("isolated OpenCode server receives no ambient corporate credential", () => {
  const prior = process.env.COMPANY_QWEN_API_KEY;
  process.env.COMPANY_QWEN_API_KEY = "ambient-corporate-secret";
  const options = new OpenCodeDriver(openCodeFixture().dependencies()).serverOptions({
    EXPLICIT_QWEN_TOKEN: "brokered"
  });
  if (prior === undefined) delete process.env.COMPANY_QWEN_API_KEY;
  else process.env.COMPANY_QWEN_API_KEY = prior;
  assert.equal(Object.hasOwn(options.environment, "COMPANY_QWEN_API_KEY"), false);
  assert.equal(options.environment.EXPLICIT_QWEN_TOKEN, "brokered");
});

test("explicit OpenCode provider session reuse is removed", () => {
  const environment = new OpenCodeDriver(openCodeFixture().dependencies()).buildEnvironment({
    OPENCODE_SESSION_ID: "foreign-session"
  });
  assert.equal(Object.hasOwn(environment, "OPENCODE_SESSION_ID"), false);
});

test("OpenCode redacts sensitive content and discards provider session identity", async () => {
  const secret = "qualification-secret-value";
  const fixture = openCodeFixture({ sensitiveValues: [secret] }, "secret");
  const events = [];
  const session = await new OpenCodeDriver(fixture.dependencies()).start(
    fixture.request(),
    (event) => events.push(event),
    new AbortController().signal
  );
  const serialized = JSON.stringify({ events, session });
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("private-session"), false);
  assert.equal(
    events.some((event) => event.type === "content.delta" && event.text === "value:[REDACTED]"),
    true
  );
});

test("OpenCode ignores events from a foreign provider session", async () => {
  const fixture = openCodeFixture({}, "foreign");
  const events = [];
  await new OpenCodeDriver(fixture.dependencies()).start(
    fixture.request(),
    (event) => events.push(event),
    new AbortController().signal
  );
  assert.equal(JSON.stringify(events).includes("foreign-secret"), false);
});

test("OpenCode redacts permission metadata before controller authorization", async () => {
  const secret = "qualification-secret-value";
  let authorizedRequest;
  const tool = { name: "vestra_write", inputSchemaDigest: "sha256:" + "c".repeat(64) };
  const fixture = openCodeFixture(
    {
      tools: [tool],
      sensitiveValues: [secret],
      authorizeTool: async (request) => {
        authorizedRequest = request;
        return false;
      }
    },
    "permission-secret"
  );
  await new OpenCodeDriver(fixture.dependencies()).start(
    fixture.request({ tools: [tool] }),
    () => {},
    new AbortController().signal
  );
  assert.equal(JSON.stringify(authorizedRequest).includes(secret), false);
  assert.equal(authorizedRequest.input.path, "[REDACTED]");
});
