---
schema: verchestra-feature-handoff/v1
feature: run-record-hardening
issue: null
status: in_progress
branch: fix/run-record-hardening
baseRevision: 77c7b8e51ca8d2b21a6b688d2e353421b0c874d8
lastCompletedTask: T1
nextTask: "T2: refuse a link below a per-Run root (the Run directory, a directory inside it, the verification scratch root) before any read or write."
lastGate: "Node 24.14.0 macOS arm64 on the tree of the T1 commit: gate:quick PASS (unit 2484, agent-readiness 323, census 13); test:architecture 87; gate:build PASS (contract 756, integration 950, e2e 246, build 146, qualification 302); gate:security PASS (security 1339, fault 310); task journeys 31; agent:check PASS; site:check PASS; 0 failed, 0 skipped, 0 todo; no provider called"
updatedAt: 2026-10-02T20:00:00Z
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

Every requirement is mapped in `validation.md`.

# Next Exact Action

Implement T2 as `tasks.md` describes it, on top of T1.

# Blockers

None.

# Decisions

The decision recorded for T1 is the entry headed `AD-0XX (to be numbered at
merge)` in `.specs/STATE.md` whose title names `task review`.

# Files Intentionally Left Unchanged

`.specs/features/architecture-deepening/spec.md`, `tasks.md`, and `handoff.md`
(the coordinator owns them), and `validation-c2.md` (the evidence of ADP-2 for
its revision; its open points are closed here, not rewritten there).
`tests/unit/task-run-record.test.mjs` (the ADP-2 suite and its goldens pass
unmodified). `complexity-baseline.json`. `CHANGELOG.md` (it has not tracked
task-path changes since #405).
