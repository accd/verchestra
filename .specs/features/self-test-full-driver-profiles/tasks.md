# T71 Full, Fault, and Approved-Driver Self-Test Tasks

## Atomic execution plan

| Task | Deliverable                                                                                                                                   | Depends on | Focused verification                    | Commit boundary                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------- | -------------------------------------- |
| T0   | Context, specification, design, task plan, and portable handoff                                                                               | None       | `pnpm agent:check`                      | Planning only                          |
| T1   | Closed full/driver check catalogs, durable-boundary facts, Driver review facts, and pure fail-closed rules                                    | T0         | Self-Test unit tests                    | Application contracts and tests        |
| T2   | Child-process crash runner and persisted fact reader under `packages/self-test`                                                               | T1         | Self-Test integration/fault tests       | Node facts and tests                   |
| T3   | Full scenario through production package, authority, context/routing, effect, verification, Handoff, and Capsule APIs                         | T1         | Full scenario integration tests         | Successful full path and tests         |
| T4   | Before/after crash matrix for every durable boundary with exact-once resume                                                                   | T2, T3     | Full scenario fault tests               | Crash convergence and tests            |
| T5   | Exact Driver review/authorization gate and denied-zero-call paths                                                                             | T1         | Driver unit/security tests              | Driver authority behavior and tests    |
| T6   | Claude, Codex, and OpenCode/Qwen deterministic approved paths; writer Tool denial                                                             | T5         | Driver integration/security tests       | Qualified adapter boundaries and tests |
| T7   | CLI dispatch for `full` and `drivers`, stable rendering/exit behavior                                                                         | T3, T6     | CLI contract/e2e tests                  | Public CLI behavior and tests          |
| T8   | Case-count audit, mutation/discrimination sensors, quick/security gates, handoff evidence                                                     | T1–T7      | `pnpm gate:quick`, `pnpm gate:security` | Evidence update only                   |
| T9   | Bind the approved, displayed, and actually used Driver request before provider entry; reject every sensitive-field mutation and unknown field | T8         | Driver security and integration tests   | Driver execution binding and tests     |
| T10  | Strengthen pure-verdict discrimination for every full-workflow field and the exact four-entry Driver provider set                             | T9         | Self-Test unit tests                    | Verdict sensors only                   |
| T11  | Derive crash identity, multiplicity, digest, and status from each authoritative durable store after resume                                    | T10        | Self-Test unit and fault tests          | Durable outcome evidence and tests     |
| T12  | Prove every boundary/phase cell and the happy path receive distinct normalized disposable roots                                               | T11        | Self-Test fault and integration tests   | Matrix isolation sensor                |
| T13  | Record review remediation evidence and run every required final gate on the exact revision                                                    | T9–T12     | All required repository gates           | Handoff evidence only                  |

## Test matrix

| Layer           | Minimum outcomes                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Unit            | Closed catalogs, missing/duplicate/unknown boundaries, multiplicity, review-field binding, writer classification                    |
| Integration     | Complete full path, each deterministic provider adapter, stable CLI dispatch and report                                             |
| Fault injection | Before/after hard crash for all registered durable boundaries, acknowledgement loss reconciliation                                  |
| Security        | Denied authority variants produce zero calls, writer Tools unreachable, portable evidence excludes provider-local state, no network |

The total new/strengthened cases must be at least 30. No case may be skipped,
todo-marked, or made less specific to satisfy the threshold.

## Commit rules

- Each task is implemented test-first and committed only after its focused
  verification passes.
- One logical behavior per commit; mechanical generated projections, if any,
  stay with their canonical-source change.
- `tasks.md` and `handoff.md` record the exact commit and next action after each
  task.
- No push occurs without explicit contributor authorization.
- Independent verification is not self-certified by the implementation agent.

## Traceability

| Task | Requirements                |
| ---- | --------------------------- |
| T1   | FULL-02, DRV-01, DRV-04     |
| T2   | FULL-03                     |
| T3   | FULL-01, FULL-04            |
| T4   | FULL-02–04                  |
| T5   | DRV-01–02, DRV-04           |
| T6   | DRV-03–04, FULL-04          |
| T7   | CLI-01                      |
| T8   | TST-01 and all requirements |
| T9   | DRV-01–04                   |
| T10  | FULL-01, DRV-01–04          |
| T11  | FULL-02–03                  |
| T12  | FULL-03                     |
| T13  | TST-01 and all requirements |

## Execution evidence

| Task | Status | Commit / evidence                                                                       |
| ---- | ------ | --------------------------------------------------------------------------------------- |
| T0   | Done   | `f568642`                                                                               |
| T1   | Done   | `ba7969b`; 33 focused unit cases                                                        |
| T2   | Done   | `ad8141b`; 26 crash-runner fault cases                                                  |
| T3   | Done   | `1b047ad`; 4 successful full-scenario integration cases                                 |
| T4   | Done   | `9345cb1`; 23 production crash-matrix cases                                             |
| T5   | Done   | `9d72bca`; 6 Driver authority security cases                                            |
| T6   | Done   | `3518665`; 5 qualified Driver integration cases                                         |
| T7   | Done   | `0d04112`; 51 CLI contract/e2e cases                                                    |
| T8   | Done   | `f7a8354`; quick/security/release PASS, full Windows baseline recorded                  |
| T9   | Done   | Approved/displayed/actual review binding; 72 focused unit/security/integration cases    |
| T10  | Done   | 28/28 application-rule cases; invalid PASS builders and exact duplicate-provider sensor |
| T11  | Done   | `a4ce1aa`; 49/49 crash cases; authoritative stores                                      |
| T12  | Done   | `7b25d37`; 34 application-rule cases; 49 isolated crash cases                           |
| T13  | Done   | All required gates PASS on clean qualified worktree                                     |
