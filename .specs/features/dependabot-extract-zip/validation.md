# Dependabot extract-zip remediation validation

**Date:** 2026-08-22
**Diff:** `codex/security-extract-zip` from `b0b7a817e7052dd3852b577e549394c5155c0e5b`
**Verifier:** primary agent independent local pass; GitHub required checks remain authoritative

## Acceptance evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| SEC-01 | `tests/agent-readiness/dependency-policy.test.mjs` asserts no `extract-zip@` lock entry; `pnpm why extract-zip` is empty | PASS |
| SEC-02 | `site:check`: 50 unit tests, Astro check 0 errors/warnings/hints, 130-page build, link/metadata check valid; existing thresholds unchanged | PASS locally |
| SEC-03 | `gate:security`: all selected stages passed, including 2062 unit, 497 contract, 165 E2E, 251 qualification, 1043 security, 283 fault tests | PASS |
| SEC-04 | Dependabot alert re-check is explicitly deferred until merged default branch | Pending by design |

## Discrimination sensor

The lockfile assertion is behaviorally discriminating: a scratch reintroduction
of an `extract-zip@` package entry is rejected by the focused test. The real
tree was not mutated for this check.

## External verification

The local Windows `site:test` run completed all 51 Playwright tests, but
Lighthouse 13's third run failed during Chrome temporary-directory cleanup with
Windows `EPERM`; the built report itself had valid metrics. GitHub's Linux Site
quality check must pass before merge.
