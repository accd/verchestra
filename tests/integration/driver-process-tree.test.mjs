import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

import { ClaudeCodeDriver } from "../../packages/drivers/src/claude-code-driver.ts";
import { OWN_PROCESS_GROUP, processTreeTerminator } from "../../packages/drivers/src/driver-process-tree.ts";
import { claudeFixture } from "../helpers/claude-driver-fixture.mjs";
import { eventuallyDead, isAlive } from "../helpers/process-liveness.mjs";
import { reap } from "../helpers/process-tree-fixture.mjs";

// invariant: what the Claude Code and Codex drivers share for stopping a
// provider (ADP-4, C4-4): which terminator a driver uses, what its fallback
// does when the composition injects none, and that the Claude Code driver
// starts one termination per child. Every process started here is an idle
// Node process or the labeled fake `claude`, and each is killed by id when its
// case ends.

const IDLE = ["-e", "setInterval(() => {}, 1000)"];

function idle(t) {
  const child = spawn(process.execPath, IDLE, { stdio: "ignore", detached: OWN_PROCESS_GROUP });
  reap(t, () => [child.pid]);
  return child;
}

test("a provider leads a process group of its own everywhere but on Windows", () => {
  assert.equal(OWN_PROCESS_GROUP, process.platform !== "win32");
});

test("an injected terminator is the one a driver uses", () => {
  const injected = async () => undefined;
  assert.equal(processTreeTerminator(injected), injected);
  assert.notEqual(processTreeTerminator(undefined), injected);
});

test("the fallback stops a provider that leads its own group", async (t) => {
  const child = idle(t);
  const exited = once(child, "exit");
  assert.equal(isAlive(child.pid), true);
  await processTreeTerminator(undefined)(child.pid);
  await exited;
  assert.equal(await eventuallyDead(child.pid), true);
});

test("the fallback finds nothing left to stop and still resolves", async (t) => {
  const child = idle(t);
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  assert.equal(await processTreeTerminator(undefined)(child.pid), undefined);
});

// invariant: every line still in the pipe asks to stop the child again once a
// stream has failed. A tree terminator reads the process table each time it is
// asked, so the driver starts one termination per child and awaits that one.
test("a Claude Code stream that keeps failing starts one termination of its child", { timeout: 30_000 }, async () => {
  const fixture = claudeFixture({ environment: { FAKE_CLAUDE_MODE: "chatter" }, maxOutputBytes: 1 });
  const driver = new ClaudeCodeDriver(fixture.dependencies());
  const events = [];
  const session = await driver.start(fixture.request(), (event) => events.push(event), new AbortController().signal);
  assert.equal(fixture.calls.terminate, 1);
  assert.deepEqual(
    events.filter((event) => event.type === "error").map((event) => event.code),
    ["VES_CLAUDE_OUTPUT_LIMIT"]
  );
  assert.equal((await driver.close(session)).outcome, "failed");
});
