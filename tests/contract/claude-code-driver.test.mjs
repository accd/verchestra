import assert from "node:assert/strict";
import { test } from "node:test";
import { ClaudeCodeDriver } from "../../packages/drivers/src/claude-code-driver.ts";
import { claudeFixture } from "../helpers/claude-driver-fixture.mjs";

test("Claude Code Driver probes exact version and capabilities", async () => {
  const result = await new ClaudeCodeDriver(claudeFixture().dependencies()).probe();
  assert.equal(result.available, true);
  assert.equal(result.version, "2.1.168");
  assert.deepEqual(result.capabilities, ["stream", "tools", "usage", "abort", "no-session-persistence"]);
});

test("Claude Code Driver blocks an unsupported CLI version", async () => {
  const fixture = claudeFixture();
  const result = await new ClaudeCodeDriver(
    fixture.dependencies({ probeEnvironment: { FAKE_CLAUDE_VERSION: "2.0.0" } })
  ).probe();
  assert.equal(result.available, false);
  assert.equal(result.error.code, "VES_CLAUDE_VERSION_UNSUPPORTED");
});

test("Claude Code Driver reports an unavailable CLI without private loader details", async () => {
  const fixture = claudeFixture();
  const result = await new ClaudeCodeDriver(fixture.dependencies({ command: ["missing-verchestra-claude"] })).probe();
  assert.deepEqual(result.error, { code: "VES_CLAUDE_NOT_AVAILABLE", message: "Claude Code is unavailable" });
});

test("Claude Code Driver builds a locked down no-persistence invocation", () => {
  const args = new ClaudeCodeDriver(claudeFixture().dependencies()).buildArguments("claude-opus-4-8");
  for (const required of [
    "--print",
    "stream-json",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--setting-sources"
  ])
    assert.equal(args.includes(required), true);
  assert.equal(args.includes("--dangerously-skip-permissions"), false);
  assert.equal(args.includes("private prompt"), false);
});

test("Claude Code Driver does not inherit ambient credentials or sessions", () => {
  const priorKey = process.env.ANTHROPIC_API_KEY;
  const priorSession = process.env.CLAUDE_CODE_SESSION;
  process.env.ANTHROPIC_API_KEY = "ambient-key";
  process.env.CLAUDE_CODE_SESSION = "ambient-session";
  const environment = new ClaudeCodeDriver(claudeFixture().dependencies()).buildEnvironment({
    CLAUDE_CODE_SESSION: "explicit-session",
    CLAUDE_SESSION_ID: "explicit-id"
  });
  if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = priorKey;
  if (priorSession === undefined) delete process.env.CLAUDE_CODE_SESSION;
  else process.env.CLAUDE_CODE_SESSION = priorSession;
  assert.equal(Object.hasOwn(environment, "ANTHROPIC_API_KEY"), false);
  assert.equal(Object.hasOwn(environment, "CLAUDE_CODE_SESSION"), false);
  assert.equal(Object.hasOwn(environment, "CLAUDE_SESSION_ID"), false);
});

test("Claude Code Driver emits common ordered lifecycle and usage", async () => {
  const fixture = claudeFixture();
  const events = [];
  const driver = new ClaudeCodeDriver(fixture.dependencies());
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
  assert.equal(events[2].text, "echo:private prompt");
  assert.deepEqual({ input: events[3].inputTokens, output: events[3].outputTokens }, { input: 5, output: 3 });
});

for (const [name, overrides] of [
  [
    "Passport revision",
    {
      passport: {
        passportId: "passport_018f0000-0000-7000-8000-000000001504",
        revision: 2,
        provider: "anthropic",
        resolvedModel: "claude-opus-4-8"
      }
    }
  ],
  [
    "selected model",
    {
      passport: {
        passportId: "passport_018f0000-0000-7000-8000-000000001504",
        revision: 1,
        provider: "anthropic",
        resolvedModel: "claude-sonnet"
      }
    }
  ]
]) {
  test(`Claude Code Driver rejects mismatched ${name}`, async () => {
    const fixture = claudeFixture(overrides);
    await assert.rejects(
      new ClaudeCodeDriver(fixture.dependencies()).start(fixture.request(), () => {}, new AbortController().signal),
      (error) => error.code === "VES_CLAUDE_IDENTITY_MISMATCH"
    );
    assert.equal(fixture.calls.spawn, 0);
  });
}

test("Claude Code Driver rejects a runtime model identity mismatch", async () => {
  const fixture = claudeFixture({ environment: { FAKE_CLAUDE_MODE: "success", FAKE_CLAUDE_MODEL: "claude-other" } });
  const events = [];
  await new ClaudeCodeDriver(fixture.dependencies()).start(
    fixture.request(),
    (event) => events.push(event),
    new AbortController().signal
  );
  assert.equal(
    events.some((event) => event.type === "error" && event.code === "VES_CLAUDE_IDENTITY_MISMATCH"),
    true
  );
  assert.equal(
    events.some((event) => event.type === "model.resolved"),
    false
  );
});

test("Claude Code Driver normalizes tool requests without executing tools", async () => {
  const fixture = claudeFixture({ environment: { FAKE_CLAUDE_MODE: "tool" } });
  const events = [];
  await new ClaudeCodeDriver(fixture.dependencies()).start(
    fixture.request(),
    (event) => events.push(event),
    new AbortController().signal
  );
  assert.deepEqual(
    events.find((event) => event.type === "tool.requested"),
    {
      type: "tool.requested",
      toolCallId: "tool-1",
      name: "vestra_echo",
      input: { value: "x" },
      sequence: 2
    }
  );
});

for (const [mode, code] of [
  ["malformed", "VES_CLAUDE_STREAM_INVALID"],
  ["invalid-tool", "VES_CLAUDE_STREAM_INVALID"],
  ["invalid-usage", "VES_CLAUDE_STREAM_INVALID"],
  ["error", "VES_CLAUDE_EXECUTION_FAILED"]
]) {
  test(`Claude Code Driver fails closed for ${mode} output`, async () => {
    const fixture = claudeFixture({ environment: { FAKE_CLAUDE_MODE: mode } });
    const events = [];
    await new ClaudeCodeDriver(fixture.dependencies()).start(
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

test("Claude Code Driver redacts sensitive stdout and excludes provider session identity", async () => {
  const secret = "qualification-secret-value";
  const fixture = claudeFixture({
    environment: { FAKE_CLAUDE_MODE: "secret", TEST_SECRET: secret },
    sensitiveValues: [secret]
  });
  const events = [];
  const session = await new ClaudeCodeDriver(fixture.dependencies()).start(
    fixture.request(),
    (event) => events.push(event),
    new AbortController().signal
  );
  const serialized = JSON.stringify({ events, session });
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("private-session-id"), false);
  assert.equal(
    events.some((event) => event.type === "content.delta" && event.text === "value:[REDACTED]"),
    true
  );
});

test("Claude Code Driver rejects pre-aborted start before probe or resolution", async () => {
  const fixture = claudeFixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    new ClaudeCodeDriver(fixture.dependencies()).start(fixture.request(), () => {}, controller.signal),
    (error) => error.code === "VES_DRIVER_CANCELLED"
  );
  assert.equal(fixture.calls.resolve, 0);
  assert.equal(fixture.calls.spawn, 0);
});

test("Claude Code Driver rejects follow-up input for one-shot print sessions", async () => {
  const driver = new ClaudeCodeDriver(claudeFixture().dependencies());
  await assert.rejects(
    driver.send({ sessionId: "any" }, { type: "user.input", text: "next" }),
    (error) => error.code === "VES_CLAUDE_SEND_UNSUPPORTED"
  );
});
