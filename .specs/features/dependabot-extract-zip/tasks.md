# Dependabot extract-zip remediation tasks

| Task | Deliverable | Verification | Status |
| --- | --- | --- | --- |
| SEC-1 | Replace the vulnerable transitive Lighthouse chain and assert the lockfile cannot reintroduce `extract-zip` | `test:agent-readiness`, `gate:security`, `site:check`, GitHub Site quality | Complete locally; GitHub Site quality pending |

## Delivery rule

Merge only the rebased PR head after required checks pass. Re-check Dependabot
alert #22 on the resulting default branch; do not close it by assertion.
