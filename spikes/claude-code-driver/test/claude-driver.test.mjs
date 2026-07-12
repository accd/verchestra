import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ClaudeCodeDriver } from "../src/claude-code-driver.mjs";

const fixture = fileURLToPath(new URL("./fake-claude.mjs", import.meta.url));

function fakeDriver(options = {}) {
  return new ClaudeCodeDriver({ command: [process.execPath, fixture], minimumVersion: "2.1.168", ...options });
}

test("probes the installed Claude Code without invoking a model", async () => {
  const result = await new ClaudeCodeDriver({ command: ["claude"], minimumVersion: "2.1.168" }).probe();
  assert.equal(result.available, true);
  assert.equal(result.version, "2.1.168");
  assert.equal(result.capabilities.streamJson, true);
  assert.equal(result.capabilities.noSessionPersistence, true);
});

test("rejects an unsupported Claude Code version", async () => {
  const result = await fakeDriver().probe({ environment: { FAKE_CLAUDE_VERSION: "2.0.0" } });
  assert.equal(result.available, false);
  assert.equal(result.error.code, "VES_CLAUDE_VERSION_UNSUPPORTED");
});

test("builds a locked-down structured invocation", () => {
  const args = fakeDriver().buildArguments({ model: "claude-opus-4-8" });
  assert.equal(args.includes("--print"), true);
  assert.equal(args.includes("stream-json"), true);
  assert.equal(args.includes("--no-session-persistence"), true);
  assert.equal(args.includes("--disable-slash-commands"), true);
  assert.equal(args.includes("--strict-mcp-config"), true);
  assert.equal(args.includes("--dangerously-skip-permissions"), false);
  assert.equal(args.includes("--allow-dangerously-skip-permissions"), false);
});

test("sends the prompt through stream-json stdin and never argv", async () => {
  const result = await fakeDriver().run({ prompt: "private prompt", environment: { FAKE_CLAUDE_MODE: "success" } });
  assert.equal(result.outputText, "echo:private prompt");
  assert.equal(result.invocation.arguments.includes("private prompt"), false);
});

test("normalizes init, text delta, usage, cost, and close events", async () => {
  const result = await fakeDriver().run({ prompt: "hello", environment: { FAKE_CLAUDE_MODE: "success" } });
  assert.deepEqual(result.resolvedModel, { provider: "anthropic", model: "claude-opus-4-8" });
  assert.equal(result.events[0].type, "session.started");
  assert.equal(result.events.some((event) => event.type === "content.delta" && event.text === "echo:hello"), true);
  assert.equal(result.events.at(-1).type, "session.closed");
  assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 3, costUsd: 0.02 });
});

test("normalizes tool requests without executing them", async () => {
  const result = await fakeDriver().run({ prompt: "tool", environment: { FAKE_CLAUDE_MODE: "tool" } });
  assert.deepEqual(result.events.find((event) => event.type === "tool.requested"), {
    type: "tool.requested",
    id: "tool-1",
    name: "vestra_echo",
    input: { value: "x" }
  });
});

test("fails closed on malformed stream-json", async () => {
  const result = await fakeDriver().run({ prompt: "bad", environment: { FAKE_CLAUDE_MODE: "malformed" } });
  assert.equal(result.stopReason, "error");
  assert.equal(result.error.code, "VES_CLAUDE_STREAM_INVALID");
});

test("normalizes a Claude execution error", async () => {
  const result = await fakeDriver().run({ prompt: "bad", environment: { FAKE_CLAUDE_MODE: "error" } });
  assert.equal(result.stopReason, "error");
  assert.equal(result.error.code, "VES_CLAUDE_EXECUTION_FAILED");
  assert.equal(result.error.message, "provider failed");
});

test("cancels through the injected process-tree terminator", async () => {
  let terminatedPid;
  let markSpawned;
  const spawned = new Promise((resolve) => { markSpawned = resolve; });
  const driver = fakeDriver({
    onSpawn: markSpawned,
    terminateTree: async (pid) => { terminatedPid = pid; process.kill(pid); }
  });
  const controller = new AbortController();
  const run = driver.run({ prompt: "wait", environment: { FAKE_CLAUDE_MODE: "hang" }, signal: controller.signal });
  await spawned;
  controller.abort();
  const result = await run;
  assert.equal(Number.isInteger(terminatedPid), true);
  assert.equal(result.stopReason, "aborted");
  assert.equal(result.error.code, "VES_CLAUDE_ABORTED");
});

test("does not inherit undeclared credential environment values", () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "ambient-secret";
  const env = fakeDriver().buildEnvironment({ FAKE_CLAUDE_MODE: "success" });
  if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = previous;
  assert.equal(Object.hasOwn(env, "ANTHROPIC_API_KEY"), false);
  assert.equal(env.FAKE_CLAUDE_MODE, "success");
});

test("redacts explicit sensitive values from stdout, stderr, and result", async () => {
  const secret = "qualification-secret-value";
  const result = await fakeDriver().run({
    prompt: "secret",
    environment: { FAKE_CLAUDE_MODE: "secret", TEST_SECRET: secret },
    sensitiveValues: [secret]
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(secret), false);
  assert.equal(result.outputText, "value:[REDACTED]");
  assert.equal(result.safeStderr, "debug:[REDACTED]");
});

test("does not expose Claude session identity in the portable result", async () => {
  const result = await fakeDriver().run({ prompt: "hello", environment: { FAKE_CLAUDE_MODE: "success" } });
  assert.equal(JSON.stringify(result).includes("private-session-id"), false);
  assert.equal(Object.hasOwn(result, "sessionId"), false);
});
