# Site Status Truth Tasks

## Execution plan

| Task | Deliverable                                                                                                        | Depends on | Verification                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------- |
| T1   | `productStatus.decision`, the maturity definition, and the install evidence route in `product.ts`                  | None       | `pnpm --filter @verchestra/site test:unit`                                 |
| T2   | Landing copy derived from the typed status (pill, headline, summary, progress strip, call to action, probes)       | T1         | `pnpm site:check`, `pnpm site:test`                                        |
| T3   | Equivalent assertions in `site.spec.ts`, `check-built-site.mjs`, `product-contract.test.mjs`; new guide-drift test | T2         | The same gates, and the new tests failing against the old strings          |
| T4   | Seven guides, the discovery workflow, README lines 77 and 86-87, both scoped `AGENTS.md`                           | T1         | `pnpm agent:check`, `node --test tests/architecture/*.test.mjs`            |
| T5   | Gate run, validation record, handoff, pull request                                                                 | T1–T4      | `pnpm gate:quick`, `pnpm site:check`, `pnpm site:test`, `pnpm agent:check` |

## Gate commands

| Level   | Command                                                        |
| ------- | -------------------------------------------------------------- |
| Focused | `pnpm --filter @verchestra/site test:unit`                     |
| Site    | `pnpm site:check && pnpm site:test`                            |
| Quick   | `pnpm gate:quick && node --test tests/architecture/*.test.mjs` |
| Agent   | `pnpm agent:check`                                             |
