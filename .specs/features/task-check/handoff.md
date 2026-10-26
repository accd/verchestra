---
schema: verchestra-feature-handoff/v1
feature: task-check
issue: 593
status: in_progress
branch: feat/593-task-check
baseRevision: 4a33c0c8fa22b5f8d2baf831cf614919a96dee26
lastCompletedTask: T7
nextTask: "Owner decision: a fifth independent validation round, or review of the pull request with round 4 and T7 as the record."
lastGate: "gate:quick PASS (unit 3029, agent-readiness 379, census 13); tests/e2e/task-check-e2e.test.mjs 23 of 23 on Windows x64; codex identity, beta-tester docs, Windows spawn shim, Windows task e2e and Windows Claude Code driver suites 44 of 44; every mutant of rounds 1 to 4 that still applies killed (22 after T6, the 4 round-4 survivors after T7)"
updatedAt: 2026-10-26T18:30:00Z
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

The owner decides between a fifth independent validation round and reviewing
the pull request, with round 4 and T7 as the record.

# Files Intentionally Left Unchanged

`doctor` and its catalog (`packages/application/src/doctor/doctor.ts`,
`apps/vestra-cli/src/doctor-composition.ts`) and its architecture tests; the
drivers; the run's own prerequisite order in `task-run.ts`.
