# Policy Hardening Tasks

## Execution Plan

| Task | Deliverable | Depends on | Verification |
| --- | --- | --- | --- |
| T1 | Case format, explanation and bundle contracts + error codes | None | Contract tests |
| T2 | `vestra policy test` runner + quick-gate wiring (POL-01) | T1 | CLI tests; gate fails on seeded mismatch |
| T3 | Attribute-level explanations with redaction (POL-02, POL-05) | T1 | Unit + security tests |
| T4 | Signed policy bundle + package digest binding (POL-03, POL-04) | T1, key-lifecycle T1 | Contract + integration tests |

## Gate Commands

| Level | Command |
| --- | --- |
| Quick | `pnpm gate:quick` |
| Full | `pnpm gate:full` |
| Security | `pnpm gate:security` |

## Completion Rules

- The evaluation path used by `policy test` is the production engine path.
- No existing error code or fail-closed behavior changes.
- Qualification evidence recorded under `docs/qualification/` as task T68d.

## Execution Evidence

| Task | Status | Evidence |
| --- | --- | --- |
| T1 | Pending | — |
| T2 | Pending | — |
| T3 | Pending | — |
| T4 | Pending | — |
