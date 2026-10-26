---
schema: verchestra-feature-handoff/v1
feature: task-check
issue: 593
status: in_progress
branch: feat/593-task-check
baseRevision: 4a33c0c8fa22b5f8d2baf831cf614919a96dee26
lastCompletedTask: T3
nextTask: "Independent validation of TCK-01 to TCK-07 into validation.md, then review of the pull request."
lastGate: "gate:quick PASS (unit 3029, agent-readiness 378, census 13); complexity PASS; tests/e2e/task-check-e2e.test.mjs 6 of 6 on Windows x64; task run, codex identity, CLI composition, task e2e, coordinated e2e, model availability and task CLI security suites 108 of 108"
updatedAt: 2026-10-26T08:30:00Z
---

# Scope

`vestra task check --request <file>`, as `spec.md` states it (TCK-01 to
TCK-07). The owner chose it on 2026-10-26 over extending `doctor`, which stays
unchanged (`spec.md`, Status).

# Completed Evidence

T1 to T3, one commit each (`tasks.md`).

- `tests/e2e/task-check-e2e.test.mjs` runs on every platform the task fixture
  serves (on Linux through its Secret Service stand-in). It covers:
  - a ready Workspace, with no value read from the Windows or Linux store;
  - every missing piece reported at once, with exit 4;
  - no Workspace;
  - a rejected request;
  - API-key mode;
  - the Codex floor of a v1 against a v2 request.
- Two mutants were killed by the author's run:
  - dropping the v2 Codex minimum;
  - reading the credential value instead of asking for its presence.

# Blockers

None.

# Next exact action

An independent validator maps every requirement to its evidence and runs a
discrimination sensor into `validation.md`. Then the owner reviews the pull
request.

# Files Intentionally Left Unchanged

`doctor` and its catalog (`packages/application/src/doctor/doctor.ts`,
`apps/vestra-cli/src/doctor-composition.ts`) and its architecture tests; the
drivers; the run's own prerequisite order in `task-run.ts`.
