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

## Constraints

- No second store, no file in the Run directory, no checkpoint kind and no
  migration. The golden values recorded for ADP-2
  (`tests/unit/task-run-record.test.mjs`) pass unmodified.
- No public error code is added. The runtime error catalog stays at 19 codes,
  the task error catalog at 10, and the migration count at 12.
- No dependency is added.

## Out of scope

- The implementer's usage during a gate attempt that never ended. The repair
  loop saves the ledger when an attempt ends, so a run killed during an attempt
  has not saved what that attempt spent. Observed and recorded in
  `validation.md`; it needs a decision of its own.
- Refusing to start a verifier when the run's ceiling was already reached.
- The reason a run reports when the verifier's budget stops it
  (`VES_TASK_FAILED`).
- A member in `budgetEvidence` that says what the block covers.
- The live task pilot's pre-registration, which names `status.checkpoints.budget`
  "Implementer usage". It is listed in `validation.md` and not edited here.
