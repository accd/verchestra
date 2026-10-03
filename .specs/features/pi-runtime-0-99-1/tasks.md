# Pi runtime 0.99.1 qualification tasks

| Task | Deliverable | Verification | Status |
| --- | --- | --- | --- |
| T1 | Pin both Pi packages to `0.99.1` with pnpm from `origin/main` and prove the frozen lockfile | `pnpm install --frozen-lockfile`; exact package-version readiness assertion | Complete locally |
| T2 | Diagnose the #490 failure and diff the published `0.87.1` and `0.99.1` packages, with the `0.99.0` and `0.99.1` changelogs, against the Driver boundary; compare the raw event sequences of both installations | Change review recorded in `docs/qualification/pi-runtime-0.99.1.md` | Complete locally |
| T3 | Move the pin through the Driver probe, spike identity, readiness policy, and contract drift cases; pin the new tool-error completion in the spike | `pnpm qualify:pi`; Pi contract and integration tests; `pnpm test:qualification`; `pnpm gate:quick`; `pnpm gate:build`; `pnpm gate:security` | Complete locally |
| T4 | Record the portable qualification report, matrix projection, and handoff | `pnpm agent:check`; GitHub required checks on the exact head | Complete locally; external CI pending |

## Delivery rule

Merge only the PR head after Quality, Site, CodeQL, and the required review
rule pass. Do not describe the version as qualified before that result.
