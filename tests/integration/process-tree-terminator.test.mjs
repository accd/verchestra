import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

import { terminateProcessGroup } from "../../packages/platform-node/src/process-tree-terminator.ts";

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
