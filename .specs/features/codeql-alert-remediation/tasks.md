# CodeQL Alert Remediation Tasks

## Execution plan

| Task | Deliverable                                                                                              | Depends on | Verification                                        | Commit    |
| ---- | ---------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------- | --------- |
| T1   | Linear batch-separator detection in the Oracle, SQL Server, and SAP ASE adapters, with parity, discrimination, and linearity assertions | None       | `pnpm gate:quick`, `pnpm gate:security`               | `0a97635` |
| T2   | Scheme allowlist in the built-site link checker                                                             | None       | `pnpm site:check`, `pnpm gate:quick`                  |           |
| T3   | Post-merge confirmation that CodeQL reports all four alerts fixed on `main`                                 | T1, T2     | `gh api repos/accd/verchestra/code-scanning/alerts`   |           |

## Gate commands

| Level    | Command                              |
| -------- | -------------------------------------- |
| Focused  | `node --test tests/security/oracle-probe-adapter.test.mjs tests/security/sqlserver-probe-adapter.test.mjs tests/security/sap-ase-probe-adapter.test.mjs` |
| Quick    | `pnpm gate:quick`                      |
| Security | `pnpm gate:security`                   |
| Site     | `pnpm site:check`                      |

## Test coverage matrix

| Layer                 | Requirement outcomes and edge cases                                                                                       | Evidence                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Probe adapter security | Separator padded with tabs/spaces, CRLF endings, after blank lines, opening line, closing line without newline, case variance, lone trailing carriage return | `tests/security/{oracle,sqlserver,sap-ase}-probe-adapter.test.mjs`        |
| Probe adapter security | Separator token sharing a line is not a separator (`public.go_orders`, `dbo.go_orders`, `total / weight`)                     | Same three suites                                                        |
| Probe adapter security | 60,000-newline statement parses in under one second                                                                          | Same three suites, `stays linear on adversarial newline input`           |
| Site build tooling     | Non-`http(s)` targets skipped; `http(s)` broken links and outside-base-path targets still reported                            | `pnpm site:check` over the built site                                    |

## Requirement traceability

| Task | Requirement IDs         |
| ---- | ------------------------- |
| T1   | CAR-01, CAR-02, CAR-03   |
| T2   | CAR-04, CAR-05           |
| T3   | CAR-06                   |

## Completion rules

- One task, one passing gate, one atomic commit.
- No alert is dismissed, suppressed, or annotated away.
- No existing assertion is weakened, skipped, or deleted.
