# GitHub Pages Website Tasks

## Execution Plan

| Task | Deliverable                                                 | Depends on | Gate                                                   | Commit                                                |
| ---- | ----------------------------------------------------------- | ---------- | ------------------------------------------------------ | ----------------------------------------------------- |
| T1   | Astro and Starlight foundation                              | None       | `pnpm site:check && pnpm site:build`                   | `feat(site): establish Astro documentation portal`    |
| T2   | Canonical content loader and status compiler                | T1         | `pnpm site:test`                                       | `feat(site): load canonical repository documentation` |
| T3   | Product visual identity and landing page                    | T2         | `pnpm site:test`                                       | `feat(site): build the Verchestra product experience` |
| T4   | Documentation information architecture and guides           | T3         | `pnpm site:test`                                       | `docs(site): publish product and engineering guides`  |
| T5   | Social identity, metadata, sitemap, robots, and 404         | T4         | `pnpm site:test`                                       | `feat(site): add public metadata and social identity` |
| T6   | Browser, accessibility, link, and performance qualification | T5         | `pnpm site:test && pnpm site:test:e2e`                 | `test(site): qualify accessibility and delivery`      |
| T7   | GitHub Pages workflow and repository controls               | T6         | `pnpm gate:quick && pnpm site:test`                    | `ci(site): publish verified GitHub Pages artifact`    |
| T8   | Public handoff and clean-clone acceptance                   | T7         | `pnpm gate:quick && pnpm site:test && pnpm site:build` | `docs(site): complete public website handoff`         |

## Test Coverage Matrix

| Layer                          | Required evidence                                                |
| ------------------------------ | ---------------------------------------------------------------- |
| Content/status logic           | Node unit tests with exact derived values and failure cases      |
| Static routes and interactions | Playwright on Chromium, Firefox, and WebKit                      |
| Accessibility                  | Axe on every page template plus keyboard assertions              |
| Performance and metadata       | Lighthouse budgets and built-output assertions                   |
| Deployment                     | Workflow structure assertions plus a successful Pages deployment |

## Requirement Traceability

| Task | Requirements                                   |
| ---- | ---------------------------------------------- |
| T1   | WEB-01, WEB-12                                 |
| T2   | WEB-04, WEB-07                                 |
| T3   | WEB-02, WEB-05, WEB-06, WEB-08, WEB-10         |
| T4   | WEB-03, WEB-04, WEB-05, WEB-06                 |
| T5   | WEB-01, WEB-07, WEB-10                         |
| T6   | WEB-01, WEB-03, WEB-08, WEB-09, WEB-10, WEB-12 |
| T7   | WEB-11                                         |
| T8   | WEB-07, WEB-12                                 |

## Completion Rules

- One task, one passing gate, one atomic commit.
- Tests assert specification outcomes rather than implementation shape.
- No skipped tests or weakened assertions.
- An independent verifier runs after T8.

## Execution Evidence

| Task | Status   | Commit    |
| ---- | -------- | --------- |
| T1   | Complete | `db39d2a` |
| T2   | Complete | `0d7e2cf` |
| T3   | Complete | `4f57e55` |
| T4   | Complete | `aa861f7` |
| T5   | Complete | `e6d5a5b` |
| T6   | Complete | `115abca` |
| T7   | Complete | `2f4109c` |
| T8   | Complete | Recorded by the public handoff commit |
