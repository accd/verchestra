---
schema: verchestra-feature-handoff/v1
feature: task-check
issue: 593
status: complete
branch: main
baseRevision: 4a33c0c8fa22b5f8d2baf831cf614919a96dee26
lastCompletedTask: T7
nextTask: "None in this feature. #593 is closed with the owner decision recorded."
lastGate: "PR #606 merged by rebase at 2026-10-26T12:47:51Z (main 1802236, tree equal to the PR head d3e2e23) with Quality gate (the full release-gate selection on Linux), Site quality and CodeQL passing on that head; independent validation round 4 and T7 as the record, by the owner decision"
updatedAt: 2026-10-26T13:05:00Z
---

# Scope

`vestra task check --request <file>`, as `spec.md` states it (TCK-01 to
TCK-07). The owner chose it on 2026-10-26 over extending `doctor`, which stays
unchanged (`spec.md`, Status).

# Completed Evidence

T1 to T7 (`tasks.md`), one commit each. `tests/e2e/task-check-e2e.test.mjs`
has twenty-three journeys and runs on every platform the task fixture serves (on
Linux through its Secret Service stand-in).

`validation.md` holds four rounds by independent validator sub-agents:

- **Round 1** (at `db966bf`): FAIL, with findings F1 to F11. T4 closes them.
- **Round 2** (at `eed6410`): FAIL, with findings N1 to N4. T5 closes them.
- **Round 3** (at `7e19779`): FAIL, with findings N5 to N12. T6 closes them.
- **Round 4** (at `246b8e5`): FAIL, with findings N13 to N18, all of low severity. T7 closes the proof gaps N16 to N18. The spec scopes out N13 to N15: Workspace state tampered with in ways where `task plan` itself fails with an internal error.

After T7, every mutant of the four rounds that still applies is killed on
Windows x64. One limit remains, and round 4 judged it honest: the macOS fake logs
a value read and a presence query alike, so a value read is asserted only on
Windows and Linux. `requireCredentialBound` asks only `adapter.has`, and the
darwin backend unit test proves that it passes neither `-g` nor `-w`.

# Blockers

None.

# Next exact action

None in this feature. The owner merged PR #606 with round 4 and T7 as the
record. The Linux CI ran every release-gate stage on the merged head,
including the POSIX branches this Windows host could not run. #593 is closed,
and its closing comment records why `task check` replaced the `doctor` probes.

# Files Intentionally Left Unchanged

`doctor` and its catalog (`packages/application/src/doctor/doctor.ts`,
`apps/vestra-cli/src/doctor-composition.ts`) and its architecture tests; the
drivers; the run's own prerequisite order in `task-run.ts`.
