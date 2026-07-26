---
schema: verchestra-feature-handoff/v1
feature: impeccable-site-polish
issue: null
status: in_progress
branch: design/impeccable-site-polish
baseRevision: 8e4f64f95c6701d32ee491ee038ea41a52fd29a2
lastCompletedTask: T1
nextTask: T2
lastGate: node scripts/agent-check.mjs
updatedAt: 2026-07-26T01:10:59Z
---

# Scope

Refine the public Astro/Starlight site under ISP-01–ISP-08 while keeping
Impeccable globally installed and completely outside the tracked repository.

# Completed Evidence

T1 complete. The global Codex skill is installed at version 4.0.2, the CLI
reports version 3.3.1, no project hook is active, and the repository was clean
before T1. `node scripts/agent-check.mjs` passed after the provider-neutral
specification, design, tasks, context, and handoff were added.

# Next Exact Action

Add deterministic unit and browser tests for ISP-01–ISP-08 before changing the
site implementation.

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
