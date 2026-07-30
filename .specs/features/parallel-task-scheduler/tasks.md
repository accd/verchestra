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
| T7 | Close the independent verifier's coverage gaps (SCH-01 partial drain, SCH-02 supplied order, SCH-03 through `execute()`) | T6 | Integration tests + mutation re-run |
| T8 | Cover SCH-02's cross-round conflict arm and record deferral-only rounds so no scheduling decision is lost | T7 | Integration tests + mutation re-run |
| T9 | Strengthen the cross-round assertion to exact round evidence, and correct the falsified determinism constraint | T8 | Integration tests + mutation re-run |

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
| T2 | Done | `packages/application/src/execution/task-executor.ts`, `packages/application/src/execution/task-scheduler.ts` (input/graph validation), `tests/unit/task-scheduler.test.mjs` |
| T3 | Done | `packages/application/src/execution/task-scheduler.ts` (engine, planner, report shell), `tests/integration/task-scheduler.test.mjs` |
| T4 | Done | Failure (SCH-05) and cancellation (SCH-08) integration tests in `tests/integration/task-scheduler.test.mjs`; `tests/helpers/task-scheduler-fixture.mjs` gained a per-task release outcome. `pnpm gate:quick` PASS (1684 unit + 96 readiness tests) |
| T5 | Done | `task-scheduler.ts` creates one run-scoped `BudgetMeter` and threads it into every `execute()` via `options.budgetMeter`; report gained `budgetSnapshot`. Tests: shared-ceiling stop, no-budget absence, deep-frozen full-evidence report. Discrimination sensor: removing the shared meter is killed by the SCH-07 test (`completed` instead of `failed`) |
| T6 | Done | `index.ts` scheduler exports verified present; `pnpm gate:quick` PASS (1684 unit + 96 readiness); `pnpm agent:check` PASS; scheduler/executor suites 45/45; spec traceability, tasks evidence, and feature handoff updated |
| T7 | Done | Verifier iteration 1 gap closure: three tests added for the two surviving mutants (SCH-01 width after a partial drain, SCH-02 taskId order independent of input order) and SCH-03's "before any task starts" through `execute()`. Both mutants re-run and now killed; `validation.md` written |
| T8 | Done | Verifier iteration 2 gap closure: test for SCH-02's cross-round arm (a task becoming ready while a scope-overlapping task is in flight) killed the surviving N1 mutant, and exposed that the deferral decision reached no round. Per user decision, a round is now recorded for starts OR deferrals; `design.md` determinism section updated. Scheduler suites 24/24, targeted 46/46, `pnpm gate:quick` + `pnpm agent:check` PASS |
| T9 | Done | Verifier iteration 3 gap closure: the cross-round test's `includes` assertion was replaced with exact `deepEqual` on rounds 2 and 3, killing both a mutant that named the running task as the deferred one and one that froze the `round` ordinal. Independently reproduced the falsified determinism constraint (4 tasks at width 2: 2 rounds batched vs 3 rounds serial, identical `outcomes`); per user decision `spec.md` and `design.md` now scope deterministic, digest-bearing evidence to `outcomes` + `budgetSnapshot` and describe `rounds` as an observational log. Scheduler suites 24/24, targeted 46/46, gates PASS |
