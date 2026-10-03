import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test } from "node:test";

import { DriverExecutionAdapter, InMemoryExecutionPayloadStore } from "../../packages/agent-runtime/src/index.ts";
import { executorInput } from "../helpers/task-executor-fixture.mjs";
import { bridgeWorktree, cleanupBridges, relayEntry, startRelay } from "../helpers/mcp-bridge-fixture.mjs";
import { WIN32_HOST } from "../helpers/mediation-platform.mjs";

afterEach(cleanupBridges);

// DETERMINISTIC FAKE driver: emits a scripted event sequence through the Driver
// protocol shape. It stands in for ClaudeCodeDriver so the adapter's event
// mapping is observed without a provider or a Claude process.
class ScriptedFakeDriver {
  constructor(script, outcome = "completed") {
    this.script = script;
    this.outcome = outcome;
    this.cancelled = [];
    this.closed = 0;
  }

  async start(_request, sink, signal) {
    let sequence = 0;
    const emit = (event) => sink({ ...event, sequence: sequence++ });
    emit({ type: "session.started", sessionId: "fake-session:private" });
    await this.script({ emit, signal });
    return { sessionId: "fake-session:private" };
  }

  async cancel(session, reason) {
    this.cancelled.push({ session, reason });
  }

  async close() {
    this.closed += 1;
    return { outcome: this.outcome };
  }
}

async function adapterFixture(driver, options = {}) {
  const { worktree } = await bridgeWorktree();
  const input = executorInput();
  const request = {
    workspaceId: input.workspaceId,
    runId: input.runId,
    task: { ...input.task, changeScope: ["src"], protectedPaths: [".git"] },
    worktreeRef: "worktree:fake",
    contextRef: "context:fake",
    checkpoint: undefined,
    capabilityGrantRefs: ["grant:writer:1"]
  };
  const calls = { checkpoints: [], usage: [], tools: [] };
  const control = {
    signal: options.signal,
    checkpoint: async (stage, data) => {
      calls.checkpoints.push({ stage, data });
      return `checkpoint:${calls.checkpoints.length}`;
    },
    reportUsage:
      options.reportUsage ??
      ((event) => {
        calls.usage.push(event);
      }),
    invokeTool:
      options.invokeTool ??
      (async (toolRequest) => {
        calls.tools.push(toolRequest);
        return { receiptRef: "receipt:1" };
      })
  };
  const sessions = [];
  const payloads = options.payloads ?? new InMemoryExecutionPayloadStore();
  const adapter = new DriverExecutionAdapter({
    resolveWorktree: async () => worktree,
    payloads,
    bridgeCommand: [process.execPath, relayEntry],
    createSession: async (session) => {
      sessions.push(session);
      return { driver, startRequest: { fake: true }, model: options.model ?? "claude-sonnet-5" };
    }
  });
  return { adapter, calls, control, request, sessions, payloads };
}

// invariant: on win32 the adapter refuses the mediated path when it opens the
// bridge, before any session exists, any driver starts, or any checkpoint,
// usage, or tool call is recorded.
async function adapterRefusedOnWin32(t) {
  t.diagnostic("win32: asserting the adapter refuses the mediated bridge instead");
  const driver = new ScriptedFakeDriver(async () => assert.fail("the driver never starts"));
  const { adapter, calls, control, request, sessions } = await adapterFixture(driver);
  await assert.rejects(adapter.execute(request, control), { code: "VES_BRIDGE_PLATFORM_UNSUPPORTED" });
  assert.deepEqual(sessions, []);
  assert.deepEqual(calls, { checkpoints: [], usage: [], tools: [] });
  assert.equal(driver.closed, 0);
}

test("usage is metered against the resolved model and checkpoints carry portable facts only", async (t) => {
  if (WIN32_HOST) return adapterRefusedOnWin32(t);
  const driver = new ScriptedFakeDriver(async ({ emit }) => {
    emit({ type: "model.resolved", resolvedModel: "claude-opus-5" });
    emit({ type: "tool.requested", toolCallId: "t1", name: "mcp__verchestra__read_file", input: {} });
    emit({ type: "usage.updated", inputTokens: 40, outputTokens: 2 });
  });
  const { adapter, calls, control, request, sessions } = await adapterFixture(driver);
  const result = await adapter.execute(request, control);
  assert.deepEqual(result, { status: "completed", outputRefs: [] });
  assert.deepEqual(calls.usage, [{ model: "claude-opus-5", inputTokens: 40, outputTokens: 2 }]);
  assert.deepEqual(calls.checkpoints, [
    { stage: "driver-started", data: { model: "claude-sonnet-5" } },
    {
      stage: "driver-finished",
      data: { outcome: "completed", toolRequests: 1, writes: 0, deletes: 0, denied: 0, errorCodes: [] }
    }
  ]);
  assert.equal(JSON.stringify(calls.checkpoints).includes("fake-session"), false);
  assert.deepEqual(Object.keys(sessions[0].bridge.environment).sort(), [
    "VERCHESTRA_BRIDGE_SOCKET",
    "VERCHESTRA_BRIDGE_TOKEN"
  ]);
  assert.equal(driver.closed, 1);
});

// The scripted driver plays Claude Code's part: it launches the real relay with
// the environment the adapter handed to createSession.
function bridgeScript(fixture, calls) {
  return async () => {
    const relay = startRelay(fixture.current.sessions[0].bridge.environment);
    await relay.initialize();
    for (const [name, args] of calls) await relay.call(name, args);
    await relay.close();
  };
}

test("writes through the bridge reach the executor's invokeTool during the session", async (t) => {
  if (WIN32_HOST) return adapterRefusedOnWin32(t);
  const holder = {};
  const driver = new ScriptedFakeDriver(
    bridgeScript(holder, [["write_file", { path: "src/a.txt", content: "via bridge\n" }]])
  );
  holder.current = await adapterFixture(driver);
  const { adapter, calls, control, request } = holder.current;
  await adapter.execute(request, control);
  assert.equal(calls.tools.length, 1);
  assert.equal(calls.tools[0].taskId, request.task.taskId);
  assert.equal(calls.tools[0].capabilityGrantRef, "grant:writer:1");
  assert.equal(calls.checkpoints.at(-1).data.writes, 1);
});

test("a driver error event yields a failed status with its stable code", async (t) => {
  if (WIN32_HOST) return adapterRefusedOnWin32(t);
  const driver = new ScriptedFakeDriver(async ({ emit }) => {
    emit({
      type: "error",
      code: "VES_CLAUDE_EXECUTION_FAILED",
      message: "provider /private/path failed",
      retryable: true
    });
  }, "failed");
  const { adapter, calls, control, request } = await adapterFixture(driver);
  assert.equal((await adapter.execute(request, control)).status, "failed");
  assert.deepEqual(calls.checkpoints.at(-1).data.errorCodes, ["VES_CLAUDE_EXECUTION_FAILED"]);
  assert.equal(JSON.stringify(calls.checkpoints).includes("/private/path"), false);
});

test("a tool requested outside the bridge cancels the session and fails closed", async (t) => {
  if (WIN32_HOST) return adapterRefusedOnWin32(t);
  const driver = new ScriptedFakeDriver(async ({ emit }) => {
    emit({ type: "tool.requested", toolCallId: "t1", name: "Edit", input: { file_path: "/etc/hosts" } });
  });
  const { adapter, calls, control, request } = await adapterFixture(driver);
  await assert.rejects(adapter.execute(request, control), { code: "VES_DRIVER_TOOL_OUTSIDE_BRIDGE" });
  assert.equal(driver.cancelled.length, 1);
  assert.equal(
    calls.checkpoints.some((entry) => entry.stage === "driver-finished"),
    false
  );
});

test("the executor's cancel stops the active session and reports it cancelled", async (t) => {
  if (WIN32_HOST) return adapterRefusedOnWin32(t);
  let adapterRef;
  const driver = new ScriptedFakeDriver(async ({ signal }) => {
    await adapterRef.cancel("worktree:fake");
    assert.equal(signal.aborted, true);
  }, "cancelled");
  const fixture = await adapterFixture(driver);
  adapterRef = fixture.adapter;
  assert.equal((await fixture.adapter.execute(fixture.request, fixture.control)).status, "cancelled");
  assert.deepEqual(
    driver.cancelled.map((entry) => entry.session.sessionId),
    ["fake-session:private"]
  );
});

// invariant: the session runner makes the already-aborted check, so a caller
// that was cancelled before the session began never reaches the driver at all.
test("an already aborted caller is reported cancelled and its driver is never started", async (t) => {
  if (WIN32_HOST) return adapterRefusedOnWin32(t);
  const controller = new AbortController();
  controller.abort();
  const driver = new ScriptedFakeDriver(async () => assert.fail("the driver never starts"));
  const { adapter, calls, control, request } = await adapterFixture(driver, { signal: controller.signal });
  assert.equal((await adapter.execute(request, control)).status, "cancelled");
  assert.equal(driver.closed, 0);
  assert.deepEqual(driver.cancelled, []);
  assert.deepEqual(calls.checkpoints, [
    {
      stage: "driver-finished",
      data: { outcome: "cancelled", toolRequests: 0, writes: 0, deletes: 0, denied: 0, errorCodes: [] }
    }
  ]);
});

// invariant: the adapter reports the session runner's outcome. A stopped
// session stays cancelled when the driver then reports how its process ended
// and answers `failed` on close, and the late code is still recorded.
test("a session the executor cancelled stays cancelled when its driver then reports a failure", async (t) => {
  if (WIN32_HOST) return adapterRefusedOnWin32(t);
  let adapterRef;
  const driver = new ScriptedFakeDriver(async ({ emit }) => {
    await adapterRef.cancel("worktree:fake");
    emit({ type: "session.closed", outcome: "cancelled", reason: "stopped by Verchestra" });
    emit({ type: "error", code: "VES_CLAUDE_STREAM_INCOMPLETE", message: "process failed", retryable: false });
  }, "failed");
  const fixture = await adapterFixture(driver);
  adapterRef = fixture.adapter;
  assert.equal((await fixture.adapter.execute(fixture.request, fixture.control)).status, "cancelled");
  assert.deepEqual(fixture.calls.checkpoints.at(-1), {
    stage: "driver-finished",
    data: {
      outcome: "cancelled",
      toolRequests: 0,
      writes: 0,
      deletes: 0,
      denied: 0,
      errorCodes: ["VES_CLAUDE_STREAM_INCOMPLETE"]
    }
  });
});

test("a session whose close does not report completed is failed, never completed", async (t) => {
  if (WIN32_HOST) return adapterRefusedOnWin32(t);
  const driver = new ScriptedFakeDriver(async () => undefined, null);
  const { adapter, control, request } = await adapterFixture(driver);
  assert.equal((await adapter.execute(request, control)).status, "failed");
});

test("a fatal executor denial through the bridge ends the run with that denial", async (t) => {
  if (WIN32_HOST) return adapterRefusedOnWin32(t);
  const holder = {};
  const denial = Object.assign(new Error("stale approval"), { code: "VES_EXECUTOR_APPROVAL_INVALID" });
  const driver = new ScriptedFakeDriver(bridgeScript(holder, [["write_file", { path: "src/a.txt", content: "x" }]]));
  holder.current = await adapterFixture(driver, {
    invokeTool: async () => {
      throw denial;
    }
  });
  const { adapter, control, request } = holder.current;
  await assert.rejects(adapter.execute(request, control), (error) => error === denial);
  assert.equal(driver.cancelled.length, 1);
});

test("usage that cannot be metered stops the run instead of running unmetered", async (t) => {
  if (WIN32_HOST) return adapterRefusedOnWin32(t);
  const failure = Object.assign(new Error("unpriced"), { code: "VES_BUDGET_MODEL_UNKNOWN" });
  const driver = new ScriptedFakeDriver(async ({ emit }) =>
    emit({ type: "usage.updated", inputTokens: 1, outputTokens: 1 })
  );
  const { adapter, control, request } = await adapterFixture(driver, {
    reportUsage: () => {
      throw failure;
    }
  });
  await assert.rejects(adapter.execute(request, control), (error) => error === failure);
});

test("the adapter refuses a relative bridge command and a session without a model", async (t) => {
  assert.throws(
    () =>
      new DriverExecutionAdapter({
        resolveWorktree: async () => "/",
        payloads: new InMemoryExecutionPayloadStore(),
        bridgeCommand: ["node", "bridge.mjs"],
        createSession: async () => assert.fail("not reached")
      }),
    { code: "VES_DRIVER_ADAPTER_INPUT_INVALID" }
  );
  if (WIN32_HOST) return adapterRefusedOnWin32(t);
  const { adapter, control, request } = await adapterFixture(new ScriptedFakeDriver(async () => undefined), {
    model: ""
  });
  await assert.rejects(adapter.execute(request, control), { code: "VES_DRIVER_ADAPTER_INPUT_INVALID" });
});

// invariant: a node's structured result travels only as a payload reference to
// bytes the controller bounded and digested (SSI-48, AD-073): the canonical
// JSON of the driver's result, put in the run's payload store, named by its
// SHA-256, and absent from every checkpoint.
const ANSWER = { summary: "s", outcome: "done" };
// {"outcome":"done","summary":"s"} is 32 bytes, members in canonical order.
const CANONICAL_ANSWER = '{"outcome":"done","summary":"s"}';

test("a completed session's structured result becomes one payload reference to its canonical bytes", async (t) => {
  if (WIN32_HOST) return adapterRefusedOnWin32(t);
  const driver = new ScriptedFakeDriver(async ({ emit }) => {
    emit({ type: "usage.updated", inputTokens: 3, outputTokens: 2 });
    emit({ type: "result.structured", value: ANSWER, bytes: 32 });
  });
  const { adapter, calls, control, request, payloads } = await adapterFixture(driver);
  const result = await adapter.execute(request, control);
  const digest = createHash("sha256").update(CANONICAL_ANSWER).digest("hex");
  assert.deepEqual(result, { status: "completed", outputRefs: [`payload:sha256:${digest}`] });
  assert.equal(Buffer.from(await payloads.get(result.outputRefs[0])).toString("utf8"), CANONICAL_ANSWER);
  assert.deepEqual(calls.checkpoints.at(-1), {
    stage: "driver-finished",
    data: { outcome: "completed", toolRequests: 0, writes: 0, deletes: 0, denied: 0, errorCodes: [] }
  });
  assert.equal(JSON.stringify(calls.checkpoints).includes("summary"), false);
});

test("a structured result of a session that did not complete is not handed on", async (t) => {
  if (WIN32_HOST) return adapterRefusedOnWin32(t);
  const driver = new ScriptedFakeDriver(async ({ emit }) => {
    emit({ type: "result.structured", value: ANSWER, bytes: 32 });
    emit({ type: "error", code: "VES_CLAUDE_EXECUTION_FAILED", message: "failed", retryable: true });
  }, "failed");
  const { adapter, control, request } = await adapterFixture(driver);
  assert.deepEqual(await adapter.execute(request, control), { status: "failed", outputRefs: [] });
});

test("a second structured result, or one whose size is not its canonical size, stops the session as invalid input", async (t) => {
  if (WIN32_HOST) return adapterRefusedOnWin32(t);
  for (const script of [
    ({ emit }) => {
      emit({ type: "result.structured", value: ANSWER, bytes: 32 });
      emit({ type: "result.structured", value: { outcome: "blocked", summary: "s" }, bytes: 35 });
    },
    ({ emit }) => emit({ type: "result.structured", value: ANSWER, bytes: 31 })
  ]) {
    const driver = new ScriptedFakeDriver(async (session) => script(session));
    const { adapter, calls, control, request } = await adapterFixture(driver);
    await assert.rejects(adapter.execute(request, control), { code: "VES_DRIVER_ADAPTER_INPUT_INVALID" });
    assert.equal(driver.cancelled.length, 1);
    assert.equal(
      calls.checkpoints.some((entry) => entry.stage === "driver-finished"),
      false
    );
  }
});

// invariant: a quota signal stops the session and surfaces as a typed refusal
// carrying only its scope and reset, so a caller can suspend instead of fail
// (SSI-58, SSI-59); nothing the session reported after it is handed on.
test("a quota signal stops the session and surfaces with its scope and reset only", async (t) => {
  if (WIN32_HOST) return adapterRefusedOnWin32(t);
  const driver = new ScriptedFakeDriver(async ({ emit }) => {
    emit({ type: "quota.exhausted", scope: "five_hour", resetsAt: "2026-09-21T14:13:20.000Z" });
    emit({ type: "quota.exhausted", scope: "seven_day" });
    emit({ type: "result.structured", value: ANSWER, bytes: 32 });
  });
  const { adapter, calls, control, request } = await adapterFixture(driver);
  const refusal = await adapter.execute(request, control).then(
    () => assert.fail("a quota signal is never a completed run"),
    (error) => error
  );
  assert.equal(refusal.code, "VES_DRIVER_QUOTA_EXHAUSTED");
  assert.deepEqual(refusal.quota, { scope: "five_hour", resetsAt: "2026-09-21T14:13:20.000Z" });
  assert.equal(Object.isFrozen(refusal.quota), true);
  assert.equal(driver.cancelled.length, 1);
  assert.equal(
    calls.checkpoints.some((entry) => entry.stage === "driver-finished"),
    false
  );
  const unreset = new ScriptedFakeDriver(async ({ emit }) =>
    emit({ type: "quota.exhausted", scope: "usage_limit_exceeded" })
  );
  const second = await adapterFixture(unreset);
  await assert.rejects(second.adapter.execute(second.request, second.control), (error) => {
    assert.deepEqual(error.quota, { scope: "usage_limit_exceeded" });
    return error.code === "VES_DRIVER_QUOTA_EXHAUSTED";
  });
});
