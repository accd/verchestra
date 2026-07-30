---
schema: verchestra-feature-handoff/v1
feature: parallel-task-scheduler
issue: 33
status: in_progress
branch: kimi/issue-33-parallel-task-scheduler
baseRevision: 09a6654c26cf3a5d4c4e08ec7af006ed9c63695d
lastCompletedTask: T6
nextTask: none
lastGate: pnpm gate:quick
updatedAt: 2026-07-30T20:14:40Z
---

# Scope

Build the deferred external-review item R7 (issue #33): a scheduler that
runs the ready frontier of an atomic-task dependency graph concurrently
through the existing `TaskExecutionCoordinator`, serializes tasks whose
change scopes overlap in deterministic `taskId` order, and returns a
deep-frozen scheduling report with per-round decisions and per-task
outcomes.

# Completed Evidence

T1: specification, context (six approved gray-area decisions A1-A6),
design, and task breakdown written from verified code reading. Recon
findings that shaped the spec: the executor processes one task per
`execute()` call; `dependencyTaskIds` is declared and validated but
consumed nowhere else; executor normalization rejects an empty
`dependencyTaskIds`, so root tasks cannot exist until that relaxes; the
coordination claim is acquired inside `execute()`, so a `coordinationRef`
is only knowable at completion; the executor accepts a caller-supplied
`options.budgetMeter` (T68b precedent), which is the SCH-07 seam.

T2: relaxed `task-executor.ts` normalization to allow `dependencyTaskIds:
[]` (root tasks), exported `normalizeTask`, and added
`packages/application/src/execution/task-scheduler.ts` input/envelope
normalization and graph validation (SCH-03: duplicate taskId, dangling
dependency, self-dependency, cycle via Kahn's algorithm, empty task list,
out-of-bound `maxConcurrentTasks`) with unit tests in
`tests/unit/task-scheduler.test.mjs`.

T3: added the scheduler engine (`TaskScheduleCoordinator`) with the pure
`planRound` planner, bounded ready-frontier fan-out through
`TaskExecutionCoordinator.execute()`, deterministic scope-conflict
serialization by `taskId` (SCH-01, SCH-02), dependency ordering (SCH-04),
and the report shell. Fixture `tests/helpers/task-scheduler-fixture.mjs`
and integration coverage in `tests/integration/task-scheduler.test.mjs`
(gated driver releases prove concurrency, width bound, scope conflict,
and dependency ordering deterministically, no timing waits).

T4: added integration tests proving SCH-05 (a task failure halts new
launches, lets in-flight siblings settle, marks every transitive
dependent `blocked`, and records exact outcomes/errorCode) and SCH-08
(a pre-aborted `AbortSignal` fails closed with zero driver calls before
`normalizeTaskSchedule` even runs; a mid-flight abort propagates to every
in-flight execution, ends the report `cancelled` with
`VES_EXECUTOR_CANCELLED` per outcome, and blocks unstarted tasks). The
engine logic for both behaviors already existed from T3; T4 added the
missing spec-anchored coverage. Extended
`tests/helpers/task-scheduler-fixture.mjs`'s `release(taskId, outcome)`
to accept a driver outcome (e.g. `{ status: "failed", outputRefs: [] }`)
so failure/cancellation can be driven deterministically through the same
gate mechanism as the existing concurrency tests. Also fixed a
pre-existing lint failure in the same fixture file (two unused
`authority.verify` parameters) that was blocking `pnpm gate:quick` before
any T4 change. `pnpm gate:quick` PASS: 1684 unit + 96 readiness tests,
0 failed.

T5: the scheduler now builds exactly one run-scoped `BudgetMeter` from
`input.budgets` (`createBudgetMeter` + the canonical `modelPriceTable`)
and threads it into every concurrent `execute()` through
`options.budgetMeter`, so the executor's own per-call meter construction
is bypassed and one declared ceiling spans the whole schedule (SCH-07).
`TaskScheduleReport` gained the optional `budgetSnapshot`, emitted
whenever a meter exists (SCH-06/A5). Tests: two tasks each consuming 500
of 1000 declared tokens (90% threshold) — neither trips alone, their sum
stops the second with `VES_EXECUTOR_BUDGET_EXCEEDED` and the snapshot
reports `consumedTokens: 1000`, `usageEvents: 2`,
`stopReason: "token-threshold"`; a budget-free schedule reports no
snapshot; a five-task graph records all three deferral reasons
(`scope-conflict:T1`, `dependency-wait`, `concurrency-limit`) in one
round plus per-task `coordinationRef`/`changeDigest`, with the report,
rounds, outcomes, and snapshot all deep-frozen. The fixture driver now
forwards `usage` events through the executor's `reportUsage` seam.

T6: verified the scheduler's public exports were already in
`packages/application/src/index.ts` (added with T3) and that
`BudgetSnapshot` is exported there too, so `TaskScheduleReport` resolves
for consumers with no index change. Gates: `pnpm gate:quick` PASS
(1684 unit + 96 agent-readiness, 0 failed), `pnpm agent:check` PASS,
typecheck and Prettier clean, and the scheduler/executor suites at 42/42
(`tests/unit/task-scheduler.test.mjs`,
`tests/integration/task-scheduler.test.mjs`,
`tests/integration/task-executor.test.mjs`,
`tests/fault-injection/task-executor-faults.test.mjs`).

Discrimination sensor (scratch state, reverted): replacing the threaded
`budgetMeter` option with an empty spread let T2 complete instead of
failing on the shared ceiling, and the SCH-07 test killed the mutant.

T7: an independent verifier returned FAIL on test coverage (the
implementation was correct on all eight criteria; two contract clauses
had no discriminating test). Two mutants had survived the suite:
dropping `- running.size` from `freeSlots`, which lets a third task run
at width 2 after a partial drain, and deleting the ready-set `taskId`
sort, which silently degrades SCH-02's deterministic order to input
order. Three integration tests closed the gaps: a four-task schedule at
width 2 asserting exactly one further start per release; conflicting
tasks supplied T2-first proving T1 still wins the round; and an invalid
graph rejected through `execute()` with zero driver and coordination
calls (SCH-03's "before any task starts", previously only proven against
`normalizeTaskSchedule` directly). Both mutants were re-injected and are
now killed. Scheduler and executor suites 45/45; `pnpm gate:quick` and
`pnpm agent:check` PASS. Full verification evidence is in
`.specs/features/parallel-task-scheduler/validation.md`.

T8: a second verifier pass found one more surviving mutant — forcing
`conflictWithRunning` to `undefined` (the cross-round arm of the scope
check) passed the whole suite, because every existing conflict test
resolved its conflict inside a single round. A task that became ready
while a scope-overlapping task was still in flight could therefore have
started concurrently with it, which is exactly what SCH-02 forbids. The
new test (T1 claiming T3's scope, T3 released by T2 settling while T1
still runs) kills it.

Writing that test surfaced a real spec/design conflict: the engine only
recorded a round when a batch launched, so T3's `scope-conflict:T1`
deferral reached no round of the report at all. SCH-06 requires per-round
deferral reasons and issue #33 requires evidence of scheduling decisions,
while `design.md` had documented the launch-only rule. The user chose to
record deferral-only rounds; the engine now pushes a round when the
planner produced starts *or* deferrals, and `design.md`'s determinism
section was updated to state the rule and why. The round count stays
bounded because the loop plans once per settled batch, and no existing
round index or length assertion changed.

Mutants re-injected and confirmed killed against the final tree: the
cross-round conflict check, the ready-set `taskId` sort, and
`freeSlots` ignoring `running.size` (each 23 pass / 1 fail against a
24/24 baseline).

T9: a third verifier pass found the new cross-round test asserted
`reasons.includes("scope-conflict:T1")` over a flattened list, which
pinned neither the round nor the deferred task — a mutant recording the
*running* task as the deferred one passed 24/24. The assertion is now an
exact `deepEqual` on round 2 (`started: []`, the exact deferral) and
round 3, which also kills a mutant that froze the `round` ordinal at 1.

The same pass falsified `spec.md`'s determinism constraint, which was
independently reproduced before acting on it: four independent tasks at
width 2 record two rounds when the first pair settles in one drain and
three when they settle separately, with byte-identical `outcomes` both
ways. This is pre-existing engine behavior from T3, not a T5-T8
regression, but the deferral-only rounds expose more of it. The user
chose to scope the guarantee rather than redesign the engine: `spec.md`
and `design.md` now state that `outcomes` and `budgetSnapshot` are
deterministic and digest-bearing (assumption A5), while `rounds` is an
observational log whose segmentation follows real settle batching, with
within-round contents and order still decided by `taskId` and never by a
race. Two `design.md` sentences that contradicted this ("rounds stay
deterministic", "concurrent interleaving never leaks into the evidence")
were corrected in the same change.

Verifier robustness note, deliberately not actioned: the engine only
awaits its settled queue and never subscribes to the abort event, so a
driver that ignores the propagated signal would keep the schedule open.
That is assumption A1 working as approved (in-flight tasks settle), not
a spec violation; changing it would need A1 revisited with the user.

# Next Exact Action

Implementation is complete for T1-T6. The remaining work is review, not
code: run the independent verifier to produce
`.specs/features/parallel-task-scheduler/validation.md`, then commit the
work as atomic per-task commits and open the pull request against
`upstream/main` linking issue #33. Human review is mandatory before
merge.

Issue #33's own acceptance criteria were re-read from GitHub and are a
subset of SCH-01..SCH-08: independent tasks run concurrently with
per-task claims (SCH-01), conflicting tasks serialize (SCH-02), and
evidence records scheduling decisions (SCH-06). No additional
implementation is outstanding against the issue.

# Blockers

None.

# Decisions

- A1: a failing task halts new launches, in-flight tasks settle, and
  transitive dependents become `blocked`.
- A2: the caller supplies `maxConcurrentTasks` (safe integer 1..100).
- A3: one shared run envelope (digests, approval, grants) plus a task
  array; no per-task authority in v1.
- A4: scope overlap is path equality or containment, matching the
  executor's `within()` rule; the per-task claim stays the backstop.
- A5: evidence is the returned report plus the final meter snapshot;
  sealing belongs to the issue #64 wiring.
- A6: no mid-graph scheduler resume in v1; per-task checkpoints already
  recover tasks.

# Files Intentionally Left Unchanged

- `.specs/STATE.md`: its `Handoff` section still records the in-progress
  `external-review-triage` feature on `main` (T6/T7 open). Overwriting it
  from this feature branch would destroy another feature's in-flight
  state on merge, and this repository's canonical per-feature handoff is
  this file. The `Decisions` log needs no new entry: A1-A6 are feature
  assumptions recorded in `context.md`, not repository-level decisions.

- `work-claims.ts`: the scheduler never builds claims itself; per-task
  claims stay inside the existing executor coordination path.
- Evidence layer (capsules, packages): the report is digest-ready but
  unsealed by design until #64 wires a producer.
