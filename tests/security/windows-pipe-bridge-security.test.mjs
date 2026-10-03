// invariant: the Windows named-pipe channel refuses what the Unix socket
// refuses, with the same codes (SSI-76), and only the run's own user can reach
// it (SSI-71). The first cases drive the real controller through the real
// transport over a fake helper on every platform: a refusal by the controller
// ends the helper that holds the pipe, which is how a pipe client learns of it.
// The `win32:` cases run the real PowerShell 7 helper and the real ACL tools
// on the Windows runner; elsewhere each asserts that the transport refuses to
// start, so no case passes without asserting.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  WHOAMI_ARGUMENTS,
  currentUserSid,
  isOwnerOnlyDacl,
  nodeWindowsAclToolRunner,
  ownerOnlyGrantArguments,
  proveOwnerOnlyDirectory,
  readDirectoryDacl,
  windowsAclToolExecutable
} from "../../packages/platform-node/src/windows-acl.ts";
import {
  PIPE_HELPER_SCRIPT,
  WindowsNamedPipeBridgeTransport,
  freshPipeName,
  pipeEndpoint
} from "../../packages/platform-node/src/windows-pipe-transport.ts";
import { cleanupBridges, openController, startRelay } from "../helpers/mcp-bridge-fixture.mjs";
import { WIN32_HOST } from "../helpers/mediation-platform.mjs";
import {
  FakePipeHost,
  cleanupPlainWorktrees,
  frame,
  hello,
  plainWorktree,
  rawChannelClient,
  relayEnvironment
} from "../helpers/pipe-bridge-fixture.mjs";
import { eventually } from "../helpers/process-liveness.mjs";

afterEach(async () => {
  await cleanupBridges();
  await cleanupPlainWorktrees();
});

const FRAME_BOUND = 8 * 1024 * 1024;
const text = (result) => result.content.map((entry) => entry.text).join("");
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function openOverPipe(options = {}) {
  const { worktree, channels } = await plainWorktree();
  const transport = new WindowsNamedPipeBridgeTransport({ root: channels, ...options });
  const opened = await openController(worktree, { transport });
  return { ...opened, channels, token: opened.controller.environment.VERCHESTRA_BRIDGE_TOKEN };
}

// invariant: the fake helper reports a client; the controller then holds the
// connection the transport made of the helper's standard streams.
async function connectedOverFakeHelper() {
  const host = new FakePipeHost();
  const opened = await openOverPipe({ host });
  host.helper.status("verchestra-pipe:connected");
  await settle();
  return { ...opened, host, helper: host.helper };
}

test("an authenticated client of the named-pipe transport is answered and served", async () => {
  const { helper, invoked, token, controller } = await connectedOverFakeHelper();
  helper.stdout.write(hello(token));
  assert.ok(await eventually(() => helper.received.endsWith("\n")));
  helper.stdout.write(
    frame({ type: "call", id: 1, name: "write_file", arguments: { path: "src/a.txt", content: "x" } })
  );
  assert.ok(await eventually(() => helper.received.split("\n").length === 3));
  const [ready, result] = helper.received
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(ready, { type: "ready", protocol: "verchestra-bridge/1" });
  assert.equal(result.content[0].text, "wrote src/a.txt; receipt receipt:1");
  assert.equal(invoked.length, 1);
  assert.equal(controller.statistics().rejectedConnections, 0);
});

for (const [name, offend] of [
  ["a wrong token", (helper) => helper.stdout.write(hello("0".repeat(64)))],
  ["a frame beyond its bound", (helper) => helper.stdout.write(Buffer.alloc(FRAME_BOUND + 1, 0x78))],
  ["a call before authentication", (helper) => helper.stdout.write(frame({ type: "call", id: 1, name: "list_dir" }))]
])
  test(`${name} on the named-pipe transport is refused with the Unix count and ends the helper`, async () => {
    const { helper, host, invoked, controller } = await connectedOverFakeHelper();
    offend(helper);
    assert.ok(await eventually(() => host.terminated.length === 1), "the helper holding the pipe is ended");
    assert.equal(helper.received, "", "the refused client is sent nothing");
    assert.equal(controller.statistics().rejectedConnections, 1);
    assert.equal(invoked.length, 0);
  });

test("a silent client of the named-pipe transport is refused when the authentication timeout ends", async (t) => {
  const host = new FakePipeHost();
  const { controller } = await openOverPipe({ host });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  host.helper.status("verchestra-pipe:connected");
  await settle();
  t.mock.timers.tick(4_999);
  assert.deepEqual(host.terminated, []);
  t.mock.timers.tick(1);
  // why: the mocked clock stops every timer-based wait, so the case yields to
  // the event loop instead.
  for (let turn = 0; turn < 1_000 && host.terminated.length === 0; turn += 1) await settle();
  t.mock.timers.reset();
  assert.deepEqual(host.terminated, [4242]);
  assert.equal(controller.statistics().rejectedConnections, 1);
});

// ---------------------------------------------------------------------------
// The real pipe. Each case below needs Windows, PowerShell 7.4 or later at its
// pinned path, and the System32 ACL tools; a GitHub Windows runner has them.
// ---------------------------------------------------------------------------

async function namedPipeRefusedOffWin32(t) {
  t.diagnostic(`${process.platform}: asserting the named-pipe transport refuses to start instead`);
  const { channels } = await plainWorktree();
  const transport = new WindowsNamedPipeBridgeTransport({ root: channels });
  await assert.rejects(
    transport.listen(() => assert.fail("no connection")),
    { code: "VES_BRIDGE_PLATFORM_UNSUPPORTED" }
  );
  assert.deepEqual(await readdir(channels), [], "nothing was created");
}

// why: a proof a real host refuses names its step and what the host's own
// tools reported, so a runner's ACL format can be read from the log alone.
async function proofDiagnosis(directory, proof) {
  if (proof.proven) return "proven";
  const tool = (name, args) => {
    const result = spawnSync(windowsAclToolExecutable(name), args, { encoding: "utf8", timeout: 10_000 });
    return { status: result.status, stdout: result.stdout?.trim(), stderr: result.stderr?.trim() };
  };
  const whoami = tool("whoami", WHOAMI_ARGUMENTS);
  const sid = currentUserSid(whoami.stdout ?? "");
  return JSON.stringify({
    step: proof.step,
    whoami,
    sid: sid ?? null,
    grant: sid === undefined ? null : tool("icacls", ownerOnlyGrantArguments(directory, sid)),
    listing: tool("icacls", [directory]),
    dacl: (await readDirectoryDacl(directory)) ?? null
  });
}

test("win32: the system tools prove a real per-run directory owner-only", async () => {
  const { channels } = await plainWorktree();
  const directory = await mkdtemp(join(channels, "vpipe-"));
  const proof = await proveOwnerOnlyDirectory(directory);
  if (!WIN32_HOST) {
    assert.deepEqual(proof, { proven: false, step: "identity" }, "without whoami.exe there is no proof");
    return;
  }
  assert.equal(proof.proven, true, await proofDiagnosis(directory, proof));
  assert.equal(proof.sid, currentUserSid(await nodeWindowsAclToolRunner("whoami", WHOAMI_ARGUMENTS)));
  assert.equal(isOwnerOnlyDacl(proof.dacl, proof.sid), true);
  assert.equal(await readDirectoryDacl(directory), proof.dacl, "a second read-back agrees");
});

test("win32: the relay reaches the controller over the named pipe and its writes become executor requests", async (t) => {
  if (!WIN32_HOST) return namedPipeRefusedOffWin32(t);
  const { controller, invoked } = await openOverPipe();
  assert.match(controller.socketPath, /^\\\\\.\\pipe\\verchestra-[0-9a-f]{32}$/u);
  const relay = startRelay(relayEnvironment(controller));
  await relay.initialize();
  const written = await relay.call("write_file", { path: "src/a.txt", content: "over the pipe\n" });
  assert.equal(text(written), "wrote src/a.txt; receipt receipt:1");
  assert.equal(invoked.length, 1);
  assert.equal(await relay.close(), 0);
  assert.equal(controller.statistics().rejectedConnections, 0);
});

test("win32: a relay presenting the wrong token is refused with the Unix code", async (t) => {
  if (!WIN32_HOST) return namedPipeRefusedOffWin32(t);
  const { controller, invoked } = await openOverPipe();
  const relay = startRelay(relayEnvironment(controller, { VERCHESTRA_BRIDGE_TOKEN: "0".repeat(64) }));
  assert.equal(await relay.exited, 1);
  assert.match(relay.stderr(), /VES_BRIDGE_AUTH_REJECTED/u);
  assert.equal(invoked.length, 0);
  assert.equal(controller.statistics().rejectedConnections, 1);
});

test("win32: a pipe client that never authenticates is refused when the authentication timeout ends", async (t) => {
  if (!WIN32_HOST) return namedPipeRefusedOffWin32(t);
  const { controller, invoked } = await openOverPipe();
  const client = rawChannelClient(controller.socketPath);
  await once(client.socket, "connect");
  const connected = Date.now();
  await client.closed;
  assert.ok(Date.now() - connected >= 4_500, "refused by the five-second authentication timeout");
  assert.equal(client.data(), "");
  assert.equal(controller.statistics().rejectedConnections, 1);
  assert.equal(invoked.length, 0);
});

test("win32: a frame beyond its bound on the named pipe is refused", async (t) => {
  if (!WIN32_HOST) return namedPipeRefusedOffWin32(t);
  const { controller, invoked, token } = await openOverPipe();
  const client = rawChannelClient(controller.socketPath);
  await once(client.socket, "connect");
  client.socket.write(hello(token));
  assert.ok(await eventually(() => client.data().endsWith("\n")), "the client authenticates first");
  client.socket.write(Buffer.alloc(FRAME_BOUND + 1, 0x78));
  await client.closed;
  assert.deepEqual(JSON.parse(client.data()), { type: "ready", protocol: "verchestra-bridge/1" });
  assert.equal(controller.statistics().rejectedConnections, 1);
  assert.equal(invoked.length, 0);
});

// why: the pipe has one instance, so the kernel refuses a second client while
// the relay holds it; that client never reaches the controller at all.
test("win32: a second same-user client cannot reach the controller while the relay holds the pipe", async (t) => {
  if (!WIN32_HOST) return namedPipeRefusedOffWin32(t);
  const { controller, invoked, token } = await openOverPipe();
  const relay = startRelay(relayEnvironment(controller));
  await relay.initialize();
  const second = rawChannelClient(controller.socketPath);
  second.socket.write(hello(token));
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  assert.equal(second.connected(), false, "the one pipe instance is taken");
  assert.equal(second.data(), "");
  const written = await relay.call("write_file", { path: "src/a.txt", content: "first client\n" });
  assert.equal(text(written), "wrote src/a.txt; receipt receipt:1");
  assert.equal(invoked.length, 1, "only the relay reached the executor");
  assert.equal(controller.statistics().rejectedConnections, 0, "the second client never reached the controller");
  second.socket.destroy();
  assert.equal(await relay.close(), 0);
});

test("win32: a pipe name that already exists makes the transport refuse", async (t) => {
  if (!WIN32_HOST) return namedPipeRefusedOffWin32(t);
  const name = freshPipeName();
  const squatter = createServer(() => undefined);
  await new Promise((resolve, reject) => {
    squatter.once("error", reject);
    squatter.listen(pipeEndpoint(name), resolve);
  });
  try {
    const { worktree, channels } = await plainWorktree();
    const transport = new WindowsNamedPipeBridgeTransport({ root: channels, pipeName: () => name });
    await assert.rejects(openController(worktree, { transport }), { code: "VES_BRIDGE_CHANNEL_INSECURE" });
    assert.deepEqual(await readdir(channels), [], "the per-run directory is removed");
  } finally {
    await new Promise((resolve) => squatter.close(resolve));
  }
});

test("win32: the per-run directory is owner-only while the channel is open, and the helper and directory are gone at close", async (t) => {
  if (!WIN32_HOST) return namedPipeRefusedOffWin32(t);
  const { controller, channels } = await openOverPipe();
  const [run] = await readdir(channels);
  const directory = join(channels, run);
  assert.match(run, /^vpipe-/u);
  assert.deepEqual(await readdir(directory), ["pipe-helper.ps1"]);
  assert.equal(await readFile(join(directory, "pipe-helper.ps1"), "utf8"), PIPE_HELPER_SCRIPT);
  const sid = currentUserSid(await nodeWindowsAclToolRunner("whoami", WHOAMI_ARGUMENTS));
  assert.equal(isOwnerOnlyDacl(await readDirectoryDacl(directory), sid), true);
  const endpoint = controller.socketPath;
  await controller.close();
  assert.deepEqual(await readdir(channels), [], "the per-run directory is removed");
  const probe = rawChannelClient(endpoint);
  await probe.closed;
  assert.equal(probe.connected(), false, "no helper holds the pipe after close");
});
