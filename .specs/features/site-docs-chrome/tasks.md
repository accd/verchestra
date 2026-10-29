# Site Docs Chrome Tasks

## Execution plan

| Task | Deliverable                                                                                                         | Depends on | Verification                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------- |
| T1   | Starlight `Header`, `MobileMenuFooter`, and `Footer` overrides with the product chrome, registered in the config    | None       | Site unit tests, build, e2e chrome tests                                |
| T2   | Unlayered Starlight light tokens under `:root[data-theme="light"]`                                                  | None       | e2e light-mode test (white body, Axe), viewport matrix in both themes   |
| T3   | Projected pages drop the Markdown H1 (after front matter) in `repository-docs-loader.ts`                            | None       | `check:built` one-h1 assertion over every page; e2e h1 counts           |
| T4   | Off-DOM Mermaid render that replaces the code block only once the SVG exists; no `min-height` on `.mermaid-diagram` | None       | e2e Mermaid test (role, SVG, table, light re-render contains `#ffffff`) |
| T5   | Tests: e2e chrome, mobile menu, light mode; unit test for `site-chrome.ts`; built-output h1 assertion               | T1–T4      | `test:unit`, `test:e2e` on three browsers, `check:built`                |
| T6   | Specification, tasks, handoff, validation; all gates; PR against `main`                                             | T5         | `gate:quick`, architecture tests, `agent:check`, Lighthouse, PR opened  |

## Gate commands

| Level        | Command                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| Focused      | `corepack pnpm --filter @verchestra/site test:unit`                                                               |
| Build        | `corepack pnpm --filter @verchestra/site build && corepack pnpm --filter @verchestra/site check:built`            |
| Browser      | `corepack pnpm --filter @verchestra/site test:e2e` (needs `pnpm` on PATH for the preview server, and a free 4322) |
| Lighthouse   | `corepack pnpm --filter @verchestra/site test:lighthouse` (needs a free 4323)                                     |
| Quick        | `corepack pnpm gate:quick`                                                                                        |
| Architecture | `node --test tests/architecture/*.test.mjs`                                                                       |
| Agent        | `corepack pnpm agent:check`                                                                                       |
| CI only      | `pnpm site:check` (`astro check` crashes in `@emnapi/runtime` on the Windows authoring machine, on `main` too)    |

## Test coverage matrix

| Layer        | Requirement outcomes and edge cases                                                                                                                          | Evidence                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Site unit    | SDC-02, SDC-04: current-page rule, link targets, base joining                                                                                                | `apps/site/tests/unit/site-chrome.test.mjs`                        |
| Site unit    | SDC-06: dark tokens and identity literals stay top-level                                                                                                     | `apps/site/tests/unit/visual-system-contract.test.mjs` (unchanged) |
| Built output | SDC-08, SDC-12: exactly one `<h1` per page, page count, unique metadata, alternates, links                                                                   | `apps/site/scripts/check-built-site.mjs`                           |
| Browser      | SDC-01–SDC-05, SDC-07, SDC-09, SDC-10, SDC-12: chrome, current page, 44px, mobile menu, light mode, Axe, Mermaid, search, theme persistence, overflow matrix | `apps/site/tests/e2e/site.spec.ts`                                 |
| Static       | SDC-13: census counts, import cycles, lint, format, complexity                                                                                               | `pnpm gate:quick`, `tests/architecture/no-import-cycles.test.mjs`  |

## Requirement traceability

| Task | Requirement IDs                                        |
| ---- | ------------------------------------------------------ |
| T1   | SDC-01, SDC-02, SDC-03, SDC-04, SDC-05, SDC-10, SDC-11 |
| T2   | SDC-06, SDC-07                                         |
| T3   | SDC-08                                                 |
| T4   | SDC-09                                                 |
| T5   | SDC-01–SDC-10, SDC-12                                  |
| T6   | SDC-12, SDC-13                                         |

## Completion rules

- One concern per change; no test weakened, deleted, or skipped.
- Files owned by PR-A and PR-B (`README.md`, `index.astro`, `product.ts`, the
  hand-written guides, the product region of `global.css`) stay untouched,
  except the one `min-height` line T4 removes from `.mermaid-diagram`.
- Human review before merge; this change is not merged by its author.

## Execution evidence

| Task | Status   | Evidence                                                                                                                 |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| T1   | Complete | `StarlightHeader.astro`, `StarlightMobileMenuFooter.astro`, `StarlightFooter.astro`, `site-chrome.ts`, `astro.config.ts` |
| T2   | Complete | `global.css` light block                                                                                                 |
| T3   | Complete | `repository-docs-loader.ts`; `parseFrontmatter` exported from `llm-content.ts`                                           |
| T4   | Complete | `StarlightHead.astro`, `global.css` `.mermaid-diagram`                                                                   |
| T5   | Complete | `site.spec.ts`, `site-chrome.test.mjs`, `check-built-site.mjs`                                                           |
| T6   | Complete | validation.md records every gate; PR opened against `main`                                                               |
