# Retained Release Rollback Tasks (#393)

| Task | Deliverable | Requirements | Verification | Status |
| --- | --- | --- | --- | --- |
| T1 | Threat model, pre-mortem, and AD-036 decision record | all | Review of `design.md` and `.specs/STATE.md` AD-036 | Done |
| T2 | Client-level reproduction: A@v1 → B@v2 → A stays `VES_TUF_ROLLBACK`; read-only trust-anchor probe | RR-02, RR-03 | `tests/e2e/tuf-update-client.test.mjs`, `tests/security/tuf-update-security.test.mjs` | Done |
| T3 | Verified-release record, `retainedRelease`, trust-bound `rollback`, rollback journal, purge of records | RR-01, RR-04, RR-05, RR-07 | `tests/integration/retained-release-rollback.test.mjs`, `tests/security/transactional-activation-security.test.mjs`, `tests/fault-injection/transactional-activation-faults.test.mjs` | Done |
| T4 | Closure takes the retained path for a superseded release and reports the path | RR-02, RR-03, RR-06 | `tests/e2e/vestra-launcher-activation.test.mjs` | Done |
| T5 | Live-activation workflow documents both rollback mechanisms and fails a leg unless the pointer moved and was restored; matrix, runbook, and README text | RR-08 | `tests/agent-readiness/live-activation-workflow.test.mjs` | Done |
| T6 | Owner: publish two same-root releases built from this revision and run the live-activation matrix | RR-08 | Live transcripts | Not started (owner-gated) |
