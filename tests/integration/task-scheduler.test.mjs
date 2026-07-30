import assert from "node:assert/strict";
import { test } from "node:test";

import { TaskScheduleCoordinator, TaskSchedulerError } from "../../packages/application/src/index.ts";

import { flush, scheduleInput, scheduleTask, schedulerPorts } from "../helpers/task-scheduler-fixture.mjs";

const schedulerError = (code) => (error) => error instanceof TaskSchedulerError && error.code === code;

test("independent tasks run concurrently with one claim per task", async () => {
  const { state, ports, release } = schedulerPorts();
  const coordinator = new TaskScheduleCoordinator(ports);
  const pending = coordinator.execute(scheduleInput([scheduleTask("T1"), scheduleTask("T2")]));
  await flush();
  assert.deepEqual(state.started, ["T1", "T2"]);
  assert.deepEqual(
    state.calls.filter((call) => call.startsWith("acquire:")),
    ["acquire:T1", "acquire:T2"]
  );
  release("T1");
  release("T2");
  const report = await pending;
  assert.equal(report.status, "completed");
  assert.deepEqual(
    report.outcomes.map((outcome) => [outcome.taskId, outcome.status, outcome.coordinationRef]),
    [
      ["T1", "completed", "coordination:T1"],
      ["T2", "completed", "coordination:T2"]
    ]
  );
});

test("the concurrency width bounds the in-flight set and defers the rest", async () => {
  const { state, ports, release } = schedulerPorts();
  const coordinator = new TaskScheduleCoordinator(ports);
  const input = scheduleInput([scheduleTask("T1"), scheduleTask("T2"), scheduleTask("T3")], {
    maxConcurrentTasks: 2
  });
  const pending = coordinator.execute(input);
  await flush();
  assert.deepEqual(state.started, ["T1", "T2"]);
  release("T1");
  await flush();
  assert.deepEqual(state.started, ["T1", "T2", "T3"]);
  release("T2");
  release("T3");
  const report = await pending;
  assert.equal(report.status, "completed");
  assert.equal(report.rounds.length, 2);
  assert.deepEqual(report.rounds[0].started, [{ taskId: "T1" }, { taskId: "T2" }]);
  assert.deepEqual(report.rounds[0].deferred, [{ taskId: "T3", reason: "concurrency-limit" }]);
  assert.deepEqual(report.rounds[1].started, [{ taskId: "T3" }]);
});

test("overlapping change scopes never run concurrently and serialize by taskId", async () => {
  const { state, ports, release } = schedulerPorts();
  const coordinator = new TaskScheduleCoordinator(ports);
  const input = scheduleInput([
    scheduleTask("T1", { scope: ["packages/application/src"] }),
    scheduleTask("T2", { scope: ["packages/application/src/T2"] })
  ]);
  const pending = coordinator.execute(input);
  await flush();
  assert.deepEqual(state.started, ["T1"]);
  release("T1");
  await flush();
  assert.deepEqual(state.started, ["T1", "T2"]);
  release("T2");
  const report = await pending;
  assert.equal(report.status, "completed");
  assert.deepEqual(report.rounds[0].deferred, [{ taskId: "T2", reason: "scope-conflict:T1" }]);
});

test("a dependent task starts only after its dependency completes", async () => {
  const { state, ports, release } = schedulerPorts();
  const coordinator = new TaskScheduleCoordinator(ports);
  const input = scheduleInput([scheduleTask("T1"), scheduleTask("T2", { dependencies: ["T1"] })]);
  const pending = coordinator.execute(input);
  await flush();
  assert.deepEqual(state.started, ["T1"]);
  release("T1");
  await flush();
  assert.deepEqual(state.started, ["T1", "T2"]);
  release("T2");
  const report = await pending;
  assert.equal(report.status, "completed");
  assert.deepEqual(report.rounds[0].deferred, [{ taskId: "T2", reason: "dependency-wait" }]);
  assert.deepEqual(report.rounds[1].started, [{ taskId: "T2" }]);
});
