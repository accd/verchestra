# Site Landing Redesign Tasks

## Execution plan

| Task | Deliverable                                                                                                                                                     | Depends on | Verification                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| T1   | `publishedLauncherVersion` in `repository-content.ts`; `repository-root.ts`; unit tests for the ledger read                                                     | None       | `corepack pnpm --filter @verchestra/site test:unit`                                                 |
| T2   | `architecture-diagram.ts` (nodes, edges, routing) and `ArchitectureDiagram.astro`; `architecture-diagram-labels.test.mjs` pinned to the Mermaid                 | None       | Site unit tests                                                                                     |
| T3   | `DeliveryFlowDiagram.astro` mapped over `deliveryStages`; `clause` on each guarantee in `product.ts`                                                            | None       | Site unit tests (product contract), build                                                           |
| T4   | `index.astro` rebuilt as seven sections with derived numbers; `global.css` product region (section padding, H2 scale, install, diagram, travels, stacked table) | T1–T3      | Build, `check:built`, visual check in both themes and at 390 px                                     |
| T5   | Assertions: `check-built-site.mjs` ledger pin and artefact presence; e2e additions; `beta-tester-docs` pinned document                                          | T4         | `check:built`, e2e on three browsers, `node --test tests/agent-readiness/beta-tester-docs.test.mjs` |
| T6   | Specification, tasks, handoff, validation; every gate; PR against `main`                                                                                        | T5         | `gate:quick`, architecture tests, `agent:check`, Lighthouse CLI, PR opened                          |

## Gate commands

| Level        | Command                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Focused      | `corepack pnpm --filter @verchestra/site test:unit`                                                                               |
| Build        | `corepack pnpm --filter @verchestra/site build && corepack pnpm --filter @verchestra/site check:built`                            |
| Browser      | `corepack pnpm --filter @verchestra/site test:e2e` (on this machine: a local-only config on port 4332, see validation.md)         |
| Lighthouse   | `corepack pnpm --filter @verchestra/site test:lighthouse` (on this machine: the Lighthouse CLI directly, see validation.md)       |
| Quick        | `corepack pnpm gate:quick`                                                                                                        |
| Architecture | `node --test tests/architecture/*.test.mjs tests/agent-readiness/beta-tester-docs.test.mjs`                                       |
| Agent        | `corepack pnpm agent:check`                                                                                                       |
| CI only      | `pnpm site:check` (`astro check` crashes in `@emnapi/runtime` on the Windows authoring machine, on `main` too) and `lhci autorun` |

## Test coverage matrix

| Layer        | Requirement outcomes and edge cases                                                                                  | Evidence                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Site unit    | SLR-02: latest release, out-of-order sequences, role refreshes ignored, no release throws                            | `apps/site/tests/unit/repository-content.test.mjs`                 |
| Site unit    | SLR-10: labels and edges equal the Mermaid block, line splits rejoin, nodes inside the viewBox and disjoint, routing | `apps/site/tests/unit/architecture-diagram-labels.test.mjs`        |
| Site unit    | SLR-12: identity literals, tokens, reduced-motion block                                                              | `apps/site/tests/unit/visual-system-contract.test.mjs` (unchanged) |
| Site unit    | SLR-01, SLR-05: pinned headline, definition, scenario, stages, databases                                             | `apps/site/tests/unit/product-contract.test.mjs` (unchanged)       |
| Repository   | SLR-03: a hand-typed version in `index.astro`                                                                        | `tests/agent-readiness/beta-tester-docs.test.mjs`                  |
| Built output | SLR-03, SLR-07, SLR-11, SLR-14: ledger pin, two drawings, pinned strings, page count, byte budgets, one `h1`         | `apps/site/scripts/check-built-site.mjs`                           |
| Browser      | SLR-01, SLR-04, SLR-05, SLR-07, SLR-14, SLR-15: artefacts, phone layout, Axe both themes, touch targets, overflow    | `apps/site/tests/e2e/site.spec.ts`                                 |
| Static       | SLR-12, SLR-13: format, lint, complexity, census counts, import cycles                                               | `corepack pnpm gate:quick`, `tests/architecture/*.test.mjs`        |

## Requirement traceability

| Task | Requirement IDs                                                |
| ---- | -------------------------------------------------------------- |
| T1   | SLR-02                                                         |
| T2   | SLR-10                                                         |
| T3   | SLR-05, SLR-08                                                 |
| T4   | SLR-01, SLR-04, SLR-06, SLR-07, SLR-09, SLR-11, SLR-12, SLR-13 |
| T5   | SLR-03, SLR-14, SLR-15                                         |
| T6   | SLR-14                                                         |

## Completion rules

- One concern per change; no test weakened, deleted, or skipped.
- No new production dependency; no client framework; no new `<script>`.
- Human review before merge; this change is not merged by its author.

## Execution evidence

| Task | Status   | Evidence                                                                                                                            |
| ---- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| T1   | Complete | `repository-content.ts` `publishedLauncherVersion`; `repository-root.ts`; two new tests in `repository-content.test.mjs`            |
| T2   | Complete | `architecture-diagram.ts`, `ArchitectureDiagram.astro`, `architecture-diagram-labels.test.mjs` (5 tests)                            |
| T3   | Complete | `DeliveryFlowDiagram.astro`; `product.ts` guarantees carry `clause`                                                                 |
| T4   | Complete | `index.astro` (seven sections), `global.css` product region; built homepage carries `0.0.0-qualification.8` and `81 public reports` |
| T5   | Complete | `check-built-site.mjs`, `site.spec.ts` (one new test, one extended), `beta-tester-docs.test.mjs` pinned document                    |
| T6   | Complete | validation.md records every gate; PR opened against `main`                                                                          |
