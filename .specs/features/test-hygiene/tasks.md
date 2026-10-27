# Test hygiene (#598): tasks

| Task | Deliverable                                                                                                                  | Verification                                                                | Status                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| T1   | TST-005: the five timing tests wait on an event or compare a ratio                                                           | the tests themselves; the mutants in `validation.md`                        | Complete (`eb0d31e`)                                                                          |
| T2   | TST-006: `survivingMutants` named reserved in the contract and the evidence                                                  | `tests/agent-readiness/release-decision.test.mjs`, the evidence golden test | Complete (`bd2aaeb`)                                                                          |
| T3   | TST-007: on-demand coverage named in `CONTRIBUTING.md`                                                                       | `tests/unit/coverage-lcov.test.mjs` (from #610)                             | Complete (`b3a2dc6`)                                                                          |
| T4   | Required checks green on the pull request head, including the POSIX-only probe-host and SIGTERM tests, then maintainer merge | CI                                                                          | Complete: #618 merged at `b3a2dc6`, run 40478961889 green on `1301f76`; no independent review |

## Delivery rule

Merge only after review and every required check green on the exact head.
