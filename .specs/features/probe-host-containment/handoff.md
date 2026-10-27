---
schema: verchestra-feature-handoff/v1
feature: probe-host-containment
issue: 569
status: verification
branch: fix/569-probe-host-containment
baseRevision: 13fa79356e6e35c583f8a135771ce15e50ace687
lastCompletedTask: T4
nextTask: "T5: merge #632 on the owner's review with every required check green on its exact head, then verify the merge by content."
lastGate: "PR #632 head b176b82: required checks green; platform-matrix gate=full run 40569914514 green on all five legs; gate=security run 40566619084 green on four legs, with macOS x64 stopped twice in test:unit by an unrelated regex-linearity ratio check; the Linux and Windows runs and 13 mutation sensors in validation.md"
updatedAt: 2026-10-27T21:15:00Z
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

PR #632 is open with its fleet runs recorded in `validation.md`. Merge it on
the owner's review with every required check green on its exact head, and
verify the merge by content. #570's unpushed branch
`test/570-probe-host-mutants` follows it.
