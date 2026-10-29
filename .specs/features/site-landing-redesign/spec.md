# Site Landing Redesign Specification

## Problem statement

The public landing page (`apps/site/src/pages/index.astro`) was judged "very
bad" by the owner on 2026-10-29: nine near-identical full-height sections
(label, oversized H2, two columns of abstract prose), no real diagram (the
"diagrams" were boxes of nouns: `.execution-score`, `.architecture-map`), no
install command although the package is published on npm, no number a reader
could check, and a capability table that collapsed on phones. PR-A
(`site/status-truth`) made every status string honest and PR-C
(`site/docs-chrome`) unified the documentation chrome; both are on `main`.
This is PR-B of that three-PR redesign: the page itself.

## Goals

- Seven sections, each carrying one concrete artefact: a command, a number, a
  drawing, or a table.
- Every number on the page is derived at build time from the repository the
  site projects (the TUF publication ledger, the qualification reports, the
  typed product data); nothing is typed in by hand.
- The two drawings are inline SVG with a role, a title, a description, and a
  text equivalent, drawn from typed data so they cannot drift from the
  documents they mirror.
- The page keeps every gate it has: Lighthouse, Axe in both themes, the
  44-pixel touch contract, the viewport matrix, the homepage byte budgets,
  the pinned status strings.

## Out of scope

- Status strings, `productStatus`, `README.md`, the hand-written guides
  (PR-A, merged).
- The Starlight chrome, the light-token block, and the Starlight region of
  `global.css` (PR-C, merged).
- Any new production dependency or client framework (ISP-06 in
  `.specs/features/impeccable-site-polish/spec.md`): Mermaid stays a
  documentation-page feature; the landing drawings are hand-authored SVG.
- Any claim of production readiness, stability, or a 1.0 release.

## Decisions

- Inline SVG, not Mermaid, for the landing drawings: client Mermaid is about
  600 KB against the 75 KB homepage script budget, and build-time Mermaid
  needs a headless-browser dependency the site may not add.
- The architecture drawing's labels and edges live in
  `apps/site/src/lib/architecture-diagram.ts` and are pinned to the Mermaid
  block of `docs/architecture.md` by a unit test, so the drawing is a
  projection of the document, never a second source.
- The repository root reaches the page through `astro:config/server`
  (`apps/site/src/lib/repository-root.ts`): `import.meta.url` inside page
  frontmatter names the prerender chunk under `dist/` at build time, which the
  first build proved by failing to find the ledger under `apps/`.
- On narrow screens (at or below 680 px) each drawing gives way to the same
  data as text: the delivery stages as the existing `<ol>`, the architecture
  as its edge list. A 960-unit drawing at 358 px is not readable.

## Requirements

| ID     | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SLR-01 | The hero SHALL render `productHeadline` as the only `h1`, `productDefinition`, the status pill (`aria-label="Current public status"`, containing `0.0.0-qualification`, `T77 verified`, `1.0 decision: signed hold`, `order: 1` on a phone), and an install block `pre.install` with `npx verchestra@<version> --version` and `npx verchestra@<version> self-test --profile smoke`, one caption, no copy button, no new script.                                                                           |
| SLR-02 | `<version>` SHALL be `publishedLauncherVersion(repositoryRoot)` from `src/lib/repository-content.ts`: the `semanticVersion` of the `release` entry with the highest `sequence` in `docs/qualification/tuf-publication-ledger.json`, read with `JSON.parse` only, throwing when no release entry exists. A unit test SHALL assert it equals the ledger's latest release and that it ignores `role-refresh` entries.                                                                                        |
| SLR-03 | `check-built-site.mjs` SHALL assert the homepage contains `npx verchestra@<ledger latest> --version` and pins no other version; `tests/agent-readiness/beta-tester-docs.test.mjs` SHALL list `apps/site/src/pages/index.astro` among its pinned documents so a hard-coded version there fails.                                                                                                                                                                                                            |
| SLR-04 | The hero's calls to action SHALL be "Install the beta build" → `docs/install-and-run/`, "View on GitHub", and the text link "Read the signed 1.0 hold" → `https://github.com/accd/verchestra/blob/main/docs/qualification/release-decision-1.0.0.md`.                                                                                                                                                                                                                                                     |
| SLR-05 | The hero's right column SHALL be `src/components/DeliveryFlowDiagram.astro`: inline SVG mapped over `deliveryStages` (six nodes, Request to Human review) with a signed-package seal between stages 3 and 4, a `.diagram[role="img"]` wrapper labelled by `<title>` and `<desc>`, `aspect-ratio: 960 / 420`; hidden at or below 680 px where the `<ol>` of the same stages shows.                                                                                                                         |
| SLR-06 | Section 2 ("What travels. What stays.") SHALL lead with `productScenario` and show two bordered columns: travels, signed (requirements, decisions, tasks, evidence digests, next action; violet rule) and stays local (credentials, provider sessions, tokens, machine paths; amber rule), matching the trust model in `docs/architecture.md`.                                                                                                                                                            |
| SLR-07 | Section 3 SHALL keep the label "What works today" and the row "Workspace initialization (init preview and apply)", with the headline `{capabilityMatrix.length} capabilities, {reportCount} public reports, one maturity each.` where `reportCount` is `compileQualificationStatus(repositoryRoot).reportCount`; every `td` SHALL carry `data-label`; at or below 680 px the header row leaves the screen visually and rows render as cards with the evidence link full-width and at least 44 px tall.    |
| SLR-08 | Section 4 SHALL be headed "Start in Claude Code. Continue in OpenCode / Qwen.", keep `.handoff-path` (its node still reads exactly "OpenCode / Qwen"), and render `guarantees` as a 3 by 2 grid with one concrete `clause` each from `product.ts`.                                                                                                                                                                                                                                                        |
| SLR-09 | Section 5 SHALL be headed "Seven engines, one no-writer contract." with the count derived from `databases.length`, keep `.database-panel` with "SAP ASE / Sybase" exact, and keep the `live-qualified` / `contract-verified` labels.                                                                                                                                                                                                                                                                      |
| SLR-10 | Section 6 SHALL render `src/components/ArchitectureDiagram.astro`: inline SVG whose nodes and edges come from `src/lib/architecture-diagram.ts`, a `.diagram[role="img"]` wrapper labelled by `<title>` and `<desc>`, colours through page tokens, a `<ul class="diagram-text">` edge list visually hidden beside the drawing and shown in its place at or below 680 px. `tests/unit/architecture-diagram-labels.test.mjs` SHALL pin every label and edge to the Mermaid block in `docs/architecture.md`. |
| SLR-11 | Section 7 SHALL keep the T01 → T77 → "1.0: signed hold" strip, the derived `qualificationSummary`, the link "Inspect T77 evidence" → `docs/qualification/t77-validation/`, the heading "What Verchestra is not" over `notToday`, and the community calls to action (Discussions, Contribute).                                                                                                                                                                                                             |
| SLR-12 | `global.css` SHALL define `--section-pad: clamp(4rem, 8vw, 6rem)` and use it on `.section-frame` and `.statement-grid`, scale section `h2` at `clamp(1.9rem, 3.4vw, 3rem)`, and add `.install`, `.diagram`, `.travels-grid`, and the stacked table inside the existing `@media (max-width: 680px)`; every literal `visual-system-contract.test.mjs` greps SHALL stay, and no second `:root[data-theme="light"]` block SHALL be added.                                                                     |
| SLR-13 | Copy SHALL contain no inline `<a>` inside a paragraph, no raster, no new `<script>`, and no "production", "stable", or "1.0 release" claim; every status statement keeps its hedge.                                                                                                                                                                                                                                                                                                                       |
| SLR-14 | Every gate SHALL stay green with equivalent assertions only: Lighthouse budgets, Axe zero violations on `/` in both themes, exactly one `h1`, exactly one "Current public status", 4 links in `details.mobile-nav`, no `a[href^="/"]:not([href^="/verchestra/"])`, no horizontal overflow at 360/768/1440 in both themes, no third-party request, at least 119 pages with unique titles, homepage JS under 75 KB and transfer under 500 KB compressed.                                                    |
| SLR-15 | e2e SHALL add: the install block visible at 390 by 844 and ending inside the viewport, both `.diagram[role=img]` present on `/`, the stage list and edge list visible on a phone in place of the drawings, and the stacked matrix.                                                                                                                                                                                                                                                                        |

## Acceptance criteria

1. WHEN the site is built THEN the homepage contains `npx verchestra@` followed
   by the ledger's latest release version, twice, and no other version.
2. WHEN `/` is opened at 1280 px THEN `h1` appears once, `.diagram[role=img]`
   twice, `pre.install` is visible with `tabindex="0"`, and the headings "What
   travels. What stays." and "N capabilities, M public reports, one maturity
   each." are visible.
3. WHEN `/` is opened at 390 by 844 THEN the status pill is in the first
   viewport, `pre.install` is visible, ends at or before x = 390 and scrolls
   horizontally, both drawings are hidden, `ol.delivery-list` shows six items,
   `ul.diagram-text` is visible, the matrix header row is at most 1 px tall,
   and every visible link, button, and summary is at least 44 by 44.
4. WHEN `docs/architecture.md`'s Mermaid block gains, loses, or relabels a node
   or edge THEN `architecture-diagram-labels.test.mjs` fails.
5. WHEN the ledger gains a release entry with a higher sequence THEN the next
   build changes the install command and `check-built-site.mjs` holds; WHEN a
   version is typed into `index.astro` THEN `beta-tester-docs.test.mjs` fails.
6. WHEN the gates run THEN site unit tests, build, `check:built`, e2e on
   Chromium, Firefox, and WebKit, `gate:quick`, the architecture and
   agent-readiness tests, and `agent:check` exit zero with no skipped or
   weakened test; `astro check` and `lhci autorun` are recorded as CI-only on
   the authoring machine, with direct Lighthouse CLI numbers as evidence.

## Edge cases

- A ledger with release entries out of sequence order: the highest `sequence`
  wins, not the last entry.
- A ledger whose latest entry is a `role-refresh`: ignored; the latest
  `release` is used.
- A bare `1fr` grid track below 900 px let the install block's longest command
  widen the hero column past the viewport while `.product-page` clipped the
  overflow, so the page-width check could not see it; the track is
  `minmax(0, 1fr)` and the e2e asserts the block ends inside the viewport.
- The `thead` is clipped to 1 px rather than `display: none`, so the table
  keeps its column headers for assistive technology while the cards name their
  columns through `data-label`.
