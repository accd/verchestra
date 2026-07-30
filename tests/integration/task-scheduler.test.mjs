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

test("the concurrency width still bounds the in-flight set after a partial drain (SCH-01)", async () => {
  const { state, ports, release } = schedulerPorts();
  const coordinator = new TaskScheduleCoordinator(ports);
  const input = scheduleInput([scheduleTask("T1"), scheduleTask("T2"), scheduleTask("T3"), scheduleTask("T4")], {
    maxConcurrentTasks: 2
  });
  const pending = coordinator.execute(input);
  await flush();
  assert.deepEqual(state.started, ["T1", "T2"]);
  // One task settles, so exactly one slot opens: the width is measured against
  // what is still running, not against the whole schedule.
  release("T1");
  await flush();
  assert.deepEqual(state.started, ["T1", "T2", "T3"]);
  release("T2");
  await flush();
  assert.deepEqual(state.started, ["T1", "T2", "T3", "T4"]);
  release("T3");
  release("T4");
  const report = await pending;
  assert.equal(report.status, "completed");
  assert.deepEqual(report.rounds[1].started, [{ taskId: "T3" }]);
  assert.deepEqual(report.rounds[1].deferred, [{ taskId: "T4", reason: "concurrency-limit" }]);
});

test("conflicting tasks serialize by taskId regardless of the order they are supplied in (SCH-02)", async () => {
  const { state, ports, release } = schedulerPorts();
  const coordinator = new TaskScheduleCoordinator(ports);
  // Supplied T2-first, with one identical scope so neither task is privileged
  // by shape: taskId is the only thing that can decide the order.
  const input = scheduleInput([
    scheduleTask("T2", { scope: ["packages/application/src"] }),
    scheduleTask("T1", { scope: ["packages/application/src"] })
  ]);
  const pending = coordinator.execute(input);
  await flush();
  assert.deepEqual(state.started, ["T1"]);
  assert.deepEqual(
    state.calls.filter((call) => call.startsWith("acquire:")),
    ["acquire:T1"]
  );
  release("T1");
  await flush();
  assert.deepEqual(state.started, ["T1", "T2"]);
  release("T2");
  const report = await pending;
  assert.equal(report.status, "completed");
  assert.deepEqual(report.rounds[0].started, [{ taskId: "T1" }]);
  assert.deepEqual(report.rounds[0].deferred, [{ taskId: "T2", reason: "scope-conflict:T1" }]);
});

test("a task that becomes ready mid-flight waits for the in-flight task it conflicts with (SCH-02)", async () => {
  const { state, ports, release } = schedulerPorts();
  const coordinator = new TaskScheduleCoordinator(ports);
  // T3 only becomes ready once T2 settles, and by then T1 — which claims T3's
  // scope — is still running. The conflict is against the in-flight set, not
  // against the tasks selected in the same round.
  const input = scheduleInput([
    scheduleTask("T1", { scope: ["packages/application/src/T1", "packages/application/src/T3"] }),
    scheduleTask("T2"),
    scheduleTask("T3", { dependencies: ["T2"] })
  ]);
  const pending = coordinator.execute(input);
  await flush();
  assert.deepEqual(state.started, ["T1", "T2"]);
  release("T2");
  await flush();
  // T3 is ready and a slot is free, but T1 still holds an overlapping scope.
  assert.deepEqual(state.started, ["T1", "T2"]);
  release("T1");
  await flush();
  assert.deepEqual(state.started, ["T1", "T2", "T3"]);
  release("T3");
  const report = await pending;
  assert.equal(report.status, "completed");
  // The blocked decision is evidence in its own right: a round that starts
  // nothing still names the deferred task, its reason, and its ordinal.
  assert.deepEqual(report.rounds[1], {
    round: 2,
    started: [],
    deferred: [{ taskId: "T3", reason: "scope-conflict:T1" }]
  });
  assert.deepEqual(report.rounds[2], { round: 3, started: [{ taskId: "T3" }], deferred: [] });
});

test("an invalid graph fails closed before any task starts (SCH-03)", async () => {
  const { state, ports } = schedulerPorts();
  const coordinator = new TaskScheduleCoordinator(ports);
  const cyclic = scheduleInput([
    scheduleTask("T1", { dependencies: ["T2"] }),
    scheduleTask("T2", { dependencies: ["T1"] })
  ]);
  await assert.rejects(coordinator.execute(cyclic), schedulerError("VES_SCHEDULER_GRAPH_INVALID"));
  assert.deepEqual(state.started, []);
  assert.deepEqual(state.calls, []);
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

test("a task failure halts new launches, lets in-flight siblings settle, and blocks the rest (SCH-05)", async () => {
  const { state, ports, release } = schedulerPorts();
  const coordinator = new TaskScheduleCoordinator(ports);
  const input = scheduleInput([scheduleTask("T1"), scheduleTask("T2"), scheduleTask("T3")], {
    maxConcurrentTasks: 2
  });
  const pending = coordinator.execute(input);
  await flush();
  assert.deepEqual(state.started, ["T1", "T2"]);
  release("T1", { status: "failed" });
  await flush();
  release("T2");
  const report = await pending;
  assert.equal(report.status, "failed");
  // No second round ever launches the deferred task once a sibling fails.
  assert.equal(report.rounds.length, 1);
  assert.deepEqual(state.started, ["T1", "T2"]);
  assert.deepEqual(
    report.outcomes.map((outcome) => [outcome.taskId, outcome.status]),
    [
      ["T1", "failed"],
      ["T2", "completed"],
      ["T3", "blocked"]
    ]
  );
  const t1 = report.outcomes.find((outcome) => outcome.taskId === "T1");
  assert.equal(t1.errorCode, "VES_EXECUTOR_DRIVER_FAILED");
  const t2 = report.outcomes.find((outcome) => outcome.taskId === "T2");
  assert.equal(t2.coordinationRef, "coordination:T2");
  const t3 = report.outcomes.find((outcome) => outcome.taskId === "T3");
  assert.equal(t3.coordinationRef, undefined);
});

test("a task failure marks every transitive dependent blocked without starting them (SCH-05)", async () => {
  const { state, ports, release } = schedulerPorts();
  const coordinator = new TaskScheduleCoordinator(ports);
  const input = scheduleInput([
    scheduleTask("T1"),
    scheduleTask("T2", { dependencies: ["T1"] }),
    scheduleTask("T3", { dependencies: ["T2"] })
  ]);
  const pending = coordinator.execute(input);
  await flush();
  assert.deepEqual(state.started, ["T1"]);
  release("T1", { status: "failed" });
  const report = await pending;
  assert.equal(report.status, "failed");
  assert.deepEqual(state.started, ["T1"]);
  assert.deepEqual(
    report.outcomes.map((outcome) => [outcome.taskId, outcome.status]),
    [
      ["T1", "failed"],
      ["T2", "blocked"],
      ["T3", "blocked"]
    ]
  );
});

test("a pre-aborted signal fails closed before any task starts (SCH-08)", async () => {
  const controller = new AbortController();
  controller.abort();
  const { state, ports } = schedulerPorts();
  const coordinator = new TaskScheduleCoordinator(ports);
  const input = scheduleInput([scheduleTask("T1")]);
  await assert.rejects(
    coordinator.execute(input, { signal: controller.signal }),
    schedulerError("VES_SCHEDULER_CANCELLED")
  );
  assert.deepEqual(state.started, []);
  assert.deepEqual(state.calls, []);
});

test("a mid-flight AbortSignal propagates to in-flight executions, ends the report cancelled, and blocks the rest (SCH-08)", async () => {
  const controller = new AbortController();
  const { state, ports, release } = schedulerPorts();
  const coordinator = new TaskScheduleCoordinator(ports);
  const input = scheduleInput([scheduleTask("T1"), scheduleTask("T2"), scheduleTask("T3")], {
    maxConcurrentTasks: 2
  });
  const pending = coordinator.execute(input, { signal: controller.signal });
  await flush();
  assert.deepEqual(state.started, ["T1", "T2"]);
  controller.abort();
  release("T1");
  release("T2");
  const report = await pending;
  assert.equal(report.status, "cancelled");
  assert.equal(report.rounds.length, 1);
  assert.deepEqual(state.started, ["T1", "T2"]);
  assert.deepEqual(
    report.outcomes.map((outcome) => [outcome.taskId, outcome.status, outcome.errorCode]),
    [
      ["T1", "failed", "VES_EXECUTOR_CANCELLED"],
      ["T2", "failed", "VES_EXECUTOR_CANCELLED"],
      ["T3", "blocked", undefined]
    ]
  );
});

test("one shared meter spans the schedule so earlier consumption stops a later task (SCH-07)", async () => {
  const { ports, release } = schedulerPorts();
  const coordinator = new TaskScheduleCoordinator(ports);
  // The 90% default threshold stops at 900 of the 1000 declared tokens. Each
  // task consumes 500: neither trips a per-task ceiling, only their sum does.
  const input = scheduleInput([scheduleTask("T1"), scheduleTask("T2", { dependencies: ["T1"] })], {
    budgets: { maximumCostUsd: 100, maximumTokens: 1000, maximumDurationMs: 3_600_000 }
  });
  const usage = [{ model: "claude-sonnet-5", inputTokens: 500, outputTokens: 0 }];
  const pending = coordinator.execute(input);
  await flush();
  release("T1", { usage });
  await flush();
  release("T2", { usage });
  const report = await pending;
  assert.equal(report.status, "failed");
  assert.deepEqual(
    report.outcomes.map((outcome) => [outcome.taskId, outcome.status, outcome.errorCode]),
    [
      ["T1", "completed", undefined],
      ["T2", "failed", "VES_EXECUTOR_BUDGET_EXCEEDED"]
    ]
  );
  // A per-task meter would report 500 here; 1000 proves both tasks spent from
  // the same declared ceiling.
  assert.equal(report.budgetSnapshot.consumedTokens, 1000);
  assert.equal(report.budgetSnapshot.usageEvents, 2);
  assert.equal(report.budgetSnapshot.stopReason, "token-threshold");
  assert.equal(report.budgetSnapshot.declared.maximumTokens, 1000);
});

test("a schedule that declares no budgets reports no budget snapshot (SCH-07)", async () => {
  const { ports, release } = schedulerPorts();
  const coordinator = new TaskScheduleCoordinator(ports);
  const pending = coordinator.execute(scheduleInput([scheduleTask("T1")]));
  await flush();
  release("T1");
  const report = await pending;
  assert.equal(report.status, "completed");
  assert.equal(report.budgetSnapshot, undefined);
});

test("the report is deep-frozen and records every scheduling decision and outcome (SCH-06)", async () => {
  const { ports, release } = schedulerPorts();
  const coordinator = new TaskScheduleCoordinator(ports);
  // T1 also claims T2's scope, so T2 conflicts; T3 waits on T1; T5 exceeds the
  // width of 2. One round therefore carries all three deferral reasons.
  const input = scheduleInput(
    [
      scheduleTask("T1", { scope: ["packages/application/src/T1", "packages/application/src/T2"] }),
      scheduleTask("T2"),
      scheduleTask("T3", { dependencies: ["T1"] }),
      scheduleTask("T4"),
      scheduleTask("T5")
    ],
    { maxConcurrentTasks: 2, budgets: { maximumCostUsd: 100, maximumTokens: 1000, maximumDurationMs: 3_600_000 } }
  );
  const pending = coordinator.execute(input);
  await flush();
  release("T1");
  release("T4");
  await flush();
  release("T2");
  release("T3");
  await flush();
  release("T5");
  const report = await pending;
  assert.equal(report.status, "completed");
  assert.deepEqual(report.rounds[0].started, [{ taskId: "T1" }, { taskId: "T4" }]);
  // Every deferral reason the spec names, recorded in one round.
  assert.deepEqual(report.rounds[0].deferred, [
    { taskId: "T2", reason: "scope-conflict:T1" },
    { taskId: "T3", reason: "dependency-wait" },
    { taskId: "T5", reason: "concurrency-limit" }
  ]);
  // A task that reached AWAITING_GATE carries both coordination and change evidence.
  assert.deepEqual(
    report.outcomes.map((outcome) => [outcome.taskId, outcome.status, outcome.coordinationRef, outcome.changeDigest]),
    [
      ["T1", "completed", "coordination:T1", "sha256:" + "5".repeat(64)],
      ["T2", "completed", "coordination:T2", "sha256:" + "5".repeat(64)],
      ["T3", "completed", "coordination:T3", "sha256:" + "5".repeat(64)],
      ["T4", "completed", "coordination:T4", "sha256:" + "5".repeat(64)],
      ["T5", "completed", "coordination:T5", "sha256:" + "5".repeat(64)]
    ]
  );
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.rounds), true);
  assert.equal(Object.isFrozen(report.rounds[0]), true);
  assert.equal(Object.isFrozen(report.rounds[0].started[0]), true);
  assert.equal(Object.isFrozen(report.outcomes), true);
  assert.equal(Object.isFrozen(report.outcomes[0]), true);
  assert.equal(Object.isFrozen(report.budgetSnapshot), true);
});
