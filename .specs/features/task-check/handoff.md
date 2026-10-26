---
schema: verchestra-feature-handoff/v1
feature: task-check
issue: 593
status: in_progress
branch: feat/593-task-check
baseRevision: 4a33c0c8fa22b5f8d2baf831cf614919a96dee26
lastCompletedTask: T6
nextTask: "Independent validation round 4 of TCK-01 to TCK-07 into validation.md, then review of the pull request."
lastGate: "gate:quick PASS (unit 3029, agent-readiness 379, census 13); complexity PASS; tests/e2e/task-check-e2e.test.mjs 21 of 21, tests/integration/codex-identity.test.mjs 20 of 20 on Windows x64; 22 of 22 mutants killed across rounds 1 to 3; CLI surface, launcher help, sealed closure, task, coordinated, run prerequisite and Windows task suites 155 of 155"
updatedAt: 2026-10-26T15:00:00Z
---

# Scope

`vestra task check --request <file>`, as `spec.md` states it (TCK-01 to
TCK-07). The owner chose it on 2026-10-26 over extending `doctor`, which stays
unchanged (`spec.md`, Status).

# Completed Evidence

T1 to T6 (`tasks.md`), one commit each. `tests/e2e/task-check-e2e.test.mjs`
has twenty-one journeys and runs on every platform the task fixture serves (on
Linux through its Secret Service stand-in).

`validation.md` holds three rounds by independent validator sub-agents:

- **Round 1** (at `db966bf`): FAIL, with findings F1 to F11. T4 closes them.
- **Round 2** (at `eed6410`): FAIL, with findings N1 to N4. T5 closes them.
- **Round 3** (at `7e19779`): FAIL, with findings N5 to N12. T6 closes them.

After T6, the author re-ran every mutant of the three rounds that still applies:
22 of 22 were killed on Windows x64. One limit remains: an extra provider child
that hangs until it is killed leaves no witness on Windows. The macOS fake
logs a value read and a presence query alike, so a value read is asserted only
on Windows and Linux.

# Blockers

None.

# Next exact action

Round 4 of independent validation into `validation.md`. Then the owner
reviews the pull request.

# Files Intentionally Left Unchanged

`doctor` and its catalog (`packages/application/src/doctor/doctor.ts`,
`apps/vestra-cli/src/doctor-composition.ts`) and its architecture tests; the
drivers; the run's own prerequisite order in `task-run.ts`.
