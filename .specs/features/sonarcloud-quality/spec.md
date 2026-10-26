# SonarCloud Quality Specification

## Problem statement

SonarCloud project `accd_verchestra` (organization `verchestra`) analyses the
repository with Automatic Analysis. On 2026-10-26 it reported 1,135 open issues
(21 blocker, 258 critical; 179 bugs, 32 vulnerabilities, 924 code smells),
Reliability and Security ratings of E, a failing quality gate, and no coverage
at all. Automatic Analysis cannot import a coverage report, and it treats
`tests/**` as product source, so test helpers are counted against product
rules and test-only rules do not apply.

## Goals

- Phase A (this change): CI-based analysis that classifies tests correctly and
  imports LCOV coverage for the product sources, with no new npm dependency.
- Phase B: close every bug and vulnerability; quality gate green.
- Phase C: close or record a reason for every remaining code smell.

## Out of scope for Phase A

| Exclusion                                          | Reason                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| Fixing any reported issue                          | Phases B and C; counts must first be measured under the corrected scope.     |
| A coverage instrumenting dependency (c8, istanbul) | Tests import `.ts` sources directly, so Node's own coverage maps to source.  |
| Coverage of end-to-end and mutation scopes         | They run the product in child processes that in-process coverage cannot see. |
| SonarCloud UI settings                             | Owner actions: token, secret, disabling Automatic Analysis, gate conditions. |

## Requirements

| ID     | Requirement                                                                                                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQC-01 | `scripts/test-scope.mjs` writes `<scope>.lcov` to `VES_COVERAGE_DIR` when set, and nothing otherwise.                                                                               |
| SQC-02 | Coverage counts only `packages/**/src/**`, `apps/vestra-cli/src/**`, `apps/vestra-launcher/src/**`.                                                                                 |
| SQC-03 | Per-scope reports merge into one `lcov.info`: hits summed per file, `/` separators, deterministic order; an empty merge fails closed.                                               |
| SQC-04 | `sonar-project.properties` analyses test code as tests and excludes generated contracts.                                                                                            |
| SQC-05 | `.github/workflows/sonarcloud.yml` runs on pull requests and `main`, measures coverage with the in-process `gate:full` scopes, and scans with the official action pinned by commit. |
| SQC-06 | `SONAR_TOKEN` is visible only to the token-presence check and the scan step; a run without the secret (fork pull request) skips the scan.                                           |

## Owner actions (not automatable here)

1. Generate a SonarCloud token and store it as the repository secret `SONAR_TOKEN`.
2. Turn off Automatic Analysis in SonarCloud → Administration → Analysis Method,
   or the CI scan fails.
3. After the first coverage run, decide whether to add a `new_coverage`
   condition to the quality gate.

## Dependency approval

`SonarSource/sonarqube-scan-action` v8.3.0
(`d209202bc7d53ff1cc128f7f907dac145c9d6ae9`) approved by the owner on
2026-10-26 for this workflow.
