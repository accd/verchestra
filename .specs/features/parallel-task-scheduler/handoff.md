---
schema: verchestra-feature-handoff/v1
feature: parallel-task-scheduler
issue: 33
status: in_progress
branch: kimi/issue-33-parallel-task-scheduler
baseRevision: 09a6654c26cf3a5d4c4e08ec7af006ed9c63695d
lastCompletedTask: T1
nextTask: T2
lastGate: pnpm agent:check
updatedAt: 2026-07-30T14:32:07Z
---

# Scope

Build the deferred external-review item R7 (issue #33): a scheduler that
runs the ready frontier of an atomic-task dependency graph concurrently
through the existing `TaskExecutionCoordinator`, serializes tasks whose
change scopes overlap in deterministic `taskId` order, and returns a
deep-frozen scheduling report with per-round decisions and per-task
outcomes.

# Completed Evidence

T1: specification, context (six approved gray-area decisions A1-A6),
design, and task breakdown written from verified code reading. Recon
findings that shaped the spec: the executor processes one task per
`execute()` call; `dependencyTaskIds` is declared and validated but
consumed nowhere else; executor normalization rejects an empty
`dependencyTaskIds`, so root tasks cannot exist until that relaxes; the
coordination claim is acquired inside `execute()`, so a `coordinationRef`
is only knowable at completion; the executor accepts a caller-supplied
`options.budgetMeter` (T68b precedent), which is the SCH-07 seam.

# Next Exact Action

T2: relax the executor's `dependencyTaskIds` validation to allow `[]`
(root tasks), export `normalizeTask`, and add the scheduler module's
input and graph validation (SCH-03) with unit tests.

# Blockers

None.

# Decisions

- A1: a failing task halts new launches, in-flight tasks settle, and
  transitive dependents become `blocked`.
- A2: the caller supplies `maxConcurrentTasks` (safe integer 1..100).
- A3: one shared run envelope (digests, approval, grants) plus a task
  array; no per-task authority in v1.
- A4: scope overlap is path equality or containment, matching the
  executor's `within()` rule; the per-task claim stays the backstop.
- A5: evidence is the returned report plus the final meter snapshot;
  sealing belongs to the issue #64 wiring.
- A6: no mid-graph scheduler resume in v1; per-task checkpoints already
  recover tasks.

# Files Intentionally Left Unchanged

- `work-claims.ts`: the scheduler never builds claims itself; per-task
  claims stay inside the existing executor coordination path.
- Evidence layer (capsules, packages): the report is digest-ready but
  unsealed by design until #64 wires a producer.
