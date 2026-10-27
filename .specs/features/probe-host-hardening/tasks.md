# Probe host hardening (#570): tasks

| Task | Deliverable                                                                         | Verification                                                       | Status   |
| ---- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------- |
| T1   | PHH-01, PHH-02: tests that kill the `detached: false` and `0777` mutants            | `out-of-process-probe-host-faults.test.mjs`, `out-of-process-probe-host-security.test.mjs` | Complete |
| T2   | PHH-03: the framed worker refuses another payload schema version                    | `probe-worker-framed-protocol.test.mjs`, the security suite        | Complete |
| T3   | Required checks green on the pull request head, after #632 merges, then maintainer merge | CI                                                            | Open     |

Item 3 of #570 (zeroization when termination fails) landed with #632.

## Delivery rule

Merge only after review and every required check green on the exact head.
