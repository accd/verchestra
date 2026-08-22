# OpenCode runtime 1.18.18 qualification tasks

| Task | Deliverable | Verification | Status |
| --- | --- | --- | --- |
| T1 | Reconcile the grouped OpenCode package update and frozen lockfile | `pnpm install --frozen-lockfile`; dependency-policy test | Complete locally |
| T2 | Update exact probe contract and current qualification matrix | `pnpm qualify:opencode`; `pnpm test:qualification` | Complete locally |
| T3 | Record portable report and handoff | `pnpm test:agent-readiness`; exact-head GitHub Quality/Site/CodeQL | Complete locally; external CI pending |

## Delivery rule

Merge only the rebased PR head after all required checks pass. Use the
documented maintainer bypass if the extra-review rule is the only blocker.
