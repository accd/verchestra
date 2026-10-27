# Test hygiene (#598): tasks

| Task | Deliverable                                                                                                                  | Verification                                                                | Status   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| T1   | TST-005: the five timing tests wait on an event or compare a ratio                                                           | the tests themselves; the mutants in `validation.md`                        | Complete |
| T2   | TST-006: `survivingMutants` named reserved in the contract and the evidence                                                  | `tests/agent-readiness/release-decision.test.mjs`, the evidence golden test | Complete |
| T3   | TST-007: on-demand coverage named in `CONTRIBUTING.md`                                                                       | `tests/unit/coverage-lcov.test.mjs` (from #610)                             | Complete |
| T4   | Required checks green on the pull request head, including the POSIX-only probe-host and SIGTERM tests, then maintainer merge | CI                                                                          | Pending  |

## Delivery rule

Merge only after review and every required check green on the exact head.
