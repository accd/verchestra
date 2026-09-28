# OpenCode runtime 1.18.33 qualification tasks

| Task | Deliverable | Verification | Status |
| --- | --- | --- | --- |
| T1 | Rebase the grouped OpenCode update onto `main`, then move both packages to `1.18.33` with `pnpm add -D -E -w` | `pnpm install --frozen-lockfile`; dependency-policy test | Complete locally |
| T2 | Update exact probe contract and current qualification matrix | `pnpm qualify:opencode`; `pnpm test:qualification` | Complete locally |
| T3 | Review upstream `v1.18.18...v1.18.33` and record the report and handoff | `pnpm gate:quick`; `pnpm gate:full`; `pnpm agent:check`; exact-head GitHub checks | Complete locally; external CI pending |

## Delivery rule

Merge only the rebased PR head after all required checks pass. Use the
documented maintainer bypass if the extra-review rule is the only blocker.
