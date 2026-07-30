# Parallel Task Scheduler Tasks

## Execution Plan

| Task | Deliverable | Depends on | Verification |
| --- | --- | --- | --- |
| T1 | Feature artifacts (spec, context, design, tasks, handoff) | None | `pnpm agent:check` |
| T2 | Executor root-task support (`dependencyTaskIds: []`), `normalizeTask` export, scheduler input and graph validation (SCH-03) | T1 | Unit tests |
| T3 | Engine: bounded concurrent fan-out, dependency order, scope serialization (SCH-01, SCH-02, SCH-04) | T2 | Integration tests |
| T4 | Failure and cancellation semantics (SCH-05, SCH-08) | T3 | Integration tests |
| T5 | ScheduleReport evidence and shared budget meter (SCH-06, SCH-07) | T4 | Integration tests |
| T6 | `index.ts` export, gates, handoff and STATE.md update | T5 | `pnpm gate:quick`, `pnpm agent:check` |

## Gate Commands

| Level | Command |
| --- | --- |
| Quick | `pnpm gate:quick` |

## Completion Rules

- Tests derive from the spec acceptance criteria; fakes extend the
  `tests/helpers/task-executor-fixture.mjs` pattern in a new scheduler
  fixture; no live drivers.
- `task-executor.ts` changes are limited to the root-task relaxation and
  the `normalizeTask` export.
- No new runtime dependency.

## Execution Evidence

| Task | Status | Evidence |
| --- | --- | --- |
| T1 | Done | spec.md, context.md, design.md, tasks.md, handoff.md; `pnpm agent:check` PASS |
| T2 | Pending | |
| T3 | Pending | |
| T4 | Pending | |
| T5 | Pending | |
| T6 | Pending | |
