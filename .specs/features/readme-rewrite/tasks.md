# README Rewrite Tasks

## Execution plan

| Task | Deliverable                                                                                                               | Depends on | Verification                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| T1   | Relocations into `docs/quick-start.md`, `docs/data-probe-contract.md`, `docs/contributing-with-agents.md`, `CONTRIBUTING.md` | None       | `pnpm agent:check`; `tests/agent-readiness/beta-tester-docs.test.mjs` (quick-start block pairing)        |
| T2   | The new `README.md`: 12 sections, 4 Mermaid diagrams, 3 tables                                                            | T1         | README pin tests; site unit tests; site build (LLM validators)                                           |
| T3   | Gate run, validation record, handoff, pull request, rich-diff check of the diagrams on GitHub                             | T2         | `pnpm gate:quick`, `pnpm agent:check`, site build + `check:built`, the GitHub rich diff                   |

## Gate commands

| Level   | Command                                                                                                                                                    |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pins    | `node --test tests/agent-readiness/beta-tester-docs.test.mjs tests/agent-readiness/npx-package-name.test.mjs tests/architecture/agent-instructions.test.mjs` |
| Site    | `pnpm --filter @verchestra/site test:unit && pnpm --filter @verchestra/site build && pnpm --filter @verchestra/site check:built`                           |
| Quick   | `pnpm gate:quick`                                                                                                                                          |
| Agent   | `pnpm agent:check`                                                                                                                                         |
