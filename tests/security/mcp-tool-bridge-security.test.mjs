import assert from "node:assert/strict";
import { access, lstat } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname } from "node:path";
import { afterEach, test } from "node:test";

import { bridgeWorktree, cleanupBridges, openController, startRelay } from "../helpers/mcp-bridge-fixture.mjs";
import { WIN32_HOST, mediationRefusedOnWin32 } from "../helpers/mediation-platform.mjs";

afterEach(cleanupBridges);

const text = (result) => result.content.map((entry) => entry.text).join("");

function rawClient(socketPath) {
  const socket = createConnection(socketPath);
  let data = "";
  socket.on("data", (chunk) => (data += chunk));
  socket.on("error", () => undefined);
  const closed = new Promise((resolve) => socket.once("close", resolve));
  return { socket, closed, data: () => data };
}

test("the channel lives in a private directory and disappears with the controller", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  const { worktree } = await bridgeWorktree();
  const { controller } = await openController(worktree);
  const directory = dirname(controller.socketPath);
  assert.equal((await lstat(directory)).mode & 0o777, 0o700);
  assert.equal((await lstat(controller.socketPath)).mode & 0o077, 0);
  assert.match(controller.environment.VERCHESTRA_BRIDGE_TOKEN, /^[a-f0-9]{64}$/u);
  await controller.close();
  await assert.rejects(access(directory), { code: "ENOENT" });
});

test("a relay presenting the wrong token is refused and serves no tool", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  const { worktree } = await bridgeWorktree();
  const { controller, invoked } = await openController(worktree);
  const relay = startRelay({ ...controller.environment, VERCHESTRA_BRIDGE_TOKEN: "0".repeat(64) });
  assert.equal(await relay.exited, 1);
  assert.match(relay.stderr(), /VES_BRIDGE_AUTH_REJECTED/u);
  assert.equal(invoked.length, 0);
  assert.equal(controller.statistics().rejectedConnections, 1);
});

test("a relay without a configured channel exits as not configured", async () => {
  const relay = startRelay({});
  assert.equal(await relay.exited, 1);
  assert.match(relay.stderr(), /VES_BRIDGE_NOT_CONFIGURED/u);
});

test("a call before authentication is refused without reaching the executor", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  const { worktree } = await bridgeWorktree();
  const { controller, invoked } = await openController(worktree);
  const client = rawClient(controller.socketPath);
  client.socket.write(
    `${JSON.stringify({ type: "call", id: 1, name: "write_file", arguments: { path: "src/a.txt", content: "x" } })}\n`
  );
  await client.closed;
  assert.equal(client.data(), "");
  assert.equal(invoked.length, 0);
});

test("only one authenticated connection is ever accepted", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  const { worktree } = await bridgeWorktree();
  const { controller } = await openController(worktree);
  const relay = startRelay(controller.environment);
  await relay.initialize();
  const second = rawClient(controller.socketPath);
  second.socket.write(
    `${JSON.stringify({ type: "hello", protocol: "verchestra-bridge/1", token: controller.environment.VERCHESTRA_BRIDGE_TOKEN })}\n`
  );
  await second.closed;
  assert.equal(second.data(), "");
  assert.equal(controller.statistics().rejectedConnections, 1);
  await relay.close();
});

for (const [path, code] of [
  ["../outside/victim.txt", "VES_BRIDGE_PATH_INVALID"],
  [".git/config", "VES_BRIDGE_PATH_PROTECTED"],
  ["docs/secret.txt", "VES_BRIDGE_SCOPE_DENIED"],
  ["src/protected/key.txt", "VES_BRIDGE_SCOPE_DENIED"],
  ["src/linkdir/victim.txt", "VES_BRIDGE_SYMLINK_DENIED"],
  ["src/linkfile.txt", "VES_BRIDGE_SYMLINK_DENIED"]
]) {
  test(`read_file refuses ${path}`, async (t) => {
    if (WIN32_HOST) return mediationRefusedOnWin32(t);
    const { worktree } = await bridgeWorktree();
    const { controller } = await openController(worktree);
    const relay = startRelay(controller.environment);
    await relay.initialize();
    const result = await relay.call("read_file", { path });
    assert.equal(result.isError, true);
    assert.equal(text(result), `denied: ${code}`);
    assert.doesNotMatch(text(result), /needle|\[core\]/u);
    await relay.close();
  });
}

test("listing and search never cross links, protected paths, or the read scope", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  const { worktree } = await bridgeWorktree();
  const { controller } = await openController(worktree);
  const relay = startRelay(controller.environment);
  await relay.initialize();
  assert.equal(text(await relay.call("list_dir", { path: "docs" })), "denied: VES_BRIDGE_SCOPE_DENIED");
  assert.equal(text(await relay.call("list_dir", { path: "src/linkdir" })), "denied: VES_BRIDGE_SYMLINK_DENIED");
  const found = JSON.parse(text(await relay.call("search", { query: "needle", path: "." })));
  assert.deepEqual(
    found.matches.map((match) => match.path),
    ["src/a.txt", "src/nested/b.txt"]
  );
  await relay.close();
});

test("an oversized MCP frame is refused instead of buffered", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  const { worktree } = await bridgeWorktree();
  const { controller, invoked } = await openController(worktree);
  const relay = startRelay(controller.environment);
  await relay.initialize();
  relay.raw("x".repeat(9 * 1024 * 1024));
  assert.equal(await relay.exited, 0);
  assert.equal(relay.unmatched.at(-1).error.code, -32600);
  assert.equal(invoked.length, 0);
});

test("oversized write content is refused before it reaches the payload store", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  const { worktree } = await bridgeWorktree();
  const { controller, invoked } = await openController(worktree);
  const relay = startRelay(controller.environment);
  await relay.initialize();
  const result = await relay.call("write_file", { path: "src/a.txt", content: "x".repeat(1_048_577) });
  assert.equal(text(result), "denied: VES_BRIDGE_PAYLOAD_TOO_LARGE");
  assert.equal(invoked.length, 0);
  await relay.close();
});
