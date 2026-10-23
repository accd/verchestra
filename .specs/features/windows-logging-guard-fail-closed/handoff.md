---
schema: verchestra-feature-handoff/v1
feature: windows-logging-guard-fail-closed
issue: 565
status: verification
branch: fix/565-logging-guard-fail-closed
baseRevision: a31b94175808aec856612d03f1aed69a1428b122
lastCompletedTask: T5
nextTask: "Review and maintainer merge (#573); after merge, move this handoff to complete."
lastGate: "Windows 11, PowerShell 5.1, non-elevated: os-secret-backend-windows unit 15/15; the two new real cases in spikes/os-secret-store green; see validation.md"
updatedAt: 2026-10-23T13:20:00Z
---

# Evidence

T1 to T4 are recorded in `validation.md`: the bug reproduced on real Windows
PowerShell (Constrained Language Mode, payload line reached, exit 0); after the
change the same program exits 3 before the payload line and is refused as
`VES_SECRET_STORE_LOGGED`; a mutant without the gate line is killed by the real
full-language case and by two unit tests.

# Next exact action

Read the `credential-store` legs on the pull request head, record the run id in
`validation.md`, mark T5, and move this handoff to `complete` after review and
merge.
