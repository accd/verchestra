# Verifier usage recorded tasks

One task and one pull request.

## Execution Plan

| Task | Deliverable | Requirements | Depends on | Verification |
| --- | --- | --- | --- | --- |
| T1 | The verifier spends from the run's ledger and its usage is recorded there when it is metered: `RunCheckpoints#recordBudgetLedger`, `meterOnRunLedger`, the promise-free repair state of `RuntimeCheckpointStore`, and `TaskRunComposition#verify` inside the metered work; the end-to-end totals corrected; `docs/quick-start.md`, the governed task design and the decision record | VUR-01..12 | None | `tests/integration/task-verifier-usage.test.mjs`, `tests/integration/task-run-checkpoints.test.mjs`, `tests/integration/runtime-checkpoint-store.test.mjs`, the locality scan, the journeys in `tests/e2e/task-cli-e2e.test.mjs` |

## Gate Commands

| Level | Command |
| --- | --- |
| Quick | `pnpm gate:quick` |
| Architecture | `pnpm test:architecture` |
| Build | `pnpm gate:build` |
| Security | `pnpm gate:security` |
| Task journeys | `node --test tests/e2e/task-cli-e2e.test.mjs tests/e2e/mediated-task-execution-e2e.test.mjs` |
| Task composition and security | `node --test tests/unit/task-cli-composition.test.mjs tests/security/task-cli-security.test.mjs` |
| Fault injection | `pnpm test:fault` |
| Readiness | `pnpm agent:check` |
| Site projection | `pnpm site:check` |

## Status

| Task | Commit | Status |
| --- | --- | --- |
| T1 | `97785fe` | Done |

Evidence for every requirement is in `validation.md`. The next action is in
`handoff.md`.
