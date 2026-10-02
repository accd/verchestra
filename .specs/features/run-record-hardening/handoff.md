---
schema: verchestra-feature-handoff/v1
feature: run-record-hardening
issue: null
status: complete
branch: main
baseRevision: bde8ad93730c412d66bd3b01dd3f3c9f6ed10897
lastCompletedTask: T3
nextTask: "No further action for this feature: T1-T3 merged as #473, #474 and #475 (AD-050 to AD-052) after the platform matrix passed on all five targets."
lastGate: "Platform matrix PASS on five targets at the branch tip (build run 37062121997, security run 37062125645); required checks and SonarCloud PASS on #473-#475"
updatedAt: 2026-10-03T00:00:00Z
---

# Scope

Three hardening follow-ups that the Run record work (ADP-2, AD-047) recorded
and left out of scope. Requirements RRH-01..19 in `spec.md`; one task, one
commit range and one pull request each, in `tasks.md`.

# Completed Evidence

T1: `task review` reads the Execution Package through
`RunRecord#approvedPackage` directly after the state check
(`apps/vestra-cli/src/task/task-review.ts`), and the Run Capsule is built from
that read. Tests: `tests/integration/task-review-package.test.mjs` (the command
function on a real Workspace, every platform), the locality case in
`tests/architecture/task-run-record-locality.test.mjs`, and the review journey
at the end of `tests/e2e/task-cli-e2e.test.mjs`. The shared fixture
`tests/helpers/task-command-fixture.mjs` opens a Workspace for a command
function without a credential. `docs/quick-start.md` names the refusal.

T2: `requireRealDirectories` in `apps/vestra-cli/src/task/task-workspace.ts`;
the Run record's two checked path functions in `task-run-record.ts`; the
gate evidence store asking for its directory per operation
(`task-evidence.ts`); the write refusal in `task-files.ts`; the verifier's
`scratchDirectory` (`task-verifier.ts`); the cancel watcher that stops a run
whose cancel state cannot be read (`task-run.ts`). Tests:
`tests/integration/task-run-containment.test.mjs` (fifteen artifact families,
the six commands in process, the verifier, the watcher; junctions on every
platform), the locality case, and four link journeys at the end of
`tests/e2e/task-cli-e2e.test.mjs`.

T3: `MARKER_SEAL` and the `markerSeal` member in `task-plan-record.ts`,
stamped by `task-plan.ts`; the marker form, the sealed marker writer and
reader, and the three answers of `activeProcess` in `task-run-record.ts`; the
cancel that ends a run whose active marker does not verify (`task-status.ts`);
the earlier grant read in `task-review.ts`. Tests:
`tests/unit/task-run-markers.test.mjs` (goldens for both forms, one tamper and
one downgrade case per marker), `tests/integration/task-marker-commands.test.mjs`
(`status`, `cancel` and `review` in process, the cancel wait on mock timers),
two locality cases, and seven journeys at the end of
`tests/e2e/task-cli-e2e.test.mjs` (resume, idle cancel and running cancel for a
legacy fixture and for a sealed Run, and the downgrade refusal).
`.specs/features/governed-task-cli/design.md` and `threat-model.md` now say
which files are sealed and what a marker that does not verify means.

Every requirement is mapped in `validation.md`.

# Next Exact Action

None. T1 merged as #473 (`29e1007`), T2 as #474 (`daf05e1`), T3 as #475
(`bde8ad9`). The junction cases and the link journeys ran off macOS for the
first time in the platform matrix before merge (build run 37062121997,
security run 37062125645), and passed on all five targets.

# Blockers

None.

# Decisions

Each task has one entry in `.specs/STATE.md`: AD-050 for T1 (`task review`
proves the Execution Package), AD-051 for T2 (nothing below a task state root
is reached through a link), and AD-052 for T3 (the five markers are sealed).

Open points for the reviewer are at the end of `validation.md`.

# Files Intentionally Left Unchanged

`.specs/features/architecture-deepening/spec.md`, `tasks.md`, and `handoff.md`
(the coordinator owns them), and `validation-c2.md` (the evidence of ADP-2 for
its revision; its open points are closed here, not rewritten there).
`tests/unit/task-run-record.test.mjs` (the ADP-2 suite and its goldens pass
unmodified). `complexity-baseline.json`. `CHANGELOG.md` (it has not tracked
task-path changes since #405).
