---
schema: verchestra-feature-handoff/v1
feature: impeccable-site-polish
issue: null
status: in_progress
branch: design/impeccable-site-polish
baseRevision: 8e4f64f95c6701d32ee491ee038ea41a52fd29a2
lastCompletedTask: T2
nextTask: T3
lastGate: focused unit and Chromium visual contract tests
updatedAt: 2026-07-26T01:19:48Z
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

# Next Exact Action

Consolidate semantic CSS tokens and shared product/Starlight foundations while
keeping the T2 visual contract green.

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
