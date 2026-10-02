import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

import { ProviderProcesses } from "../../apps/vestra-cli/src/task/task-process-tree.ts";
import { eventuallyDead, isAlive } from "../helpers/process-liveness.mjs";
import { reap } from "../helpers/process-tree-fixture.mjs";

// invariant: the provider processes of a `vestra task` command (ADP-4, C4-4).
// A provider session gets its terminator and its spawn observer from them. The
// terminator never rejects, because a driver calls it from an abort listener;
// a tree it could not confirm stopped is named once on stderr. The interrupt
// handlers exist only while a provider runs. That an interrupt stops a whole
// tree and ends the command is proven with a real child process in
// tests/integration/task-provider-interrupt.test.mjs. The one process started
// here is an idle Node process, killed by id when its case ends.

const INTERRUPTS = ["SIGHUP", "SIGTERM"];
const listeners = () => INTERRUPTS.map((signal) => process.listenerCount(signal));

function fixture(options = {}) {
  const reported = [];
  const providers = new ProviderProcesses({ stderr: (text) => reported.push(text), ...options });
  return { providers, reported };
}

function idle(t) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    detached: process.platform !== "win32"
  });
  reap(t, () => [child.pid]);
  return child;
}

test("the terminator stops a provider that leads its own group and reports nothing", async (t) => {
  const { providers, reported } = fixture();
  const session = providers.session("Claude Code");
  const child = idle(t);
  const exited = once(child, "exit");
  assert.equal(isAlive(child.pid), true);
  assert.equal(await session.terminateTree(child.pid), undefined);
  await exited;
  assert.equal(await eventuallyDead(child.pid), true);
  // invariant: a tree that is already gone is not a failure and not a report.
  assert.equal(await session.terminateTree(child.pid), undefined);
  assert.deepEqual(reported, []);
});

test("a tree whose final check still sees a member alive is named once on stderr, and the terminator resolves", async () => {
  const asked = [];
  const { providers, reported } = fixture({
    terminateTree: async (pid, incomplete) => {
      asked.push(pid);
      incomplete();
    }
  });
  const claude = providers.session("Claude Code");
  const codex = providers.session("Codex");
  assert.equal(await claude.terminateTree(4242), undefined);
  assert.equal(await claude.terminateTree(4242), undefined);
  assert.equal(await codex.terminateTree(4343), undefined);
  assert.deepEqual(asked, [4242, 4242, 4343], "every request reaches the tree routine");
  assert.deepEqual(reported, [
    "vestra: the Claude Code process group 4242 was not confirmed stopped and may still be running. Stop it with: kill -KILL -- -4242\n",
    "vestra: the Codex process group 4343 was not confirmed stopped and may still be running. Stop it with: kill -KILL -- -4343\n"
  ]);
});

test("a kill the runtime refuses is reported the same way and does not reject", async () => {
  // why: Node refuses a process identifier that is not an integer before it
  // signals anything, so this is a kill that fails without reaching a process.
  const { providers, reported } = fixture();
  assert.equal(await providers.session("Codex").terminateTree(Number.NaN), undefined);
  assert.equal(reported.length, process.platform === "win32" ? 0 : 1);
  if (process.platform !== "win32")
    assert.match(reported[0], /^vestra: the Codex process group NaN was not confirmed stopped/u);
});

test("the interrupt handlers exist only while a provider is running", async () => {
  const before = listeners();
  const interrupts = process.listenerCount("SIGINT");
  const { providers } = fixture({ terminateTree: async () => undefined });
  const claude = providers.session("Claude Code");
  const codex = providers.session("Codex");
  assert.equal(providers.running(), false);
  assert.deepEqual(listeners(), before, "a session that started nothing installs nothing");
  claude.onSpawn(4242);
  assert.equal(providers.running(), true);
  assert.deepEqual(
    listeners(),
    before.map((count) => count + 1)
  );
  codex.onSpawn(4343);
  assert.deepEqual(
    listeners(),
    before.map((count) => count + 1),
    "one handler per signal, however many providers run"
  );
  await claude.end();
  assert.equal(providers.running(), true, "the other provider is still running");
  assert.deepEqual(
    listeners(),
    before.map((count) => count + 1)
  );
  await codex.end();
  await codex.end();
  assert.equal(providers.running(), false);
  assert.deepEqual(listeners(), before, "the handlers are removed with the last provider");
  assert.equal(process.listenerCount("SIGINT"), interrupts, "SIGINT is never the provider processes' to answer");
});

test("an effect of a session runs as long as the command is not being interrupted", async () => {
  const { providers } = fixture();
  const session = providers.session("Claude Code");
  assert.equal(await session.unlessInterrupted(async () => "checkpoint:1"), "checkpoint:1");
  await assert.rejects(
    session.unlessInterrupted(async () => {
      throw new Error("the effect failed");
    }),
    /the effect failed/u
  );
});
