# canonicalize 5.1.0 tasks

| Task | Deliverable | Verification | Status |
| --- | --- | --- | --- |
| T1 | Move `canonicalize` to `5.1.0` with `pnpm add -E`; add the refusal and V1/V2 agreement tests | `pnpm install --frozen-lockfile`; `tests/unit/evidence-integrity.test.mjs` with two faults; `pnpm test:contract`; canonical, evidence and DSSE security tests; `pnpm agent:check`; exact-head GitHub checks | Complete: merged as #663 |

## Delivery rule

Merge only the PR head whose required checks pass, by rebase through the
documented maintainer bypass, and verify the merge by content.
