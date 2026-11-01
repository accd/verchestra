---
schema: verchestra-feature-handoff/v1
feature: readme-overhaul
issue: null
status: complete
branch: claude/readme-banner
baseRevision: 6e435e95fd93c49fe0dbcc5d56508409387483e6
lastCompletedTask: T3
nextTask: "None in this feature. It closes when the T3 pull request merges."
lastGate: "T1 merged in #713 and T2 in #723 with Quality gate, Site quality and CodeQL green; T3 README-bound and site unit tests pass locally"
updatedAt: 2026-11-01T09:10:00Z
---

# Scope

The root `README.md` only, as `spec.md` states it (RDM-01 to RDM-06).

# Next action

None. T1 to T3 are done, and the feature closes when the T3 pull request
merges. To regenerate the assets: run `vhs docs/assets/self-test.tape` from the
repository root for the GIF, and render `docs/assets/banner.html` as its header
comment says for the banners.
