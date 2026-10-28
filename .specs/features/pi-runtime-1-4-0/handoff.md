---
schema: verchestra-feature-handoff/v1
feature: pi-runtime-1-4-0
issue: 563
status: complete
branch: main
baseRevision: b5819c6e24d9d7ac97f09171eaf91ff23bcb7bc2
lastCompletedTask: T3
nextTask: "None in this feature."
lastGate: "PR #659 merged by rebase through the maintainer bypass at 2026-10-28T15:14:01Z (main 37fa6ec, tree equal to the PR head cae4119) with Quality gate, Site quality and CodeQL passing on that head. #659 re-landed #651 as one commit, because a rebase merge could not replay #651's merge resolution next to Cedar's package.json line; its diff equals #651's over Cedar (935ac83). Fleet run 40704061361 (gate=full, at 1179701) green on all five legs, macOS x64 on re-run after the probe-host fault flake #658 fixed; no independent review, so the module comparison, control run and suites in validation.md are the record"
updatedAt: 2026-10-28T15:20:00Z
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

None in this feature.
