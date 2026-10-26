# Architecture hygiene (#597): tasks

| Task | Deliverable                                                                                                                         | Verification                                                                              | Status                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------- |
| T1   | ARQ-008: `MAXIMUM_RUN_PAYLOAD_BYTES` exported; tests reach both payload store refusals; the limits documented in the quick start    | `tests/unit/execution-payload-store.test.mjs`                                             | Complete (`0c4d0b8`)            |
| T2   | ARQ-007: `budgetLedgerProblem` shared by the meter and the stored-ledger reader; `runtime-store.ts` uses `TERMINAL_WORKFLOW_STATES` | `tests/unit/budget-ledger-rule.test.mjs`                                                  | Complete (`adc88a6`, `20b36d4`) |
| T3   | ARQ-003: a bound on every child process outside a provider session, a named code for each timeout                                   | `tests/unit/child-bounds.test.mjs`, `tests/architecture/bounded-child-processes.test.mjs` | Complete (`b727a3f`)            |
| T4   | ARQ-005: the three barrel cycles broken; a cycle detector over the production graph                                                 | `tests/architecture/no-import-cycles.test.mjs`                                            | Complete (`4ccae4d`)            |
| T5   | ARQ-006: the three doubles moved to `src/testing.ts`; an entry-point walker                                                         | `tests/architecture/no-test-doubles-in-entry-points.test.mjs`                             | Complete (`76b62ff`)            |
| T6   | Required checks green on the pull request head, review, and maintainer merge                                                        | CI                                                                                        | Pending                         |

## Delivery rule

Merge only after review and every required check green on the exact head.
