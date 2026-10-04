// invariant: SSI-75 and SSI-76 over a real helper process on every platform.
// The named-pipe transport drives the DETERMINISTIC FAKE stand-in
// (tests/helpers/pipe-relay-stand-in.mjs), a real process that relays a local
// endpoint over its standard streams as the PowerShell helper relays the
// pipe, ended through the real tree terminator. It reproduces the ways a
// refused channel could fail to end and shows that it ends, and that the
// channel's trace tells them apart: a frame refused on a faithful relay, a
// helper that stops taking the client's bytes while its client's write is
// still pending, and a helper whose child process keeps the connection.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { WindowsNamedPipeBridgeTransport } from "../../packages/platform-node/src/windows-pipe-transport.ts";
import { cleanupBridges, openController } from "../helpers/mcp-bridge-fixture.mjs";
import {
  PIPE_CASE,
  assertRefusalEnds,
  cleanupPlainWorktrees,
  hello,
  pipeTrace,
  plainWorktree,
  rawChannelClient,
  reaches,
  settlesWithin,
  standInHost
} from "../helpers/pipe-bridge-fixture.mjs";
import { eventually } from "../helpers/process-liveness.mjs";

afterEach(
  async () => {
    try {
      await settlesWithin(cleanupBridges(), "the bridges' cleanup");
    } finally {
      await cleanupPlainWorktrees();
    }
  },
  { timeout: PIPE_CASE.timeout }
);

const FRAME_BOUND = 8 * 1024 * 1024;

// why: a channel over the stand-in in `mode`, authenticated by its client,
// which then writes a frame beyond its bound.
async function oversizedFrame(mode, controllerOptions = {}) {
  const trace = pipeTrace();
  const { root, worktree, channels } = await plainWorktree();
  const host = standInHost(mode, root);
  const transport = trace.counting(
    new WindowsNamedPipeBridgeTransport({ root: channels, host, observe: trace.observe, exitWaitMs: 2_000 })
  );
  const { controller, invoked } = await settlesWithin(
    openController(worktree, { transport, ...controllerOptions }),
    "the controller's open over the stand-in"
  );
  const client = rawChannelClient(host.endpoint);
  await client.connectedWithin();
  client.socket.write(hello(controller.environment.VERCHESTRA_BRIDGE_TOKEN));
  assert.ok(await eventually(() => client.data().endsWith("\n")), "the client authenticates first");
  client.socket.write(Buffer.alloc(FRAME_BOUND + 1, 0x78));
  return { trace, controller, invoked, client, endpoint: host.endpoint };
}

test("a frame refused on a faithful relay ends the helper, its endpoint, and the client", PIPE_CASE, async () => {
  for (let round = 1; round <= 3; round += 1) {
    const channel = await oversizedFrame("relay");
    await assertRefusalEnds(channel);
    assert.equal(channel.invoked.length, 0, `round ${round}`);
    const steps = channel.trace.events().map((event) => event.step);
    assert.deepEqual(
      steps.slice(0, 5),
      ["helper-started", "listening", "connected", "connection-closed", "end"],
      `round ${round}`
    );
    assert.equal(channel.trace.events()[4].trigger, "connection-closed", `round ${round}`);
    await cleanupBridges();
  }
});

// why: the stall seen on the Windows runner, reproduced: the helper stops
// taking the client's bytes, so the frame never reaches the controller and
// the client's write stays pending. The trace says so (no refusal, part of
// the frame reached, the write waiting), and when the channel closes the
// helper ends and the client is disconnected with its write still pending.
test(
  "a helper that stops taking a pending frame is told apart, and the channel's close still ends it",
  PIPE_CASE,
  async () => {
    const { trace, controller, client, endpoint } = await oversizedFrame("stalls");
    const diagnosis = () => trace.describe({ client: client.state() });
    await reaches(() => trace.reached() >= 64 * 1024, "part of the frame reaching the controller", diagnosis);
    await reaches(() => client.state().writeQueueSize > 0, "the client's write waiting", diagnosis);
    assert.equal(controller.statistics().rejectedConnections, 0, "nothing was refused");
    assert.ok(trace.reached() < FRAME_BOUND, diagnosis());
    assert.equal(trace.saw("end"), false, "the helper's end has not begun");
    await settlesWithin(controller.close(), "the channel's close");
    const end = trace.events().find((event) => event.step === "end");
    assert.deepEqual([end.trigger, end.running], ["channel-closed", true], diagnosis());
    assert.equal(trace.saw("helper-exited"), true, diagnosis());
    await reaches(() => client.isClosed(), "the client's disconnect with its write pending", diagnosis);
    assert.notEqual(endpoint, undefined);
  }
);

// why: a server end that outlives the helper, reproduced: the stand-in's
// child holds the connection. Ending the helper alone would leave the client
// connected; ending its tree disconnects it.
test("a refused channel whose helper's child holds the connection ends the whole tree", PIPE_CASE, async () => {
  const channel = await oversizedFrame("shares");
  await assertRefusalEnds(channel);
  assert.equal(channel.invoked.length, 0);
  const { trace } = channel;
  await reaches(
    () => trace.saw("tree-terminated"),
    "the tree terminator's return",
    () => trace.describe({})
  );
  const outcome = trace.events().find((event) => event.step === "tree-terminated").outcome;
  assert.equal(outcome, "returned", trace.describe({}));
});

// why: the Windows runner's failure, reproduced: a relay that writes in whole
// 128 KiB blocks, as the earlier PowerShell helper read, is kept up with, and
// its frame is refused for its size.
test(
  "a frame relayed in whole 128 KiB blocks reaches the controller and is refused for its size",
  PIPE_CASE,
  async () => {
    const channel = await oversizedFrame("blocks");
    await assertRefusalEnds(channel);
    assert.equal(channel.controller.statistics().stalledFrames, 0, channel.trace.describe({}));
    assert.equal(channel.trace.reached(), 125 + FRAME_BOUND + 1);
  }
);

// why: a relay that holds a frame's tail, as an unflushed one would: the
// frame never completes at the controller, which refuses it at the stall
// bound, so the channel still ends, the helper with it, and the client is
// disconnected.
test(
  "a relay that holds a frame's tail still has its channel refused, ended, and disconnected",
  PIPE_CASE,
  async () => {
    const channel = await oversizedFrame("holds-tail", { frameStallTimeoutMs: 1_000 });
    await assertRefusalEnds(channel);
    assert.equal(channel.controller.statistics().stalledFrames, 1, channel.trace.describe({}));
    assert.ok(channel.trace.reached() <= 125 + FRAME_BOUND, channel.trace.describe({}));
  }
);
