# Pi runtime 0.84.2 validation

**Date:** 2026-08-22
**Diff:** `codex/qualify-pi-0-84-2` from `9b1c48febcb9e5aa4645ba14da5b835bb0b922ad`
**Verifier:** primary agent local verification; GitHub required checks remain authoritative

## Acceptance evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| PI-01 | `tests/agent-readiness/dependency-policy.test.mjs` checks both manifest pins and lock entries | PASS |
| PI-02 | `pnpm qualify:pi`: 12 tests passed, including exact installed-version probe and drift rejection | PASS |
| PI-03 | `pnpm test:qualification`: 251 passed, 0 failed, 0 skipped | PASS |
| PI-04 | `pnpm test:agent-readiness`: 150 passed, 0 failed, 0 skipped; external required gates pending | PASS locally; pending externally |

## Discrimination sensor

The probe contract expects the observed installed version `0.84.2`; changing the
qualified constant or either package pin without updating the complete
qualification surface fails the focused contract/readiness tests.

## External verification

The Linux Quality and Site jobs, CodeQL, and the required review rule must pass
on the exact pushed head before merge. This report makes no claim of public
installer or production readiness.
