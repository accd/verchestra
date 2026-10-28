---
schema: verchestra-feature-handoff/v1
feature: probe-host-containment
issue: 569
status: complete
branch: main
baseRevision: 13fa79356e6e35c583f8a135771ce15e50ace687
lastCompletedTask: T5
nextTask: "None in this feature. AD-037 as amended awaits the owner's ratification; the host's T3 (composition) follows it and lifts the guard in tests/architecture/extension-host-composition.test.mjs."
lastGate: "PR #632 merged by rebase through the maintainer bypass at 2026-10-28T09:38:46Z (main e60dd65, b771cec, ff557cf; the diff main gained equal to the PR's over five main commits that share no file with it), with Quality gate, Site quality and CodeQL passing on the head dae190c; fleet runs 40569914514 (gate=full, five legs green) and 40566619084 (gate=security, four legs green, macOS x64 stopped by the regex-linearity flake #637 fixed); no independent review, so the Linux runs and 13 mutation sensors in validation.md are the record"
updatedAt: 2026-10-28T12:30:00Z
---

# Evidence

T1 to T4 are recorded in `validation.md`. The probe host now stops a worker's
tree before it kills it and fails a worker that exited first or whose output
outlives the kill. The approval and the grant bind a launch digest, the host
refuses an unapproved launch before it starts and refuses loader variables
outright, and admission resolves the extension and looks its approval up
itself.

The owner chose the four decisions in `spec.md` on 2026-10-27. AD-037 stays
`proposed`, and the composition guard stays until the owner ratifies it.

# Next exact action

None in this feature. AD-037 as amended awaits the owner's ratification, and
the host's T3 (composition) follows it.
