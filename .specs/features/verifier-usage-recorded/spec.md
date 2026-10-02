# Verifier usage recorded

## Problem

A governed task meters two providers against one set of declared ceilings. The
repair loop saves the implementer's budget ledger in its repair state when a
gate attempt ends (`packages/application/src/execution/gate-repair.ts`). For
verification, `TaskRunComposition#verify` (`apps/vestra-cli/src/task/task-run.ts`)
built a meter from that ledger, and `meterUsage`
(`apps/vestra-cli/src/task/task-codex.ts`) recorded every Codex usage event on
it and stopped the verifier at a ceiling. Nothing saved that meter's ledger
afterwards.

So a run reported fewer tokens than it spent:

- `task status` and the Run Capsule reported the implementer's usage alone.
  The end-to-end journeys pinned 18 tokens for a run whose two labeled fakes
  report 18 and 8.
- A run with the implementer on a subscription and the verifier on an API key
  reported `not billed (subscription)`, with no cost for the billed provider.
- A run the verifier's usage stopped ended `FAILED` with a ledger that named
  no ceiling.
- A verification repeated by `resume` built its meter from the implementer's
  ledger again, so what the interrupted verification had spent no longer
  counted against the ceilings.

## Vocabulary

Every artifact of this feature uses these terms exactly: module, interface,
implementation, depth, seam, adapter, leverage, locality.

The **run's ledger** is the `budgetLedger` of the latest repair state of a run,
a `repair` checkpoint in the runtime store. The **Run record module** is
`apps/vestra-cli/src/task/task-run-record.ts`; its checkpoint projections are
`RunCheckpoints`. The **budget module** is
`apps/vestra-cli/src/task/task-budget.ts`. **Metered work** is work that spends
outside the repair loop; today that is verification.

## Requirements

- **VUR-01** — WHEN a usage event of metered work is metered THEN the meter's
  ledger SHALL be recorded as the run's ledger before the next event is read,
  so that a process killed after the event leaves the usage in the runtime
  store.
- **VUR-02** — WHEN the run's ledger is recorded outside the repair loop THEN
  the stage, the attempt count and the attempt chain of the latest repair state
  SHALL stay as the loop left them and only the ledger SHALL change. IF the run
  has no repair state THEN the ledger SHALL be filed under stage `converged`
  with no attempt recorded.
- **VUR-03** — WHEN metered work ends, by returning or by failing, THEN the
  ledger SHALL be recorded once more, so the time spent after the last usage
  event and a duration ceiling reached without one are on the run's ledger.
- **VUR-04** — WHEN metered work starts THEN its meter SHALL continue from the
  run's ledger. A verification that is repeated SHALL therefore add its own
  usage once, keep what an interrupted verification spent, and spend from the
  same ceilings as the repair attempts and every earlier verification.
- **VUR-05** — IF a ledger has fewer tokens, usage events or unbilled tokens,
  or less cost, than the run's recorded ledger THEN recording it SHALL be
  refused with `VES_TASK_STATE_INVALID`, reason `VES_TASK_STATE_MISMATCH`. IF
  it is not a ledger THEN it SHALL be refused with reason
  `VES_TASK_STATE_MALFORMED`. In both cases nothing SHALL be stored.
- **VUR-06** — IF recording the ledger fails THEN the failure SHALL be raised
  as itself and SHALL NOT be read as a budget stop.
- **VUR-07** — `task status` SHALL report the run's ledger under
  `checkpoints.budget`: the usage of the implementer and of the verifier.
- **VUR-08** — The Run Capsule's `budgetEvidence` SHALL carry the run's ledger.
  Its members, the capsule schema version and the digest rules SHALL NOT
  change, and a capsule sealed before this feature SHALL verify as it did.
- **VUR-09** — Usage of a model reached through a subscription SHALL stay
  unbilled: tokens and duration, no cost. Usage of a model reached with an API
  key SHALL cost what the model price table says. A run with one of each SHALL
  be reported as `mixed`.
- **VUR-10** — WHEN the run's usage reaches a ceiling during verification,
  through the verifier's usage alone or through the implementer's and the
  verifier's together, THEN the verifier SHALL be stopped as budget exceeded
  and the run's ledger SHALL name the ceiling.
- **VUR-11** — Only the budget module SHALL record a ledger on the Run record,
  and the task composition SHALL verify inside the budget module's metered
  work, so the verifier is handed no meter that is not on the run's ledger.
- **VUR-12** — The repair state SHALL be readable and recordable without a
  promise, under the same checks as the repair state port.

### T2–T4 — the run's account is complete

T1 left three gaps, recorded as open points in `validation.md`: a run killed
during a gate attempt lost what its implementer had reported; a verifier was
started when the run's ceiling was already reached; and a run the verifier's
budget stopped failed with the code every task failure shares. T2, T3 and T4
close them.

- **VUR-13** (T2) — WHEN a usage event of the implementer is metered THEN the
  repair loop's meter SHALL record its ledger as the run's ledger before the
  next event is read, through the same Run record projection the verifier's
  usage is recorded through, so that a run killed during an attempt keeps what
  the attempt had reported.
- **VUR-14** (T2) — IF the run has no repair state when its ledger is recorded
  THEN the ledger SHALL be filed with no attempt recorded, under stage
  `converged` when the gate checkpoint says the task is committed and under
  stage `repair` otherwise. This replaces the second sentence of VUR-02.
- **VUR-15** (T2) — WHEN a run is resumed THEN the repair loop's meter SHALL
  continue from the run's ledger, so the usage an interrupted attempt recorded
  is counted once: an attempt resumed at its gate adds nothing, and an attempt
  that runs its implementer again adds that session's usage.
- **VUR-16** (T2) — A provider session that was ended before it reported usage
  has nothing to record, and nothing SHALL be recorded or estimated for it.
  `docs/quick-start.md` SHALL say so.
- **VUR-17** (T2) — IF recording the ledger of an implementer's usage fails
  THEN the run SHALL fail with that failure's code and the attempt SHALL NOT
  go on to its gate.
- **VUR-18** (T3) — WHEN work metered on the run's ledger fails as a task
  failure whose reason is `VES_EXECUTOR_BUDGET_EXCEEDED` or a `VES_BUDGET_*`
  code THEN the run SHALL fail with that reason as its code, the code the
  implementer's path reports for the same stop. Every other failure SHALL keep
  the code it had. No code SHALL be added.
- **VUR-19** (T4) — IF the run's meter already says stop when the verifier
  session is about to start THEN the session SHALL be refused with reason
  `VES_EXECUTOR_BUDGET_EXCEEDED` before a session directory, an identity
  directory or a Codex process exists, and the run's ledger SHALL name the
  ceiling.
- **VUR-20** (T2) — Every meter the task composition builds SHALL record on
  the run's ledger. This extends VUR-11 to the repair loop's meter.

## Constraints

- No second store, no file in the Run directory, no checkpoint kind and no
  migration. The golden values recorded for ADP-2
  (`tests/unit/task-run-record.test.mjs`) pass unmodified.
- No public error code is added. The runtime error catalog stays at 19 codes,
  the task error catalog at 10, and the migration count at 12.
- No dependency is added.
- The Run Capsule's shape, schema version and digest rules do not change.
- `packages/application` (the meter, the repair loop, the executor, the task
  run coordinator) is not changed by T2–T4.

## Out of scope

- Usage a provider never reported. Claude Code reports usage when its session
  ends and Codex when its turn ends, so a session killed before that leaves
  nothing to record (VUR-16).
- The duration an interrupted attempt took after its last recorded usage
  event. The loop records the time when an attempt ends.
- Stopping a converged attempt whose duration ceiling passed during its gates.
  The repair loop does not; the run then fails at verification (VUR-19).
- A member in `budgetEvidence` that says what the block covers.
- The live task pilot's pre-registration, which names `status.checkpoints.budget`
  "Implementer usage". It is listed in `validation.md` and not edited here.
