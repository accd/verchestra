import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { CodexDriver } from "../src/codex-driver.mjs";

const fixture = fileURLToPath(new URL("./fake-codex-app-server.mjs", import.meta.url));

function fakeDriver(options = {}) {
  return new CodexDriver({ command: [process.execPath, fixture], minimumVersion: "0.115.0", ...options });
}

test("probes installed Codex without invoking a model", async () => {
  const result = await new CodexDriver({ minimumVersion: "0.115.0" }).probe();
  assert.equal(result.available, true);
  assert.equal(result.version, "0.115.0");
  assert.equal(result.capabilities.appServerJsonl, true);
  assert.equal(result.capabilities.ephemeralThreads, true);
  assert.equal(result.capabilities.dynamicToolsExperimental, true);
});

test("rejects an unsupported Codex version", async () => {
  const result = await fakeDriver().probe({ environment: { FAKE_CODEX_VERSION: "0.114.0" } });
  assert.equal(result.available, false);
  assert.equal(result.error.code, "VES_CODEX_VERSION_UNSUPPORTED");
});

test("builds a local stdio app-server invocation without bypass flags", () => {
  const args = fakeDriver().buildArguments();
  assert.deepEqual(args.slice(-3), ["app-server", "--listen", "stdio://"]);
  assert.equal(args.includes("--dangerously-bypass-approvals-and-sandbox"), false);
  assert.equal(args.some((value) => value.startsWith("ws://")), false);
});

test("performs the required handshake and sends prompt only inside JSONL stdin", async () => {
  const sent = [];
  const result = await fakeDriver({ onMessageSent: (message) => sent.push(message) }).run({ prompt: "private prompt", model: "gpt-5.5-codex", environment: { FAKE_CODEX_MODE: "success" } });
  assert.equal(sent[0].method, "initialize");
  assert.equal(sent[0].params.capabilities.experimentalApi, true);
  assert.equal(sent[1].method, "initialized");
  assert.equal(sent.find((message) => message.method === "thread/start").params.ephemeral, true);
  assert.equal(sent.find((message) => message.method === "turn/start").params.input[0].text, "private prompt");
  assert.equal(result.invocation.arguments.includes("private prompt"), false);
});

test("locks the thread to read-only, ephemeral state and explicit dynamic tools", async () => {
  const sent = [];
  await fakeDriver({ onMessageSent: (message) => sent.push(message) }).run({
    prompt: "tool",
    model: "gpt-5.5-codex",
    tools: [{ name: "vestra_echo", description: "Echo input", inputSchema: { type: "object" } }],
    environment: { FAKE_CODEX_MODE: "success" }
  });
  const params = sent.find((message) => message.method === "thread/start").params;
  assert.equal(params.sandbox, "read-only");
  assert.equal(params.approvalPolicy, "untrusted");
  assert.equal(params.ephemeral, true);
  assert.deepEqual(params.dynamicTools, [{ name: "vestra_echo", description: "Echo input", inputSchema: { type: "object" } }]);
});

test("normalizes model identity, streaming text, usage, and lifecycle", async () => {
  const result = await fakeDriver().run({ prompt: "hello", model: "gpt-5.5-codex", environment: { FAKE_CODEX_MODE: "success" } });
  assert.deepEqual(result.resolvedModel, { provider: "openai", model: "gpt-5.5-codex" });
  assert.equal(result.events[0].type, "session.started");
  assert.equal(result.events.some((event) => event.type === "content.delta" && event.text === "echo:hello"), true);
  assert.deepEqual(result.usage, { inputTokens: 7, outputTokens: 4 });
  assert.equal(result.events.at(-1).type, "session.closed");
});

test("normalizes a dynamic tool request and denies execution inside the Driver", async () => {
  const result = await fakeDriver().run({ prompt: "tool", tools: [{ name: "vestra_echo", description: "Echo", inputSchema: {} }], environment: { FAKE_CODEX_MODE: "tool" } });
  assert.deepEqual(result.events.find((event) => event.type === "tool.requested"), { type: "tool.requested", id: "call-1", name: "vestra_echo", input: { value: "x" } });
  assert.equal(result.safeStderr.includes("tool-response-success:false"), true);
});

test("declines Codex command approvals instead of granting a hidden writer", async () => {
  const result = await fakeDriver().run({ prompt: "command", environment: { FAKE_CODEX_MODE: "command-approval" } });
  assert.equal(result.events.some((event) => event.type === "warning" && event.code === "VES_CODEX_BUILTIN_TOOL_DENIED"), true);
  assert.equal(result.safeStderr.includes("approval-decision:decline"), true);
});

test("fails closed on malformed app-server JSONL", async () => {
  const result = await fakeDriver().run({ prompt: "bad", environment: { FAKE_CODEX_MODE: "malformed" } });
  assert.equal(result.stopReason, "error");
  assert.equal(result.error.code, "VES_CODEX_STREAM_INVALID");
});

test("normalizes an app-server turn failure", async () => {
  const result = await fakeDriver().run({ prompt: "bad", environment: { FAKE_CODEX_MODE: "error" } });
  assert.equal(result.stopReason, "error");
  assert.equal(result.error.code, "VES_CODEX_EXECUTION_FAILED");
  assert.equal(result.error.message, "provider failed");
});

test("cancels with turn/interrupt before process-tree termination", async () => {
  let terminatedPid;
  let markSpawned;
  const spawned = new Promise((resolve) => { markSpawned = resolve; });
  const controller = new AbortController();
  const driver = fakeDriver({
    onSpawn: markSpawned,
    onMessageSent: (message) => { if (message.method === "turn/start") setTimeout(() => controller.abort(), 30); },
    terminateTree: async (pid) => { terminatedPid = pid; process.kill(pid); }
  });
  const run = driver.run({ prompt: "wait", environment: { FAKE_CODEX_MODE: "hang" }, signal: controller.signal, cancelGraceMs: 100 });
  await spawned;
  const result = await run;
  assert.equal(Number.isInteger(terminatedPid), true);
  assert.equal(result.stopReason, "aborted");
  assert.equal(result.error.code, "VES_CODEX_ABORTED");
  assert.equal(result.safeStderr.includes("interrupt-received"), true);
});

test("enforces a bounded output limit", async () => {
  const result = await fakeDriver().run({ prompt: "large", environment: { FAKE_CODEX_MODE: "large" }, maxOutputBytes: 300 });
  assert.equal(result.stopReason, "error");
  assert.equal(result.error.code, "VES_CODEX_OUTPUT_LIMIT");
});

test("does not inherit ambient OpenAI credentials", () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "ambient-secret";
  const environment = fakeDriver().buildEnvironment({ FAKE_CODEX_MODE: "success" });
  if (previous === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previous;
  assert.equal(Object.hasOwn(environment, "OPENAI_API_KEY"), false);
  assert.equal(environment.FAKE_CODEX_MODE, "success");
});

test("redacts sensitive values from content, errors, and stderr", async () => {
  const secret = "qualification-secret-value";
  const result = await fakeDriver().run({ prompt: "secret", environment: { FAKE_CODEX_MODE: "secret", TEST_SECRET: secret }, sensitiveValues: [secret] });
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(result.outputText, "value:[REDACTED]");
  assert.equal(result.safeStderr, "debug:[REDACTED]");
});

test("keeps Codex thread and turn identities out of portable results", async () => {
  const result = await fakeDriver().run({ prompt: "hello", environment: { FAKE_CODEX_MODE: "success" } });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("private-thread-id"), false);
  assert.equal(serialized.includes("private-turn-id"), false);
  assert.equal(Object.hasOwn(result, "threadId"), false);
});

// Same npm cmd-shim rule as the Claude spike: on Windows the shim cannot be
// spawned without a shell, so the driver resolves the package entry beside it
// and runs it with this Node executable. Synthetic npm-global layout keeps the
// assertion provider-free and cross-platform.
test("resolves the Windows npm cmd-shim to the package entry beside it", async (t) => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { resolveCodexCommand } = await import("../src/codex-driver.mjs");
  const bin = await mkdtemp(path.join(tmpdir(), "verchestra-codex-npm-"));
  t.after(() => rm(bin, { recursive: true, force: true }));
  await writeFile(path.join(bin, "codex.cmd"), "@ECHO off\r\n");
  const entry = path.join(bin, "node_modules", "@openai", "codex", "bin", "codex.js");
  await mkdir(path.dirname(entry), { recursive: true });
  await writeFile(entry, 'console.log("codex-cli 0.115.0 (fixture)");\n');

  const resolved = resolveCodexCommand({ platform: "win32", env: { PATH: bin }, execPath: process.execPath });
  assert.deepEqual(resolved, [process.execPath, entry]);
  const probe = await new CodexDriver({ command: resolved, minimumVersion: "0.115.0" }).probe();
  assert.equal(probe.available, true);
  assert.equal(probe.version, "0.115.0");

  await rm(entry);
  assert.deepEqual(resolveCodexCommand({ platform: "win32", env: { PATH: bin } }), ["codex"]);
  assert.deepEqual(resolveCodexCommand({ platform: "linux", env: { PATH: bin } }), ["codex"]);
});
