# Pi runtime 0.84.2 qualification tasks

| Task | Deliverable | Verification | Status |
| --- | --- | --- | --- |
| T1 | Pin both Pi packages and regenerate the frozen lockfile | `pnpm install --frozen-lockfile`; exact package-version readiness assertion | Complete locally |
| T2 | Requalify the real Driver probe and update contract/spike evidence | `pnpm qualify:pi`; `pnpm test:qualification`; `pnpm test:agent-readiness` | Complete locally |
| T3 | Record the portable qualification report and matrix projection | Documentation review plus GitHub required checks on the exact head | Complete locally; external CI pending |

## Delivery rule

Merge only the rebased PR head after Quality, Site, CodeQL, and the required
review rule pass. Do not describe the version as qualified before that result.
