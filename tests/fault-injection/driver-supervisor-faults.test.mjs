import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BoundedDriverEventQueue,
  DriverSupervisor,
  escalateDriverCancellation
} from "../../packages/drivers/src/index.ts";

test("bounded queue pauses at high water and resumes at low water", () => {
  const queue = new BoundedDriverEventQueue({ capacity: 4, highWater: 3, lowWater: 1 });
  assert.equal(queue.push("a").pauseReads, false);
  queue.push("b");
  assert.equal(queue.push("c").pauseReads, true);
  queue.shift();
  assert.equal(queue.shift().resumeReads, true);
});

test("bounded queue rejects overflow and requires cancellation", () => {
  const queue = new BoundedDriverEventQueue({ capacity: 1, highWater: 1, lowWater: 0 });
  queue.push("a");
  assert.throws(
    () => queue.push("b"),
    (error) => error.code === "VES_DRIVER_BACKPRESSURE_LIMIT" && error.cancellationRequired
  );
});

test("supervisor rejects a sequence gap and requires cancellation", () => {
  const supervisor = new DriverSupervisor({
    queue: { capacity: 3, highWater: 2, lowWater: 0 },
    cancellation: {
      protocolCancel: async () => {},
      waitForExit: async () => true,
      signalProcess: async () => {},
      killTree: async () => {}
    }
  });
  assert.throws(
    () => supervisor.accept({ type: "content.delta", text: "gap", sequence: 1 }),
    (error) => error.code === "VES_DRIVER_EVENT_SEQUENCE" && error.cancellationRequired
  );
});

for (const bounds of [
  [0, 0, 0],
  [2, 3, 1],
  [3, 2, 2],
  [3, 2, -1]
]) {
  test(`bounded queue rejects invalid bounds ${bounds.join("/")}`, () => {
    assert.throws(
      () => new BoundedDriverEventQueue({ capacity: bounds[0], highWater: bounds[1], lowWater: bounds[2] })
    );
  });
}

test("cancellation stops after protocol acknowledgement", async () => {
  const calls = [];
  const result = await escalateDriverCancellation({
    protocolCancel: async () => calls.push("cancel"),
    waitForExit: async () => true,
    signalProcess: async () => calls.push("signal"),
    killTree: async () => calls.push("kill")
  });
  assert.equal(result.stage, "protocol-cancel");
  assert.deepEqual(calls, ["cancel"]);
});

test("cancellation escalates to process signal", async () => {
  const calls = [];
  const exits = [false, true];
  const result = await escalateDriverCancellation({
    protocolCancel: async () => calls.push("cancel"),
    waitForExit: async () => exits.shift(),
    signalProcess: async () => calls.push("signal"),
    killTree: async () => calls.push("kill")
  });
  assert.equal(result.stage, "process-signal");
  assert.deepEqual(calls, ["cancel", "signal"]);
});

test("cancellation escalates finally to process-tree kill", async () => {
  const calls = [];
  const result = await escalateDriverCancellation({
    protocolCancel: async () => calls.push("cancel"),
    waitForExit: async () => false,
    signalProcess: async () => calls.push("signal"),
    killTree: async () => calls.push("kill")
  });
  assert.equal(result.stage, "process-tree-kill");
  assert.deepEqual(calls, ["cancel", "signal", "kill"]);
  assert.deepEqual(result.evidence, [
    "protocol-cancel",
    "grace-expired",
    "process-signal",
    "signal-grace-expired",
    "process-tree-kill"
  ]);
});
