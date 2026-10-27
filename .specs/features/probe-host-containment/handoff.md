---
schema: verchestra-feature-handoff/v1
feature: probe-host-containment
issue: 569
status: verification
branch: fix/569-probe-host-containment
baseRevision: 13fa79356e6e35c583f8a135771ce15e50ace687
lastCompletedTask: T4
nextTask: "T5: open the pull request, dispatch platform-matrix.yml with gate=security on its head for the macOS legs, and merge on review with every required check green."
lastGate: "The 148 probe-host tests pass on Linux (WSL Ubuntu, Node 24.14.0), and 122 on Windows, where the spawned cases assert the platform refusal; all 13 mutation sensors in validation.md are killed; pnpm gate:quick, tests/architecture and pnpm agent:check pass on Windows. macOS not yet run."
updatedAt: 2026-10-27T19:45:00Z
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

Open the pull request from `fix/569-probe-host-containment`. Dispatch
`platform-matrix.yml` with `gate=security` on its head, because Linux CI does
not run macOS, whose zombie and process-table behavior differs. Record the run
in `validation.md`, then merge on review.
