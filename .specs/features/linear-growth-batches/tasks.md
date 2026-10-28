# Linear-growth batches of equal length: tasks

| Task | Deliverable                                                                                    | Verification                                                                            | Status                                                                                                |
| ---- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| T1   | LGB-01 to LGB-03: quarter-count large batches, calibration from `GROWTH_SCALE`, median verdict | `tests/unit/linear-growth.test.mjs`; the contention runs and mutants in `validation.md` | Complete                                                                                              |
| T2   | The fleet's noisy legs green on the pull request head, then maintainer merge                   | `platform-matrix.yml` with `gate=quick`, twice; CI                                      | Complete: #637 merged at `ecc9d62` (diff-equal); fleet runs in `validation.md`; no independent review |

## Delivery rule

Merge only after review and every required check green on the exact head.
