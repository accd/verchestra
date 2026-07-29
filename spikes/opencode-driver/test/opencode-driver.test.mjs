import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { OpenCodeDriver } from "../src/opencode-driver.mjs";

function modelCatalog() {
  return { all: [{ id: "company", name: "Company AI", models: { "qwen3-coder-480b": { id: "qwen3-coder-480b" }, "other-coder": { id: "other-coder" } } }], connected: ["company"], default: { company: "qwen3-coder-480b" } };
}

function fakeFactory(mode = "success", calls = [], hooks = {}) {
  return async (options) => {
    calls.push(["server", options]);
    const events = async function* () {
      if (mode === "hang") { await new Promise((resolve) => setTimeout(resolve, 10_000)); return; }
      if (mode === "malformed") { yield { nope: true }; return; }
      if (mode === "permission") yield { type: "permission.asked", properties: { id: "permission-1", sessionID: "private-session", permission: "vestra_write", patterns: ["src/a.ts"], metadata: { input: { path: "src/a.ts" } }, always: [] } };
      if (mode === "secret") yield { type: "message.part.updated", properties: { part: { sessionID: "private-session", type: "text", text: `value:${process.env.TEST_SECRET ?? "qualification-secret-value"}`, time: { end: 1 } } } };
      else if (mode !== "error") yield { type: "message.part.updated", properties: { part: { sessionID: "private-session", type: "text", text: "done", time: { end: 1 } } } };
      if (mode === "error") yield { type: "session.error", properties: { sessionID: "private-session", error: { name: "ProviderError", data: { message: "provider failed" } } } };
      yield {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "private-session",
            type: "step-finish",
            cost: 0.03,
            tokens: { input: 9, output: 5, reasoning: 2, cache: { read: 4, write: 0 } }
          }
        }
      };
      yield { type: "session.status", properties: { sessionID: "private-session", status: { type: "idle" } } };
    };
    return {
      client: {
        provider: { list: async () => ({ data: modelCatalog() }) },
        event: { subscribe: async () => ({ stream: events() }) },
        session: {
          create: async (parameters) => {
            calls.push(["create", parameters]);
            await hooks.afterSessionCreate?.();
            return { data: { id: "private-session" } };
          },
          prompt: async (parameters) => { calls.push(["prompt", parameters]); return mode === "prompt-error" ? { error: { message: "prompt rejected" } } : { data: {} }; },
          abort: async (parameters) => { calls.push(["abort", parameters]); return { data: true }; },
          delete: async (parameters) => { calls.push(["delete", parameters]); return { data: true }; }
        },
        permission: { reply: async (parameters) => { calls.push(["permission", parameters]); return { data: true }; } }
      },
      server: { url: "http://127.0.0.1:43210", close: () => calls.push(["close"]) }
    };
  };
}

function driver(mode = "success", calls = [], options = {}) {
  return new OpenCodeDriver({ command: [process.execPath, fileURLToPath(new URL("./fake-opencode.mjs", import.meta.url))], serverFactory: fakeFactory(mode, calls), minimumVersion: "1.17.18", ...options });
}

test("probes the exact repo-local OpenCode without model inference", async () => {
  const result = await new OpenCodeDriver({ minimumVersion: "1.17.18" }).probe();
  assert.equal(result.available, true);
  assert.equal(result.version, "1.18.9");
  assert.equal(result.capabilities.sdkEvents, true);
});

test("rejects an unsupported OpenCode version", async () => {
  const result = await driver().probe({ environment: { FAKE_OPENCODE_VERSION: "1.16.0" } });
  assert.equal(result.available, false);
  assert.equal(result.error.code, "VES_OPENCODE_VERSION_UNSUPPORTED");
});

test("keeps run-json fallback pure, stdin-driven, and without bypass flags", () => {
  const args = driver().buildFallbackArguments({ model: "company/qwen3-coder-480b" });
  assert.deepEqual(args.slice(-6), ["run", "--format", "json", "--pure", "--model", "company/qwen3-coder-480b"]);
  for (const flag of ["--auto", "--yolo", "--dangerously-skip-permissions", "--continue", "--share"]) assert.equal(args.includes(flag), false);
});

test("discovers Qwen through generic provider/model catalog identity", async () => {
  const result = await driver().discoverModels();
  assert.equal(result.models.some((entry) => entry.id === "company/qwen3-coder-480b"), true);
  assert.equal(result.models.find((entry) => entry.id === "company/qwen3-coder-480b").connected, true);
});

test("applies the same resolver to non-Qwen model families", async () => {
  const result = await driver().discoverModels();
  assert.deepEqual(result.models.map((entry) => entry.id).sort(), ["company/other-coder", "company/qwen3-coder-480b"]);
});

test("fails before prompting when the exact model is absent", async () => {
  const calls = [];
  const result = await driver("success", calls).run({ prompt: "x", model: "company/missing" });
  assert.equal(result.error.code, "VES_OPENCODE_MODEL_UNAVAILABLE");
  assert.equal(calls.some(([name]) => name === "prompt"), false);
});

test("starts an isolated server with ask-all permissions and sharing disabled", async () => {
  const calls = [];
  await driver("success", calls).run({ prompt: "x", model: "company/qwen3-coder-480b" });
  const options = calls.find(([name]) => name === "server")[1];
  assert.equal(options.hostname, "127.0.0.1");
  assert.equal(options.port, 0);
  assert.equal(options.config.share, "disabled");
  assert.equal(options.config.permission["*"], "ask");
});

test("passes only explicit tool availability to the prompt", async () => {
  const calls = [];
  await driver("success", calls).run({ prompt: "x", model: "company/qwen3-coder-480b", tools: ["vestra_read", "vestra_write"] });
  assert.deepEqual(calls.find(([name]) => name === "prompt")[1].tools, { vestra_read: true, vestra_write: true });
});

test("rejects built-in tools that would bypass the Verchestra effect bridge", async () => {
  const calls = [];
  const result = await driver("success", calls).run({ prompt: "x", model: "company/qwen3-coder-480b", tools: ["bash"] });
  assert.equal(result.error.code, "VES_OPENCODE_TOOL_UNMEDIATED");
  assert.equal(calls.some(([name]) => name === "prompt"), false);
});

test("normalizes a permission request and grants it only through controller policy", async () => {
  const calls = [];
  const result = await driver("permission", calls).run({ prompt: "x", model: "company/qwen3-coder-480b", authorizeTool: async (request) => request.name === "vestra_write" });
  assert.equal(result.events.some((event) => event.type === "tool.requested" && event.name === "vestra_write"), true);
  assert.equal(calls.find(([name]) => name === "permission")[1].reply, "once");
});

test("rejects a permission denied by controller policy", async () => {
  const calls = [];
  await driver("permission", calls).run({ prompt: "x", model: "company/qwen3-coder-480b", authorizeTool: async () => false });
  assert.equal(calls.find(([name]) => name === "permission")[1].reply, "reject");
});

test("normalizes model identity, content, usage, cost, and close", async () => {
  const result = await driver().run({ prompt: "x", model: "company/qwen3-coder-480b" });
  assert.deepEqual(result.resolvedModel, { provider: "company", model: "qwen3-coder-480b" });
  assert.equal(result.outputText, "done");
  assert.deepEqual(result.usage, { inputTokens: 9, outputTokens: 5, reasoningTokens: 2, cacheReadTokens: 4, cacheWriteTokens: 0, costUsd: 0.03 });
  assert.equal(result.events.at(-1).type, "session.closed");
});

test("fails closed on an unknown event envelope", async () => {
  const result = await driver("malformed").run({ prompt: "x", model: "company/qwen3-coder-480b" });
  assert.equal(result.error.code, "VES_OPENCODE_STREAM_INVALID");
});

test("normalizes provider failures", async () => {
  const result = await driver("error").run({ prompt: "x", model: "company/qwen3-coder-480b" });
  assert.equal(result.stopReason, "error");
  assert.equal(result.error.message, "provider failed");
});

test("cancels the SDK session before closing the server", async () => {
  const calls = [];
  const controller = new AbortController();
  const sessionCreateStarted = Promise.withResolvers();
  const releaseSessionCreate = Promise.withResolvers();
  const serverFactory = fakeFactory("hang", calls, {
    afterSessionCreate: async () => {
      sessionCreateStarted.resolve();
      await releaseSessionCreate.promise;
    }
  });
  const run = new OpenCodeDriver({
    command: [process.execPath, fileURLToPath(new URL("./fake-opencode.mjs", import.meta.url))],
    serverFactory
  }).run({ prompt: "x", model: "company/qwen3-coder-480b", signal: controller.signal });
  await sessionCreateStarted.promise;
  controller.abort();
  releaseSessionCreate.resolve();
  const result = await run;
  assert.equal(result.stopReason, "aborted");
  assert.equal(calls.findIndex(([name]) => name === "abort") < calls.findIndex(([name]) => name === "close"), true);
  assert.equal(calls.some(([name]) => name === "prompt"), false);
});

test("does not inherit undeclared corporate credentials", () => {
  const previous = process.env.COMPANY_QWEN_API_KEY;
  process.env.COMPANY_QWEN_API_KEY = "ambient";
  const environment = driver().buildEnvironment({ EXPLICIT_QWEN_TOKEN: "bound" });
  if (previous === undefined) delete process.env.COMPANY_QWEN_API_KEY; else process.env.COMPANY_QWEN_API_KEY = previous;
  assert.equal(Object.hasOwn(environment, "COMPANY_QWEN_API_KEY"), false);
  assert.equal(environment.EXPLICIT_QWEN_TOKEN, "bound");
});

test("redacts sensitive values and discards session identity", async () => {
  const secret = "qualification-secret-value";
  const result = await driver("secret").run({ prompt: "x", model: "company/qwen3-coder-480b", sensitiveValues: [secret] });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("private-session"), false);
  assert.equal(result.outputText, "value:[REDACTED]");
});
