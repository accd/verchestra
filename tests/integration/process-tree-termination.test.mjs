import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

import {
  terminateProcessGroup,
  terminateProcessTree
} from "../../packages/platform-node/src/process-tree-terminator.ts";
import { eventuallyDead, isAlive } from "../helpers/process-liveness.mjs";
import { reap } from "../helpers/process-tree-fixture.mjs";

// invariant: the tree terminator (ADP-4, C4-4). A group signal cannot reach a
// descendant that left the group through setsid(), so `terminateProcessTree`
// records the tree first and kills what the signal could not reach. The group
// terminator itself is covered by tests/integration/process-tree-terminator.test.mjs.

const INCOMPLETE = () => assert.fail("the terminator reported a live group");

// why: the leader forks one child that stays in its group and one that leaves
// it with setsid(), and prints both ids only after both forks, so the tree is
// known to hold three processes in two groups before anything is signalled.
const TREE_LEADER = `
const { spawn } = require("node:child_process");
const idle = ["-e", "setInterval(() => {}, 1000)"];
const sameGroup = spawn(process.execPath, idle, { stdio: "ignore" });
const escaped = spawn(process.execPath, idle, { stdio: "ignore", detached: true });
process.stdout.write(JSON.stringify({ sameGroup: sameGroup.pid, escaped: escaped.pid }) + "\\n");
setInterval(() => {}, 1000);
`;

async function spawnTree(t) {
  const leader = spawn(process.execPath, ["-e", TREE_LEADER], {
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "ignore"]
  });
  const [chunk] = await once(leader.stdout, "data");
  const tree = { leader: leader.pid, ...JSON.parse(String(chunk)) };
  reap(t, () => Object.values(tree));
  return { process: leader, tree };
}

test("a group signal alone leaves a member that left the group through setsid alive", async (t) => {
  const { process: leader, tree } = await spawnTree(t);
  const exited = once(leader, "exit");
  if (process.platform === "win32") {
    t.diagnostic("win32: there are no process groups; the tree is killed through taskkill");
    await terminateProcessGroup(tree.leader, INCOMPLETE);
    await exited;
    return;
  }
  await terminateProcessGroup(tree.leader, INCOMPLETE);
  await exited;
  assert.equal(await eventuallyDead(tree.sameGroup), true, "the member of the group is dead");
  assert.equal(isAlive(tree.escaped), true, "the escapee is beyond the group signal");
});

test("a process tree is killed with the member that left its group through setsid", async (t) => {
  const { process: leader, tree } = await spawnTree(t);
  const exited = once(leader, "exit");
  if (process.platform === "win32") {
    t.diagnostic("win32: there are no process groups; the tree is killed through taskkill");
    await terminateProcessTree(tree.leader, INCOMPLETE);
    await exited;
    return;
  }
  for (const [name, pid] of Object.entries(tree)) assert.equal(isAlive(pid), true, `${name} was running`);
  await terminateProcessTree(tree.leader, INCOMPLETE);
  await exited;
  for (const [name, pid] of Object.entries(tree)) assert.equal(await eventuallyDead(pid), true, `${name} is dead`);
});

test("terminating a tree that is already gone reports nothing left to kill", async (t) => {
  const { process: leader, tree } = await spawnTree(t);
  const exited = once(leader, "exit");
  await terminateProcessTree(tree.leader, INCOMPLETE);
  await exited;
  await terminateProcessTree(tree.leader, INCOMPLETE);
});
