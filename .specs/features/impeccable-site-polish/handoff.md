---
schema: verchestra-feature-handoff/v1
feature: impeccable-site-polish
issue: null
status: complete
branch: design/impeccable-site-polish
baseRevision: 8e4f64f95c6701d32ee491ee038ea41a52fd29a2
lastCompletedTask: T6
nextTask: Human review and merge decision
lastGate: independent verification with 28 unit, 51 browser, Lighthouse, and 120-page build
updatedAt: 2026-07-26T02:19:02Z
---

# Scope

Refine the public Astro/Starlight site under ISP-01–ISP-08 while keeping
Impeccable globally installed and completely outside the tracked repository.

# Completed Evidence

T1 complete. The global Codex skill is installed at version 4.0.2, the CLI
reports version 3.3.1, no project hook is active, and the repository was clean
before T1. `node scripts/agent-check.mjs` passed after the provider-neutral
specification, design, tasks, context, and handoff were added.

T2 complete. Twenty-six site unit tests pass, including exact assertions that
no Impeccable artifact or dependency is tracked and that the incumbent fonts,
palette, focus treatment, and reduced-motion contract remain present. Two
focused Chromium tests pass across the required viewport/theme matrix and with
zero Axe violations on representative public surfaces.

The pre-existing full browser suite has 42 passes and three identical failures:
the contributing-with-agents page renders the concise `llms.txt` link as a
base-relative URL while the existing contract expects the absolute production
URL. No test was changed or weakened; the implementation must restore the
existing contract before T6.

T3 complete. The product and Starlight surfaces now share semantic typography,
content-width, spacing, radius, elevation, motion, and focus tokens. Product
navigation exposes the current section on desktop and mobile, the background
decoration is quieter, interactive feedback is consistent, and local fonts use
`font-display: swap`. All 27 unit tests, Astro diagnostics, and the four focused
Chromium tests pass.

T4 complete. The landing page now leads from product definition into a
typed, concrete cross-environment handoff scenario. The delivery path is an
editorial traversal instead of a floating card, guarantee cards are a single
evidence grid, heading tracking is restrained, supporting workflow copy is
larger, and mobile status precedes the headline. Dark and light desktop views,
the 390 × 844 mobile view, and the guarantee section were inspected from the
local build. All 27 unit tests, the build, and four focused Chromium acceptance
tests pass.

T5 complete. Mermaid now derives its palette from the active theme and
rerenders when that theme changes. Reduced motion disables only authored
transitions, touch devices no longer inherit hover lift, Windows forced-colors
receives explicit control edges, critical metadata is larger, and long reading
lines are bounded. The final source detector was clean. The rendered detector
identified repeated cyan/violet brand warnings plus real hierarchy, line
length, uppercase-label, and border/shadow findings; the real findings were
corrected while the explicitly approved brand palette was retained.

`agent:check`, `site:check`, `site:test`, `site:build`, and `gate:quick` pass.
The site suite covered Chromium, Firefox, WebKit, Axe, and Lighthouse. The
Windows Lighthouse cleanup hit a temporary-directory lock, used the runner's
single built-in retry, and completed successfully.

The rendered detector's 27 items were dispositioned without tracking its
provider-local output:

| Finding group                       | Count | Disposition and repository evidence                                                 |
| ----------------------------------- | ----: | ----------------------------------------------------------------------------------- |
| Violet/cyan palette or gradient     |    16 | Retained as the ISP-02 identity; full-theme Axe and Lighthouse gates pass.          |
| Long all-caps label                 |     1 | Fixed by shortening the hero eyebrow to “Verified delivery.”                        |
| Long reading line                   |     3 | Fixed with 38ch, 64ch, and 65ch reading bounds.                                     |
| Wide body tracking                  |     1 | Fixed by reducing workflow-header tracking to 0.05em.                               |
| Hairline border plus diffuse shadow |     1 | Fixed by removing elevation from the bordered database panel.                       |
| Repeated section kickers            |     5 | Fixed by removing four repeated kickers and retaining one contextual problem label. |

Independent validation then found that the reduced-motion browser assertion
sampled a control with no authored transition. The follow-up test now checks
the primary button, navigation link, and text link directly, proves hover
transform is absent under reduced motion, and proves the authored transition
returns under the default preference.

Re-verification matched all eight ISP requirements and all six acceptance
outcomes. The mandatory site gate passed with 28 unit tests, 51 browser tests
across Chromium, Firefox, and WebKit, zero skipped or todo tests, Lighthouse,
and a 120-page build. All three scratch-only discrimination mutations were
killed, including the previously surviving one-second button transition.

# Next Exact Action

Perform human visual review and decide whether to merge. Nothing has been
published, pushed, or deployed by this feature.

# Blockers

None.

# Decisions

- Preserve the incumbent visual identity; this is refinement, not redesign.
- Use Impeccable only as optional, temporary review input.
- Keep all tool artifacts, screenshots, hooks, and reports outside Git.
- Retain current site routes, product truth, status, and dependency set.

# Files Intentionally Left Unchanged

- Product packages and T69–T77 roadmap implementation.
- Canonical qualification evidence and repository architecture.
- Dependency manifests and lockfile.
