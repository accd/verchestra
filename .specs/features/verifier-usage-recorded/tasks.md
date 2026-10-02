# Verifier usage recorded tasks

Four tasks in two pull requests: T1 alone, then T2, T3 and T4 stacked on it,
one commit each, in this order.

## Execution Plan

| Task | Deliverable | Requirements | Depends on | Verification |
| --- | --- | --- | --- | --- |
| T1 | The verifier spends from the run's ledger and its usage is recorded there when it is metered: `RunCheckpoints#recordBudgetLedger`, `meterOnRunLedger`, the promise-free repair state of `RuntimeCheckpointStore`, and `TaskRunComposition#verify` inside the metered work; the end-to-end totals corrected; `docs/quick-start.md`, the governed task design and the decision record | VUR-01..12 | None | `tests/integration/task-verifier-usage.test.mjs`, `tests/integration/task-run-checkpoints.test.mjs`, `tests/integration/runtime-checkpoint-store.test.mjs`, the locality scan, the journeys in `tests/e2e/task-cli-e2e.test.mjs` |
| T2 | The implementer's usage is recorded as it arrives: `recordingMeter` on the repair loop's meter, and the stage of a run without a repair state taken from its gate checkpoint; the requirements of T2–T4 | VUR-13..17, VUR-20 | T1 | `tests/integration/task-run-usage.test.mjs`, `tests/integration/task-run-checkpoints.test.mjs`, the locality scan, the kill-and-resume journeys in `tests/e2e/task-cli-e2e.test.mjs` |
| T3 | A budget stop names itself: metered work the budget stopped fails the run with the budget's own code | VUR-18 | T2 | `tests/integration/task-run-usage.test.mjs`, `tests/integration/task-verifier-usage.test.mjs`, the ceiling journey in `tests/e2e/task-cli-e2e.test.mjs` |
| T4 | A verifier does not start when the run's ceiling was already reached; `docs/quick-start.md`, the governed task design and the decision record for T2–T4 | VUR-19 | T3 | `tests/integration/codex-verifier-session.test.mjs`, `tests/integration/task-run-usage.test.mjs`, the journey in `tests/e2e/task-cli-e2e.test.mjs` |

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
