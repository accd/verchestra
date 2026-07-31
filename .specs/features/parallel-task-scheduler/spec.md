# Parallel Task Scheduler Specification

## Problem Statement

`TaskExecutionCoordinator.execute()`
(`packages/application/src/execution/task-executor.ts`) runs exactly one
`AtomicExecutionTask` per call, yet every task already declares
`dependencyTaskIds` and a `changeScope`, and the work-claim machinery
already arbitrates overlapping scopes with signed fencing tokens
(`packages/application/src/coordination/work-claims.ts`). A run that closes
several atomic tasks must therefore be driven by a caller-side serial loop
even when tasks are independent: no component orders the dependency graph,
runs non-conflicting tasks concurrently, or records why a task ran,
waited, or was skipped. Deferred external-review item R7 (issue #33).

## Goals

- A scheduler that executes the ready frontier of a task dependency graph
  concurrently, bounded by a caller-declared width, reusing the existing
  per-task executor and its authority, coordination, worktree, budget, and
  checkpoint path unchanged.
- Deterministic serialization of tasks whose change scopes overlap; fail
  closed: invalid graphs never start a task.
- A scheduling report that records every scheduling decision and per-task
  outcome, with the per-task outcomes and budget snapshot forming its
  digestable run evidence.

## Out of Scope

| Exclusion | Reason |
| --- | --- |
| Mid-graph resume after a scheduler crash | Per-task checkpoints already recover a task; scheduler-level resume is a separate feature (assumption A6). |
| Sealing scheduling evidence into signed packages | The report's `outcomes` and `budgetSnapshot` are digest-ready; sealing belongs to the evidence wiring tracked in issue #64, which must digest those fields rather than the whole report. |
| Cross-run claim leasing or remote claim acquisition | Per-task claims stay inside the existing executor coordination path. |
| Parallelism inside one task (driver fan-out) | The bounded unit is the atomic task. |

## Acceptance Criteria

1. **SCH-01** — WHEN tasks whose `dependencyTaskIds` are all completed and
   whose change scopes do not overlap any in-flight scope are pending THEN
   the scheduler SHALL run up to `maxConcurrentTasks` of them
   concurrently, each through `TaskExecutionCoordinator.execute()` with
   its own per-task coordination claim.
2. **SCH-02** — WHEN two ready tasks have overlapping change scopes (equal
   paths or one path containing the other) THEN the scheduler SHALL never
   run them concurrently and SHALL order them deterministically by
   `taskId`.
3. **SCH-03** — WHEN the task set contains a duplicate `taskId`, a
   dangling dependency reference, a self-dependency, a dependency cycle,
   an empty task list, or a `maxConcurrentTasks` outside the safe bound
   THEN the scheduler SHALL fail closed with a typed `TaskSchedulerError`
   before any task starts.
4. **SCH-04** — WHEN any dependency of a task has not completed THEN the
   scheduler SHALL NOT start that task.
5. **SCH-05** — WHEN a task fails THEN the scheduler SHALL start no new
   task, let in-flight tasks settle, mark every transitive dependent
   `blocked`, and report all outcomes.
6. **SCH-06** — WHEN the schedule ends THEN the scheduler SHALL return a
   deep-frozen report recording per round which tasks started and which
   deferred with reason (`dependency-wait`, `scope-conflict:<taskId>`,
   `concurrency-limit`), and per task the final outcome (`completed`,
   `failed`, `blocked`) with `coordinationRef` and `changeDigest` when the
   task reached AWAITING_GATE and `errorCode` when it failed.
7. **SCH-07** — WHEN the run declares budgets THEN the scheduler SHALL
   thread one shared run-scoped budget meter into every concurrent
   `execute()` call and SHALL include the final meter snapshot in the
   report, so one declared ceiling spans the whole schedule.
8. **SCH-08** — WHEN the caller's AbortSignal fires THEN the scheduler
   SHALL propagate it to every in-flight execution, settle, and end the
   report with status `cancelled`; a signal already aborted before start
   SHALL fail before any task starts.

## Design Constraints

- `task-executor.ts` changes minimally: root tasks require
  `dependencyTaskIds: []` to pass executor normalization; nothing else in
  the executor changes. The T68b/T68c pull requests touch that file, so
  the scheduler lives in a new module.
- Task outcomes are data, not exceptions: invalid input throws typed
  errors; failed tasks appear in the report with status `failed`.
- Deterministic evidence: identical graph and identical task outcomes
  produce identical `outcomes` and `budgetSnapshot`, emitted in
  `sorted(taskId)` order. These are the digest-bearing parts of the
  report. Within any single round, the started set, the deferred set, and
  their orderings are decided by `taskId` sort and never by a wall-clock
  race.
- `rounds` is an observational log, not a digest surface. Round
  segmentation follows real settle batching: two tasks completing in one
  drain produce one round where two separate drains produce two. A
  faithful record of a concurrent engine cannot be otherwise without
  either serializing execution or reporting rounds that never happened,
  so assumption A5's digest-ready claim is scoped to `outcomes` and
  `budgetSnapshot`.
- No new runtime dependency; scheduling is pure application-layer
  orchestration over existing ports.

## Requirement Traceability

| Requirement | Task | Status |
| --- | --- | --- |
| SCH-03 | T2 | Done |
| SCH-01, SCH-02, SCH-04 | T3 | Done |
| SCH-05, SCH-08 | T4 | Done |
| SCH-06, SCH-07 | T5 | Done |
| All | T6 | Done |

## Success Criteria

- Integration tests prove two independent tasks overlap in flight, two
  scope-conflicting tasks never do, and a dependent task starts only
  after its dependency completes.
- A failing task blocks its transitive dependents deterministically while
  in-flight siblings settle, and the report names the exact failure and
  blocked set.
- One shared meter stops a later task once earlier consumption exhausts
  the declared ceiling.
