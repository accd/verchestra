# Budget Enforcement Tasks

## Execution Plan

| Task | Deliverable | Depends on | Verification |
| --- | --- | --- | --- |
| T1 | `BudgetMeterPort` contract + error codes | None | Contract tests |
| T2 | Accumulator consuming `usage.updated`; threshold validation (BUD-01, BUD-06) | T1 | Unit tests |
| T3 | Versioned model price table + unknown-model fail-closed (BUD-02) | T1 | Unit + security tests |
| T4 | Executor integration: cost and duration stops via cancel + checkpoint (BUD-03, BUD-04) | T2, T3 | Fault-injection tests |
| T5 | Capsule evidence: declared versus consumed budget (BUD-05) | T4 | Schema regeneration + e2e test |

## Gate Commands

| Level | Command |
| --- | --- |
| Quick | `pnpm gate:quick` |
| Full | `pnpm gate:full` |
| Security | `pnpm gate:security` |

## Completion Rules

- Error codes are pattern-validated public errors; capsule evidence extends the hand-written validator (D2 precedent), since no generated schema covers either.
- No new runtime dependency; price table is tracked data.
- Qualification evidence recorded under `docs/qualification/` as task T68b.

## Execution Evidence

| Task | Status | Evidence |
| --- | --- | --- |
| T1 | Done | budget-meter.ts contract + 3 public codes |
| T2 | Done | 17 unit tests: accumulator, thresholds, first-reason retention |
| T3 | Done | model-price-table.ts, versioned, HUMAN REVIEW flagged; unknown model fails closed |
| T4 | Done | 9 fault-injection tests: flood, silent driver, precedence |
| T5 | Done | Run Capsule budgetEvidence, 9 integration tests |
