# Impeccable Site Polish Tasks

## Execution plan

| Task | Deliverable                                                                              | Depends on | Verification                                             | Commit                                                 |
| ---- | ---------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------- | ------------------------------------------------------ |
| T1   | Global tool verification plus provider-neutral specification, design, tasks, and handoff | None       | Global skill check, clean repository, `pnpm agent:check` | `docs(site): specify the impeccable design refinement` |
| T2   | Deterministic visual contract and responsive acceptance tests                            | T1         | Site unit and focused Playwright tests                   | `test(site): define the visual refinement contract`    |
| T3   | Semantic design tokens and shared product/Starlight foundations                          | T2         | Site unit, Astro check, and focused browser tests        | `refactor(site): strengthen the shared visual system`  |
| T4   | Landing-page hierarchy, typography, layout, and copy refinement                          | T3         | Focused product contract and Playwright tests            | `refactor(site): refine the landing page hierarchy`    |
| T5   | Responsive, accessibility, motion, and performance hardening across public surfaces      | T4         | Impeccable detector, site tests, build, Axe, Lighthouse  | `fix(site): harden responsive presentation`            |
| T6   | Full acceptance evidence, validation handoff, and independent review                     | T5         | All required gates and clean diff                        | `docs(site): complete the design refinement handoff`   |

## Gate commands

| Level   | Command                                                |
| ------- | ------------------------------------------------------ |
| Focused | `pnpm --filter @verchestra/site test:unit`             |
| Browser | `pnpm --filter @verchestra/site test:e2e`              |
| Site    | `pnpm site:check && pnpm site:test && pnpm site:build` |
| Quick   | `pnpm gate:quick`                                      |
| Agent   | `pnpm agent:check`                                     |

## Test coverage matrix

| Layer               | Requirement outcomes and edge cases                                                                               | Evidence                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Site unit contracts | ISP-01, ISP-02, ISP-03, ISP-06, ISP-07; exact forbidden paths, tokens, status, dependencies, routes, and metadata | `apps/site/tests/unit/*.test.mjs`                              |
| Browser behavior    | ISP-04, ISP-05; Axe, focus, theme, reduced motion, navigation, overflow, and viewport matrix                      | `apps/site/tests/e2e/site.spec.ts`                             |
| Built output        | ISP-02, ISP-06, ISP-07; base path, direct routes, alternates, sitemap, robots, and static artifacts               | `apps/site/scripts/check-built-site.mjs` and site build tests  |
| Mechanical detector | ISP-08; changed source and rendered local URL                                                                     | Impeccable CLI output captured in task evidence, not committed |

## Requirement traceability

| Task | Requirement IDs                                |
| ---- | ---------------------------------------------- |
| T1   | ISP-01, ISP-02, ISP-07, ISP-08                 |
| T2   | ISP-01–ISP-08                                  |
| T3   | ISP-02, ISP-03, ISP-04, ISP-06                 |
| T4   | ISP-02, ISP-03, ISP-04, ISP-05                 |
| T5   | ISP-01, ISP-04, ISP-05, ISP-06, ISP-07, ISP-08 |
| T6   | ISP-01–ISP-08                                  |

## Completion rules

- One task, one passing gate, one atomic commit.
- Tests assert specification outcomes and are never weakened, deleted, or
  skipped to obtain a pass.
- Update the portable handoff after every task.
- Independent verification and human review are required before completion.

## Execution evidence

| Task | Status   | Commit  |
| ---- | -------- | ------- |
| T1   | Complete | d6e7c99 |
| T2   | Complete | f1fb33e |
| T3   | Complete | 857816f |
| T4   | Complete | 59cb327 |
| T5   | Complete | a8d2557 |
| T6   | Planned  | Pending |

### Verifier fix tasks

| Task | Gap                                                                            | Verification                                                    | Commit         |
| ---- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- | -------------- |
| T5F1 | Make reduced-motion assertions discriminating and record detector dispositions | Focused browser test, unit contract, and re-verification sensor | pending commit |

## Task validation

All six tasks are atomic, strictly ordered T1 → T2 → T3 → T4 → T5 → T6, and
co-locate tests with every changed presentation layer. The feature fits one TLC
execution batch, so implementation remains in the primary task.
