import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { escalateCancellation, isProcessAlive, killProcessTree } from "../src/worker-supervisor.mjs";

test("cooperative cancellation stops after protocol acknowledgement", async () => {
  const calls = [];
  const result = await escalateCancellation({
    sendProtocolCancel: async () => calls.push("cancel"),
    waitForExit: async () => true,
    sendSignal: async () => calls.push("signal"),
    killTree: async () => calls.push("tree")
  });
  assert.deepEqual(result, { terminated: true, stage: "protocol-cancel", evidence: ["protocol-cancel", "protocol-exit"] });
  assert.deepEqual(calls, ["cancel"]);
});

test("uncooperative cancellation records every stage and kills the tree", async () => {
  const calls = [];
  const exits = [false, false];
  const result = await escalateCancellation({
    sendProtocolCancel: async () => calls.push("cancel"),
    waitForExit: async () => exits.shift() ?? true,
    sendSignal: async () => calls.push("signal"),
    killTree: async () => calls.push("tree")
  });
  assert.deepEqual(result, { terminated: true, stage: "process-tree-kill", evidence: ["protocol-cancel", "grace-expired", "process-signal", "signal-grace-expired", "process-tree-kill"] });
  assert.deepEqual(calls, ["cancel", "signal", "tree"]);
});

test("current-platform process-tree killer terminates a non-group-leader parent and descendant", { timeout: 10_000 }, async (t) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./fixtures/process-tree-worker.mjs", import.meta.url))], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  const [line] = await once(child.stdout, "data");
  const pids = JSON.parse(line.toString("utf8").trim());
  t.after(() => {
    for (const pid of [pids.child, pids.parent]) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  });
  assert.equal(await isProcessAlive(pids.parent), true);
  assert.equal(await isProcessAlive(pids.child), true);
  const exited = once(child, "exit");
  await killProcessTree(pids.parent);
  await exited;
  assert.equal(await isProcessAlive(pids.parent), false);
  assert.equal(await isProcessAlive(pids.child), false);
});
