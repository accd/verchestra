import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

import { runDriverSession } from "../../packages/agent-runtime/src/execution/driver-session-runner.ts";
import { ClaudeCodeDriver } from "../../packages/drivers/src/claude-code-driver.ts";
import { CodexDriver } from "../../packages/drivers/src/codex-driver.ts";
import {
  OWN_PROCESS_GROUP,
  processTreeTerminator,
  singleTermination
} from "../../packages/drivers/src/driver-process-tree.ts";
import { claudeFixture } from "../helpers/claude-driver-fixture.mjs";
import { codexFixture } from "../helpers/codex-driver-fixture.mjs";
import { eventuallyDead, isAlive } from "../helpers/process-liveness.mjs";
import { reap } from "../helpers/process-tree-fixture.mjs";

// invariant: what the Claude Code and Codex drivers share for stopping a
// provider (ADP-4, C4-4): which terminator a driver uses, what its fallback
// does when the composition injects none, and that a stop asks for one
// termination per child. How the provider child run ends a provider on every
// other path is asserted at its own interface
// (tests/integration/provider-child-run.test.mjs). Every process started here
// is an idle Node process or a labeled fake, and each is killed by id when its
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

test("a child is terminated once however often it is asked, and a termination that failed is tried again", async () => {
  const asked = [];
  let fail = true;
  const stop = singleTermination(async (pid) => {
    asked.push(pid);
    if (fail) throw new Error("the provider could not be stopped");
  }, 4242);
  await assert.rejects(stop(), /could not be stopped/u);
  fail = false;
  const [first, second] = [stop(), stop()];
  assert.equal(first, second, "requests that overlap share one termination");
  await first;
  await stop();
  assert.deepEqual(asked, [4242, 4242], "one failed request, then one that every later request shares");
});

// invariant: a stop reaches a driver twice, through its signal and through
// `cancel`. Windows answers a kill of a process that has exited with an error,
// so a terminator asked a second time failed there, the cancel failed with it,
// and the session's terminal event came from the close, without the reason of
// the stop. The terminator here fails on a second request on every platform,
// which is how the platform matrix failure is reproduced where it never showed.
for (const [label, Driver, fixtureOf, hang] of [
  ["claude-code", ClaudeCodeDriver, claudeFixture, { FAKE_CLAUDE_MODE: "hang" }],
  ["codex", CodexDriver, codexFixture, { FAKE_CODEX_MODE: "hang" }]
]) {
  test(
    `${label}: a stop asks for one termination, so its terminal event keeps the reason`,
    { timeout: 30_000 },
    async (t) => {
      const asked = [];
      const fixture = fixtureOf({ environment: hang });
      const driver = new Driver(
        fixture.dependencies({
          onSpawn: (pid) => reap(t, () => [pid]),
          terminateTree: async (pid) => {
            asked.push(pid);
            if (asked.length > 1) throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
            // why: the provider outlives the Codex interrupt grace period of
            // the fixture, so a driver that asked again after it is caught.
            await new Promise((resolve) => setTimeout(resolve, 150));
            process.kill(pid);
          }
        })
      );
      const controller = new AbortController();
      t.after(() => controller.abort());
      const events = [];
      const finished = await runDriverSession({
        driver,
        startRequest: fixture.request(),
        signal: controller.signal,
        observe: (event) => {
          events.push(event);
          if (event.type === "session.started") controller.abort();
        }
      });
      assert.equal(finished.outcome, "cancelled");
      assert.equal(asked.length, 1, "the provider was asked to stop more than once");
      assert.deepEqual(
        events.filter((event) => event.type === "session.closed").map(({ outcome, reason }) => ({ outcome, reason })),
        [{ outcome: "cancelled", reason: "stopped by Verchestra" }]
      );
    }
  );
}

// why: imported here, with the case that reads it, so that the lines of the
// cases above stay where they were.
import { unawaitedTermination } from "../../packages/drivers/src/driver-process-tree.ts";

test("an end no caller awaits asks for the termination and contains its failure", async (t) => {
  const unhandled = [];
  const record = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", record);
  t.after(() => process.off("unhandledRejection", record));
  let asked = 0;
  const end = unawaitedTermination(async () => {
    asked += 1;
    throw new Error("the provider could not be stopped");
  });
  assert.equal(end(), undefined);
  end();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(asked, 2, "each end asks; the single termination per child is the terminator's own");
  assert.deepEqual(unhandled, []);
});
