// invariant: the controller takes its channel from a transport (SSI-70), and
// every control it owns (authentication, one connection, the frame bound, the
// authentication timeout) applies to a connection whatever transport delivered
// it. An in-memory transport stands in for the Unix socket and the Windows
// named pipe, so these cases observe the controller alone, on every platform:
// an injected transport opens the bridge on Windows too, while a caller there
// that brings none is refused, since Windows has no Unix socket.
import assert from "node:assert/strict";
import { once } from "node:events";
import { duplexPair } from "node:stream";
import { afterEach, test } from "node:test";

import { DriverExecutionAdapter, InMemoryExecutionPayloadStore } from "../../packages/agent-runtime/src/index.ts";
import { cleanupBridges, openController, relayEntry } from "../helpers/mcp-bridge-fixture.mjs";
import { WIN32_HOST, windowsMediationPath } from "../helpers/mediation-platform.mjs";
import { cleanupPlainWorktrees, frame, hello, plainWorktree } from "../helpers/pipe-bridge-fixture.mjs";
import { executorInput } from "../helpers/task-executor-fixture.mjs";

afterEach(async () => {
  await cleanupBridges();
  await cleanupPlainWorktrees();
});

const ENDPOINT = "memory:bridge-under-test";
const FRAME_BOUND = 8 * 1024 * 1024;

class MemoryTransport {
  closed = 0;
  #accept;

  async listen(accept) {
    this.#accept = accept;
    return {
      endpoint: ENDPOINT,
      close: async () => {
        this.closed += 1;
      }
    };
  }

  connect() {
    const [client, server] = duplexPair();
    let received = "";
    client.on("data", (chunk) => (received += chunk));
    client.on("error", () => undefined);
    this.#accept(server);
    return { client, server, received: () => received };
  }
}

async function frames(connection, count) {
  while (connection.received().split("\n").length - 1 < count) await once(connection.client, "data");
  return connection
    .received()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

async function openOverMemory() {
  const { worktree } = await plainWorktree();
  const transport = new MemoryTransport();
  const opened = await openController(worktree, { transport });
  return { ...opened, transport, token: opened.controller.environment.VERCHESTRA_BRIDGE_TOKEN };
}

async function refused(connection) {
  if (!connection.server.destroyed) await once(connection.server, "close");
  assert.equal(connection.received(), "", "a refused connection receives nothing");
}

test("the controller announces its transport's endpoint and closes that channel once", async () => {
  const { controller, transport } = await openOverMemory();
  assert.equal(controller.socketPath, ENDPOINT);
  assert.equal(controller.environment.VERCHESTRA_BRIDGE_SOCKET, ENDPOINT);
  assert.match(controller.environment.VERCHESTRA_BRIDGE_TOKEN, /^[a-f0-9]{64}$/u);
  const open = transport.connect();
  await controller.close();
  await controller.close();
  assert.equal(transport.closed, 1);
  assert.equal(open.server.destroyed, true, "closing the controller ends every connection it holds");
});

test("a connection from any transport is served only after it authenticates", async () => {
  const { controller, invoked, token, transport } = await openOverMemory();
  const relay = transport.connect();
  relay.client.write(hello(token));
  assert.deepEqual(await frames(relay, 1), [{ type: "ready", protocol: "verchestra-bridge/1" }]);
  relay.client.write(
    frame({ type: "call", id: 1, name: "write_file", arguments: { path: "src/a.txt", content: "x" } })
  );
  const [, result] = await frames(relay, 2);
  assert.deepEqual(result, {
    type: "result",
    id: 1,
    content: [{ type: "text", text: "wrote src/a.txt; receipt receipt:1" }],
    isError: false
  });
  assert.equal(invoked.length, 1);
  assert.equal(controller.statistics().rejectedConnections, 0);
});

for (const [name, offend] of [
  ["a wrong token", (connection) => connection.client.write(hello("0".repeat(64)))],
  ["a frame beyond its bound", (connection) => connection.client.write(Buffer.alloc(FRAME_BOUND + 1, 0x78))],
  [
    "a call before authentication",
    (connection) => connection.client.write(frame({ type: "call", id: 1, name: "delete_file", arguments: {} }))
  ]
])
  test(`${name} is refused on an injected transport and reaches no tool`, async () => {
    const { controller, invoked, transport } = await openOverMemory();
    const connection = transport.connect();
    offend(connection);
    await refused(connection);
    assert.equal(invoked.length, 0);
    assert.equal(controller.statistics().rejectedConnections, 1);
  });

test("a connection that stays silent is refused when the authentication timeout ends", async (t) => {
  const { controller, transport } = await openOverMemory();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const connection = transport.connect();
  t.mock.timers.tick(4_999);
  assert.equal(connection.server.destroyed, false, "the relay has five seconds to authenticate");
  t.mock.timers.tick(1);
  await refused(connection);
  assert.equal(controller.statistics().rejectedConnections, 1);
});

test("a second connection is refused once one has authenticated", async () => {
  const { controller, token, transport } = await openOverMemory();
  const first = transport.connect();
  first.client.write(hello(token));
  await frames(first, 1);
  const second = transport.connect();
  second.client.write(hello(token));
  await refused(second);
  assert.equal(first.server.destroyed, false);
  assert.equal(controller.statistics().rejectedConnections, 1);
});

class SilentDriver {
  closed = 0;

  async start(_request, sink) {
    sink({ type: "session.started", sessionId: "memory-session", sequence: 0 });
    return { sessionId: "memory-session" };
  }

  async cancel() {}

  async close() {
    this.closed += 1;
    return { outcome: "completed" };
  }
}

test("the driver adapter opens its bridge over the transport the composition hands it", async () => {
  const { worktree } = await plainWorktree();
  const transport = new MemoryTransport();
  const sessions = [];
  const driver = new SilentDriver();
  const adapter = new DriverExecutionAdapter({
    resolveWorktree: async () => worktree,
    payloads: new InMemoryExecutionPayloadStore(),
    bridgeCommand: [process.execPath, relayEntry],
    bridgeTransport: transport,
    createSession: async (session) => {
      sessions.push(session);
      return { driver, startRequest: {}, model: "claude-sonnet-5" };
    }
  });
  const input = executorInput();
  const request = {
    workspaceId: input.workspaceId,
    runId: input.runId,
    task: { ...input.task, changeScope: ["src"], protectedPaths: [".git"] },
    worktreeRef: "worktree:memory",
    contextRef: "context:memory",
    checkpoint: undefined,
    capabilityGrantRefs: ["grant:writer:1"]
  };
  const control = {
    checkpoint: async () => "checkpoint:1",
    reportUsage: () => undefined,
    invokeTool: async () => assert.fail("no tool is called")
  };
  assert.deepEqual(await adapter.execute(request, control), { status: "completed", outputRefs: [] });
  assert.equal(sessions[0].bridge.environment.VERCHESTRA_BRIDGE_SOCKET, ENDPOINT);
  assert.equal(transport.closed, 1, "the run's channel is closed when the session ends");
  assert.equal(driver.closed, 1);
});

test("without a transport the controller keeps the Unix socket, and Windows requires one", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const { worktree } = await plainWorktree();
  const { controller } = await openController(worktree);
  assert.match(controller.socketPath, /[\\/]vmcp-[^\\/]+[\\/]bridge\.sock$/u);
});
