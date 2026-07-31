# Parallel Task Scheduler Design

## Placement

New module `packages/application/src/execution/task-scheduler.ts`,
exported through `packages/application/src/index.ts`. Application layer:
it orchestrates the existing executor and ports and owns no platform
concern.

## Components

1. **Normalization and graph validation** — the envelope mirrors
   `TaskExecutionInput` minus `task`, plus `tasks` and
   `maxConcurrentTasks`. Tasks normalize through the executor's own
   `normalizeTask` (exported; unchanged semantics apart from allowing
   `dependencyTaskIds: []`). Graph validation: unique `taskId`, every
   dependency reference exists, no self-dependency, no cycle (Kahn),
   non-empty task list.
2. **Overlap predicate** — `pathsOverlap` is equality or containment in
   either direction; `scopesOverlap` is any overlapping pair across two
   change scopes.
3. **Planner (pure)** — input: tasks, per-task state
   (`pending | running | completed | failed | blocked`), in-flight
   scopes, free slots. Output: tasks to start (sorted by `taskId`,
   non-overlapping against in-flight scopes and against each other) and
   deferrals with reason (`dependency-wait`, `scope-conflict:<taskId>`,
   `concurrency-limit`).
4. **Engine** — bounded fan-out: launches planner-selected tasks through
   one `TaskExecutionCoordinator`, threads the caller `AbortSignal` and
   one shared `BudgetMeter` (when budgets are declared) into every
   `execute()` call, and drains completions through a settled queue so
   the loop waits on real completions instead of polling. On task
   failure: halt launches, settle
   in-flight, mark transitive dependents `blocked`.
5. **Report** — deep-frozen: `status` (`completed | failed |
   cancelled`), run identity, `maxConcurrentTasks`, `rounds` (started,
   deferred with reasons), `outcomes` (per task: status,
   `coordinationRef`, `changeDigest`, `errorCode`), and the final
   `budgetSnapshot` when a meter exists.

## Failure model

- Invalid input or graph: `TaskSchedulerError`
  (`VES_SCHEDULER_INPUT_INVALID`, `VES_SCHEDULER_GRAPH_INVALID`) before
  any task starts; a pre-aborted signal: `VES_SCHEDULER_CANCELLED`.
- Task failure: recorded in the report; the schedule ends `failed`.
- Caller cancellation: propagated to in-flight executions; the schedule
  ends `cancelled`; unstarted tasks end `blocked`.

## Data flow

```
TaskScheduleInput ──normalize/validate──▶ graph (taskId → task)
      │                                        │
      │                            planner ◀── state map
      │                                │ start batch
      │                                ▼
      │                    TaskExecutionCoordinator.execute()
      │                     (authority → claim → worktree →
      │                      context → driver → inspection)
      │                                │ settled outcomes
      ▼                                ▼
        ScheduleReport (rounds + outcomes [+ budgetSnapshot])
```

## Determinism

Identical graph and task outcomes produce identical `outcomes` and
`budgetSnapshot`: ready sets are sorted by `taskId`, conflict order is
the same sort, and outcome entries are emitted in `sorted(taskId)`
order. Those are the digest-bearing parts of the report.

`rounds` is an observational log and its segmentation does follow settle
batching: four independent tasks at width 2 record two rounds when the
first pair settles in one drain and three when they settle separately,
with identical `outcomes` either way. Within a round, contents and
order are still decided by `taskId`, never by a race. See the
`rounds` constraint in `spec.md`.

A round is recorded whenever the planner produced a decision — a launch
or a deferral — not only when a batch launches. A task that becomes
ready while a scope-overlapping task is still in flight is deferred in a
round that starts nothing, and SCH-06 requires that decision to appear in
the evidence; recording launches only would drop it silently. The round
count is still bounded, because the loop plans once per settled batch.
