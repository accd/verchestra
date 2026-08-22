---
schema: verchestra-feature-handoff/v1
feature: canonical-json-signed-evidence
issue: 58
status: verification
branch: codex/issue-58-signed-evidence-execution-package
baseRevision: b0e0c831c4efa52f85d7c90b7e5fa10a5527a3a8
lastCompletedTask: T4
nextTask: Obtain independent validation, then submit the Execution Package slice for required human review; do not merge without that review.
lastGate: node --test focused evidence suite (115/115) PASS; corepack pnpm gate:quick PASS; corepack pnpm gate:security PASS; corepack pnpm site:check and site:build PASS
updatedAt: 2026-08-22T21:16:00Z
---

# Scope

This is the Execution Package portion of the signed-evidence migration for #58.
It intentionally leaves Run Capsule, Recovery Bundle, Support Bundle, and release
surfaces at their current recorded V1 contracts.

# Blockers

Human review remains mandatory before merge. No private signing material is
needed or accessed by this work.

`site:test` reached its Playwright phase but its configured Astro preview command
daemonized and its parent exited before Playwright could supervise it. This
pre-existing local test-infrastructure observation is not recorded as a pass;
the static site checks and build passed. It is outside this Execution Package
slice and needs a separately scoped site-preview review if it remains reproducible.
