# Pi runtime 0.87.1 qualification tasks

| Task | Deliverable | Verification | Status |
| --- | --- | --- | --- |
| T1 | Pin both Pi packages to `0.87.1` and regenerate the frozen lockfile from `origin/main` | `pnpm install --frozen-lockfile`; exact package-version readiness assertion | Complete locally |
| T2 | Diagnose the #415 failures and diff the published `0.84.2`, `0.85.1`, `0.86.0`, `0.86.1`, `0.87.0`, and `0.87.1` packages against the Driver boundary | Change review recorded in `docs/qualification/pi-runtime-0.87.1.md` | Complete locally |
| T3 | Requalify the real Driver probe and update contract, spike, integration, and readiness evidence | `pnpm qualify:pi`; Pi contract and integration tests; `pnpm test:qualification`; `pnpm gate:quick`; `pnpm gate:full`; `pnpm gate:security` | Complete locally |
| T4 | Record the portable qualification report, matrix projection, and handoff | `pnpm agent:check`; GitHub required checks on the exact head | Complete locally; external CI pending |

## Delivery rule

Merge only the rebased PR head after Quality, Site, CodeQL, and the required
review rule pass. Do not describe the version as qualified before that result.
