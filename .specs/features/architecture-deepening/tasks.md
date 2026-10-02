# Architecture deepening tasks

One task per pull request. The coordinator owns this file. Each task records its
evidence in `validation-<id>.md`.

| Task | Requirement | Deliverable                                                                                   | Depends on | Status                         |
| ---- | ----------- | --------------------------------------------------------------------------------------------- | ---------- | ------------------------------ |
| T0   | —           | This specification; ledger entry for `.4`                                                     | —          | Done (#443, `af7d047`)         |
| TA1  | ADP-A       | Evidence for isolating Claude Code without `--bare`, and for Codex identity directories       | T0         | Done (#458, `0158e48`; AD-044) |
| TA2  | ADP-A       | Subscription profile for Claude Code; Codex identity directory; mode selection; documentation | TA1        | Done (#458, `0158e48`; AD-044) |
| T5   | ADP-5       | Verification ports split by operation                                                         | T0         | Done (#444, `6fb623a`)         |
| T1a  | ADP-1       | One module for the handle, branch name and trailers                                           | T0         | Done (#454, `7197954`; AD-043) |
| T1b  | ADP-1       | Recovery and cleanup operations move into that module; SHA-256                                | T1a        | Done (#455, `8c305e4`)         |
| T1c  | ADP-1       | Scrubbed environment for git                                                                  | T1b        | Done (#456, `a6df70a`)         |
| T3a  | ADP-3       | Driver session ledger                                                                         | TA2        | Done (#459, `d9e834c`; AD-045) |
| T3b  | ADP-3       | Driver version probe                                                                          | T3a        | Done (#460, `60ebd82`; AD-046) |
| T2a  | ADP-2       | Run record module                                                                             | T1b, T5    | Done (#461, `c0bc40c`; AD-047) |
| T2b  | ADP-2       | Typed checkpoint projections                                                                  | T2a        | Done (#462, `b90df87`)         |
| T2c  | ADP-2       | Containment of the per-Run directories                                                        | T2a        | Done (#463, `e17abb3`)         |
| T4a  | ADP-4       | Driver session runner                                                                         | T3b        | In progress                    |
| T4b  | ADP-4       | Verifier adopts the runner                                                                    | T4a, T2a   | In progress                    |
| T4c  | ADP-4       | Self-test scenarios adopt the runner                                                          | T4a        | In progress                    |
| T4d  | ADP-4       | Process-tree termination for Claude Code and Codex                                            | T4b        | In progress                    |
| T6a  | ADP-6       | Legacy runtime store methods removed                                                          | T0         | Done (#447, `0cb454b`)         |
| T6b  | ADP-6       | Effect repository in its own file                                                             | T6a        | Done (#448, `ac59fac`)         |
| T7a  | ADP-7       | Shared custody helpers for the publication scripts                                            | T0         | Done (#446, `d195400`)         |
| T7b  | ADP-7       | Release entry derived by the ledger module                                                    | T7a        | Done (#449, `44c1c10`; AD-042) |
| T8   | ADP-8       | Credential policy beside the store                                                            | T0         | Done (#445, `b714ad8`)         |
