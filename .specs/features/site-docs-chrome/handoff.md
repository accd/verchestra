---
schema: verchestra-feature-handoff/v1
feature: site-docs-chrome
issue: null
status: verification
branch: site/docs-chrome
baseRevision: d2f6de855089e1496a6d9a95c01c54975da1120e
lastCompletedTask: T6
nextTask: Human review and merge decision of the PR
lastGate: unit 68, build 135 pages, check:built, e2e 63/63 on three browsers, gate:quick, architecture 148, agent:check; astro check and lhci autorun left to CI (validation.md)
updatedAt: 2026-10-29T00:00:00Z
---

# Scope

PR-C of the three-PR site redesign: Starlight pages share the product chrome,
documentation light mode renders, projected pages render one `<h1>`, and a
Mermaid block keeps its text equivalent until its SVG exists. Requirements
SDC-01 to SDC-13 in spec.md.

# Completed Evidence

T1 complete. `apps/site/src/components/StarlightHeader.astro`,
`StarlightMobileMenuFooter.astro`, and `StarlightFooter.astro` override
Starlight's `Header`, `MobileMenuFooter`, and `Footer` (registered in
`apps/site/astro.config.ts` next to `Head` and `Search`). The header keeps
Starlight's `SiteTitle` (restyled as the wordmark through the existing
`.site-title` rule in the Starlight section of `global.css`), adds
`nav[aria-label="Product navigation"]` with Docs / Roadmap / Community hidden
below `md` through `sl-hidden md:sl-flex`, then the existing
`StarlightSearch.astro` (imported directly), `SocialIcons`, and Starlight's
`ThemeSelect`. The mobile menu lists the same three links as a plain list
above the default `MobileMenuFooter`. The footer renders the default footer,
then the product block with the same targets as `ProductLayout.astro`. The
links and the current-page rule live in `apps/site/src/lib/site-chrome.ts`.

T2 complete. `global.css` gains a second `:root[data-theme="light"]` block
right after the product light block with the twelve Starlight light tokens,
unlayered, so they beat the unlayered dark tokens the same way those beat
Starlight's layered palette. The dark tokens stay where
`visual-system-contract.test.mjs` greps them.

T3 complete. `repository-docs-loader.ts` strips the Markdown H1 from the body
with `withoutLeadingTitle` (still exported from `llm-content.ts`, where
`tests/unit/regex-linearity.test.mjs` imports it), after the YAML front matter
that the T68a to T77 reports open with (`parseFrontmatter` is now exported
from `llm-content.ts` for that; its body starts with a blank line, hence the
`trimStart()`). Titles still come from `extractTitle(originalMarkdown)`.
`check-built-site.mjs` now asserts exactly one `<h1` on every built page; the
first build after the plain `withoutLeadingTitle` call still had two on the 13
front-matter reports, which is what that assertion caught.

T4 complete. `StarlightHead.astro` builds the diagram element off-DOM, awaits
`mermaid.render`, then replaces the code block; blocks already rendered
re-render in place on a theme change (the light re-render still contains
`#ffffff`); a block still pending its first render is marked and left to it.
`.mermaid-diagram` has no `min-height` any more (one line removed from the
product region of `global.css`, the only edit there).

T5 complete. `site.spec.ts` adds three tests (chrome and one-h1, mobile menu,
light mode with white body and Axe); `site-chrome.test.mjs` adds four unit
tests; `check-built-site.mjs` adds the one-h1 assertion. No existing
assertion changed.

T6: gates recorded in validation.md.

# Next Exact Action

Human review and merge decision of the PR `feat(site): unify docs chrome and
fix light mode` against `main`. Confirm the two gates the authoring machine
could not complete are green in CI: `astro check` (`pnpm site:check`, crashes
locally in `@emnapi/runtime`) and `lhci autorun` (`test:lighthouse`, locked
locally at Chrome profile cleanup; three direct audits meet every assertion,
see validation.md). Nothing has been merged, published, or deployed by this
feature.

# Blockers

None.

# Decisions

- Starlight's own `ThemeSelect` stays in the documentation header instead of
  the product toggle: its script owns the `starlight-theme` storage key, and
  the product toggle writes the same key, so the two agree.
- The mobile menu's product links are a plain list, not a second `nav`: the
  menu already sits inside the sidebar's "Main" navigation landmark.
- The product chrome link data lives in `site-chrome.ts`; `ProductLayout.astro`
  keeps its own copy because PR-B owns it. The unit test pins both to the same
  targets.
- `.mermaid-diagram`'s `min-height` line was removed in place rather than
  overridden from the Starlight section, as the smallest diff for PR-B to
  rebase over.

# Files Intentionally Left Unchanged

- `README.md`, `apps/site/src/pages/index.astro`, `apps/site/src/data/product.ts`,
  the hand-written guides, and the product region of `global.css` (PR-A and
  PR-B), except the one `min-height` line.
- Dependency manifests and the lockfile.
