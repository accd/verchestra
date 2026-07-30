# Parallel Task Scheduler Context

## User Decisions (gray areas)

Approved by the user with the plan; each entry names the chosen default
and its rationale.

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| A1 | Sibling failure policy | Let in-flight tasks settle; start nothing new; dependents become `blocked` | Fail closed without mid-write cancellation surprises. |
| A2 | Concurrency width | Caller-supplied `maxConcurrentTasks`, safe integer 1..100 | The orchestrator owns the policy; no magic constant. |
| A3 | Authority shape | One shared run envelope (digests, approval, grants) plus a task array | An Execution Package closes approvals per run, not per task. |
| A4 | Overlap semantics | Path equality or containment over `changeScope`, the same rule as the executor's `within()` | One mental model; static analysis decides order, and the per-task claim stays the enforcement backstop. |
| A5 | Evidence surface | Returned deep-frozen report plus the final meter snapshot; no signed capsule, no scheduler checkpoint | The report's `outcomes` and `budgetSnapshot` are digest-ready (`rounds` is an observational log, see the determinism constraint in `spec.md`); sealing belongs to the issue #64 wiring. |
| A6 | Mid-graph resume | Out of scope for v1 | Per-task checkpoints already recover tasks; scheduler resume is a separate feature. |

## Recon discoveries that shaped the spec

- Executor normalization requires non-empty `dependencyTaskIds`
  (`stringList` rejects `[]`), so root tasks cannot exist today. The
  scheduler requires roots; executor validation relaxes to allow an empty
  dependency list, and nothing else in the executor changes.
- `dependencyTaskIds` is declared and validated but consumed nowhere else
  in the repository (grep across `packages/`, `tests/`, `spikes/`).
- The coordination claim is acquired inside `execute()`, so a
  `coordinationRef` only exists at completion: the report records it at
  outcome level, not at round level.
- The executor accepts a caller-supplied `options.budgetMeter` (the T68b
  run-scoped budget precedent), which is the seam SCH-07 uses.

## Deferred Ideas

- Scheduler-level resume across a crash using per-task checkpoints.
- Sealing the scheduling report into signed run evidence (needs #64).
