---
schema: verchestra-feature-handoff/v1
feature: pi-runtime-1-4-0
issue: 563
status: verification
branch: build/563-pi-1-4
baseRevision: b5819c6e24d9d7ac97f09171eaf91ff23bcb7bc2
lastCompletedTask: T3
nextTask: "Open the PR, merge it by rebase through the maintainer bypass only after the required checks pass on its exact head and the fleet run is green, verify the merge by content, then record in #563 that the Pi successor is done."
lastGate: "qualify:pi 27 of 27 at zero skips; Pi contract, integration and dependency-policy 43 of 43; cross-driver suites 112 of 112; gate:quick and agent:check results in validation.md"
updatedAt: 2026-10-28T15:30:00Z
---

# Evidence

The manifest, lockfile, probe pin, spike identity, drift neighbours, matrix
row, report and handoff agree on Pi `1.4.0`. The published packages of
`0.99.1` and `1.4.0` were compared file by file for every module the root
entry loads (108 then, 38 now); the review is in
`docs/qualification/pi-runtime-1.4.0.md`. The one behaviour change that
reaches the boundary, a malformed tool call refused before authorization, is
pinned by a new spike case with a control run. Every other Pi suite passes
without edits.

# Next exact action

Open the PR, merge it by rebase only after the required checks pass on its
exact head and the fleet run is green, verify by content, and comment on #563.
