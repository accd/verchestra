// why: the fixture of the process-tree termination suites (ADP-4, C4-4). The
// fake providers' `fork` mode starts one descendant that stays in the
// provider's process group and one that leaves it with setsid(), and names all
// three processes in its output.
// invariant: every process started here belongs to the test and is killed by
// id when the case ends; nothing outside those ids is signalled.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import { eventuallyDead, isAlive } from "./process-liveness.mjs";

export const WIN32_HOST = process.platform === "win32";

// invariant: whatever the case proved, no process it started outlives it.
export function reap(t, pids) {
  t.after(() => {
    for (const pid of pids()) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH" && error.code !== "EPERM") throw error;
      }
    }
  });
}

// why: the process table is read through the system's own `ps` by its absolute
// path, never through whatever a search path would find first.
export function processGroupOf(pid) {
  return Number(execFileSync("/bin/ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).trim());
}

// invariant: the provider, the descendant in its group, and the one that left.
export function treeIn(events) {
  const text = events.find((event) => event.type === "content.delta" && String(event.text).startsWith("tree:"))?.text;
  if (text === undefined) return undefined;
  const [provider, sameGroup, escaped] = text.slice("tree:".length).split(":").map(Number);
  return { provider, sameGroup, escaped };
}

// why: a running session of a driver whose fake provider is in `fork` mode.
// `tree` resolves once the provider named its three processes, or with nothing
// when the run ended first, so a broken fixture fails the case, not hangs it.
export function forkingSession(t, driver, request, signal = new AbortController().signal) {
  const events = [];
  let announce;
  const announced = new Promise((resolve) => (announce = resolve));
  reap(t, () => Object.values(treeIn(events) ?? {}));
  const run = driver.start(
    request,
    (event) => {
      events.push(event);
      if (treeIn(events) !== undefined) announce(treeIn(events));
    },
    signal
  );
  const tree = Promise.race([announced, run.then(() => undefined)]);
  const sessionId = () => events.find((event) => event.type === "session.started")?.sessionId;
  return { events, run, tree, sessionId };
}

export function assertTreeRunning(tree) {
  assert.ok(tree, "the run ended before the provider named its processes");
  for (const [name, pid] of Object.entries(tree)) assert.equal(isAlive(pid), true, `${name} was not running`);
  assert.equal(processGroupOf(tree.provider), tree.provider, "the provider does not lead a process group of its own");
  assert.notEqual(processGroupOf(tree.provider), processGroupOf(process.pid), "the provider shares the caller's group");
  assert.equal(processGroupOf(tree.sameGroup), tree.provider, "the descendant left the provider's group");
  assert.notEqual(processGroupOf(tree.escaped), tree.provider, "the escapee is still in the provider's group");
}

function terminalEvents(events) {
  return events.filter((event) => event.type === "session.closed");
}

async function assertTreeGone(tree) {
  for (const [name, pid] of Object.entries(tree))
    assert.equal(await eventuallyDead(pid), true, `${name} is still running`);
}

// invariant: win32 has no process groups and no setsid(), so there the suite
// asserts what holds on every platform: a stopped session ends, its terminal
// event says cancelled, and the provider process is gone. No case is skipped.
async function stoppedOnWin32(t, build, dependencies, stop) {
  t.diagnostic("win32: no process groups; asserting that a stopped session ends and its provider is gone");
  let provider;
  const { driver, request } = build({ ...dependencies, onSpawn: (pid) => (provider = pid) }, "hang");
  reap(t, () => (provider === undefined ? [] : [provider]));
  const controller = new AbortController();
  const events = [];
  let announce;
  const announced = new Promise((resolve) => (announce = resolve));
  const run = driver.start(
    request,
    (event) => {
      events.push(event);
      if (event.type === "session.started") announce(event.sessionId);
    },
    controller.signal
  );
  const sessionId = await Promise.race([announced, run.then(() => undefined)]);
  assert.equal(typeof sessionId, "string", "the run ended before it announced a session");
  await stop({ driver, sessionId, controller });
  await driver.close(await run);
  assert.equal(await eventuallyDead(provider), true, "the provider is still running");
  assert.equal(terminalEvents(events)[0]?.outcome, "cancelled");
}

// why: the Claude Code and Codex drivers are held to one contract for stopping
// a provider, so the cases are written once and each qualification suite runs
// them against its own driver and labeled fake. `build(dependencies, mode)`
// returns a driver whose fake provider runs in that mode, and its request;
// `terminator` is the one the composition root injects, and `reported` holds
// what it wrote about a tree it could not confirm stopped.
export function processTreeSuite(test, { label, build, terminator, reported }) {
  const options = { timeout: 60_000 };
  const cancel = ({ driver, sessionId }) => driver.cancel({ sessionId }, "user-request");

  test(
    `${label}: a cancel kills the provider, the descendant in its group, and the one that left it`,
    options,
    async (t) => {
      if (WIN32_HOST) return stoppedOnWin32(t, build, { terminateTree: terminator }, cancel);
      const { driver, request } = build({ terminateTree: terminator }, "fork");
      const session = forkingSession(t, driver, request);
      const tree = await session.tree;
      assertTreeRunning(tree);
      await driver.cancel({ sessionId: session.sessionId() }, "user-request");
      // invariant: the run ends. With only the provider killed, the descendant
      // that holds its output open would keep the run waiting.
      const reference = await session.run;
      await assertTreeGone(tree);
      assert.deepEqual(
        terminalEvents(session.events).map(({ outcome, reason }) => ({ outcome, reason })),
        [{ outcome: "cancelled", reason: "user-request" }]
      );
      await driver.close(reference);
      assert.deepEqual(reported, [], "a tree that was stopped is not reported as running");
    }
  );

  test(`${label}: an aborted start signal kills the whole tree`, options, async (t) => {
    const abort = ({ controller }) => controller.abort();
    if (WIN32_HOST) return stoppedOnWin32(t, build, { terminateTree: terminator }, abort);
    const controller = new AbortController();
    const { driver, request } = build({ terminateTree: terminator }, "fork");
    const session = forkingSession(t, driver, request, controller.signal);
    const tree = await session.tree;
    assertTreeRunning(tree);
    controller.abort();
    const reference = await session.run;
    await assertTreeGone(tree);
    assert.equal((await driver.close(reference)).outcome, "cancelled");
    assert.deepEqual(reported, [], "a tree that was stopped is not reported as running");
  });

  test(
    `${label}: without an injected terminator a cancel still stops the provider's whole group`,
    options,
    async (t) => {
      if (WIN32_HOST) return stoppedOnWin32(t, build, { terminateTree: undefined }, cancel);
      const { driver, request } = build({ terminateTree: undefined }, "fork");
      const session = forkingSession(t, driver, request);
      const tree = await session.tree;
      assertTreeRunning(tree);
      await driver.cancel({ sessionId: session.sessionId() }, "user-request");
      await driver.close(await session.run);
      assert.equal(await eventuallyDead(tree.provider), true, "the provider is still running");
      assert.equal(
        await eventuallyDead(tree.sameGroup),
        true,
        "the descendant in the provider's group is still running"
      );
      // invariant: a descendant that left the group is beyond a group signal.
      // Reaching it is what the injected terminator is for, and why the task
      // composition always injects one.
      assert.equal(isAlive(tree.escaped), true, "the fallback reached a process outside the provider's group");
    }
  );
}

function errorCodes(events) {
  return events.filter((event) => event.type === "error").map((event) => event.code);
}

// invariant: win32 has no process groups and no setsid(), so there the suite
// asserts what holds on every platform: the session ends the way that end is
// reported, and the provider process, which the fake keeps alive until it is
// terminated, is gone. No case is skipped.
async function endedOnWin32(t, build, terminator, end) {
  t.diagnostic("win32: no process groups; asserting that the session ends and its provider is gone");
  let provider;
  const dependencies = { terminateTree: terminator, onSpawn: (pid) => (provider = pid) };
  const { driver, request } = build(dependencies, end.mode, end.execution);
  reap(t, () => (provider === undefined ? [] : [provider]));
  if (end.win32 !== undefined) {
    t.diagnostic("win32: the fake cannot close its standard input; asserting that the session is stopped instead");
    assert.deepEqual(await stoppedWithInputPending(driver, request), end.win32);
    assert.equal(await eventuallyDead(provider), true, "the provider is still running");
    return;
  }
  const events = [];
  const reference = await driver.start(request, (event) => events.push(event), new AbortController().signal);
  assert.deepEqual(errorCodes(events), end.errors);
  assert.equal(await eventuallyDead(provider), true, "the provider is still running");
  assert.equal((await driver.close(reference)).outcome, end.outcome);
}

// why: long enough for a write that was going to fail to have failed, and far
// below the time limit of a case.
const INPUT_SETTLE_MS = 1_000;

// invariant: what holds on win32 for a provider that does not read its input.
// The runtime keeps the descriptors of the standard streams open there, so the
// fake cannot close its input; the write of the prompt then neither fails nor
// ends, and the driver learns nothing. Nothing ends that session by itself and
// no failure is reported, the driver's wait is ended by a stop, and the
// session then ends as any stopped session does.
// hazard: if the run ends by itself here, the write did fail, and the case of
// the other platforms is the one that applies.
export async function stoppedWithInputPending(driver, request) {
  const events = [];
  let announce;
  const announced = new Promise((resolve) => (announce = resolve));
  let ended = false;
  const run = driver.start(
    request,
    (event) => {
      events.push(event);
      if (event.type === "session.started") announce(event.sessionId);
    },
    new AbortController().signal
  );
  const settled = run.then(() => (ended = true));
  const sessionId = await Promise.race([announced, settled.then(() => undefined)]);
  assert.equal(typeof sessionId, "string", "the run ended before it announced a session");
  await new Promise((resolve) => setTimeout(resolve, INPUT_SETTLE_MS));
  assert.equal(ended, false, "the run ended by itself: the write to the provider's input failed on this platform");
  assert.deepEqual(errorCodes(events), [], "a failure was reported before the session was stopped");
  await driver.cancel({ sessionId }, "user-request");
  const closed = await driver.close(await run);
  return { errors: errorCodes(events), outcome: closed.outcome };
}

// why: a provider is ended in more ways than by a stop: its stream fails, it
// exceeds its output limit, it closes its input, or its run ends while it is
// still running. Each of these ends must leave nothing of its tree behind, the
// descendant that left its process group included. `ends` names the fake's
// mode for each, what the session reports, and how it closes;
// `build(dependencies, mode, execution)` returns a driver whose fake provider
// runs in that mode, forking its tree first when `execution.fork` is set. An
// end the fake cannot produce on win32 names what is asserted there instead,
// as `win32`, and what the case is then called, as `win32Name`.
export function providerEndSuite(test, { label, build, terminator, reported, ends }) {
  for (const end of ends) {
    const name = WIN32_HOST ? (end.win32Name ?? end.name) : end.name;
    test(`${label}: a provider that ${name} leaves nothing of its tree behind`, { timeout: 60_000 }, async (t) => {
      if (WIN32_HOST) return endedOnWin32(t, build, terminator, end);
      const { driver, request } = build({ terminateTree: terminator }, end.mode, { ...end.execution, fork: true });
      const session = forkingSession(t, driver, request);
      const tree = await session.tree;
      assert.ok(tree, "the run ended before the provider named its processes");
      // invariant: the run ends by itself. Nothing here stops the session; the
      // driver ended the provider because of how its run ended.
      const reference = await session.run;
      assert.deepEqual(errorCodes(session.events), end.errors);
      await assertTreeGone(tree);
      assert.equal((await driver.close(reference)).outcome, end.outcome);
      assert.deepEqual(reported, [], "a tree that was stopped is not reported as running");
    });
  }
}
