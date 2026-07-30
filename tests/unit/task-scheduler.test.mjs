import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeTaskSchedule, TaskSchedulerError } from "../../packages/application/src/execution/task-scheduler.ts";

import { scheduleInput, scheduleTask } from "../helpers/task-scheduler-fixture.mjs";

const schedulerError = (code) => (error) => error instanceof TaskSchedulerError && error.code === code;

test("a valid schedule with root and dependent tasks normalizes and freezes", () => {
  const input = normalizeTaskSchedule(
    scheduleInput([scheduleTask("T1"), scheduleTask("T2", { dependencies: ["T1"] })])
  );
  assert.equal(input.tasks.length, 2);
  assert.deepEqual(input.tasks[0].dependencyTaskIds, []);
  assert.equal(Object.isFrozen(input.tasks), true);
  assert.equal(Object.isFrozen(input.authority), true);
});

test("a duplicate taskId fails closed before any task starts", () => {
  assert.throws(
    () => normalizeTaskSchedule(scheduleInput([scheduleTask("T1"), scheduleTask("T1")])),
    schedulerError("VES_SCHEDULER_GRAPH_INVALID")
  );
});

test("a dependency on a task outside the set fails closed", () => {
  assert.throws(
    () => normalizeTaskSchedule(scheduleInput([scheduleTask("T1", { dependencies: ["T9"] })])),
    schedulerError("VES_SCHEDULER_GRAPH_INVALID")
  );
});

test("a task that depends on itself fails closed", () => {
  assert.throws(
    () => normalizeTaskSchedule(scheduleInput([scheduleTask("T1", { dependencies: ["T1"] })])),
    schedulerError("VES_SCHEDULER_GRAPH_INVALID")
  );
});

test("a dependency cycle fails closed", () => {
  const cyclic = scheduleInput([
    scheduleTask("T1", { dependencies: ["T2"] }),
    scheduleTask("T2", { dependencies: ["T1"] })
  ]);
  assert.throws(() => normalizeTaskSchedule(cyclic), schedulerError("VES_SCHEDULER_GRAPH_INVALID"));
});

test("an empty task list fails closed", () => {
  assert.throws(() => normalizeTaskSchedule(scheduleInput([])), schedulerError("VES_SCHEDULER_INPUT_INVALID"));
});

test("a concurrency width outside the safe bound fails closed", () => {
  for (const maxConcurrentTasks of [0, -1, 1.5, 101, "4"]) {
    assert.throws(
      () => normalizeTaskSchedule(scheduleInput([scheduleTask("T1")], { maxConcurrentTasks })),
      schedulerError("VES_SCHEDULER_INPUT_INVALID"),
      `width ${maxConcurrentTasks} must be rejected`
    );
  }
});

test("a malformed envelope fails closed", () => {
  const missingAuthority = scheduleInput([scheduleTask("T1")]);
  delete missingAuthority.authority;
  assert.throws(() => normalizeTaskSchedule(missingAuthority), schedulerError("VES_SCHEDULER_INPUT_INVALID"));
  assert.throws(
    () => normalizeTaskSchedule(scheduleInput([scheduleTask("T1")], { executionPackageDigest: "not-a-digest" })),
    schedulerError("VES_SCHEDULER_INPUT_INVALID")
  );
});

test("a task that fails executor task validation fails closed with a scheduler error", () => {
  const invalid = scheduleTask("T1");
  invalid.risk = "extreme";
  assert.throws(() => normalizeTaskSchedule(scheduleInput([invalid])), schedulerError("VES_SCHEDULER_INPUT_INVALID"));
});
