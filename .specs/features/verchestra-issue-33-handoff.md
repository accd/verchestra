# Handoff: Issue #33 Parallel Task Scheduler

## Next Session Focus

Continue implementation of GitHub issue #33, "Parallel task scheduler over
the dependency graph." The next concrete work is T4: add and verify failure
and cancellation behavior. Then complete T5 and T6, run independent
verification, and prepare the branch for review/PR.

## Repository State

- Workspace: `/Users/brunojanuario/Documents/Projects/verchestra`
- Branch: `kimi/issue-33-parallel-task-scheduler`
- Worktree: clean at handoff creation time
- Base revision: `09a6654c26cf3a5d4c4e08ec7af006ed9c63695d`
- Current branch contains the specification commit and scheduler
  implementation commits; inspect `git log --oneline` and `git diff
  upstream/main...HEAD` rather than relying on this summary.
- The fork/upstream remote setup was configured earlier; do not expose or
  copy credentials. Inspect remotes before any push.

## Canonical References

Do not recreate these contents from this document. Read them from the
repository:

- Issue: https://github.com/accd/verchestra/issues/33
- Contribution rules: https://github.com/accd/verchestra?tab=contributing-ov-file
- Feature specification: `.specs/features/parallel-task-scheduler/spec.md`
- Feature context and approved assumptions: `.specs/features/parallel-task-scheduler/context.md`
- Feature design: `.specs/features/parallel-task-scheduler/design.md`
- Task breakdown and gate commands: `.specs/features/parallel-task-scheduler/tasks.md`
- Tracked feature handoff: `.specs/features/parallel-task-scheduler/handoff.md`
- Repository decisions: `.specs/STATE.md`
- Existing executor: `packages/application/src/execution/task-executor.ts`
- Existing coordination primitives: `packages/application/src/coordination/work-claims.ts`
- Scheduler implementation: `packages/application/src/execution/task-scheduler.ts`
- Scheduler fixture: `tests/helpers/task-scheduler-fixture.mjs`
- Scheduler unit tests: `tests/unit/task-scheduler.test.mjs`
- Scheduler integration tests: `tests/integration/task-scheduler.test.mjs`
- Existing executor integration fixture/tests: `tests/helpers/task-executor-fixture.mjs`, `tests/integration/task-executor.test.mjs`

## Completed Work

The following work is already represented by tracked commits and should not
be repeated:

- T1 specification/design/task/handoff artifacts were created and checked by
  `pnpm agent:check`.
- T2 added root-task support, exported task normalization, scheduler envelope
  and graph validation, and validation tests.
- T3 added the scheduler engine, bounded ready-frontier fan-out, dependency
  ordering, deterministic scope serialization, public exports, fixtures, and
  integration coverage.
- A small follow-up commit added the `TaskSchedulerError` import/predicate to
  the scheduler integration test in preparation for cancellation assertions.

Use the commit history and diff for exact file-level details.

## Verification Already Run

- Scheduler validation and executor integration tests: 20/20 passed after T2.
- Scheduler engine, validation, and executor tests: 24/24 passed after T3.
- Full unit suite: 1,684/1,684 passed during T3 verification.
- TypeScript typecheck passed after fixing optional `AbortSignal` handling and
  stale narrowing of `AbortSignal.aborted`.
- Prettier was run on changed TypeScript and test files.
- `pnpm agent:check` passed for the T1 specification artifacts.

The full integration suite reported 75 failures on the macOS environment.
These were unrelated existing real-adapter failures. A clean-tree check of
the Git worktree adapter reproduced its `VES_GIT_WORKTREE_ESCAPE` failures
before the scheduler changes; the temporary-directory symlink behavior is an
environment limitation on this machine. Do not weaken or skip those tests.

## Remaining Tasks

Follow `.specs/features/parallel-task-scheduler/tasks.md`:

1. **T4: Failure and cancellation semantics**
   - Add integration tests for the approved A1 behavior: a task failure halts
     new launches, in-flight tasks settle, and remaining dependents/outstanding
     tasks are reported as blocked.
   - Add pre-aborted and mid-flight `AbortSignal` tests for SCH-08.
   - Use deterministic driver gates/signals in
     `tests/helpers/task-scheduler-fixture.mjs`; never use flaky timing waits.
   - Run targeted scheduler tests, typecheck, and the task gate before the
     atomic T4 commit.

2. **T5: Schedule report and shared budget meter**
   - Add the report's final budget snapshot and create/thread one shared
     run-scoped meter through every task execution.
   - Use the existing budget APIs in
     `packages/application/src/execution/budget-meter.ts` and
     `model-price-table.ts`; do not create a second budget implementation.
   - Add behavior-focused tests proving one declared ceiling spans tasks and
     that the report records exact outcomes, coordination references,
     change digests, deferral reasons, and budget evidence.

3. **T6: Final integration and verification**
   - Update the tracked feature handoff frontmatter/body with completed task
     evidence and the exact next action.
   - Update `.specs/STATE.md` only by replacing the Handoff section if the
     repository handoff convention still requires it; preserve all Decisions.
   - Update task/spec traceability and execution evidence.
   - Run `pnpm agent:check` and `pnpm gate:quick`.
   - Run applicable focused unit/integration tests and record exact counts.
   - Dispatch a fresh verifier after the last implementation task. The
     verifier must perform spec-anchored coverage, a discrimination sensor in
     scratch state, and write `.specs/features/parallel-task-scheduler/validation.md`.
   - If verification finds gaps, create bounded fix tasks and re-run the
     verifier; do not declare completion from self-assessment alone.

## Implementation Constraints

- Preserve the assumptions in `context.md` unless the user explicitly changes
  them: in-flight tasks settle after a sibling failure; width is caller-
  supplied and bounded; authority is a shared run envelope; scope overlap is
  path equality/containment; the report is returned but not signed; scheduler
  resume is out of scope.
- Tests must derive from the specification, not mirror implementation details.
- Do not weaken, delete, skip, or quarantine existing tests.
- Keep one atomic commit per task using Conventional Commits.
- Avoid unrelated changes and new dependencies.
- The repository requires human review before merge, release, or deployment.

## Suggested Skills

- `tlc-spec-driven`: resume the task-by-task execution contract, update
  traceability, run per-task gates, and perform mandatory final verification.
- `codebase-design`: use if the scheduler's concurrency/failure seam or report
  contract needs redesign before implementing T5.
- `tdd`: useful for the deterministic failure/cancellation tests in T4 and the
  shared-budget behavior in T5.
- `code-review`: invoke after the implementation is complete to review the
  branch against `upstream/main` for regressions and spec deviations.
- `handoff`: invoke again only if the work pauses before T6 is complete.

## First Actions

1. Read root/scoped `AGENTS.md`, `.specs/STATE.md` Decisions, and the feature
   artifacts listed above.
2. Run `git status --short --branch`, `git rev-parse HEAD`, and inspect the
   current diff/commit range.
3. Read the existing scheduler engine and tests before editing.
4. Implement T4 only, state assumptions/files/success criteria, run its tests,
   and commit atomically.
