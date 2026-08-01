---
schema: verchestra-feature-handoff/v1
feature: public-proof-artifact
issue: 155
status: planned
branch: docs/155-public-proof-artifact-spec
baseRevision: 4fb899498db4f170dd8e1b6fc7c8f5aa8e988243
lastCompletedTask: null
nextTask: Owner review of spec.md
lastGate: pnpm gate:quick
updatedAt: 2026-08-01T14:30:00Z
---

# Scope

One real, deterministic, regenerable Execution Package published on the site
and linked from the README, with drift protection. Specification only; no
design, tasks, or implementation exist yet — the flow stopped after Specify
by owner instruction.

# Next Exact Action

Owner reviews `spec.md` (requirements PRF-01..06) and answers the two open
decisions: seed fixture (recommended: the qualified cross-backend
delivery-proof fixture) and site route name. Then the Design phase bounds
the generator location and the build-time projection boundary.

# Blockers

Owner review of this specification.

# Decisions

- First artifact is an Execution Package (owner-approved direction from the
  2026-08 Plan Mode audit).
- The site consumes committed, reviewed bytes only; generation never runs in
  deploy. NestJS: not applicable.
