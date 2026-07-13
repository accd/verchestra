import assert from "node:assert/strict";
import { test } from "node:test";
import { CodexDriver } from "../../packages/drivers/src/codex-driver.ts";
import { codexFixture } from "../helpers/codex-driver-fixture.mjs";

test("Codex Driver probes exact app-server capabilities", async () => {
  const result = await new CodexDriver(codexFixture().dependencies()).probe();
  assert.equal(result.available, true);
  assert.equal(result.version, "0.115.0");
  assert.equal(result.capabilities.includes("ephemeral-threads"), true);
  assert.equal(result.capabilities.includes("read-only"), true);
});

test("Codex Driver blocks an unsupported version", async () => {
  const fixture = codexFixture();
  const result = await new CodexDriver(
    fixture.dependencies({ probeEnvironment: { FAKE_CODEX_VERSION: "0.114.0" } })
  ).probe();
  assert.equal(result.available, false);
  assert.equal(result.error.code, "VES_CODEX_VERSION_UNSUPPORTED");
});

test("Codex Driver redacts unavailable CLI loader details", async () => {
  const result = await new CodexDriver(codexFixture().dependencies({ command: ["missing-verchestra-codex"] })).probe();
  assert.deepEqual(result.error, { code: "VES_CODEX_NOT_AVAILABLE", message: "Codex is unavailable" });
});

test("Codex Driver builds local stdio app-server arguments only", () => {
  const args = new CodexDriver(codexFixture().dependencies()).buildArguments();
  assert.deepEqual(args.slice(-3), ["app-server", "--listen", "stdio://"]);
  assert.equal(
    args.some((value) => value.startsWith("ws://")),
    false
  );
  assert.equal(args.includes("private prompt"), false);
});

test("Codex Driver excludes ambient credentials and explicit thread reuse", () => {
  const prior = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "ambient-key";
  const environment = new CodexDriver(codexFixture().dependencies()).buildEnvironment({
    CODEX_THREAD_ID: "foreign-thread",
    CODEX_TURN_ID: "foreign-turn"
  });
  if (prior === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prior;
  assert.equal(Object.hasOwn(environment, "OPENAI_API_KEY"), false);
  assert.equal(Object.hasOwn(environment, "CODEX_THREAD_ID"), false);
  assert.equal(Object.hasOwn(environment, "CODEX_TURN_ID"), false);
});

test("Codex Driver locks every thread to ephemeral read-only authority", () => {
  const fixture = codexFixture();
  const params = new CodexDriver(fixture.dependencies()).buildThreadParams(fixture.execution);
  assert.equal(params.ephemeral, true);
  assert.equal(params.sandbox, "read-only");
  assert.equal(params.approvalPolicy, "untrusted");
  assert.equal(params.approvalsReviewer, "user");
  assert.deepEqual(params.dynamicTools[0], {
    name: "vestra_read",
    description: "Read approved input",
    inputSchema: { type: "object" }
  });
});

test("Codex Driver emits common ordered model, content, usage, and close events", async () => {
  const fixture = codexFixture();
  const events = [];
  const driver = new CodexDriver(fixture.dependencies());
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
  assert.deepEqual({ input: events[3].inputTokens, output: events[3].outputTokens }, { input: 7, output: 4 });
});

for (const [name, overrides] of [
  [
    "Passport revision",
    {
      passport: {
        passportId: "passport_018f0000-0000-7000-8000-000000001504",
        revision: 2,
        provider: "openai",
        resolvedModel: "gpt-5.5-codex"
      }
    }
  ],
  [
    "selected model",
    {
      passport: {
        passportId: "passport_018f0000-0000-7000-8000-000000001504",
        revision: 1,
        provider: "openai",
        resolvedModel: "other"
      }
    }
  ]
]) {
  test(`Codex Driver rejects mismatched ${name}`, async () => {
    const fixture = codexFixture(overrides);
    await assert.rejects(
      new CodexDriver(fixture.dependencies()).start(fixture.request(), () => {}, new AbortController().signal),
      (error) => error.code === "VES_CODEX_IDENTITY_MISMATCH"
    );
    assert.equal(fixture.calls.spawn, 0);
  });
}

test("Codex Driver blocks a model absent from the app-server catalog", async () => {
  const fixture = codexFixture({
    model: "gpt-missing",
    passport: {
      passportId: "passport_018f0000-0000-7000-8000-000000001504",
      revision: 1,
      provider: "openai",
      resolvedModel: "gpt-missing"
    }
  });
  const events = [];
  await new CodexDriver(fixture.dependencies()).start(
    fixture.request(),
    (event) => events.push(event),
    new AbortController().signal
  );
  assert.equal(
    events.some((event) => event.type === "error" && event.code === "VES_CODEX_PROTOCOL_FAILED"),
    true
  );
  assert.equal(
    events.some((event) => event.type === "model.resolved"),
    false
  );
});

test("Codex Driver normalizes a declared dynamic tool and denies inline execution", async () => {
  const tool = {
    name: "vestra_echo",
    description: "Echo",
    inputSchema: { type: "object" },
    inputSchemaDigest: "sha256:" + "c".repeat(64)
  };
  const fixture = codexFixture({ tools: [tool], environment: { FAKE_CODEX_MODE: "tool" } });
  const events = [];
  await new CodexDriver(fixture.dependencies()).start(
    fixture.request({ tools: [{ name: tool.name, inputSchemaDigest: tool.inputSchemaDigest }] }),
    (event) => events.push(event),
    new AbortController().signal
  );
  assert.deepEqual(
    events.find((event) => event.type === "tool.requested"),
    {
      type: "tool.requested",
      toolCallId: "call-1",
      name: "vestra_echo",
      input: { value: "x" },
      sequence: 2
    }
  );
});

test("Codex Driver rejects an undeclared dynamic tool request", async () => {
  const fixture = codexFixture({ environment: { FAKE_CODEX_MODE: "tool" } });
  const events = [];
  await new CodexDriver(fixture.dependencies()).start(
    fixture.request(),
    (event) => events.push(event),
    new AbortController().signal
  );
  assert.equal(
    events.some((event) => event.type === "error" && event.code === "VES_CODEX_TOOL_UNDECLARED"),
    true
  );
});

test("Codex Driver declines hidden built-in write approval", async () => {
  const fixture = codexFixture({ environment: { FAKE_CODEX_MODE: "command-approval" } });
  const events = [];
  await new CodexDriver(fixture.dependencies()).start(
    fixture.request(),
    (event) => events.push(event),
    new AbortController().signal
  );
  assert.equal(
    events.some((event) => event.type === "warning" && event.code === "VES_CODEX_BUILTIN_TOOL_DENIED"),
    true
  );
});

for (const [mode, code] of [
  ["malformed", "VES_CODEX_STREAM_INVALID"],
  ["error", "VES_CODEX_EXECUTION_FAILED"],
  ["large", "VES_CODEX_OUTPUT_LIMIT"]
]) {
  test(`Codex Driver fails closed for ${mode} app-server output`, async () => {
    const fixture = codexFixture({
      environment: { FAKE_CODEX_MODE: mode },
      ...(mode === "large" ? { maxOutputBytes: 300 } : {})
    });
    const events = [];
    await new CodexDriver(fixture.dependencies()).start(
      fixture.request(),
      (event) => events.push(event),
      new AbortController().signal
    );
    assert.equal(
      events.some((event) => event.type === "error" && event.code === code),
      true
    );
  });
}

test("Codex Driver redacts content and excludes thread/turn identities", async () => {
  const secret = "qualification-secret-value";
  const fixture = codexFixture({
    environment: { FAKE_CODEX_MODE: "secret", TEST_SECRET: secret },
    sensitiveValues: [secret]
  });
  const events = [];
  const session = await new CodexDriver(fixture.dependencies()).start(
    fixture.request(),
    (event) => events.push(event),
    new AbortController().signal
  );
  const serialized = JSON.stringify({ events, session });
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("private-thread-id"), false);
  assert.equal(serialized.includes("private-turn-id"), false);
  assert.equal(
    events.some((event) => event.type === "content.delta" && event.text === "value:[REDACTED]"),
    true
  );
});

test("Codex Driver rejects pre-aborted start before probe and spawn", async () => {
  const fixture = codexFixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    new CodexDriver(fixture.dependencies()).start(fixture.request(), () => {}, controller.signal),
    (error) => error.code === "VES_DRIVER_CANCELLED"
  );
  assert.equal(fixture.calls.resolve, 0);
  assert.equal(fixture.calls.spawn, 0);
});

test("Codex Driver rejects follow-up input for ephemeral turns", async () => {
  await assert.rejects(
    new CodexDriver(codexFixture().dependencies()).send({ sessionId: "any" }, { type: "user.input", text: "next" }),
    (error) => error.code === "VES_CODEX_SEND_UNSUPPORTED"
  );
});
