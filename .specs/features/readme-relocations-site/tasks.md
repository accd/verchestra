# README Relocations to the Site Tasks

## Execution plan

| Task | Deliverable                                                                                                                       | Depends on | Verification                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| T1   | `## Initialize a workspace from the checkout` in `develop-from-source.md` (RRS-01 to RRS-03), plus a heading for the portal steps | None       | `pnpm --filter @verchestra/site test:unit`, `pnpm agent:check`                                        |
| T2   | The handoff sequence diagram and its introducing sentence in `workflows/cross-environment-handoff.md` (RRS-04)                    | None       | `pnpm --filter @verchestra/site build && check:built`; a Playwright probe of the built route (RRS-06) |
| T3   | Gate run, validation record, handoff, pull request (RRS-05, RRS-07)                                                               | T1, T2     | The gate table in `validation.md`                                                                     |

## Gate commands

| Level   | Command                                                                                                                                             |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused | `pnpm --filter @verchestra/site test:unit`                                                                                                          |
| Site    | `pnpm --filter @verchestra/site build && pnpm --filter @verchestra/site check:built`, then the e2e suite on an alternate port (see `validation.md`) |
| Quick   | `pnpm gate:quick && node --test tests/architecture/*.test.mjs`                                                                                      |
| Agent   | `pnpm agent:check`                                                                                                                                  |
