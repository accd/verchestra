import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

import {
  taskkillExecutable,
  terminateProcessGroup,
  terminateStoppedTree
} from "../../packages/platform-node/src/process-tree-terminator.ts";

const INCOMPLETE = () => assert.fail("the terminator reported a live group");

// why: the leader prints its grandchild's pid only after the fork, so the
// group is known to hold two members before it is signalled.
const LEADER = `
const { spawn } = require("node:child_process");
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
process.stdout.write(String(grandchild.pid) + "\\n");
setInterval(() => {}, 1000);
`;

async function spawnGroup() {
  const leader = spawn(process.execPath, ["-e", LEADER], {
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "ignore"]
  });
  const [chunk] = await once(leader.stdout, "data");
  return { leader, grandchild: Number(String(chunk).trim()) };
}

function blockEventLoop(milliseconds) {
  // hazard: the event loop must not turn, or Node would reap the leader and
  // the group would never be observed as zombies only.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

// invariant: "dead" means no member of the group is still running; a zombie
// has already exited and only awaits its reaper.
function liveMembers(pgid) {
  return execFileSync("ps", ["-A", "-o", "pid=,pgid=,stat="], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim().split(/\s+/u))
    .filter(([, group, state]) => Number(group) === pgid && state?.startsWith("Z") === false)
    .map(([pid]) => Number(pid));
}

// invariant: Darwin reports EPERM for a group signal when every member is a
// zombie awaiting its reaper; the terminator must count that tree as dead
// instead of failing a kill that already succeeded (#405 candidate build).
test("a process group left with only zombies awaiting their reaper counts as terminated", async (t) => {
  const { leader } = await spawnGroup();
  if (process.platform === "win32") {
    t.diagnostic("win32: the tree is killed through taskkill, which has no zombie state");
    const exited = once(leader, "exit");
    await terminateProcessGroup(leader.pid, INCOMPLETE);
    await exited;
    return;
  }
  process.kill(-leader.pid, "SIGKILL");
  blockEventLoop(300);
  assert.deepEqual(liveMembers(leader.pid), [], "the group holds zombies only");
  if (process.platform === "darwin")
    assert.throws(() => process.kill(-leader.pid, 0), { code: "EPERM" }, "Darwin refuses a zombie-only group");
  await terminateProcessGroup(leader.pid, INCOMPLETE);
  assert.deepEqual(liveMembers(leader.pid), []);
});

test("a live process group is killed and verified gone", async () => {
  const { leader, grandchild } = await spawnGroup();
  const exited = once(leader, "exit");
  const ascending = (left, right) => left - right;
  if (process.platform !== "win32")
    assert.deepEqual(liveMembers(leader.pid).sort(ascending), [leader.pid, grandchild].sort(ascending));
  await terminateProcessGroup(leader.pid, INCOMPLETE);
  await exited;
  if (process.platform !== "win32") assert.deepEqual(liveMembers(leader.pid), []);
});

test("taskkill resolves under SystemRoot", () => {
  const saved = process.env["SystemRoot"];
  try {
    process.env["SystemRoot"] = "D:\\Windows";
    assert.equal(taskkillExecutable(), "D:\\Windows\\System32\\taskkill.exe");
  } finally {
    if (saved === undefined) delete process.env["SystemRoot"];
    else process.env["SystemRoot"] = saved;
  }
});

// why: the routine the probe host ends its worker with (#569). Each case below
// asserts the win32 refusal there instead of skipping: the probe host is POSIX
// only and refuses win32 before it starts a worker.
const REFUSED = () => {
  throw new Error("incomplete");
};

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function eventuallyGone(pid) {
  for (let attempt = 0; attempt < 40 && alive(pid); attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 25));
  return !alive(pid);
}

function reap(t, pid) {
  t.after(() => {
    if (alive(pid)) process.kill(pid, "SIGKILL");
  });
}

async function refusedOnWin32(t) {
  t.diagnostic("win32: the stopped-tree routine refuses this platform instead");
  await assert.rejects(terminateStoppedTree(process.pid, { exited: () => false, incomplete: REFUSED }), /incomplete/u);
}

// why: the escapee leaves the leader's group at once, so only parentage links
// it to the leader when the tree is stopped.
const ESCAPING_LEADER = `
const { spawn } = require("node:child_process");
const escaped = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: true });
process.stdout.write(String(escaped.pid) + "\\n");
setInterval(() => {}, 1000);
`;

test("a stopped tree ends a descendant that left the group while its root ran", async (t) => {
  if (process.platform === "win32") return refusedOnWin32(t);
  const leader = spawn(process.execPath, ["-e", ESCAPING_LEADER], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"]
  });
  const [chunk] = await once(leader.stdout, "data");
  const escaped = Number(String(chunk).trim());
  reap(t, escaped);
  const exited = once(leader, "exit");
  const outcome = await terminateStoppedTree(leader.pid, {
    exited: () => leader.exitCode !== null || leader.signalCode !== null,
    incomplete: INCOMPLETE
  });
  await exited;
  assert.deepEqual(outcome, { running: true });
  assert.equal(await eventuallyGone(escaped), true, "the escapee is dead");
});

test("a root that exited before its group was stopped is reported as not running", async (t) => {
  if (process.platform === "win32") return refusedOnWin32(t);
  const { leader, grandchild } = await spawnGroup();
  reap(t, grandchild);
  const exited = once(leader, "exit");
  process.kill(leader.pid, "SIGKILL");
  await exited;
  const outcome = await terminateStoppedTree(leader.pid, { exited: () => true, incomplete: INCOMPLETE });
  assert.deepEqual(outcome, { running: false });
  assert.equal(await eventuallyGone(grandchild), true, "the member left in the group is still killed");
});

// why: a pid the table still lists can belong to another process once the
// host has seen the root exit, so the root counts as running only if both agree.
test("a root the host saw exit is not running even when a table still lists its pid", async (t) => {
  if (process.platform === "win32") return refusedOnWin32(t);
  const { leader, grandchild } = await spawnGroup();
  reap(t, grandchild);
  const exited = once(leader, "exit");
  process.kill(leader.pid, "SIGKILL");
  await exited;
  const outcome = await terminateStoppedTree(leader.pid, {
    exited: () => true,
    incomplete: INCOMPLETE,
    table: async () => [{ pid: leader.pid, ppid: 1, pgid: leader.pid, zombie: false }]
  });
  assert.deepEqual(outcome, { running: false });
});

test("without a process table the group is still killed and the sweep is reported incomplete", async (t) => {
  if (process.platform === "win32") return refusedOnWin32(t);
  const { leader, grandchild } = await spawnGroup();
  reap(t, grandchild);
  const exited = once(leader, "exit");
  await assert.rejects(
    terminateStoppedTree(leader.pid, { exited: () => false, incomplete: REFUSED, table: async () => undefined }),
    /incomplete/u
  );
  await exited;
  assert.equal(await eventuallyGone(grandchild), true);
});
