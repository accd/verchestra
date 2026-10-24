# OpenCode runtime 1.19.4 qualification tasks

| Task | Deliverable | Verification | Status |
| --- | --- | --- | --- |
| T1 | Take over the #581 branch on `main`, then move both packages to `1.19.4` with `pnpm add -D -E -w` | `pnpm install --frozen-lockfile`; dependency-policy test; lockfile diff limited to the two packages and their binaries | Complete locally |
| T2 | Update the exact probe contract, the drift discrimination, and the current qualification matrix | `VES_REQUIRE_PINNED_PROVIDERS=1 pnpm qualify:opencode`; `pnpm test:qualification` | Complete locally |
| T3 | Review upstream `v1.18.33...v1.19.4` and record the report and handoff | `pnpm gate:quick`; `pnpm gate:full`; `pnpm agent:check`; exact-head GitHub checks | Complete locally; external CI pending |

## Delivery rule

Merge only the rebased PR head after all required checks pass. Use the
documented maintainer bypass if the extra-review rule is the only blocker.
