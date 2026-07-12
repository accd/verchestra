import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  AssistantMessageEventStream,
  Type,
  createFauxCore,
  fauxAssistantMessage,
  fauxToolCall
} from "@earendil-works/pi-ai";
import { PiRuntimeBoundary } from "../src/pi-boundary.mjs";

function fauxWith(responses, options = {}) {
  const faux = createFauxCore({ provider: "verchestra-pi-qualification", ...options });
  faux.setResponses(responses);
  return faux;
}

function textTool(execute) {
  return {
    name: "echo",
    label: "Echo",
    description: "Echo a value",
    parameters: Type.Object({ value: Type.String() }),
    execute
  };
}

test("pins the current Earendil Pi packages", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.devDependencies["@earendil-works/pi-agent-core"], "0.80.6");
  assert.equal(pkg.devDependencies["@earendil-works/pi-ai"], "0.80.6");
});

test("does not retain deprecated Mario Zechner package names", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
  assert.equal(Object.keys(pkg.devDependencies).some((name) => name.startsWith("@mariozechner/pi-")), false);
});

test("returns resolved model identity and provider usage", async () => {
  const faux = fauxWith([fauxAssistantMessage("hello")]);
  const result = await new PiRuntimeBoundary().run({ prompt: "hi", model: faux.getModel(), streamFn: faux.streamSimple });
  assert.deepEqual(result.resolvedModel, {
    api: faux.getModel().api,
    provider: faux.getModel().provider,
    model: faux.getModel().id
  });
  assert.equal(result.usage.totalTokens > 0, true);
  assert.equal(result.stopReason, "stop");
  assert.equal(result.outputText, "hello");
});

test("normalizes lifecycle and streamed text events", async () => {
  const faux = fauxWith([fauxAssistantMessage("streamed output")], { tokensPerSecond: 1_000 });
  const result = await new PiRuntimeBoundary().run({ prompt: "hi", model: faux.getModel(), streamFn: faux.streamSimple });
  assert.equal(result.events[0].type, "session.started");
  assert.equal(result.events.some((event) => event.type === "content.delta" && event.text.length > 0), true);
  assert.equal(result.events.at(-1).type, "session.closed");
});

test("executes an allowed tool only through the mediation callback", async () => {
  let executions = 0;
  const faux = fauxWith([
    fauxAssistantMessage(fauxToolCall("echo", { value: "approved" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done")
  ]);
  const tool = textTool(async (_id, params) => {
    executions += 1;
    return { content: [{ type: "text", text: params.value }], details: { mediated: true } };
  });
  const result = await new PiRuntimeBoundary().run({
    prompt: "use tool",
    model: faux.getModel(),
    streamFn: faux.streamSimple,
    tools: [tool],
    authorizeTool: async () => ({ allowed: true })
  });
  assert.equal(executions, 1);
  assert.equal(result.events.some((event) => event.type === "tool.requested" && event.name === "echo"), true);
  assert.equal(result.events.some((event) => event.type === "tool.completed" && event.isError === false), true);
});

test("blocks a denied tool before its implementation executes", async () => {
  let executions = 0;
  const faux = fauxWith([
    fauxAssistantMessage(fauxToolCall("echo", { value: "denied" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("denial observed")
  ]);
  const tool = textTool(async () => {
    executions += 1;
    return { content: [{ type: "text", text: "unexpected" }], details: {} };
  });
  const result = await new PiRuntimeBoundary().run({
    prompt: "use tool",
    model: faux.getModel(),
    streamFn: faux.streamSimple,
    tools: [tool],
    authorizeTool: async () => ({ allowed: false, reason: "controller denied" })
  });
  assert.equal(executions, 0);
  assert.equal(result.events.some((event) => event.type === "tool.completed" && event.isError === true), true);
});

test("returns a stable aborted result when the controller signal aborts", async () => {
  const model = createFauxCore({ provider: "abort-test" }).getModel();
  let streamReady;
  const ready = new Promise((resolve) => {
    streamReady = resolve;
  });
  const streamFn = (_model, _context, options) => {
    const stream = new AssistantMessageEventStream();
    const abort = () => {
      const error = fauxAssistantMessage("", { stopReason: "aborted", errorMessage: "aborted by controller" });
      stream.push({ type: "error", reason: "aborted", error });
    };
    options.signal.addEventListener("abort", abort, { once: true });
    streamReady();
    return stream;
  };
  const controller = new AbortController();
  const run = new PiRuntimeBoundary().run({ prompt: "wait", model, streamFn, signal: controller.signal });
  await ready;
  controller.abort();
  const result = await run;
  assert.equal(result.stopReason, "aborted");
  assert.equal(result.error.code, "VES_PI_ABORTED");
});

test("rejects context that cannot fit before calling Pi", async () => {
  const faux = fauxWith([fauxAssistantMessage("must not run")], { models: [{ id: "tiny", contextWindow: 8, maxTokens: 4 }] });
  const result = await new PiRuntimeBoundary().run({ prompt: "x".repeat(80), model: faux.getModel(), streamFn: faux.streamSimple });
  assert.equal(result.error.code, "VES_PI_CONTEXT_CAPACITY_EXCEEDED");
  assert.equal(faux.state.callCount, 0);
});

test("normalizes provider failures without throwing", async () => {
  const faux = fauxWith([fauxAssistantMessage("", { stopReason: "error", errorMessage: "provider failed" })]);
  const result = await new PiRuntimeBoundary().run({ prompt: "hi", model: faux.getModel(), streamFn: faux.streamSimple });
  assert.equal(result.stopReason, "error");
  assert.equal(result.error.code, "VES_PI_PROVIDER_ERROR");
  assert.equal(result.error.message, "provider failed");
});

test("normalizes a stream contract rejection", async () => {
  const model = createFauxCore({ provider: "throw-test" }).getModel();
  const result = await new PiRuntimeBoundary().run({
    prompt: "hi",
    model,
    streamFn: async () => {
      throw new Error("runtime rejected");
    }
  });
  assert.equal(result.stopReason, "error");
  assert.equal(result.error.code, "VES_PI_RUNTIME_FAILED");
  assert.equal(result.error.message, "runtime rejected");
});

test("returns no transcript, system prompt, or provider session state", async () => {
  const faux = fauxWith([fauxAssistantMessage("safe")]);
  const result = await new PiRuntimeBoundary().run({ prompt: "private prompt", systemPrompt: "private system", model: faux.getModel(), streamFn: faux.streamSimple });
  const serialized = JSON.stringify(result);
  assert.equal(Object.hasOwn(result, "messages"), false);
  assert.equal(serialized.includes("private prompt"), false);
  assert.equal(serialized.includes("private system"), false);
  assert.equal(serialized.includes("sessionId"), false);
});

test("creates a fresh Pi agent state for every run", async () => {
  const faux = fauxWith([
    (context) => fauxAssistantMessage(`visible:${context.messages.length}`),
    (context) => fauxAssistantMessage(`visible:${context.messages.length}`)
  ]);
  const boundary = new PiRuntimeBoundary();
  const first = await boundary.run({ prompt: "one", model: faux.getModel(), streamFn: faux.streamSimple });
  const second = await boundary.run({ prompt: "two", model: faux.getModel(), streamFn: faux.streamSimple });
  assert.equal(first.outputText, "visible:1");
  assert.equal(second.outputText, "visible:1");
});
