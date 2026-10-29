---
schema: verchestra-feature-handoff/v1
feature: site-landing-redesign
issue: null
status: verification
branch: site/landing-redesign
baseRevision: d76c339557edae488e9ea68f6c0a8ea52e89cad6
lastCompletedTask: T6
nextTask: Human review and merge decision of the PR
lastGate: see validation.md; astro check and lhci autorun left to CI
updatedAt: 2026-10-29T22:00:00Z
---

# Scope

PR-B of the three-PR site redesign approved on 2026-10-29: the landing page
rebuilt as seven sections, each with one concrete artefact (a command, a
number, a drawing, or a table), every number derived at build time from the
repository. Requirements SLR-01 to SLR-15 in spec.md. PR-A (honest status
strings) and PR-C (documentation chrome) are on `main` and this branch builds
on them.

# Completed Evidence

T1 complete. `apps/site/src/lib/repository-content.ts` exports
`publishedLauncherVersion(repositoryRoot)`: the `semanticVersion` of the
`release` entry with the highest `sequence` in
`docs/qualification/tuf-publication-ledger.json` (today
`0.0.0-qualification.8`), `JSON.parse` only, throwing when no release entry
exists. `apps/site/src/lib/repository-root.ts` exports the repository root
from `astro:config/server`, because `import.meta.url` inside page frontmatter
names the prerender chunk under `dist/` at build time (the first build failed
looking for the ledger under `apps/`). Two tests in
`repository-content.test.mjs`.

T2 complete. `apps/site/src/lib/architecture-diagram.ts` holds the twelve
nodes (label verbatim, line split, geometry, tone), the eleven edges in
Mermaid order, and the orthogonal routing. `ArchitectureDiagram.astro` draws
them as inline SVG inside `.diagram[role="img"]` with `<title>` and `<desc>`,
followed by `ul.diagram-text`, the edge list. Five tests in
`architecture-diagram-labels.test.mjs` pin labels, edges, geometry, routing,
and the component's use of the module to the Mermaid block in
`docs/architecture.md`.

T3 complete. `DeliveryFlowDiagram.astro` maps `deliveryStages` onto a
960 by 420 snake (row one left to right, row two right to left) with the
amber signed-package seal between stages 3 and 4. Each guarantee in
`product.ts` carries a `clause`.

T4 complete. `index.astro`: hero (headline, definition, pill, install block,
three calls to action, the drawing, the stage list for phones), "What
travels. What stays.", "What works today" with the derived headline and a
stacked matrix on phones, "Start in Claude Code. Continue in OpenCode /
Qwen." with the handoff path and the 3 by 2 guarantee grid, "Seven engines,
one no-writer contract.", the architecture drawing, and the status section
that now also holds "What Verchestra is not" and the community calls to
action. `global.css` product region: `--section-pad`, the H2 scale,
`.install`, `.diagram*`, `.diagram-text`, `.delivery-list`, `.travels-*`,
`.guarantee-card__clause`, `.not-today`, the stacked table, and
`minmax(0, 1fr)` single-column tracks below 900 px (a bare `1fr` let the
install block widen the hero past the viewport).

T5 complete. `check-built-site.mjs` asserts the ledger's latest version in
the install command and no other pinned version, both drawings, and the new
headings; `site.spec.ts` adds one landing test and extends the phone test;
`tests/agent-readiness/beta-tester-docs.test.mjs` lists `index.astro` as a
pinned document.

T6: gates recorded in validation.md.

# Next Exact Action

Human review and merge decision of the PR `feat(site): rebuild the landing
page around real artefacts` against `main`. Confirm in CI the two gates the
authoring machine could not complete: `astro check` (`pnpm site:check`) and
`lhci autorun` (`test:lighthouse`); direct Lighthouse CLI audits of the build
are recorded in validation.md. Nothing has been merged, published, or
deployed by this feature.

# Blockers

None.

# Decisions

- Inline SVG rather than Mermaid for the landing drawings (script budget,
  no headless-browser dependency).
- The drawings' data lives in typed modules (`deliveryStages`,
  `architecture-diagram.ts`); the components only lay it out.
- Below 680 px the drawings are replaced by their text equivalents instead of
  being scaled down to an unreadable size.
- The `thead` of the stacked matrix is clipped to 1 px, not removed, so the
  table keeps its headers for assistive technology.
- `maturityDefinitions` are explained only for the states the matrix uses
  (available, qualified, experimental), derived from the matrix.

# Files Intentionally Left Unchanged

- Every validation report, the signed decision file, the ledger, `README.md`,
  the hand-written guides, `productStatus`.
- The Starlight region and the light-token block of `global.css` (PR-C).
- Dependency manifests and the lockfile.
