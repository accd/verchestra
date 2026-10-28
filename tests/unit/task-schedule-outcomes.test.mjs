import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TaskScheduleCoordinator,
  TaskSchedulerError
} from "../../packages/application/src/execution/task-scheduler.ts";

import { flush, scheduleInput, scheduleTask, schedulerPorts } from "../helpers/task-scheduler-fixture.mjs";

// Unit-level outcomes of one schedule run: the rounds it records, how each
// settled task becomes an outcome, and how a failure or a cancel ends the run.

const schedulerError = (code) => (error) => error instanceof TaskSchedulerError && error.code === code;
const BUDGETS = { maximumCostUsd: 10, maximumTokens: 100_000, maximumDurationMs: 600_000 };

test("a dependent task runs in a later round and both outcomes carry their claim and change", async () => {
  const { ports, release } = schedulerPorts();
  const pending = new TaskScheduleCoordinator(ports).execute(
    scheduleInput([scheduleTask("T2", { dependencies: ["T1"] }), scheduleTask("T1")])
  );
  await flush();
  release("T1");
  await flush();
  release("T2");
  const report = await pending;
  assert.equal(report.status, "completed");
  assert.deepEqual(report.rounds, [
    { round: 1, started: [{ taskId: "T1" }], deferred: [{ taskId: "T2", reason: "dependency-wait" }] },
    { round: 2, started: [{ taskId: "T2" }], deferred: [] }
  ]);
  assert.deepEqual(report.outcomes, [
    { taskId: "T1", status: "completed", coordinationRef: "coordination:T1", changeDigest: "sha256:" + "5".repeat(64) },
    { taskId: "T2", status: "completed", coordinationRef: "coordination:T2", changeDigest: "sha256:" + "5".repeat(64) }
  ]);
  assert.equal(Object.isFrozen(report.rounds[0].started[0]), true);
  assert.equal("budgetSnapshot" in report, false);
});

test("a failed task halts the schedule and blocks the tasks that never started", async () => {
  const { state, ports, release } = schedulerPorts();
  const pending = new TaskScheduleCoordinator(ports).execute(
    scheduleInput([scheduleTask("T1"), scheduleTask("T2", { dependencies: ["T1"] }), scheduleTask("T3")], {
      maxConcurrentTasks: 1
    })
  );
  await flush();
  release("T1", { status: "failed" });
  const report = await pending;
  assert.equal(report.status, "failed");
  assert.deepEqual(state.started, ["T1"]);
  assert.deepEqual(report.outcomes, [
    { taskId: "T1", status: "failed", errorCode: "VES_EXECUTOR_DRIVER_FAILED" },
    { taskId: "T2", status: "blocked" },
    { taskId: "T3", status: "blocked" }
  ]);
  assert.equal(report.rounds.length, 1);
});

test("an error that is not an executor error is recorded as a driver failure", async () => {
  const { ports } = schedulerPorts({
    context: {
      compile: async () => {
        throw new Error("context store unavailable");
      }
    }
  });
  const report = await new TaskScheduleCoordinator(ports).execute(scheduleInput([scheduleTask("T1")]));
  assert.equal(report.status, "failed");
  assert.deepEqual(report.outcomes, [{ taskId: "T1", status: "failed", errorCode: "VES_EXECUTOR_DRIVER_FAILED" }]);
});

test("an executor error keeps its own stable code in the outcome", async () => {
  const { ports } = schedulerPorts({
    context: { compile: async () => ({ contextRef: "context:001", contextDigest: "sha256:" + "9".repeat(64) }) }
  });
  const report = await new TaskScheduleCoordinator(ports).execute(scheduleInput([scheduleTask("T1")]));
  assert.equal(report.status, "failed");
  assert.deepEqual(report.outcomes, [{ taskId: "T1", status: "failed", errorCode: "VES_EXECUTOR_CONTEXT_INVALID" }]);
});

test("a task its driver reports cancelled ends the whole schedule cancelled", async () => {
  const { ports, release } = schedulerPorts();
  const pending = new TaskScheduleCoordinator(ports).execute(
    scheduleInput([scheduleTask("T1"), scheduleTask("T2", { dependencies: ["T1"] })])
  );
  await flush();
  release("T1", { status: "cancelled" });
  const report = await pending;
  assert.equal(report.status, "cancelled");
  assert.deepEqual(report.outcomes, [
    { taskId: "T1", status: "failed", errorCode: "VES_EXECUTOR_CANCELLED" },
    { taskId: "T2", status: "blocked" }
  ]);
});

test("an abort after a task settles stops new launches and ends the schedule cancelled", async () => {
  const { state, ports, release } = schedulerPorts();
  const controller = new AbortController();
  const pending = new TaskScheduleCoordinator(ports).execute(
    scheduleInput([scheduleTask("T1"), scheduleTask("T2", { dependencies: ["T1"] })]),
    { signal: controller.signal }
  );
  await flush();
  controller.abort();
  release("T1");
  const report = await pending;
  assert.equal(report.status, "cancelled");
  assert.deepEqual(state.started, ["T1"]);
  assert.deepEqual(
    report.outcomes.map((outcome) => [outcome.taskId, outcome.status]),
    [
      ["T1", "failed"],
      ["T2", "blocked"]
    ]
  );
});

test("an already aborted signal refuses the schedule before it is read", async () => {
  const controller = new AbortController();
  controller.abort();
  const { state, ports } = schedulerPorts();
  await assert.rejects(
    new TaskScheduleCoordinator(ports).execute({ not: "a schedule" }, { signal: controller.signal }),
    schedulerError("VES_SCHEDULER_CANCELLED")
  );
  assert.deepEqual(state.started, []);
});

test("declared budgets produce one meter whose snapshot ends the report", async () => {
  const { ports, release } = schedulerPorts();
  const pending = new TaskScheduleCoordinator(ports).execute(scheduleInput([scheduleTask("T1")], { budgets: BUDGETS }));
  await flush();
  release("T1");
  const report = await pending;
  assert.equal(report.status, "completed");
  assert.equal(typeof report.budgetSnapshot, "object");
  assert.notEqual(report.budgetSnapshot, null);
});

test("two ready tasks with overlapping scopes start one round apart in taskId order", async () => {
  const { state, ports, release } = schedulerPorts();
  const pending = new TaskScheduleCoordinator(ports).execute(
    scheduleInput([scheduleTask("T2", { scope: ["packages/application/src"] }), scheduleTask("T1")])
  );
  await flush();
  assert.deepEqual(state.started, ["T1"]);
  release("T1");
  await flush();
  release("T2");
  const report = await pending;
  assert.deepEqual(report.rounds[0].deferred, [{ taskId: "T2", reason: "scope-conflict:T1" }]);
  assert.deepEqual(report.rounds[1].started, [{ taskId: "T2" }]);
});
