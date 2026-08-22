---
schema: verchestra-feature-handoff/v1
feature: pi-runtime-0-84-2
issue: 285
status: complete
branch: codex/qualify-pi-0-84-2
baseRevision: 9b1c48febcb9e5aa4645ba14da5b835bb0b922ad
lastCompletedTask: T3
nextTask: No further action; issue #285 is closed.
lastGate: corepack pnpm test:agent-readiness
updatedAt: 2026-08-22T18:00:00Z
---

# Evidence

The Pi packages, installed manifest, Driver probe, spike contract, and
qualification matrix all agree on `0.84.2`. The focused Pi suite passes 12/12,
the qualification suite passes 251/251, and agent readiness passes 150/150.

# Next exact action

Publish this branch as the qualification successor to Dependabot #285 and
wait for Linux CI. Keep #285 open only until the successor is ready, then close
it with a link to the qualified replacement.
