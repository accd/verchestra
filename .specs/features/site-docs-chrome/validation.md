# Site Docs Chrome Validation

**Date**: 2026-10-29
**Spec**: `.specs/features/site-docs-chrome/spec.md`
**Base**: `d2f6de855089e1496a6d9a95c01c54975da1120e` (`origin/main`)
**Branch**: `site/docs-chrome`
**Verifier**: the author, on the Windows authoring machine; independent review
is the PR review.

## Verdict

**PASS on every gate that completed here** (unit, build, built-site check,
e2e on three browsers, quick gate, architecture, census, agent check). Two
gates are left to the Ubuntu CI run: `astro check` cannot start on this
machine, and `lhci autorun` cannot finish three consecutive runs on it, though
three direct audits of the build meet every one of its assertions (see
"Lighthouse on this machine").

## Gates

| Gate                            | Command                                                                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site unit tests                 | `corepack pnpm --filter @verchestra/site test:unit`                      | 68 tests, 68 pass, 0 fail, 0 skipped (64 existing + 4 in `site-chrome.test.mjs`)                                                                                                                                                                                                                                                                                                                                                       |
| Site build                      | `corepack pnpm --filter @verchestra/site build`                          | 135 pages built, Pagefind index over 135 files, exit 0                                                                                                                                                                                                                                                                                                                                                                                 |
| Built-site check                | `corepack pnpm --filter @verchestra/site check:built`                    | `{"pages":135,"compressedJavaScript":1116,"compressedTransfer":247510,"internalLinks":"valid","metadata":"valid"}`; the new one-`<h1` assertion holds on all 135 pages                                                                                                                                                                                                                                                                 |
| e2e (Chromium, Firefox, WebKit) | `playwright test --config <scratchpad>/docs-chrome-playwright.config.ts` | 63 passed (21 tests × 3 browsers), 0 failed, 0 flaky, 0 skipped, 3.1 min, exit 0 — on port 4326, see "Alternate e2e port" below                                                                                                                                                                                                                                                                                                        |
| Lighthouse                      | `corepack pnpm --filter @verchestra/site test:lighthouse`                | **Not completed by `lhci autorun` on this machine** (see "Lighthouse on this machine"): 20 autorun attempts, 9 single audits completed, never 3 in a row. Three direct Lighthouse CLI audits of the same build with the gate's preset and Chrome flags all score performance 1, accessibility 1, best-practices 1, SEO 1, LCP 326–330 ms, CLS 0.0004–0.0009, inside every assertion of `lighthouserc.cjs`. CI runs the gate on Ubuntu. |
| Quick gate                      | `corepack pnpm gate:quick`                                               | `gate:quick PASS` (format:check, lint, complexity:check, typecheck, test:unit, test:agent-readiness, test:census), exit 0, run twice                                                                                                                                                                                                                                                                                                   |
| Architecture tests              | `node --test tests/architecture/*.test.mjs`                              | 148 tests, 148 pass, 0 fail, 0 skipped (includes `no-import-cycles`)                                                                                                                                                                                                                                                                                                                                                                   |
| Canonical-JSON census           | `corepack pnpm run test:census`                                          | 14 pass, 0 fail; no signal count changed (`site-chrome.ts` has none; `llm-content.ts` only gained an `export` keyword)                                                                                                                                                                                                                                                                                                                 |
| Agent check                     | `corepack pnpm agent:check`                                              | `agent:check PASS`                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Prettier                        | `corepack pnpm exec prettier --write <every new or changed file>`        | Applied; `format:check` inside `gate:quick` is green                                                                                                                                                                                                                                                                                                                                                                                   |

### Not runnable here

`pnpm site:check` runs `astro check`, which crashes on this Windows machine
inside `@emnapi/runtime@2.0.0-alpha.3` when `@astrojs/check` is imported, on
`main` too. CI runs it on Ubuntu; it is the one gate this record does not
carry. The three commands that `site:check` wraps besides it (`test:unit`,
`build`, `check:built`) ran and are recorded above.

### Alternate e2e port

`apps/site/playwright.config.ts` binds `127.0.0.1:4322` with
`reuseExistingServer` on outside CI. A stale `astro preview` from the main
checkout has held 4322 since 2026-10-28 and serves an old build; it could not
be stopped from this session. A run through `test:e2e` would therefore attach
to the wrong build. The suite ran instead through a scratchpad-only config
(never inside the worktree) that spreads the repository config and overrides
only `use.baseURL`, `webServer.url`, and `webServer.command` to port 4326,
sets `webServer.cwd` to `apps/site`, and sets `reuseExistingServer: false`.
Spec file, browsers, workers, and timeouts are the repository's. The first
queued run through `test:e2e` was stopped before any result was read once the
foreign server was identified (`docs/` on 4322 had no "Product navigation").

### Lighthouse on this machine

The first runs inside the harness shell sandbox failed with `NO_FCP` (Chrome
painted nothing) and `EPERM` on `%TEMP%\lighthouse.*`; outside the sandbox the
page loads and audits, but chrome-launcher's profile cleanup intermittently
hits the Windows temporary-directory lock that `scripts/run-lighthouse.mjs`
retries once for (handoff of impeccable-site-polish records the same lock).
Three clean runs in a row are needed per attempt. Twenty `test:lighthouse`
attempts (one direct, then loops of 4, 5, 6, and 10) never got three: nine
single audits completed and the rest failed at cleanup with
`EPERM ... \Temp\lighthouse.<id>`, after the page had loaded and the audits
had run. `--disable-crashpad` did not change it, no `lighthouse.*` directory
or headless Chrome was left behind between attempts, and the only Chrome
processes on the machine were the user's own browser. Because lhci clears
`.lighthouseci` at the start of every autorun, those completed audits left no
report on disk.

To get real numbers, the Lighthouse CLI (`lighthouse@13.5.0`, the version lhci
uses) ran three times directly against `astro preview` on 4323 with the
gate's settings (`--preset=desktop`, the four categories, the same
`--chrome-flags`) and `--output-path` to a scratchpad file, which Lighthouse
writes before the cleanup that fails. Every run wrote a complete report
(about 675 KB) and then exited 1 on the same `EPERM`. Scores, in run order:

| Run | Performance | Accessibility | Best practices | SEO | LCP (ms) | CLS    |
| --- | ----------- | ------------- | -------------- | --- | -------- | ------ |
| 1   | 1           | 1             | 1              | 1   | 330      | 0.0009 |
| 2   | 1           | 1             | 1              | 1   | 327      | 0.0004 |
| 3   | 1           | 1             | 1              | 1   | 326      | 0.0004 |

Against `lighthouserc.cjs`: performance median 1 ≥ 0.95; accessibility,
best-practices, and SEO 1 on every run (pessimistic); LCP ≤ 2500 and CLS ≤ 0.1
on every run (pessimistic). The gate command itself did not exit 0 here, so
this row is evidence, not a pass of the declared gate; the Ubuntu CI run is
the pass. The direct runs happened after the e2e run and with no other
preview of this project active (Astro allows one preview per project, which
is also why the e2e and Lighthouse never ran at the same time).

## Spec-anchored requirement traceability

| Requirement | File:line + assertion/inspection                                                                                                                                                                                                                                                              | Result |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| SDC-01      | `StarlightHeader.astro` renders `nav[aria-label="Product navigation"]` between `SiteTitle` and `Search`, then `SocialIcons` and `ThemeSelect`; `site.spec.ts` "documentation pages share the product chrome" asserts the three links; Axe (dark and light) passes, so `landmark-unique` holds | PASS   |
| SDC-02      | `site-chrome.test.mjs` pins Docs current below `docs/` (including `docs/community/contributing/`) and Roadmap only on `roadmap/`; `site.spec.ts` asserts `aria-current="page"` on `docs/` and `roadmap/`                                                                                      | PASS   |
| SDC-03      | Header nav carries `sl-hidden md:sl-flex`; `site.spec.ts` "the mobile documentation menu lists the product navigation" asserts the landmark hidden at 390 px and the menu list visible with the three links; browser check at 390 px: `display: none`, overflow 0                             | PASS   |
| SDC-04      | `StarlightFooter.astro` renders `DefaultFooter` then `.product-footer`; `site.spec.ts` asserts the five footer links in order and `LLM summary` → `/verchestra/llms.txt`; `site-chrome.test.mjs` pins the five targets                                                                        | PASS   |
| SDC-05      | Every chrome link is `inline-flex` with `min-width`/`min-height: 2.75rem`; `site.spec.ts` asserts no header link box below 44 × 44 and every mobile menu link ≥ 44 × 44; Axe `color-contrast` passes in both themes (`--muted` on the header: 9.4:1 dark, 6.6:1 light)                        | PASS   |
| SDC-06      | `global.css` second `:root[data-theme="light"]` block with the twelve `--sl-*` tokens, unlayered; dark tokens untouched; `visual-system-contract.test.mjs` passes; `site.spec.ts` asserts body `rgb(255, 255, 255)` on light `docs/` and `roadmap/`                                           | PASS   |
| SDC-07      | `site.spec.ts` "light documentation pages have a white page and no Axe violations" — `expect(results.violations).toEqual([])` on both pages                                                                                                                                                   | PASS   |
| SDC-08      | `repository-docs-loader.ts` applies `withoutLeadingTitle` to the body after `parseFrontmatter` and `trimStart()`; `check-built-site.mjs` asserts exactly one `<h1` on every page (135); `site.spec.ts` asserts `h1` count 1 on `roadmap/` and `docs/architecture/system-overview/`            | PASS   |
| SDC-09      | `StarlightHead.astro` `renderMermaid`: off-DOM element, `await paint(diagram)` then `frame.replaceWith(diagram)`; rendered diagrams re-painted in place; `.mermaid-diagram` has no `min-height`; existing Mermaid e2e (role, SVG, table, `#ffffff` after light) passes                        | PASS   |
| SDC-10      | `ThemeSelect` imported from `@astrojs/starlight/components/ThemeSelect.astro`; existing "theme selection persists across product and documentation surfaces" passes                                                                                                                           | PASS   |
| SDC-11      | Imports in the three overrides are `@astrojs/starlight/components/*.astro` and `./StarlightSearch.astro`; no `virtual:starlight` import; "the documentation search button's name contains the shortcut it shows" passes                                                                       | PASS   |
| SDC-12      | Every pre-existing `site.spec.ts` test passes unchanged (63/63); `check-built-site.mjs` page, title, description, alternate, and `T01–T77 evidence` assertions pass                                                                                                                           | PASS   |
| SDC-13      | `test:census` 14/14 with no count change; `no-import-cycles` passes; `gate:quick` lint and complexity pass                                                                                                                                                                                    | PASS   |

## Acceptance criteria

| Criterion                                           | Evidence                                                                                                                                   | Result |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| AC1 desktop chrome on `docs/`                       | `site.spec.ts` "documentation pages share the product chrome and render one heading"                                                       | PASS   |
| AC2 `roadmap/` current + one h1; system overview h1 | same test, second and third page                                                                                                           | PASS   |
| AC3 mobile menu at 390 px                           | `site.spec.ts` "the mobile documentation menu lists the product navigation"                                                                | PASS   |
| AC4 light docs: white body, zero Axe                | `site.spec.ts` "light documentation pages have a white page and no Axe violations"                                                         | PASS   |
| AC5 one `<h1` per built page + existing checks      | `check-built-site.mjs`, 135 pages                                                                                                          | PASS   |
| AC6 Mermaid                                         | existing reduced-motion/Mermaid e2e; built CSS has no `min-height:18rem`; browser check: SVG present, no `pre[data-language=mermaid]` left | PASS   |
| AC7 gates                                           | table above; `astro check` recorded as not runnable here                                                                                   | PASS   |

## Edge cases

- Front-matter reports: the first build with the plain `withoutLeadingTitle`
  call left two `<h1>` on the 13 reports T68a to T77; the built-output
  assertion caught it; fixed with `parseFrontmatter(...).body.trimStart()`.
- Wordmark clipping at 820 px and 390 px (title wrapper shrank with the search
  box): fixed with `flex: none` on the title wrapper; browser check after the
  rebuild shows the title text unclipped and zero horizontal overflow at both
  widths.
- Theme change during a pending first Mermaid render: the pending block is
  marked `data-mermaid-pending` and left to its own render.

## Visual check

Built site served on a separate port and inspected in the desktop app's
browser pane: dark and light `docs/` at 1280 px (wordmark, Docs / Roadmap /
Community, search, GitHub, theme select; white page in light), `roadmap/` at
390 px with the Starlight menu open (Docs / Roadmap underlined as current /
Community above GitHub and the theme select), `docs/architecture/system-overview/`
at 820 px and 390 px (one h1, Mermaid SVG present, overflow 0).
