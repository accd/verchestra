---
schema: verchestra-feature-handoff/v1
feature: task-check
issue: 593
status: in_progress
branch: feat/593-task-check
baseRevision: 4a33c0c8fa22b5f8d2baf831cf614919a96dee26
lastCompletedTask: T5
nextTask: "Independent validation round 3 of TCK-01 to TCK-07 into validation.md, then review of the pull request."
lastGate: "gate:quick PASS (unit 3029, agent-readiness 378, census 13); complexity PASS; tests/e2e/task-check-e2e.test.mjs 15 of 15 on Windows x64; 13 of 13 applicable mutants killed (round-1 and round-2 survivors included); CLI surface, launcher help, sealed closure, codex identity and task e2e suites 150 of 150"
updatedAt: 2026-10-26T11:30:00Z
---

# Scope

`vestra task check --request <file>`, as `spec.md` states it (TCK-01 to
TCK-07). The owner chose it on 2026-10-26 over extending `doctor`, which stays
unchanged (`spec.md`, Status).

# Completed Evidence

T1 to T5 (`tasks.md`), one commit each. `tests/e2e/task-check-e2e.test.mjs`
has fifteen journeys and runs on every platform the task fixture serves (on
Linux through its Secret Service stand-in).

`validation.md` holds two rounds by independent validator sub-agents:

- **Round 1** (at `db966bf`): FAIL, with findings F1 to F11. T4 closes them.
- **Round 2** (at `eed6410`): FAIL, with findings N1 to N4. T5 closes them.

After T5, the author re-ran every mutant that survived either round, plus two
new ones for N1 and N2: 13 of 13 were killed on Windows x64. The POSIX branch of
the printed login command is asserted only on POSIX hosts.

# Blockers

None.

# Next exact action

Round 3 of independent validation into `validation.md`. Then the owner
reviews the pull request.

# Files Intentionally Left Unchanged

`doctor` and its catalog (`packages/application/src/doctor/doctor.ts`,
`apps/vestra-cli/src/doctor-composition.ts`) and its architecture tests; the
drivers; the run's own prerequisite order in `task-run.ts`.
