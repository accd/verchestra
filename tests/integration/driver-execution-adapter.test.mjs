import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { DriverExecutionAdapter, InMemoryExecutionPayloadStore } from "../../packages/agent-runtime/src/index.ts";
import { executorInput } from "../helpers/task-executor-fixture.mjs";
import { bridgeWorktree, cleanupBridges, relayEntry, startRelay } from "../helpers/mcp-bridge-fixture.mjs";

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
  const adapter = new DriverExecutionAdapter({
    resolveWorktree: async () => worktree,
    payloads: new InMemoryExecutionPayloadStore(),
    bridgeCommand: [process.execPath, relayEntry],
    createSession: async (session) => {
      sessions.push(session);
      return { driver, startRequest: { fake: true }, model: options.model ?? "claude-sonnet-5" };
    }
  });
  return { adapter, calls, control, request, sessions };
}

test("usage is metered against the resolved model and checkpoints carry portable facts only", async () => {
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

test("writes through the bridge reach the executor's invokeTool during the session", async () => {
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

test("a driver error event yields a failed status with its stable code", async () => {
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

test("a tool requested outside the bridge cancels the session and fails closed", async () => {
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

test("the executor's cancel stops the active session and reports it cancelled", async () => {
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

test("an aborted caller signal reaches the driver before it starts work", async () => {
  const controller = new AbortController();
  controller.abort();
  const driver = new ScriptedFakeDriver(async ({ signal }) => assert.equal(signal.aborted, true));
  const { adapter, control, request } = await adapterFixture(driver, { signal: controller.signal });
  assert.equal((await adapter.execute(request, control)).status, "cancelled");
});

test("a fatal executor denial through the bridge ends the run with that denial", async () => {
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

test("usage that cannot be metered stops the run instead of running unmetered", async () => {
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

test("the adapter refuses a relative bridge command and a session without a model", async () => {
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
  const { adapter, control, request } = await adapterFixture(new ScriptedFakeDriver(async () => undefined), {
    model: ""
  });
  await assert.rejects(adapter.execute(request, control), { code: "VES_DRIVER_ADAPTER_INPUT_INVALID" });
});
