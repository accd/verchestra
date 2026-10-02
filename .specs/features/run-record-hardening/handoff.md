---
schema: verchestra-feature-handoff/v1
feature: run-record-hardening
issue: null
status: in_progress
branch: fix/run-record-hardening
baseRevision: 77c7b8e51ca8d2b21a6b688d2e353421b0c874d8
lastCompletedTask: T2
nextTask: "T3: seal the five markers for a run planned from now on, keep a legacy Run on its plain markers, and make an active or cancel marker that does not verify fail closed without blocking a cancel."
lastGate: "Node 24.14.0 macOS arm64 on the tree of the T2 commit: gate:quick PASS (unit 2484, agent-readiness 323, census 13); test:architecture 88; gate:build PASS (contract 756, integration 998, e2e 250, build 146, qualification 302); gate:security PASS (security 1339, fault 310); task journeys 35; agent:check PASS; site:check PASS; 0 failed, 0 skipped, 0 todo; no provider called"
updatedAt: 2026-10-02T22:00:00Z
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

Every requirement is mapped in `validation.md`.

# Next Exact Action

Implement T3 as `tasks.md` describes it, on top of T2.

# Blockers

None.

# Decisions

Each task has one entry headed `AD-0XX (to be numbered at merge)` in
`.specs/STATE.md`: for T1 the one whose title names `task review`, for T2 the
one titled "Nothing below a task state root is reached through a link".

# Files Intentionally Left Unchanged

`.specs/features/architecture-deepening/spec.md`, `tasks.md`, and `handoff.md`
(the coordinator owns them), and `validation-c2.md` (the evidence of ADP-2 for
its revision; its open points are closed here, not rewritten there).
`tests/unit/task-run-record.test.mjs` (the ADP-2 suite and its goldens pass
unmodified). `complexity-baseline.json`. `CHANGELOG.md` (it has not tracked
task-path changes since #405).
