---
schema: verchestra-feature-handoff/v1
feature: canonical-json-signed-evidence
issue: 58
status: verification
branch: codex/issue-58-signed-evidence-execution-package
baseRevision: b0e0c831c4efa52f85d7c90b7e5fa10a5527a3a8
lastCompletedTask: T4
nextTask: Obtain fresh independent validation of the V1 ordering correction, then submit the Execution Package slice for required human review; do not merge without that review.
lastGate: Corrected candidate focused evidence 116/116 PASS; corepack pnpm gate:quick PASS; corepack pnpm gate:security PASS. Fresh independent validation remains required after the recorded b116e84 rejection.
updatedAt: 2026-08-22T20:38:11Z
---

# Scope

This is the Execution Package portion of the signed-evidence migration for #58.
It intentionally leaves Run Capsule, Recovery Bundle, Support Bundle, and release
surfaces at their current recorded V1 contracts.

# Blockers

Human review remains mandatory before merge. No private signing material is
needed or accessed by this work.

The first independently checked candidate (`b116e84`) was rejected. It changed
legacy V1 code-unit default-sort sites to locale ordering for `uniqueStrings`,
task component/command/criterion arrays, and `blockedBy`. No product output from
that candidate is accepted. The correction keeps code-unit ordering for those
sites in both versions and keeps `localeCompare` only where schema V1 used it
historically.

`site:test` reached its Playwright phase but its configured Astro preview command
daemonized and its parent exited before Playwright could supervise it. This
pre-existing local test-infrastructure observation is not recorded as a pass;
the static site checks and build passed. It is outside this Execution Package
slice and needs a separately scoped site-preview review if it remains reproducible.
