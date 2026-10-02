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
import { reap, stoppedWithInputPending, WIN32_HOST } from "../helpers/process-tree-fixture.mjs";

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

// invariant: a provider is ended in more ways than by a stop, and each of them
// goes through the injected terminator once: a stream that failed, an output
// limit, an input the provider closed, and a run that ended with the
// provider still running. A signal to the one process would not be counted
// here, and would leave the provider's descendants behind; the qualification
// suites prove the tree, these cases prove the wiring on every platform.
// why: the unawaited helper is imported here, with the cases that read it, so
// that the lines of the cases above, which the validation evidence cites, stay.
import { unawaitedTermination } from "../../packages/drivers/src/driver-process-tree.ts";

// hazard: a driver that does not end its provider would leave the run, and the
// fake, alive after the case fails; the provider is killed by id when it ends.
async function endedByItself(t, Driver, fixture) {
  const events = [];
  const counted = fixture.dependencies();
  const onSpawn = (pid) => {
    counted.onSpawn(pid);
    reap(t, () => [pid]);
  };
  const driver = new Driver({ ...counted, onSpawn });
  const session = await driver.start(fixture.request(), (event) => events.push(event), new AbortController().signal);
  const errors = events.filter((event) => event.type === "error").map((event) => event.code);
  return { errors, outcome: (await driver.close(session)).outcome, terminations: fixture.calls.terminate };
}

for (const [label, Driver, fixtureOf, ended] of [
  [
    "a Codex stream that fails",
    CodexDriver,
    () => codexFixture({ environment: { FAKE_CODEX_MODE: "garbled" } }),
    { by: endedByItself, errors: ["VES_CODEX_STREAM_INVALID"], outcome: "failed", terminations: 1 }
  ],
  [
    "a Codex provider that exceeds its output limit",
    CodexDriver,
    () => codexFixture({ environment: { FAKE_CODEX_MODE: "large" }, maxOutputBytes: 2048 }),
    { by: endedByItself, errors: ["VES_CODEX_OUTPUT_LIMIT"], outcome: "failed", terminations: 1 }
  ],
  [
    "a Codex run that ends with its provider still running",
    CodexDriver,
    () => codexFixture({ environment: { FAKE_CODEX_MODE: "linger" } }),
    { by: endedByItself, errors: [], outcome: "completed", terminations: 1 }
  ],
  inputRow()
]) {
  test(`${label} ends that provider through one termination of its child`, { timeout: 30_000 }, async (t) => {
    const { by, ...expected } = ended;
    assert.deepEqual(await by(t, Driver, fixtureOf()), expected);
  });
}

// hazard: on win32 the fake cannot close its input, so no write fails there
// and nothing ends the session but a stop. The row asserts there what holds:
// nothing ends the session by itself, and a stop ends it through one
// termination, with the prompt still unread.
function inputRow() {
  const fixtureOf = () =>
    claudeFixture({ environment: { FAKE_CLAUDE_MODE: "deaf" }, prompt: "x".repeat(2 * 1024 * 1024) });
  if (!WIN32_HOST)
    return [
      "a Claude Code provider that closes its input",
      ClaudeCodeDriver,
      fixtureOf,
      { by: endedByItself, errors: ["VES_CLAUDE_STDIN_FAILED"], outcome: "failed", terminations: 1 }
    ];
  return [
    "a stop of a Claude Code provider that does not read its input",
    ClaudeCodeDriver,
    fixtureOf,
    { by: stoppedUnread, errors: ["VES_CLAUDE_ABORTED"], outcome: "cancelled", terminations: 1 }
  ];
}

async function stoppedUnread(t, Driver, fixture) {
  const counted = fixture.dependencies();
  const onSpawn = (pid) => {
    counted.onSpawn(pid);
    reap(t, () => [pid]);
  };
  const stopped = await stoppedWithInputPending(new Driver({ ...counted, onSpawn }), fixture.request());
  return { ...stopped, terminations: fixture.calls.terminate };
}

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
