# OpenCode runtime 1.18.18 validation

**Date:** 2026-08-22
**Diff:** `codex/rebase-pr277` from `7028d7fc4f3483b38569001e9b5cb0754e9f04a4`
**Verifier:** primary agent local verification; GitHub required checks remain authoritative

## Acceptance evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| OC-01 | Manifest/lockfile exact-version assertion in `tests/agent-readiness/dependency-policy.test.mjs` | PASS |
| OC-02 | `pnpm qualify:opencode` and probe expectation `1.18.18`; support floor remains unchanged | PASS locally |
| OC-03 | Existing OpenCode boundary suite retained; `pnpm test:qualification` is required externally | Pending exact head |
| OC-04 | `pnpm test:agent-readiness` and `pnpm gate:quick` pass locally; Linux gates pending | PASS locally; pending externally |

## Discrimination sensor

The real probe and policy assertion reject a stale package identity: changing
either direct OpenCode pin without updating the complete qualified surface makes
the readiness/qualification tests fail.

## External verification

Quality, Site, CodeQL, and the required review rule must pass on the exact pushed
head before merge. No production-readiness claim is made.
