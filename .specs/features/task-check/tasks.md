# Task check: tasks

| Task | What | Requirements | Proof |
| --- | --- | --- | --- |
| T1 | Move `providerModels` and `requireModelsPricedForApiKey` out of `task-run.ts` into `task-provider-models.ts`, unchanged, so `task check` does not load the run composition | — (refactor) | `tests/integration/task-run-prerequisites.test.mjs`, `tests/e2e/task-cli-e2e.test.mjs` and `tests/e2e/task-coordinated-e2e.test.mjs` pass unchanged |
| T2 | `vestra task check`: `task-check.ts`; a presence-only `requireCredentialBound`; `readRequest` exported; the handler and the manifest entry (`mutating: false`); the command enumerations of `cli-surface`, `sealed-launcher-closure` and `cli-launchers-e2e` gain it | TCK-01 to TCK-06 | `tests/e2e/task-check-e2e.test.mjs` (6 journeys on every platform the fixture serves); the three enumeration tests |
| T3 | README task section and exit-code row 4, the quick start step 6, the CHANGELOG; this spec, the handoff and the validation | TCK-07 | `tests/agent-readiness/beta-tester-docs.test.mjs` (the exit-code table keeps its nine rows); `agent:check` |
