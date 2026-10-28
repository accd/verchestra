# json-schema-to-typescript 16.0.0 tasks

| Task | Deliverable | Verification | Status |
| --- | --- | --- | --- |
| T1 | Move the pin with `pnpm add -E -w -D`; scope a `js-yaml` 5.5.0 override to the generator; keep the lockfile to that change | `pnpm install --frozen-lockfile`; lockfile diff | Complete locally |
| T2 | Read the 16.0.0 changelog; prove zero drift; add the `js-yaml` lockfile sensor; restate the Dependabot reason | `generate-contract-types.mjs --check`; `pnpm test:contract`; dependency-policy test and three lockfile mutants | Complete locally |
| T3 | Record the validation and the handoff | `pnpm gate:quick`; `pnpm agent:check`; exact-head GitHub checks | Complete locally; external CI pending |

## Delivery rule

Merge only the PR head whose required checks pass, by rebase through the
documented maintainer bypass, and verify the merge by content.
