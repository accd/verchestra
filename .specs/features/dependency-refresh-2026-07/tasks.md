# July 2026 Dependency Refresh Tasks

## Execution plan

| Task | Deliverable                                                                                   | Depends on | Verification                                       | Commit    |
| ---- | ----------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------- | --------- |
| T1   | prettier 3.9.6 merged (#32)                                                                     | None       | `format:check`, `gate:quick`                        | `8cf6783` |
| T2   | Coordinated OpenCode 1.18.7: manifest, lockfile, spike assertion, superseding report, Dependabot group, policy tests | T1         | `qualify:opencode`, `test:qualification`, `gate:full` |           |
| T3   | Close #30 and #31 as superseded, with the unblock condition recorded                            | T2         | Both pull requests closed with a stated reason       |           |
| T4   | jose 6.2.4 (#29)                                                                                | T2         | `gate:quick`, `gate:security`                        | `c927876` |
| T5   | Confirm zero open Dependabot pull requests and green `main`                                     | T3, T4     | `gh pr list`, `gh run list`                          |           |
| T6   | Second wave: `pnpm/action-setup` v6.0.9 (#44), `@astrojs/check` 0.9.10 (#46), `@astrojs/starlight` 0.41.5 (#48) | T5 | tag-SHA dereference, `gate:quick`, the four site stages | `2112a7a`, `0ce0bcb`, `e9e9def` |
| T7   | Coordinated requalification: OpenCode 1.18.9 (#45) and Cedar 4.12.0 (#47), each with a superseding report | T6 | `qualify:opencode`, `qualify:cedar`, `gate:security` |           |

## Gate commands

| Level         | Command                                     |
| ------------- | --------------------------------------------- |
| Focused       | `corepack pnpm qualify:opencode`             |
| Quick         | `pnpm gate:quick`                            |
| Full          | `pnpm gate:full`                             |
| Qualification | `pnpm test:qualification`                    |
| Security      | `pnpm gate:security` (T4 only)               |

## Test coverage matrix

| Layer               | Requirement outcomes and edge cases                                              | Evidence                                                 |
| ------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Dependency policy   | Both OpenCode packages pinned to one exact version in manifest and lockfile        | `tests/agent-readiness/dependency-policy.test.mjs`        |
| Dependency policy   | Dependabot groups OpenCode as one unit                                             | Same suite                                                |
| Driver qualification| 17 OpenCode boundary outcomes against the installed 1.18.7                         | `spikes/opencode-driver/test/opencode-driver.test.mjs`    |
| Driver contract     | A 1.17.18 host is still accepted (floor unchanged)                                 | `tests/contract/opencode-driver.test.mjs`                 |

## Requirement traceability

| Task | Requirement IDs          |
| ---- | -------------------------- |
| T1   | DRF-01                    |
| T2   | DRF-02, DRF-03, DRF-04, DRF-05 |
| T3   | DRF-06                    |
| T4   | DRF-07                    |
| T5   | DRF-08                    |
| T6   | DRF-08                    |
| T7   | DRF-02, DRF-03, DRF-04, DRF-05, DRF-06, DRF-09 |

## Completion rules

- One task, one passing gate, one atomic commit.
- Superseded pull requests close with a concrete reason and unblock condition.
- No qualification boundary, assertion, or threshold weakened.
