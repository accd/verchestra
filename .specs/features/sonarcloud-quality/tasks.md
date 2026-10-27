# SonarCloud Quality Tasks

## Execution plan

| Task | Deliverable                                                                                                 | Depends on        | Verification                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------ |
| T1   | Opt-in coverage in `test-scope.mjs`, LCOV merge, `sonar-project.properties`, `sonarcloud.yml`               | None              | `pnpm gate:quick`, focused tests, local LCOV run             |
| T2   | First CI analysis with coverage on `main`                                                                   | T1, owner actions | SonarCloud `coverage` measure present                        |
| T3   | S8707 path injection (14 under the corrected scope, all `spikes/node-runtime/src/build-bundle.mjs`)         | T2                | `pnpm test:qualification`, `pnpm gate:quick`                 |
| T4   | S6505 ×3, S4036 ×4, S2612 ×1, S5443 ×1 (9 under the corrected scope)                                        | T2                | `pnpm gate:quick`, `pnpm test:architecture`, site unit tests |
| T5   | S2871 `sort()` without comparator (156): `codeUnitCompare` from `@verchestra/domain`, never `localeCompare` | T2                | `pnpm gate:security`, `pnpm test:census`                     |
| T6   | S6324 control characters in regular expressions (22; S1534, S7739, S1764 read 0 open by then)               | T2                | `pnpm gate:quick`, `pnpm gate:security`                      |
| T7   | S8786, S5843 regular-expression complexity (22 by then), with linearity assertions                          | T2                | `pnpm gate:security`                                         |
| T8   | Maintainability rules, one rule family per change; accepted issues recorded in `validation.md`              | T3–T7             | `pnpm gate:quick`, `pnpm test:architecture`                  |

## Gate commands

| Level    | Command                                                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Focused  | `node --test tests/unit/coverage-lcov.test.mjs tests/unit/test-scope.test.mjs tests/agent-readiness/sonarcloud-workflow.test.mjs` |
| Coverage | `VES_COVERAGE=1 pnpm test:unit && node scripts/merge-coverage.mjs`                                                                |
| Quick    | `pnpm gate:quick`                                                                                                                 |

## Requirement traceability

| Requirement | Evidence                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| SQC-01      | `tests/unit/coverage-lcov.test.mjs` — "a scope writes LCOV to coverage/ only when VES_COVERAGE=1 asks for it" |
| SQC-02      | `scripts/test-scope.mjs` `COVERED_SOURCES`; local run lists only product files                                |
| SQC-03      | `tests/unit/coverage-lcov.test.mjs` — merge, normalisation, fail-closed cases                                 |
| SQC-04      | `tests/agent-readiness/sonarcloud-workflow.test.mjs` — "test code is analysed as tests"                       |
| SQC-05      | `tests/agent-readiness/sonarcloud-workflow.test.mjs` — trigger, scopes, pinning                               |
| SQC-06      | `tests/agent-readiness/sonarcloud-workflow.test.mjs` — "the token reaches only…"                              |
