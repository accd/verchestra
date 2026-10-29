# Site Docs Chrome Specification

## Problem statement

The public site (`apps/site`, Astro + Starlight) has two page families. The
product pages (landing, community, 404) render `ProductLayout.astro` with the
product header (wordmark, Docs / Roadmap / Community / GitHub), the product
footer, and the theme toggle. Every Starlight page (`/docs/**`, `/roadmap/`)
renders Starlight's default header and footer instead, so the product
navigation disappears the moment a reader enters the documentation. Three
defects compound this (diagnosed 2026-10-29):

- R7: documentation light mode is broken. `global.css` sets the dark
  `--sl-color-*` tokens on `:root` outside any cascade layer, which beats
  Starlight's light palette in `@layer starlight.base`. `:root[data-theme="light"]`
  redefines the product tokens but no `--sl-*` token, so a light documentation
  page keeps `--sl-color-black: #070a12` as its body background. The e2e suite
  ran Axe in dark only, so nothing caught it.
- R8a: projected Markdown pages (roadmap, architecture system overview,
  contributing, security, support, versioning, code of conduct, and every
  `tNN-validation` report) render two `<h1>`: Starlight's page title plus the
  Markdown H1 the loader kept in the body.
- R8b: `StarlightHead.astro` replaces the Mermaid code block with an empty
  `div.mermaid-diagram` (18rem min-height) before the Mermaid bundle resolves,
  so the first paint shows an empty box.

This is PR-C of the owner-approved three-PR site redesign. PR-A (honest status
strings) and PR-B (landing redesign) own `README.md`, `index.astro`,
`product.ts`, the hand-written guides, and the product region of
`global.css`; this change does not touch them.

## Goals

- Starlight pages share the product chrome: wordmark, product navigation,
  product footer, in both themes, with Starlight's own search, social icons,
  and theme select kept.
- Documentation light mode renders a white page with readable chrome and zero
  Axe violations.
- Every public page renders exactly one `<h1>`.
- A Mermaid block keeps its text equivalent on screen until its SVG exists.

## Out of scope

- Landing-page copy, status strings, `product.ts`, `README.md`, and the
  hand-written guides (PR-A and PR-B).
- The product region of `global.css` above the Starlight section, except the
  one `min-height` line the Mermaid fix requires.
- New production dependencies, client frameworks, or a change of the wordmark,
  fonts, or violet/cyan/amber identity.
- Any claim of production readiness or a 1.0 release.

## Requirements

| ID     | Requirement                                                                                                                                                                                                                                                                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDC-01 | Every Starlight page SHALL render a header with the site title styled as the wordmark, a `nav` labelled "Product navigation" holding Docs / Roadmap / Community, Starlight's search, social icons, and theme select. The label SHALL differ from the sidebar's "Main" (Axe `landmark-unique`).                                                                                                       |
| SDC-02 | The product navigation SHALL mark Docs current on every page below `/verchestra/docs/` and Roadmap current on `/verchestra/roadmap/` alone, with `aria-current="page"`.                                                                                                                                                                                                                              |
| SDC-03 | Below Starlight's `md` breakpoint the header navigation SHALL hide through Starlight's `sl-hidden md:sl-flex` utilities, and the mobile menu SHALL list the same three links above Starlight's own mobile preferences.                                                                                                                                                                               |
| SDC-04 | Every Starlight page SHALL end with Starlight's default footer (pagination) followed by the product footer: wordmark, "Verified AI software delivery. Apache-2.0.", and the links Documentation / Agent guide / LLM summary / Discussions / Issues with the same targets as `ProductLayout.astro`.                                                                                                   |
| SDC-05 | Every product chrome link SHALL offer at least a 44 by 44 CSS-pixel target and SHALL meet WCAG AA contrast in both themes.                                                                                                                                                                                                                                                                           |
| SDC-06 | `:root[data-theme="light"]` SHALL define the Starlight light tokens outside any cascade layer, so a light documentation page has a `rgb(255, 255, 255)` body background. The dark tokens SHALL stay unlayered top-level literals (`visual-system-contract.test.mjs` greps them).                                                                                                                     |
| SDC-07 | Light `docs/` and `roadmap/` SHALL have zero Axe violations.                                                                                                                                                                                                                                                                                                                                         |
| SDC-08 | Projected Markdown pages SHALL drop the Markdown H1 from the body through `withoutLeadingTitle` (kept in `llm-content.ts`), after any YAML front matter; titles SHALL still come from `extractTitle(originalMarkdown)`. Every built page SHALL contain exactly one `<h1>`.                                                                                                                           |
| SDC-09 | Mermaid rendering SHALL build the diagram element off-DOM, await `mermaid.render`, then replace the code block; the theme-change re-render SHALL keep replacing `innerHTML` in place; `.mermaid-diagram` SHALL have no `min-height`; the `DOMContentLoaded` trigger SHALL stay.                                                                                                                      |
| SDC-10 | Starlight's `ThemeSelect` SHALL stay in the header, since its script owns the `starlight-theme` storage key the product toggle also writes; theme persistence from the landing page to `docs/` SHALL keep passing.                                                                                                                                                                                   |
| SDC-11 | Starlight component defaults SHALL be imported from `@astrojs/starlight/components/<Name>.astro`, never from `virtual:starlight/*`; the search override SHALL be imported directly so its accessible-name fix stays.                                                                                                                                                                                 |
| SDC-12 | Every existing site assertion SHALL stay green: Ctrl+K opens the "Search" dialog, `button[data-open-modal]` is named `Search <keys>`, exactly 4 links in the product mobile nav on `/`, no `a[href^="/"]:not([href^="/verchestra/"])`, no horizontal overflow at 360/768/1440 in both themes, `docs/index.html` contains "T01–T77 evidence", at least 119 pages with unique titles and descriptions. |
| SDC-13 | No new `JSON.stringify`, `localeCompare`, or `createHash` call in `.ts`/`.mjs` under `apps/site` (the canonical-JSON census pins exact counts per file); no import cycle (`tests/architecture/no-import-cycles`).                                                                                                                                                                                    |

## Acceptance criteria

1. WHEN `docs/` is opened at desktop width THEN the "Product navigation"
   landmark holds the links Docs, Roadmap, Community in that order, Docs is
   `aria-current="page"`, each link is at least 44 by 44, and the "Footer
   navigation" landmark holds Documentation, Agent guide, LLM summary,
   Discussions, Issues.
2. WHEN `roadmap/` is opened THEN Roadmap is `aria-current="page"`, Docs is
   not, and the page has exactly one `h1`; `docs/architecture/system-overview/`
   has exactly one `h1`.
3. WHEN `docs/` is opened at 390 pixels and the Starlight menu is opened THEN
   the product navigation landmark is hidden and the menu lists Docs, Roadmap,
   Community as visible 44 by 44 links.
4. WHEN `localStorage["starlight-theme"]` is `light` and `docs/` or `roadmap/`
   is loaded THEN `html[data-theme="light"]`, the body background is
   `rgb(255, 255, 255)`, and Axe reports zero violations.
5. WHEN the built site is checked THEN every HTML page contains exactly one
   `<h1`, and the existing checks (page count, unique titles and descriptions,
   alternates, links) pass.
6. WHEN `docs/architecture/system-overview/` loads THEN `.mermaid-diagram` has
   `role="img"`, its SVG is visible, the table stays visible, and the light
   re-render contains `#ffffff`; the built CSS has no `min-height:18rem`.
7. WHEN the gates run THEN site unit tests, site build, `check:built`, e2e on
   Chromium, Firefox, and WebKit, Lighthouse, `gate:quick`, the architecture
   tests, and `agent:check` all exit zero with no skipped or weakened test;
   `astro check` is recorded as not runnable on the authoring machine and left
   to CI.

## Edge cases

- Qualification reports that open with YAML front matter: the H1 follows the
  front matter, so the body is stripped after it (`parseFrontmatter`).
- A theme change while the first Mermaid render is still pending: the pending
  block is left to that render; blocks already rendered re-render in place.
- Two `nav` landmarks with the product links (header and mobile menu) at the
  same viewport: the mobile menu uses a plain list inside the sidebar's "Main"
  landmark, so no label is duplicated.
- The 4322 preview port shared with another worktree: a foreign preview must
  not be reused by `test:e2e` (see validation.md).
