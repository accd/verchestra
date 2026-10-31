---
schema: verchestra-feature-handoff/v1
feature: readme-overhaul
issue: null
status: verification
branch: claude/readme-self-test-gif
baseRevision: 549074498b0cab3eaaeb7e4f4efef0574ad01b7a
lastCompletedTask: T2
nextTask: "Human review of the rendered self-test GIF on GitHub, then CI on Node 24.14.0."
lastGate: "README-bound tests pass locally; full gates need Node 24.14.0 (see validation.md)"
updatedAt: 2026-10-31T12:30:00Z
---

# Scope

The root `README.md` only, as `spec.md` states it (RDM-01 to RDM-06).

# Next action

Review the rendered page on the branch. To regenerate the GIF, run
`vhs docs/assets/self-test.tape` from the repository root. Possible follow-up,
not started: a light and dark banner asset.
