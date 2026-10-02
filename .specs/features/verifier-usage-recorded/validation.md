# Validation — Verifier usage recorded

Branch `fix/verifier-usage-recorded`, one commit for the task (T1) on base
revision `bde8ad9` (`origin/main` with the three Run record hardening ranges
merged as AD-050..052). Sources are named by symbol; assertions are cited by
test file and line. Every gate result below was measured on the tree of the T1
commit after it was rebased onto that base.

## The defect, verified before any change

- By reading, at the base: `TaskRunComposition#verify` built `this.#meter(ledger)`
  from the repair checkpoint's ledger and handed it to `verifyTask`;
  `meterUsage` in `task-codex.ts` recorded each `usage.updated` event on it
  through `recordUsageAndDecide`; no caller of `verifyTask` and nothing below
  it read that meter's ledger afterwards.
- By running, at the base: the journeys of `tests/e2e/task-cli-e2e.test.mjs`
  asserted 18 tokens in `status` and in the Run Capsule and passed, while the
  labeled fake verifier (`tests/helpers/task-cli-fakes/fake-codex-task.mjs`)
  reports 5 input and 3 output tokens in every turn; the mixed journey asserted
  `not billed (subscription)` for a run whose verifier was billed.
- Where a run's usage is read: `checkpointStages` in `task-status.ts`
  (`status.checkpoints.budget`), `budgetEvidence` in `task-review.ts` (the Run
  Capsule), `TaskRunComposition#verify` (the verifier's meter), and
  `normalizeState` in `gate-repair.ts` (the repair loop's meter on `resume`).
  All four read the `budgetLedger` of the latest repair state; the first three
  through `RunCheckpoints#repair`. `task-budget.ts` holds the one check of a
  stored ledger and the two reports of it. No other reader exists, so recording
  the verifier's usage on that ledger reaches every one of them.

## T1 — requirement evidence

`U` is `tests/integration/task-verifier-usage.test.mjs`, `K` is
`tests/integration/task-run-checkpoints.test.mjs`, `S` is
`tests/integration/runtime-checkpoint-store.test.mjs`, `L` is
`tests/architecture/task-run-record-locality.test.mjs`, `E` is
`tests/e2e/task-cli-e2e.test.mjs`. `U`, `K` and `S` use a real runtime store.
The cases of `U` that run the verifier use the production session
(`runCodexVerifier`) against the labeled fake `codex`; on Windows each asserts
that the task path is refused instead. `E` runs the `vestra` binary and its
journeys run on macOS only, as before.

| Requirement | Definition (symbol) | Assertion evidence |
| --- | --- | --- |
| VUR-01 recorded when the event is metered | `meterOnRunLedger` (the recording meter), `RunCheckpoints#recordBudgetLedger`, `RuntimeCheckpointStore#recordRepair` | Read back through a second connection while the work has not ended and nothing was awaited: `U:106-126`. A real process killed after the verifier's usage: the store holds 26 tokens, 2 events, the priced cost `U:369-376`. The record is stored when the call returns `K:303`. Through the binary, a run killed while its mutation gate is held reports 26 tokens and 2 events `E:1281-1282` |
| VUR-02 only the ledger moves; no state is `converged` with no attempt | `RunCheckpoints#recordBudgetLedger`, `UNRECORDED_LOOP` | Stage, attempts and chain kept for a `converged` and a `repair` state `K:299-307`, `U:120-125`; a state without a ledger `K:321-326`; no state `K:309-319`, `U:128-138`; only its own run and task `K:388-397`; a corrupt state stops the record with the store's code `K:399-409`. Through the binary the killed run still shows `repair: converged` `E:1277` |
| VUR-03 recorded once more when the work ends | `meterOnRunLedger` (`finally`) | Time after the last usage event, for work that returns and work that fails, and the work's own result returned `U:240-268`. The duration ceiling, which no usage event reports: `duration-threshold` and the elapsed time are on the ledger `U:324-342`. The Run Capsule seals the same duration `status` printed `E:324` |
| VUR-04 a repeated verification continues from the ledger | `meterOnRunLedger` (`create(…budgetLedger)`) | The meter starts at the implementer's 18 `U:109`; a second verification starts at 26 and ends at 34 in 3 events `U:140-153`; after a real kill `U:378-385`. Through the binary: 34 tokens, 3 events, two verifier sessions, one implementer session, and the capsule seals 34 `E:1284-1302` |
| VUR-05 the ledger only grows | `continuesLedger`, `RunCheckpoints#recordBudgetLedger`, `storedBudgetLedger` | Fewer tokens, events, unbilled tokens, less cost, and a meter that started at zero are refused as `VES_TASK_STATE_MISMATCH`; `null` and `undefined` likewise; three non-ledgers as `VES_TASK_STATE_MALFORMED`; the recorded state is unchanged after each `K:358-378`. An earlier duration is recorded, and the same ledger twice is one record `K:380-385` |
| VUR-06 a failure to record is raised as itself | `meterOnRunLedger`, `recordUsageAndDecide` | The same error object leaves `recordUsageAndDecide` and the metered work `U:216-238`; a usage event the meter refuses is the meter's refusal and records nothing `U:205-214` |
| VUR-07 `status` reports the run | `checkpointStages`, `budgetStatus` | `E:284-290` (26 tokens, 26 unbilled, 2 events, `not billed (subscription)`), `E:442-446` (API keys), `E:542-545` (mixed), `E:1281-1282`, `E:1292-1296`, `E:1329-1331` |
| VUR-08 the Run Capsule carries the run's ledger, shape unchanged | `budgetEvidence`, `capsuleBudgetConsumption` | Read back from the sealed capsule: `E:319-325`, `E:450-452`, `E:548-552`, `E:1300-1302`. The three blocks a ledger maps to are the ones recorded for ADP-2 `K:176-220` (unmodified) and `K:328-356`, `U:166-174`, `U:193-202`. `packages/evidence` is not changed, and `tests/integration/run-capsule-budget-evidence.test.mjs` passes unmodified, including "a capsule without budget evidence still seals, so older runs stay valid" |
| VUR-09 unbilled stays unbilled, billed costs the table's price | `createBudgetMeter` (`unbilledModels`), `budgetStatus`, `capsuleBudgetConsumption` | Both on a subscription: cost 0, 26 unbilled, no cost in the capsule block `U:158-174`. Both on API keys: the price table's cost for both events `U:176-181`, `E:442`. One of each: the verifier's cost, the implementer's tokens unbilled, `mixed` `U:185-202`, `E:542-552` |
| VUR-10 a ceiling reached in verification | `meterUsage`, `meterOnRunLedger` | The verifier alone: 8 tokens against a ceiling of 8, `VES_EXECUTOR_BUDGET_EXCEEDED`, `token-threshold` on the ledger `U:283-297`. Together: 18 and 8 are each below 90% of 28 and 26 is not; the same turn on a meter that is not on the run's ledger returns a verdict `U:299-320`. Through the binary the run fails in verification with its task committed and the ledger names the ceiling `E:1311-1331`. Duration `U:324-342` |
| VUR-11 one caller records, and verification is the metered work | `TaskRunComposition#verify`, `meterOnRunLedger` | `L:188-198` |
| VUR-12 the repair state without a promise | `RuntimeCheckpointStore#inspectRepair`, `#recordRepair` | `S:311-344`: the same value as the port, frozen, five malformed states and a malformed identity refused, a tampered row refused. The port calls them, so the repair loop's own case (`S:281-305`) covers them as well. `L:101-103` keeps both names inside the Run record module |

### Arithmetic of the corrected totals

The labeled fake implementer reports one usage event of 11 input and 7 output
tokens; the labeled fake verifier reports one of 5 and 3.

| Journey | Before | Now | Why |
| --- | --- | --- | --- |
| Subscription, `status` and capsule (`E:284-290`, `E:319-325`) | 18 tokens, 18 unbilled | 26 tokens, 26 unbilled, 2 events | 18 + 8 |
| API keys (`E:442-452`) | a cost greater than 0 | `(11·3 + 7·15)/10⁶ + (5·1.75 + 3·14)/10⁶` USD, 26 tokens | the price table's rates for `claude-sonnet-5` and `gpt-5.2-codex`, computed in the test from the table |
| Implementer on a subscription, verifier on a key (`E:542-552`) | `not billed (subscription)` | `billing: mixed`, cost `(5·1.75 + 3·14)/10⁶` USD, 18 unbilled of 26 | the verifier's usage is billed |
| Killed during verification, then resumed (`E:1281-1302`) | — (new) | 26 at the kill, 34 in 3 events after `resume` | 18 + 8, then + 8 for the second verifier session |

## Behaviour changes

| Case | Before | Now |
| --- | --- | --- |
| `status.checkpoints.budget` and the capsule's `budgetEvidence` after verification | the implementer's usage | the run's: implementer and verifier |
| One provider on a subscription | `not billed (subscription)` (implementer on it) or a plain cost (verifier on it) | `billing: mixed` with the billed cost and the unbilled token count |
| A run the verifier's usage stops | `FAILED`, the ledger names no ceiling | `FAILED`, `stopReason` names it and the tokens include the verifier's |
| `resume` in `VERIFYING` | the verifier's meter starts from the implementer's total | it starts from what the interrupted verification recorded |
| A run with no repair state that verifies (killed between its task commit and the loop's save) | `checkpoints.repair: none`, `budget: null` | `checkpoints.repair: converged`, the verifier's ledger |
| `consumedDurationMs` | time until the loop's last save | that plus the time verification took |

The Run Capsule's shape, schema version and digest rules are unchanged, and
`packages/evidence` is untouched. A capsule sealed before this change verifies
as before and understates its run by the verifier's usage.

## Discrimination (disposable copy)

A copy of `apps/vestra-cli`, `packages`, `tests`, `schemas` and `scripts` in
an ignored scratch directory was mutated one change at a time and restored from
the tracked sources before each run; the tracked sources were never mutated.
Unmutated copy: `U`, `K`, `S`, `L` and
`tests/integration/codex-verifier-session.test.mjs`, 67 pass, 0 fail.

| Mutation in the copy | Failing cases |
| --- | --- |
| M1 — the usage event does not record the ledger (it is saved only when the work ends) | 6 in `U`, including the killed process; through the binary 1 of 41: the killed journey reads 18 where 26 were spent |
| M2 — the ledger is not recorded when the work ends | 4: the closing record, the duration ceiling, the recording failure, and the locality case |
| M3 — the composition as it was: a meter resumed from the ledger and never recorded | 1 in `L`; through the binary 5 of 41: the subscription, API-key, mixed, killed and ceiling journeys (the ceiling journey reads `stopReason: null`) |
| M4 — the record replaces the repair state instead of keeping it | 3 |
| M5 — a ledger that winds the account backwards is stored | 1 |
| M6 — the growth check ignores unbilled tokens | 1 |
| M7 — the meter does not continue from the run's ledger | 8 |
| M8 — the promise-free record skips the state checks | 2 in `S` |
| M9 — a run with no repair state is filed under `repair` | 2 |
| M10 — the ledger is recorded before the event is metered | 4 |
| M11 — a failure to record a usage event is swallowed | 1 |
| M12 — the growth check ignores the token count | 1 |
| M13 — a non-ledger is stored | 1 |
| M14 — the stored state is not inspected | 5 |

## Recorded evidence that states what this changes

Nothing immutable was edited. These tracked statements describe the reported
usage as it was:

- `.specs/features/subscription-provider-auth/validation.md` ("Known limits"):
  "The task ledger shown by `task status` holds the implementer's usage; the
  verifier's usage spends from the same ceilings and is not added to that
  ledger." True for its revision; no longer true.
- `.specs/features/live-task-pilot/spec.md` §7 (the pre-registered recording
  template) names `status.checkpoints.budget` "Implementer usage" and records
  "Verifier usage" as whatever a public surface reports, `unavailable`
  otherwise. That field now holds the run's usage, and the public surface for
  the verifier's share is the difference a reader cannot take from it. §5 (S2)
  expects that "the implementer's usage in `checkpoints.budget` did not grow
  across the resume": with this change the field grows across that resume by
  the verifier's usage. The same column is in
  `.specs/features/live-task-pilot/validation.md` (results table). No pilot run
  is recorded yet, so no recorded total changes; the template needs the
  owner's amendment before the pilot.
- No qualification report under `docs/qualification/` states a token total of
  a governed task run. `docs/qualification/` was searched for `consumedTokens`,
  `unbilledTokens`, `usageEvents` and `budgetEvidence`: no match.

## Open points for the reviewer

1. **The implementer's usage during an attempt that never ended is still
   lost.** The repair loop saves the ledger when an attempt ends. Observed
   through the binary with the labeled fakes: a run killed at its held
   implementation gate reports `budget: null`, and after `resume` (which does
   not run the implementer again) it reports 8 tokens in 1 event, the
   verifier's alone, where 26 were spent. Before this change it reported 0.
   The same record (`recordBudgetLedger`) could carry the loop's meter, with
   the stage a run without a state is filed under decided for that case. It is
   a change to the implementer path and is not made here.
   `docs/quick-start.md` states the gap.
2. **A verifier is started when the run's ceiling was already reached** (by
   reading: `runCodexVerifier` checks the meter only when a usage event
   arrives or the duration timer fires, and the repair loop does not stop a
   converged attempt). It is stopped on its first usage event, which Codex
   reports at the end of its turn. With the ledger now carried across a
   `resume`, a verification resumed after its usage reached the threshold
   spends one more session before it stops. The executor refuses to start in
   that case; the verifier does not.
3. **The reason of a run the verifier's budget stops is `VES_TASK_FAILED`.**
   Observed: `start` prints `reason: VES_TASK_FAILED`, because the task run
   coordinator takes the public error's code and drops its `reason` detail
   (`VES_EXECUTOR_BUDGET_EXCEEDED`). The ledger now names the ceiling; the
   outcome still does not. `E:1311-1331` asserts the state and the ledger and
   not that reason.
4. **Nothing in a Run Capsule says what `budgetEvidence` covers.** A capsule
   sealed before this change and one sealed after it have the same shape.
5. **A recording failure when verification ends replaces the verification's
   own failure**, and after a verification that passed it fails the command
   with the run already in `HUMAN_REVIEW`. Both need the runtime store to
   refuse a write.
6. The new suites `U`, `K`, `S` and the crash stand-in have run on macOS only.

## Guardrails

- Complexity: `pnpm complexity:check` PASS, 178 baselined keys, no entry
  changed, no new function above 10.
- Census: `pnpm census:refresh` left the inventory as it was (115 entries); no
  product source gained or lost `JSON.stringify` or `createHash`.
- Citations fixed for the lines this task moved in `task-run.ts`:
  `.specs/features/live-task-pilot/validation.md` (`:51` is now `:52`,
  `:558-559` is now `:566-567`, `:354` is now `:355`, `:594-596` is now
  `:602-604`) and `.specs/features/architecture-deepening/validation-c6.md`
  (`:331` is now `:332`). No tracked text cites a line of `task-budget.ts`,
  `task-run-record.ts` or `checkpoint-store-adapter.ts`.
- No error code was added. Migration count (12), runtime error catalog count
  (19) and task error catalog count (10) unchanged.
- The ADP-2 goldens (`tests/unit/task-run-record.test.mjs`) and the hardening
  suites pass unmodified; no stored shape in the Run directory changed.
- The digest-bound qualification reports are untouched.

## Gates (Node 24.14.0, macOS arm64)

Measured on the tree of the T1 commit (`97785fe`), run one after another.

| Command | Result |
| --- | --- |
| `node --test tests/integration/task-verifier-usage.test.mjs tests/integration/task-run-checkpoints.test.mjs tests/integration/runtime-checkpoint-store.test.mjs tests/architecture/task-run-record-locality.test.mjs tests/integration/codex-verifier-session.test.mjs tests/unit/task-run-record.test.mjs tests/unit/task-run-markers.test.mjs tests/integration/task-marker-commands.test.mjs tests/integration/task-run-containment.test.mjs tests/integration/task-review-package.test.mjs tests/integration/task-commit-recovery.test.mjs` | PASS — 219 passed |
| `pnpm gate:quick` | PASS — unit 2504, agent-readiness 323, census 13 |
| `pnpm test:architecture` | PASS — 91 |
| `pnpm gate:build` | PASS — contract 756, integration 1029, e2e 259, architecture 91, build 146, qualification 302 |
| `pnpm gate:security` | PASS — security 1339, fault 310 |
| `node --test tests/e2e/task-cli-e2e.test.mjs tests/e2e/mediated-task-execution-e2e.test.mjs` | PASS — 44 passed |
| `node --test tests/unit/task-cli-composition.test.mjs tests/security/task-cli-security.test.mjs` | PASS — 15 passed |
| `pnpm test:fault` | PASS — 310 |
| `pnpm agent:check` | PASS |
| `pnpm site:check` | PASS — 135 pages |

0 failed, 0 skipped, 0 todo in every run. No provider was called: the
implementer and the verifier are the labeled fakes. `pnpm gate:quick`,
`pnpm test:architecture` and `pnpm agent:check` were run again on the commit
that adds this file and the handoff, with the same counts.

Against the base (`bde8ad9`): integration 1009 → 1029 (twelve cases in `U`,
seven in `K`, one in `S`), e2e 257 → 259 and the task journeys 42 → 44 (the
two new journeys), architecture 90 → 91 (the locality case). No case was
deleted. Three journeys had assertions replaced, listed under "Arithmetic of
the corrected totals"; the assertions they replace pinned the defect.

# T2–T4 — the run's account is complete

Branch `fix/run-usage-complete`, one commit per task (T2, T3, T4) on base
revision `d9dc5d5` (`origin/main` with T1 merged as AD-055). The sections
above are the evidence of T1 for its own commit; their line citations are
that commit's. The citations below are the tip's. Open points 1, 2 and 3
above are closed by T2, T4 and T3.

`R` is `tests/integration/task-run-usage.test.mjs`, `V` is
`tests/integration/codex-verifier-session.test.mjs`; `U`, `K`, `L` and `E` are
as above. `R` runs a task run composed in process the way `TaskRunComposition`
composes it (`composedRun` in `tests/helpers/verifier-usage-fixture.mjs`): the
production task run coordinator, repair loop, workflow machine and budget
module over the Run record's checkpoint projections in a real runtime store.
The repair loop's meter is the recording meter and verification is the metered
work, as in the composition; only the two providers and the gate are scripted.
A provider that never returns is where a killed process leaves a run, and a
resumed run is a new composition over a new connection to the same store. `R`
needs no credential, so its cases run on every platform, except the three that
run the production verifier session against the labeled fake `codex`, which
assert the Windows refusal there. The real kill, through the `vestra` binary,
is in `E` (macOS).

## Where implementer usage can arrive

Claude Code reports usage once, in its `result` message, when its session ends
(`packages/drivers/src/claude-code-driver.ts`, the `result` branch). A run can
therefore be killed at three points relative to it:

| Point | What is recorded | After `resume` | Evidence |
| --- | --- | --- | --- |
| Before the session reported usage | nothing: there is nothing to record | the resumed sessions' usage only (26 with the fakes) | `R:149-157`; `E:961` with `recorded: null`, `E:970-972` |
| After it reported, before the attempt reached its gate | the usage, on a `repair` state with no attempt | the implementer runs again and adds its own session (18 + 18 + 8 = 44) | `R:94-106`, `R:130-144`; `E:668-670`, `E:678-682` |
| After the attempt reached its gate | the same | the attempt is resumed at its gate and adds nothing (18 + 8 = 26) | `R:108-128`; `E:614-616`, `E:627-630` |

A second attempt of a declared repair policy is the second and third row on
the state the first attempt left (`R:159-186`).

## Requirement evidence

| Requirement | Definition (symbol) | Assertion evidence |
| --- | --- | --- |
| VUR-13 the implementer's usage is recorded when it is metered | `recordingMeter`, `TaskRunComposition#repair` | Read through a second connection while the attempt has not ended: 18 tokens, 1 event, the priced cost `R:94-106`. Through the binary, a run killed at its held gate and one killed with its implementer's process still open both report 18 tokens in 1 event `E:614-616`, `E:668-670` |
| VUR-14 the stage of a run without a repair state | `RunCheckpoints#unrecordedLoop` | No gate checkpoint, `gate-failed` and `gates-passed` are `repair`; `committed` is `converged`; no attempt in either `K:312-337`. In a run: `repair` during the first attempt `R:98-103`, `converged` for a committed run whose loop saved nothing `R:365-376` |
| VUR-15 a resumed run counts an interrupted attempt once | `runGateRepairLoop` (`budget.create(state.budgetLedger)`), `recordingMeter` | Resumed at its gate: the implementer is not run, 26 tokens in 2 events, `converged` with one attempt `R:108-128`. Run again: 44 in 3 `R:130-144`. A second attempt recorded on `repair` with the first attempt's chain, then `converged` with two `R:159-186`. A ceiling the killed attempt reached stops the resumed run before another attempt `R:188-201`. Through the binary: 26 after a resume at the gate, where the run reported 8 `E:627-630`; 44 with two implementer sessions `E:674`, `E:678-682` |
| VUR-16 nothing is recorded for a session that reported nothing | — | No repair state after the kill; the resumed run's total is 26 `R:149-157`. Through the binary: `budget` is `null` after an implementer stopped before its result, and 26 after `resume`, for both signals `E:961`, `E:970-972`. `docs/quick-start.md` ("Budgets") says what cannot be recorded |
| VUR-17 a failure to record fails the run as itself | `recordingMeter` | The run fails with the store's code and the attempt does not reach its gate `R:203-217` |
| VUR-18 a budget stop names itself | `budgetStop`, `meterOnRunLedger` | The implementer's and the verifier's budget stop both end `FAILED` with `VES_EXECUTOR_BUDGET_EXCEEDED` `R:222-245`; the meter's refusal ends with the meter's code on both paths `R:247-263`; a verifier failure with another reason, another public error that carries a budget reason, an error with its own code and one with none keep their codes `R:265-284`; the production session reaching the run's ceiling `R:286-303`. The task failure is the cause, with its envelope and reason unchanged `U:103-109`, `U:295`, `U:318`, `U:338`. Through the binary: `start` prints the reason and `status` reports it `E:1401`, `E:1405`, `E:1438`; the implementer's is unchanged `E:562` |
| VUR-19 a verifier does not start on a spent budget | `runCodexVerifier` | A meter at its token ceiling and one past its duration ceiling: refused with `VES_EXECUTOR_BUDGET_EXCEEDED`, no thread, no turn, no session directory, no token spent `V:169-192`. A verification resumed after its usage reached the ceiling: the run fails as a budget stop, the fake's logs are empty, and the ledger still holds 26 tokens in 2 events, not 34 `R:309-330`. The duration ceiling passing during the gates: the attempt converges, no verifier starts, and the ledger names `duration-threshold` `R:336-363`. Through the binary: the gate is held past 90% of a 12 s ceiling, the task is committed, the run fails with the budget's code, and `fake-codex.log` and `fake-codex-turn.log` are empty `E:1419-1446` |
| VUR-20 every meter of a run records on the run's ledger | `TaskRunComposition#repair`, `#verify` | `L:188-202` |

## Behaviour changes

| Case | After T1 | Now |
| --- | --- | --- |
| `status` during an attempt, once the implementer reported usage | `checkpoints.repair: none`, `budget: null` | `repair: repair`, the implementer's usage |
| A run killed at its implementation gate, then resumed | 8 tokens, 1 event (the verifier's) | 26 tokens, 2 events |
| A run killed after its implementer reported usage and before its gate, then resumed | 26 (the second implementer session and the verifier) | 44: both implementer sessions and the verifier |
| A run killed after a usage event that reached a ceiling, then resumed | another attempt, or a verifier session, was started | `FAILED` with `VES_EXECUTOR_BUDGET_EXCEEDED` before anything is spent |
| A run whose ceiling was reached before verification | a Codex session was started and stopped on its first usage event | no Codex process; the run fails as a budget stop |
| The reason of a run a ceiling stops in verification | `VES_TASK_FAILED` | `VES_EXECUTOR_BUDGET_EXCEEDED` |
| The reason of a run whose verifier usage the meter refused | `VES_TASK_FAILED` | the meter's code (`VES_BUDGET_MODEL_UNKNOWN`, `VES_BUDGET_USAGE_INVALID`), as on the implementer's path |

The Run Capsule's shape, schema version and digest rules are unchanged, and
`packages/evidence` and `packages/application` are untouched.

## Tests replaced

No case was deleted without a replacement at the same or a wider interface.

| Replaced (T1) | Replacement |
| --- | --- |
| `K` "a run whose repair loop saved no state gets its ledger under converged with no attempt" | `K:312-337` "a run whose repair loop saved no state is filed under repair until its task is committed": the same assertion for a committed task, and `repair` for three uncommitted gate states |
| `U`: `failedWith("VES_EXECUTOR_BUDGET_EXCEEDED")` on three metered verifier sessions | `budgetExceeded` (`U:103-109`): the budget's code on the failure, and the former assertion, unchanged, on its cause |
| `L` "the verifier spends from the Run's ledger, and only the budget module records one" | `L:188-202` "every meter of a run records on the Run's ledger, and only the budget module records one": every assertion of the former plus the repair loop's meter |

`K` "usage recorded after the repair loop moves only the ledger of the latest
repair state" keeps its assertions under a title that no longer says "after
the repair loop". `U` writes the committed gate checkpoint in its setup,
because verification follows the task commit. In `E`, three existing journeys
gained assertions and none lost any. `V` and the ADP-2 and hardening suites
are otherwise unmodified.

## Discrimination (disposable copy)

The same procedure as for T1. Unmutated copy: `R`, `U`, `K`, `S`, `L` and `V`,
82 pass, 0 fail.

| Mutation in the copy | Failing cases |
| --- | --- |
| N1 — the recording meter does not record | 14, in `R`, `U` and `L` |
| N2 — the repair loop is handed a meter that records nothing (the composition as it was) | 1 in `L`; through the binary 2 of 43: the run killed at its gate and the run killed after its implementer reported usage |
| N3 — a run with no repair state is always filed under `converged` | 2 |
| N4 — a run with no repair state is always filed under `repair` | 3 |
| N5 — the verifier starts on a budget that is already gone | 3: `V:169-192`, `R:309-330`, `R:336-363`; through the binary 1 of 43: "a Codex process opened a thread" |
| N6 — a budget stop keeps the code every task failure shares | 8; through the binary 2 of 43: the ceiling journey and the journey without a verifier |
| N7 — every task failure is renamed to its reason | 1: `R:265-284` |
| N8 — the meter's refusal is not a budget stop | 1: `R:247-263` |
| N9 — any public error with a budget reason is renamed | 1: `R:265-284` |
| N10 — the refusal names the verifier, not the budget | 4 |
| N11 — the refusal comes after the session directory is made | 1: `V:169-192` |
| N12 — the stage is taken from any gate checkpoint, not a committed one | 1: `K:312-337` |

## The live task pilot's pre-registration after both pull requests

`.specs/features/live-task-pilot/` is not edited here. These statements of its
`spec.md` no longer describe what the product reports:

| Lines | Statement | What is true now |
| --- | --- | --- |
| `spec.md:475` | "Implementer usage" is `status.checkpoints.budget` as reported | `checkpoints.budget` is the run's usage: the implementer's and the verifier's, in one ledger. It is the implementer's alone only when read before verification starts |
| `spec.md:476` | "Verifier usage" is whatever a public surface reports for the Codex session, `unavailable` otherwise | The verifier's usage is public as part of `checkpoints.budget`. It is not reported apart; it is the difference between a reading taken after the implementer finished and the reading after verification |
| `spec.md:330-331` (S2) | "the implementer's usage in `checkpoints.budget` did not grow across the resume" | `checkpoints.budget` grows across that resume by the verifier's usage. What does not grow is the implementer's share: the reading of step 2 is the implementer's usage, and no second Claude Code session is counted |
| `spec.md:309-311` (S2, step 2) | "Record `checkpoints.toolReceipts` and `checkpoints.budget`" at `awaiting-gate` | Still correct, and only now meaningful: before T2 `checkpoints.budget` was `null` at that point, so there was nothing to record |

The results table of `.specs/features/live-task-pilot/validation.md` (line 57)
has the same two column names. `spec.md:402-405` (a token ceiling is checked
when a provider reports usage, so a session can overshoot) stays true. S1
(`spec.md:268-296`) cancels during the implementer and states nothing about
the budget; after T2 its `checkpoints.budget` is `null` unless Claude Code had
already reported its result.

## Open points for the reviewer (T2–T4)

1. **A converged attempt whose duration ceiling passed during its gates is
   still committed.** The repair loop does not stop a converged attempt, so
   the task commit exists when verification refuses to start. The run is
   `FAILED` with the budget's code and the task branch is kept.
2. **The time an interrupted attempt took after its last usage event is not
   recorded.** The loop records the duration when an attempt ends.
3. **A run whose verifier usage the meter refused now reports the meter's
   code** (`VES_BUDGET_MODEL_UNKNOWN`, `VES_BUDGET_USAGE_INVALID`) where it
   reported `VES_TASK_FAILED`. Both codes exist and the implementer's path
   reports them; planning refuses an unpriced model, so the first needs a
   price table that changed after the plan.
4. T1's open points 4 (nothing in a Run Capsule says what `budgetEvidence`
   covers) and 5 (a recording failure when verification ends) stand.
5. `R` and the new cases of `K`, `U`, `V` have run on macOS only.

## Guardrails (T2–T4)

- Complexity: `pnpm complexity:check` PASS, 178 baselined keys, no entry
  changed, no new function above 10.
- Census: `pnpm census:refresh` left the inventory as it was (115 entries).
- Citations: no cited line of `task-run.ts` moved (`:52`, `:332`, `:355`,
  `:566-567`, `:602-604` are where they were), and no tracked text cites a
  line of `task-codex.ts`, `task-budget.ts` or `task-run-record.ts`.
- No error code was added. Migration count (12), runtime error catalog count
  (19) and task error catalog count (10) unchanged.
- The ADP-2 goldens and the hardening suites pass unmodified.
- No variable, parameter or member in the new code or tests is named after a
  credential.

## Gates (T2–T4; Node 24.14.0, macOS arm64)

Measured on the tree of the T4 commit (`1fb2dae`), after the rebase onto
`d9dc5d5`, run one after another.

| Command | Result |
| --- | --- |
| `node --test tests/integration/task-run-usage.test.mjs tests/integration/task-verifier-usage.test.mjs tests/integration/task-run-checkpoints.test.mjs tests/integration/runtime-checkpoint-store.test.mjs tests/architecture/task-run-record-locality.test.mjs tests/integration/codex-verifier-session.test.mjs tests/unit/task-run-record.test.mjs tests/unit/task-run-markers.test.mjs tests/integration/task-marker-commands.test.mjs tests/integration/task-run-containment.test.mjs tests/integration/task-review-package.test.mjs tests/integration/task-commit-recovery.test.mjs` | PASS — 234 passed |
| `pnpm gate:quick` | PASS — unit 2504, agent-readiness 323, census 13 |
| `pnpm test:architecture` | PASS — 93 |
| `pnpm gate:build` | PASS — contract 782, integration 1056, e2e 261, architecture 93, build 146, qualification 329 |
| `pnpm gate:security` | PASS — security 1339, fault 310 |
| `node --test tests/e2e/task-cli-e2e.test.mjs tests/e2e/mediated-task-execution-e2e.test.mjs` | PASS — 46 passed |
| `node --test tests/unit/task-cli-composition.test.mjs tests/security/task-cli-security.test.mjs` | PASS — 15 passed |
| `pnpm test:fault` | PASS — 310 |
| `pnpm agent:check` | PASS |
| `pnpm site:check` | PASS — 135 pages |

0 failed, 0 skipped, 0 todo in every run. No provider was called: the
implementer and the verifier are the labeled fakes.

T2–T4 add fourteen cases in `R`, one in `V` and two journeys in `E`; `K` and
`L` each have one case replaced by one. On the trees of the T2 and T3 commits,
before the rebase, the focused suites, the task journeys (42 on each),
`pnpm gate:quick`, `pnpm test:architecture` and `pnpm agent:check` passed.
`pnpm gate:quick`, `pnpm test:architecture` and `pnpm agent:check` were run
again on the commit that adds this section, with the same counts.
