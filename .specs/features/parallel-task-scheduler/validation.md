# Parallel Task Scheduler Validation

Independent verification of the parallel task scheduler (issue #33).
The verifier is not the author and re-derived coverage from `spec.md`
rather than from the author's traceability table. Four verification
passes ran; this document records the final state.

## Verdict: PASS

All eight acceptance criteria SCH-01 through SCH-08 hold, each with a
located assertion whose value matches the spec's stated outcome, and each
protected by at least one mutation that the suite kills. Every finding
raised across the three failing iterations is resolved: two were closed
by tests, one exposed a real defect that was fixed in the implementation,
and one was escalated and settled by an explicit user decision that is
now written into the spec. `gate:quick` and `agent:check` pass.

One limitation is carried forward deliberately, with the user's decision
recorded: `rounds` is an observational log whose segmentation follows
real settle batching, so it is not a digest surface. `outcomes` and
`budgetSnapshot` are. This is stated in `spec.md`'s Design Constraints
and `design.md`'s Determinism section, and it matches measured
behaviour.

Two cosmetic documentation residuals remain and are listed at the end.
Neither contradicts the code, and both are superseded by the more
specific constraint in the same document; they do not hold the verdict.

## Iteration history and resolution of every finding

| # | Finding | Raised | Severity | Resolution | Verified |
| --- | --- | --- | --- | --- | --- |
| M3 | Ready-set `taskId` sort unasserted — dropping the sort left ready order equal to input order, and the suite passed | It. 1 | Contract clause with no evidence | Test added: conflicting tasks supplied out of `taskId` order (`tests/integration/task-scheduler.test.mjs:80`) | Killed in it. 2, 3 and final |
| M5 | Concurrency ceiling unasserted after a partial drain — the in-flight set could reach 3 against a declared width of 2 | It. 1 | Contract clause with no evidence | Test added: four tasks at width 2, one release at a time (`:55`) | Killed in it. 2, 3 and final |
| SCH-03 boundary | "Before any task starts" proven only structurally; no coordinator-level assertion | It. 1 | Minor | Test added: cyclic graph through `execute()`, asserting `state.started` and `state.calls` are both empty (`:140`) | Passing |
| N1 | Scope conflict against an **in-flight** task unasserted — every conflict test decided its conflict inside one round, so two overlapping scopes could run concurrently and the suite passed | It. 2 | High — the arm SCH-02 exists to protect | Test added (`:106`), built to the verifier's probe shape | Killed in it. 3 and final |
| Round recording | Writing the N1 test proved deferrals decided in a round that starts nothing reached no round at all, so the scope-conflict decision was absent from the evidence | It. 3 | **Real defect**, not a doc nit | Implementation fixed: `plan.start.length > 0` → `plan.start.length > 0 \|\| plan.deferred.length > 0`; `design.md` Determinism rewritten | Mutant P1 (revert) killed |
| P4 | The cross-round test used `reasons.includes(...)`, so a deferral naming the running task as the deferred task passed 24/24 | It. 3 | Corrupt evidence undetected | Assertion strengthened to exact `deepEqual` on `rounds[1]` and `rounds[2]` (`:132-137`) | Killed, 23 pass / 1 fail |
| P2 | The `round` ordinal was never asserted anywhere; freezing it to the constant `1` survived | It. 3 | Minor | Closed by the same `deepEqual`, which pins `round: 2` and `round: 3` | Killed, 23 pass / 1 fail |
| Determinism | `spec.md` claimed identical graph plus identical outcomes produce an identical report and that round contents and orderings never depend on wall-clock races. Falsified on unmutated code: four tasks at width 2 give two rounds batched, three rounds serial, with byte-identical `outcomes` | It. 3 | Spec statement false against shipped code | Escalated with redesign offered as the alternative. **User decided to scope the guarantee rather than redesign the engine.** `spec.md` and `design.md` now separate digest-bearing evidence (`outcomes`, `budgetSnapshot`) from `rounds` as an observational log, and cite the 2-vs-3-round measurement | Wording re-read and confirmed against measured behaviour; **carried forward as an accepted limitation** |
| P3 | Draining the settled queue one entry at a time changes round segmentation and survives the suite | It. 3 | Reclassified | Not a defect under the scoped guarantee — round segmentation is explicitly no longer promised. Retained as a **known equivalent mutant** with respect to the spec | Still survives, correctly |

## Scope covered

- Commit range `09a6654..a443ae0` (feature commits `1d5e488`,
  `5f2af8a`, `033ba71`, `68faddf`, `a443ae0`).
- Plus the uncommitted working tree, which is the real deliverable:
  `packages/application/src/execution/task-scheduler.ts`,
  `tests/helpers/task-scheduler-fixture.mjs`,
  `tests/integration/task-scheduler.test.mjs` (15 cases), and the spec,
  design, tasks, and handoff updates.
- Commits `f15100e..7d030b5` in the same range are prior T68a
  qualification and CI work, unrelated to this feature.
- Executable delta against HEAD, confirmed by diff and unchanged since
  iteration 3: the shared run-scoped `BudgetMeter` and `budgetSnapshot`,
  and the one round-recording condition. Nothing else.
  `sha256:84ab30826b614a2c3bfeb2b3bc0eb8a030458a0f0ab33aa4c7fb56c84e6b63f4`.
- `tests/integration/task-scheduler.test.mjs` is `+291 / -0` against
  HEAD. No `.skip`, `.only`, or `.todo` in any scheduler suite.

## Acceptance criteria evidence

Line numbers are the final working tree.

| AC | Evidence | Asserted outcome | Covered |
| --- | --- | --- | --- |
| SCH-01 | `tests/integration/task-scheduler.test.mjs:15-19` — `state.started` is `["T1","T2"]` with both tasks parked at their driver gates, and the claim list is exactly `["acquire:T1","acquire:T2"]` | Two independent tasks in flight at once, each through its own `execute()` and its own coordination claim | Yes |
| SCH-01 (width bound) | `:41,44,49-52` first batch capped at 2 with `rounds.length === 2`; `:63,68,71,76-77` four tasks at width 2, started grows `["T1","T2"] → +T3 → +T4` one release at a time, `rounds[1].started` `[{T3}]`, `rounds[1].deferred` `[{T4,"concurrency-limit"}]` | The in-flight set never exceeds `maxConcurrentTasks`, in the first round and after a partial drain | Yes |
| SCH-02 (same round) | `:161,164,168` — containment scopes; `started` is `["T1"]` while T1 is in flight; deferred `[{T2,"scope-conflict:T1"}]` | Two ready tasks with overlapping scopes never run together | Yes |
| SCH-02 (`taskId` order) | `:85-88,91-95,98,102-103` — tasks supplied `[T2, T1]` with the identical scope `["packages/application/src"]`, so `taskId` is the only discriminator; `started` is `["T1"]`, the only claim is `acquire:T1`, `rounds[0]` starts `[{T1}]` and defers `[{T2,"scope-conflict:T1"}]` | The lower `taskId` wins the round regardless of input order | Yes |
| SCH-02 (across rounds) | `:119,123,126` — T1 claims T3's scope, T3 depends on T2; after T2 settles `started` stays `["T1","T2"]` although a slot is free, and becomes `["T1","T2","T3"]` only after T1 settles. `:132-137` — `rounds[1]` equals `{ round: 2, started: [], deferred: [{ taskId: "T3", reason: "scope-conflict:T1" }] }` and `rounds[2]` equals `{ round: 3, started: [{ taskId: "T3" }], deferred: [] }` | A task that becomes ready while a scope-overlapping task is in flight waits for it, and that decision is recorded with the right task, reason, and ordinal | Yes |
| SCH-03 | `tests/unit/task-scheduler.test.mjs:20,27,34,41,49,53-60,63-71,73-77` (duplicate, dangling, self, cycle, empty, out-of-bound width, malformed envelope, invalid task); `tests/integration/task-scheduler.test.mjs:147-149` — a cyclic graph through `TaskScheduleCoordinator.execute()` rejects typed with `state.started` and `state.calls` both `[]` | Every enumerated invalid form throws a typed `TaskSchedulerError`, and nothing starts and no port is touched | Yes |
| SCH-04 | `:177,180,184-185` — `started` is `["T1"]` before `release("T1")`, `["T1","T2"]` after; round 1 defers `T2` as `dependency-wait`, round 2 starts it | A dependent task starts only after its dependency completes | Yes |
| SCH-05 | `:196,201-218` — status `failed`, `rounds.length === 1`, `state.started` still `["T1","T2"]`, outcomes `[["T1","failed"],["T2","completed"],["T3","blocked"]]`, `t1.errorCode === "VES_EXECUTOR_DRIVER_FAILED"`, `t2.coordinationRef === "coordination:T2"`, `t3.coordinationRef === undefined`; `:231,234-243` — a failed root leaves `T2` and `T3` `blocked` with `state.started` still `["T1"]` | Nothing new launches, the in-flight sibling settles and reports its own evidence, every transitive dependent is `blocked` | Yes |
| SCH-06 (rounds) | `:355-361` — `rounds[0].started` `[{T1},{T4}]`, `rounds[0].deferred` `[{T2,"scope-conflict:T1"},{T3,"dependency-wait"},{T5,"concurrency-limit"}]`; `:132-137` — a deferral decided in a round that starts nothing reaches the report in full | All three deferral reason forms recorded, and deferral-only decisions are not dropped | Yes |
| SCH-06 (outcomes) | `:363-372` — every outcome carries `coordinationRef` and `changeDigest`; `errorCode` at `:214` (`VES_EXECUTOR_DRIVER_FAILED`), `:277-284` (`VES_EXECUTOR_CANCELLED`), `:303-309` (`VES_EXECUTOR_BUDGET_EXCEEDED`); `blocked` outcomes carry neither (`:218`, `:282`) | AWAITING_GATE tasks carry coordination and change evidence; failed tasks carry the executor error code | Yes |
| SCH-06 (deep-frozen) | `:373-379` — `Object.isFrozen` on `report`, `rounds`, `rounds[0]`, `rounds[0].started[0]`, `outcomes`, `outcomes[0]`, `budgetSnapshot` | The report is frozen at every level a consumer reaches | Yes |
| SCH-07 | `:302-315` — two 500-token tasks against a declared 1000: `T1` `completed`, `T2` `failed` with `VES_EXECUTOR_BUDGET_EXCEEDED`, `budgetSnapshot.consumedTokens === 1000`, `usageEvents === 2`, `stopReason === "token-threshold"`; `:326` — no declared budgets yields `budgetSnapshot === undefined` | One meter spans the schedule and its final snapshot is in the report | Yes |
| SCH-08 (pre-aborted) | `:252-257` — rejects `VES_SCHEDULER_CANCELLED`, `state.started` and `state.calls` both `[]` | Fails before any task starts and before any port is touched | Yes |
| SCH-08 (mid-flight) | `:269,274-284` — status `cancelled`, `rounds.length === 1`, `state.started` still `["T1","T2"]`, outcomes `[["T1","failed","VES_EXECUTOR_CANCELLED"],["T2","failed","VES_EXECUTOR_CANCELLED"],["T3","blocked",undefined]]` | The signal reaches every in-flight `execute()`, in-flight work settles, unstarted work is blocked | Yes |
| Design constraint (root tasks) | `tests/integration/task-executor.test.mjs:125-132`; `tests/unit/task-scheduler.test.mjs:15` | The executor relaxation is exercised on both paths | Yes |
| Design constraint (deterministic evidence) | `:363-372` and `:302-315` pin `outcomes` and `budgetSnapshot` content and order; within-round order pinned at `:355-361` and `:132-137` | The digest-bearing surfaces are `taskId`-ordered and race-free | Yes, as scoped |

## Necessity and integrity of the test suite

Fifteen integration cases and nine unit cases; every one maps to a
criterion, and no test maps to nothing. No duplication that is not
justified: `:55` extends `:33` past the first drain, `:80` and `:161`
test different discriminators, `:106` covers the cross-round arm neither
of them reaches, and `:140` reaches SCH-03 through `execute()` where the
unit tests reach it through `normalizeTaskSchedule`.

No assertion was weakened, skipped, or deleted at any point. Verified by
reading every round assertion in the final file rather than by trusting a
diff:

| Line | Assertion | Status |
| --- | --- | --- |
| `:49` | `report.rounds.length === 2` | Exact, unchanged since iteration 1 |
| `:50-52`, `:76-77`, `:102-103` | `rounds[N].started` / `.deferred` | Exact, unchanged |
| `:132-137` | `rounds[1]` and `rounds[2]` whole-object equality | **Strengthened** from `reasons.includes(...)` |
| `:168`, `:184-185` | `rounds[0].deferred`, `rounds[1].started` | Exact, unchanged |
| `:203` | `report.rounds.length === 1` (SCH-05) | Exact, unchanged |
| `:275` | `report.rounds.length === 1` (SCH-08) | Exact, unchanged |
| `:355-361` | `rounds[0].started`, `rounds[0].deferred` | Exact, unchanged |

Both `rounds.length` equalities survive the round-recording change on
their own merits: in the SCH-05 and SCH-08 cases the schedule halts, so
no further planning happens. A scan for loose assertion forms
(`assert.ok`, `assert.notEqual`, `assert.match`, `.includes(`) finds
none; the only `assert.equal(x, true)` calls are the seven
`Object.isFrozen` checks, where that form is correct. `+291 / -0`
against HEAD; zero deletions.

## Discrimination sensor

Every mutation was applied to a scratch copy of
`packages/application/src/execution/task-scheduler.ts`, run against
`tests/unit/task-scheduler.test.mjs` and
`tests/integration/task-scheduler.test.mjs`, then reverted. Thirteen
distinct behaviour-level mutations were injected across the four passes.
Final-tree baseline: 24 tests, 24 pass.

| # | Mutation | It. 1 | It. 2 | It. 3 | Final |
| --- | --- | --- | --- | --- | --- |
| M1 | `pathsOverlap` reduced to equality | Killed | — | — | — |
| M2 | `halt = true` removed on task failure | Killed | — | — | — |
| M3 | ready-set `.sort(byTaskId)` dropped | **Survived** | Killed | Killed | Killed |
| M4 | pre-aborted signal check removed | Killed | — | — | — |
| M5 | `freeSlots` ignores `running.size` | **Survived** | Killed | Killed | Killed |
| M6 | intra-round conflict check removed | Killed | — | — | — |
| N1 | conflict check against in-flight tasks removed | — | **Survived** | Killed | Killed |
| N2 | width bound off by one (`>` for `>=`) | — | Killed | — | — |
| N3 | outcomes in settle order | — | Killed | — | — |
| N4 | deferrals in discovery order | — | Killed | — | — |
| P1 | round-recording fix reverted to launch-only | — | — | Killed | Killed |
| P2 | `round` ordinal frozen to the constant `1` | — | — | **Survived** | Killed |
| P3 | settled queue drained one entry at a time | — | — | **Survived** | Survives — equivalent under the scoped guarantee |
| P4 | cross-round deferral names the in-flight task as deferred | — | — | **Survived** | Killed |
| P5 | `if (!halt)` planning guard removed | — | — | Killed | — |

Final-pass detail: P4, P2, N1, M3, M5, and P1 each fail the suite at
23 pass / 1 fail, and each is killed by the test written for it rather
than by an unrelated case. P3 changes only round segmentation, leaves
`outcomes` and `budgetSnapshot` identical, and is therefore an equivalent
mutant with respect to the guarantee the spec now makes.

## Accepted limitation: `rounds` is not a digest surface

Measured on the unmutated implementation, four independent tasks at
`maxConcurrentTasks: 2` with identical task outcomes:

- The first two tasks settling in one drain batch — two rounds; round 2
  starts `[T3, T4]` and defers nothing.
- The same graph and outcomes, settling one at a time — three rounds;
  round 2 starts `[T3]` and defers `[{T4,"concurrency-limit"}]`.

`outcomes` is byte-identical across both. Which case occurs depends on
whether two concurrent `execute()` calls resolve inside the same
microtask batch, which is real timing.

The user chose to scope the guarantee rather than redesign the engine.
`spec.md`'s Design Constraints now separate deterministic, digest-bearing
evidence (`outcomes` and `budgetSnapshot`, `sorted(taskId)`) from
`rounds` as an observational log whose segmentation follows settle
batching, while within-round contents and order stay decided by `taskId`.
`design.md`'s Determinism section states the same and cites the
2-vs-3-round measurement. The verifier re-read both end to end: the
wording matches measured behaviour, the two previously contradicting
sentences in `design.md` are gone, and the round-recording paragraph
agrees with the code (`plan.start.length > 0 || plan.deferred.length > 0`).

Round count remains bounded, measured and reasoned: six tasks with a
long-running scope holder produce six rounds with ordinals `1..6`, four
of them deferral-only. Each loop iteration either terminates or consumes
at least one settled entry, and each task launches at most once, so
`rounds.length <= tasks.length + 1` (ceiling 101). The loop awaits the
settled queue and never polls, so there is no spin.

Consequence for downstream work: issue #64's evidence sealing must digest
`outcomes` and `budgetSnapshot`, not the whole report.

## Documentation residuals (recommended, non-blocking)

Two statements outside the edited sections still describe the whole
report as digest-ready, which the new Design Constraint narrows:

- `spec.md` Goals: "A scheduling report that records every scheduling
  decision and per-task outcome as digestable run evidence."
- `spec.md` Out of Scope, sealing row: "The report is digest-ready".

`context.md`'s assumption A5 carries the same phrase, but the new
constraint names and scopes A5 explicitly, so it is already reconciled.
A clause on each of the two `spec.md` lines would remove the last
ambiguity for a reader who starts at Goals. Neither contradicts the code
and both are superseded by the more specific constraint in the same
document, so neither holds the verdict.

## Gate evidence (final)

| Command | Result |
| --- | --- |
| `corepack pnpm agent:check` | PASS |
| `corepack pnpm gate:quick` | PASS — format, lint, typecheck clean; `test:unit` 1684 tests, 1684 pass, 0 fail; `test:agent-readiness` 96 tests, 96 pass, 0 fail |
| `node --test` over unit, integration, executor-integration, and fault-injection scheduler suites | 46 tests, 46 pass, 0 fail |
| `corepack pnpm test:integration` (iteration 1) | 521 tests, 446 pass, 75 fail — all scheduler cases pass; every failure is in `memory-store`, `memory-vector-index`, `memory-lifecycle`, `gate-commit-adapters`, `git-worktree-adapter`, `sqlite-probe-adapter`, or `runtime-store`, none of which this feature touches. Pre-existing macOS real-adapter environment limitation, unrelated |

`gate:full` is the profile the CI gate-selection contract maps to
`packages/application`; locally it cannot complete because of the same
real-adapter limitation. **It must be run on Linux CI before merge.**

## Issue #33 conformance

| Issue criterion | Status |
| --- | --- |
| Independent tasks run concurrently with per-task claims | Satisfied — `:15-19`, with the width bound held through a partial drain at `:63-77` (mutants M5, N2) |
| Conflicting tasks serialize | Satisfied — same round (`:161-168`, mutants M1, M6), `taskId` order (`:91-103`, mutant M3), and against in-flight tasks (`:119-137`, mutant N1) |
| Evidence records scheduling decisions | Satisfied — all three deferral reasons, per-task outcomes with coordination, change, and error evidence, and deferral-only decisions with the right task, reason, and ordinal (`:132-137`, `:355-379`; mutants P1, P2, P4, N3, N4). Round segmentation is an accepted, documented limitation |

## Restore proof

Every mutation was reverted from a scratch backup immediately after its
run, across all four passes. After the final restore,
`packages/application/src/execution/task-scheduler.ts` hashes to
`sha256:84ab30826b614a2c3bfeb2b3bc0eb8a030458a0f0ab33aa4c7fb56c84e6b63f4`,
the value recorded before the first mutation of this pass;
`git diff --stat` shows only the author's own changes; and the 46-test
scheduler and executor suite is green. Nothing was committed, and no
implementation or test file was modified by this verification. This
document is the only file the verifier created.

## Remaining human action before merge

1. Run `gate:full` on Linux CI — the profile the gate-selection contract
   maps to `packages/application` — and confirm it passes there.
2. Optionally apply the two documentation clauses above.
3. Human review and approval, as required by `AGENTS.md`.
