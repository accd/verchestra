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

- Schema changes only through `schemas/` and the generator.
- No new runtime dependency; price table is tracked data.
- Qualification evidence recorded under `docs/qualification/` as task T68b.

## Execution Evidence

| Task | Status | Evidence |
| --- | --- | --- |
| T1 | Pending | — |
| T2 | Pending | — |
| T3 | Pending | — |
| T4 | Pending | — |
| T5 | Pending | — |
