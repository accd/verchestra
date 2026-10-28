# Cedar 4.14.0 qualification tasks

| Task | Deliverable | Verification | Status |
| --- | --- | --- | --- |
| T1 | Move both manifests to `4.14.0` with `pnpm add -E`, keeping the lockfile to Cedar alone | `pnpm install --frozen-lockfile`; lockfile diff | Complete locally |
| T2 | Move the engine and language pins; add the two corpus entries for the 4.13 and 4.14 changes | `pnpm qualify:cedar`; policy suites; four injected faults | Complete locally |
| T3 | Record the upstream review, the report and the handoff | `pnpm gate:quick`; `pnpm gate:security`; `pnpm agent:check`; exact-head GitHub checks | Complete locally; external CI pending |

## Delivery rule

Merge only the PR head whose required checks pass, by rebase through the
documented maintainer bypass, and verify the merge by content.
