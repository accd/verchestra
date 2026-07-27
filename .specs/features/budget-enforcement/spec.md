# Budget Enforcement Specification

## Problem Statement

Execution Packages declare `budgets.maximumCostUsd` and
`budgets.maximumDurationMs`
(`packages/evidence/src/execution-package/execution-package.ts:97-100`), but
nothing reads them during execution: the fields are parsed, bounded, and
digested, then ignored. Meanwhile every qualified driver (Claude Code,
Codex, OpenCode, Pi) already emits `usage.updated` events carrying
`inputTokens`/`outputTokens` — the raw material flows and is discarded. For
a harness that runs agents with deferred human approval, unbounded cost
runaway is failure mode number one, and today the declared ceiling is a
dead field.

## Goals

- A per-run meter that accumulates token usage from driver `usage.updated`
  events and converts it to cost through a versioned per-model price table.
- Enforcement: execution stops at a configured percentage of the declared
  ceiling, in a recoverable state.
- Duration enforcement against `maximumDurationMs` with the same
  recoverability.
- Actual spend sealed into run evidence so the package's declared budget and
  the consumed budget are both auditable.

## Out of Scope

| Exclusion | Reason |
| --- | --- |
| Provider billing API reconciliation | `usage.updated` self-reports are the qualified boundary; billing APIs are unqualified surfaces. |
| Cross-run or organizational budget pools | Per-run enforcement first; aggregation is a later feature. |
| `maximumTokens` context priority budgets | Different concept (context compiler), owned by `.specs/features/context-tokenizers/`. |
| Price-table auto-update from the network | Versioned, reviewed, tracked data only. |

## Acceptance Criteria

1. **BUD-01** — WHEN a driver emits `usage.updated` during a run THEN the
   run's accumulator SHALL record input and output tokens attributed to the
   declared model, and runs with no usage events SHALL record zero.
2. **BUD-02** — WHEN accumulated usage is priced THEN the price table
   version and per-model rates SHALL be recorded in the run evidence, and
   an unknown model SHALL fail closed (execution stops with a distinct
   error, never silently free).
3. **BUD-03** — WHEN projected or accumulated cost reaches the enforcement
   threshold (a configured percentage of `maximumCostUsd`, default 90%)
   THEN execution SHALL stop through the existing cancellation path
   (`task-executor.ts` driver cancel + checkpoint) with a recoverable
   `budget-exceeded` state, never a hard process kill.
4. **BUD-04** — WHEN elapsed run time reaches the equivalent threshold of
   `maximumDurationMs` THEN execution SHALL stop with the same recoverable
   semantics as BUD-03.
5. **BUD-05** — WHEN a run completes or stops THEN the Run Capsule SHALL
   carry the actual token usage, computed cost, price-table version, and
   the declared budgets, so an auditor can compare ceiling versus actual.
6. **BUD-06** — WHEN a package declares budgets THEN validation SHALL
   reject enforcement thresholds outside `(0, 100]` and non-positive
   ceilings, preserving the existing bounded-number discipline of
   `execution-package.ts:550-594`.

## Design Constraints

- Enforcement happens in the application layer where driver events are
  already consumed; the evidence layer only records outcomes.
- No new runtime dependency; prices are tracked, versioned data.
- Stopping for budget uses the same abort/checkpoint machinery as
  cancellation — idempotent reconciliation, not blind retry.
- Usage figures are provider self-reports; evidence records them as claims,
  consistent with the existing sanitized-claims discipline.

## Requirement Traceability

| Requirement | Task | Status |
| --- | --- | --- |
| BUD-01 | T2 | Pending |
| BUD-02 | T3 | Pending |
| BUD-03, BUD-04 | T4 | Pending |
| BUD-05 | T5 | Pending |
| BUD-06 | T2 | Pending |

## Success Criteria

- A runaway run demonstrably stops at the threshold with a recoverable
  checkpoint, proven by fault-injection tests with a synthetic
  token-flooding driver.
- Every capsule shows declared versus consumed budget.
