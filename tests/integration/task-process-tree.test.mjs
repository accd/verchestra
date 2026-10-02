import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

import { terminateProviderTree } from "../../apps/vestra-cli/src/task/task-process-tree.ts";
import { eventuallyDead, isAlive } from "../helpers/process-liveness.mjs";
import { reap } from "../helpers/process-tree-fixture.mjs";

// invariant: the terminator `vestra task` injects into its provider drivers
// (ADP-4, C4-4). The drivers call it from an abort listener, where a rejection
// would be unhandled and end the whole command, so it resolves whatever the
// kill reports. That it kills a whole tree is proven with the drivers, in the
// qualification suites. The one process started here is an idle Node process,
// killed by id when its case ends.

test("the task composition's terminator stops a provider that leads its own group", async (t) => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    detached: process.platform !== "win32"
  });
  reap(t, () => [child.pid]);
  const exited = once(child, "exit");
  assert.equal(isAlive(child.pid), true);
  assert.equal(await terminateProviderTree(child.pid), undefined);
  await exited;
  assert.equal(await eventuallyDead(child.pid), true);
  // invariant: a tree that is already gone is not a failure.
  assert.equal(await terminateProviderTree(child.pid), undefined);
});

test("the task composition's terminator resolves when the kill itself is refused", async () => {
  // why: Node refuses a process identifier that is not an integer before it
  // signals anything, so this is a kill that fails without reaching a process.
  assert.equal(await terminateProviderTree(Number.NaN), undefined);
});
