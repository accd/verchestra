# Site Landing Redesign Validation

**Date**: 2026-10-29
**Spec**: `.specs/features/site-landing-redesign/spec.md`
**Base**: `d76c339557edae488e9ea68f6c0a8ea52e89cad6` (`origin/main`, with PR-A,
PR-C, the README rewrite, and the qualification exit record)
**Branch**: `site/landing-redesign`
**Verifier**: the author, on the Windows 11 authoring machine (Node 24.14.0,
`corepack pnpm`); independent review is the PR review.

## Verdict

**PASS on every gate that completed here** (site unit, build, built-site
check, e2e on three browsers, quick gate, architecture and agent-readiness
tests, census, agent check). Two gates are left to the Ubuntu CI run:
`astro check` cannot start on this machine, and `lhci autorun` cannot finish
on it; three direct Lighthouse audits of the build meet every assertion in
`lighthouserc.cjs` (see "Lighthouse on this machine").

## Gates

| Gate                            | Command                                                                                     | Result                                                                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site unit tests                 | `corepack pnpm --filter @verchestra/site test:unit`                                         | 77 tests, 77 pass, 0 fail, 0 skipped (70 existing + 2 in `repository-content.test.mjs` + 5 in `architecture-diagram-labels.test.mjs`)                                                                                               |
| Site build                      | `corepack pnpm --filter @verchestra/site build`                                             | 135 pages, Pagefind index over 135 files, exit 0                                                                                                                                                                                    |
| Built-site check                | `corepack pnpm --filter @verchestra/site check:built`                                       | `{"pages":135,"compressedJavaScript":1116,"compressedTransfer":249585,"internalLinks":"valid","metadata":"valid"}`; the homepage installs `0.0.0-qualification.8` (the ledger's latest release) and pins no other version           |
| e2e (Chromium, Firefox, WebKit) | `playwright test --config <scratchpad>/landing-playwright.config.ts`                        | 66 passed (22 tests × 3 browsers), 0 failed, 0 flaky, 0 skipped, 2.2 min, exit 0, on port 4332 (see "Alternate e2e port")                                                                                                           |
| Lighthouse                      | Lighthouse CLI 13.5.0 directly, three runs (see "Lighthouse on this machine")               | performance 1, 1, 1; accessibility 1; best practices 1; SEO 1; LCP 331, 326, 324 ms; CLS 0.028, 0.008, 0.028: inside every assertion of `lighthouserc.cjs`. `lhci autorun` itself does not complete on this machine; CI is the gate |
| Quick gate                      | `corepack pnpm gate:quick`                                                                  | `gate:quick PASS` (format:check, lint, complexity:check, typecheck, test:unit, test:agent-readiness, test:census), run after the last edit                                                                                          |
| Architecture + agent readiness  | `node --test tests/architecture/*.test.mjs tests/agent-readiness/beta-tester-docs.test.mjs` | 164 pass, 0 fail, 0 skipped (`index.astro` is now a pinned document; it carries no literal version)                                                                                                                                 |
| Canonical-JSON census           | inside `gate:quick` (`test:census`)                                                         | 14 pass; no signal count changed (`publishedLauncherVersion` uses `JSON.parse` only; the new unit test writes its ledger fixtures as JSON text, not through `JSON.stringify`)                                                       |
| Agent check                     | `corepack pnpm agent:check`                                                                 | `agent:check PASS`                                                                                                                                                                                                                  |
| Prettier                        | `corepack pnpm exec prettier --write <every new or changed file>`                           | Applied; `format:check` inside `gate:quick` is green                                                                                                                                                                                |

### Not runnable here

`pnpm site:check` runs `astro check`, which crashes on this Windows machine
inside `@emnapi/runtime@2.0.0-alpha.3` when `@astrojs/check` is imported, on
`main` too (recorded by PR-A and PR-C). The three other commands `site:check`
wraps (`test:unit`, `build`, `check:built`) ran and are recorded above. CI
runs `astro check` on Ubuntu; the new TypeScript (`architecture-diagram.ts`,
`repository-root.ts`, the component frontmatter) is typed under the site's
`strictest` configuration and the Vite build compiled it without a warning.

### Alternate e2e port

`apps/site/playwright.config.ts` binds `127.0.0.1:4322` with
`reuseExistingServer` outside CI, and a stale `astro preview` from another
checkout has held 4322 since 2026-10-28. The suite ran through a
scratchpad-only config (never inside the worktree, nothing to delete before
committing) that spreads the repository config and overrides `testDir`,
`outputDir`, `use.baseURL`, `webServer.command`, `webServer.url`,
`webServer.cwd`, and `reuseExistingServer: false` for port 4332. Spec file,
browsers, workers, and timeouts are the repository's.

The first full run reported 3 failures (one per browser) on the new landing
test: `getByRole("img", { name: /delivery path/ })` resolved to two elements,
the `.diagram` wrapper and the inner `<svg>`, which exposes its own `img`
role once it has a `<title>`. The SVGs now carry `aria-hidden="true"`; the
wrapper stays the one image, and its name still resolves through
`aria-labelledby` to the `<title>` and `<desc>` inside (accessible-name
computation includes referenced hidden nodes). The second full run: 66/66.

### Lighthouse on this machine

`lhci autorun` cannot complete on this machine: chrome-launcher fails with
`EPERM` deleting its temporary profile under `%TEMP%\lighthouse.*` after each
audit (recorded by PR-A, PR-C, and the impeccable-site-polish handoff), and
lhci clears `.lighthouseci` at the start of every autorun. The Lighthouse CLI
(`lighthouse@13.5.0`, the version lhci uses, at
`node_modules/.pnpm/lighthouse@13.5.0_*/node_modules/lighthouse/cli/index.js`)
ran three times against `astro preview` on 4333 with the gate's settings
(`--preset=desktop`, the four categories, the same `--chrome-flags`) and
`--output-path` into the scratchpad. Each run wrote a complete report, then
exited 1 on the same cleanup `EPERM`.

| Run | Performance | Accessibility | Best practices | SEO | LCP (ms) | CLS   |
| --- | ----------- | ------------- | -------------- | --- | -------- | ----- |
| 1   | 1           | 1             | 1              | 1   | 331      | 0.028 |
| 2   | 1           | 1             | 1              | 1   | 326      | 0.008 |
| 3   | 1           | 1             | 1              | 1   | 324      | 0.028 |

Against `lighthouserc.cjs`: performance median 1 ≥ 0.95; accessibility,
best-practices, and SEO 1 on every run (pessimistic); LCP ≤ 2500 and CLS ≤
0.1 on every run (pessimistic). The one layout shift Lighthouse lists is the
install block's caption re-wrapping when the self-hosted fonts swap in
(`font-display: swap`, the behaviour ISP-06 keeps); it is 0.028 at most,
inside the 0.1 budget, and no new JavaScript or image contributes. The gate
command itself did not exit 0 here, so this row is evidence, not a pass of
the declared gate; the Ubuntu CI run is the pass.

## Spec-anchored requirement traceability

| Requirement | File:line + assertion/inspection                                                                                                                                                                                                                                                                                                                                                                                      | Result |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| SLR-01      | `index.astro` hero: `h1#hero-title`, `.hero__definition`, `.qualification-pill[aria-label="Current public status"]`, `pre.install[tabindex="0"]` with the two commands from `installCommands`, `.install__caption`; `global.css` `.qualification-pill { order: 1 }` at ≤ 680 px; e2e "landing renders the install block" and "mobile navigation and the status" pass; `check-built-site.mjs` asserts the pill strings | PASS   |
| SLR-02      | `repository-content.ts` `publishedLauncherVersion`: highest `sequence` among `kind === "release"`, `JSON.parse` only, throws "no release entry"; `repository-content.test.mjs` "the published launcher version is the ledger's latest release" and "ignores role refreshes and fails without a release"                                                                                                               | PASS   |
| SLR-03      | `check-built-site.mjs` asserts `npx verchestra@${ledgerLatest} --version` and that every `npx verchestra@` match equals it; `beta-tester-docs.test.mjs` `PINNED_DOCUMENTS` includes `apps/site/src/pages/index.astro`; 164/164                                                                                                                                                                                        | PASS   |
| SLR-04      | `index.astro` `.hero__actions`: "Install the beta build" → `docs/install-and-run/`, "View on GitHub", "Read the signed 1.0 hold" → the decision file on GitHub; e2e asserts the hold link's href; `check-built-site.mjs` asserts both labels                                                                                                                                                                          | PASS   |
| SLR-05      | `DeliveryFlowDiagram.astro` maps `deliveryStages`, seal between nodes 3 and 4, `.diagram.diagram--delivery[role="img"][aria-labelledby]`, `<title>`/`<desc>`; `global.css` `.diagram--delivery { aspect-ratio: 960 / 420 }`, `.diagram { display: none }` and `.delivery-list { display: block }` at ≤ 680 px; e2e phone test asserts both                                                                            | PASS   |
| SLR-06      | `index.astro` `section.travels`: `.statement-lead` = `productScenario`, `.travels-column--travels` (violet inset rule) and `--stays` (amber); lists from `travels` and `stays`; `check-built-site.mjs` asserts "What travels. What stays."                                                                                                                                                                            | PASS   |
| SLR-07      | `index.astro`: label "What works today", headline from `capabilityMatrix.length` and `reportCount` (built: "13 capabilities, 81 public reports"), `td[data-label]`; `global.css` ≤ 680 px: clipped `thead`, block cells, `td::before { content: attr(data-label) }`, full-width 44 px link; e2e asserts the header height ≤ 1 px, the cell `display: block`, and the 44 px contract                                   | PASS   |
| SLR-08      | `index.astro` `h2#handoff-title` "Start in Claude Code. Continue in OpenCode / Qwen."; `.handoff-path` unchanged (node text "OpenCode / Qwen" exact, e2e passes); `.guarantee-grid` with `guarantee.clause`; `product.ts` six clauses                                                                                                                                                                                 | PASS   |
| SLR-09      | `index.astro` `engineHeadline` from `databases.length` ("Seven engines, one no-writer contract."); `.database-panel` unchanged; e2e "SAP ASE / Sybase" exact passes                                                                                                                                                                                                                                                   | PASS   |
| SLR-10      | `architecture-diagram.ts` (12 nodes, 11 edges, `architectureEdgePath`), `ArchitectureDiagram.astro` (`.diagram--architecture[role="img"]`, title, desc, `ul.diagram-text`); `architecture-diagram-labels.test.mjs` 5/5 against the Mermaid block; e2e asserts the edge list visible on a phone with "vestra CLI → Application workflows"                                                                              | PASS   |
| SLR-11      | `index.astro` `section.qualification`: progress strip, `qualificationSummary`, "Inspect T77 evidence →" → `docs/qualification/t77-validation/`, `h3#not-today-title` "What Verchestra is not", `.community-cta` with Discussions and Contribute; `check-built-site.mjs` asserts the link, the label, and the heading                                                                                                  | PASS   |
| SLR-12      | `global.css`: `--section-pad: clamp(4rem, 8vw, 6rem)` on `.section-frame` and `.statement-grid`; `h2` `clamp(1.9rem, 3.4vw, 3rem)`; `.install`, `.diagram*`, `.travels-grid`, stacked table inside `@media (max-width: 680px)`; `visual-system-contract.test.mjs` 4/4; exactly one `:root[data-theme="light"]` block for the product tokens (PR-C's Starlight light block untouched)                                  | PASS   |
| SLR-13      | `index.astro` reviewed: no `<a>` inside `<p>`, no raster, no `<script>`; `check-built-site.mjs` rejects `production-ready`; the built homepage contains "A production release is not." and no "stable" or "1.0 release" claim                                                                                                                                                                                         | PASS   |
| SLR-14      | Lighthouse table above; e2e Axe (dark and light) 0 violations on `/`; `h1` count 1; `getByLabel("Current public status")` count 1; 4 mobile links; no `a[href^="/"]:not([href^="/verchestra/"])`; viewport matrix overflow ≤ 1 px; no third-party request; `check:built` 135 pages, JS 1116 B, transfer 249 585 B                                                                                                     | PASS   |
| SLR-15      | `site.spec.ts` "landing renders the install block, both diagrams, and the derived numbers" (new) and "mobile navigation and the status remain usable in the first viewport" (extended): install block visible, ends at x ≤ 390, `overflow-x: auto`; `.diagram[role=img]` count 2; drawings hidden and lists visible on a phone; stacked matrix                                                                        | PASS   |

## Acceptance criteria

| Criterion                                               | Evidence                                                                                                                                      | Result |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| AC1 built homepage installs the ledger's latest release | `check-built-site.mjs`; `grep` of `dist/index.html` finds only `npx verchestra@0.0.0-qualification.8`                                         | PASS   |
| AC2 `/` at 1280 px                                      | e2e "landing renders the install block, both diagrams, and the derived numbers"                                                               | PASS   |
| AC3 `/` at 390 by 844                                   | e2e "mobile navigation and the status remain usable" and "product touch targets"                                                              | PASS   |
| AC4 Mermaid drift fails the unit test                   | `architecture-diagram-labels.test.mjs` compares labels and edges by value (verified by reading the assertions; both inputs are tracked files) | PASS   |
| AC5 ledger drift and hand-typed version                 | `check-built-site.mjs` ledger assertion; `beta-tester-docs.test.mjs` pinned document                                                          | PASS   |
| AC6 gates                                               | table above; `astro check` and `lhci autorun` recorded as CI-only                                                                             | PASS   |

## Edge cases

- `import.meta.url` in page frontmatter: the first build failed with
  `ENOENT ... apps\docs\qualification\tuf-publication-ledger.json`, because
  at build time it names the prerender chunk under `dist/.prerender/chunks/`.
  `repository-root.ts` now takes the root from `astro:config/server`.
- Hero overflow on a phone: with a bare `1fr` track the install block widened
  `.hero__copy` to 544 px at a 390 px viewport while `.product-page { overflow:
hidden }` hid it from the page-width check (the pill measured 461 px wide).
  Fixed with `minmax(0, 1fr)` and `min-width: 0`; the e2e now asserts the
  block ends inside the viewport.
- The inner `<svg>` exposing a second `img` role: fixed with `aria-hidden`,
  see "Alternate e2e port".
- A failed build leaves `dist/.prerender/` behind, which the census then
  scans as nine unclassified sources; a successful build removes it. Nothing
  to commit.

## Visual check

Built site served on port 4334 and inspected in the desktop app's browser
pane: dark landing at 1440 px (hero with the drawing on the right, the two
trust columns, the matrix, the handoff path and guarantee grid, the probe
panel, the architecture drawing with its twelve nodes, the status strip, the
exclusion list, and the community call to action) and at 390 px (pill first,
install block scrolling inside the viewport, stage list in place of the
drawing, stacked matrix cards, edge list in place of the architecture
drawing). The light theme was verified by the e2e viewport matrix and the
Axe light-mode run; the pane stopped painting before a light screenshot
could be taken.
