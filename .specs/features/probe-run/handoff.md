---
schema: verchestra-feature-handoff/v1
feature: probe-run
issue: 235
status: planned
branch: plan/235-probe-run
baseRevision: 859092a9e41da727c62869c904343bf72e808c98
lastCompletedTask: null
nextTask: "Owner review of plan.md (slice 2b) and AD-086; then derive checks.md from the approved plan and build."
lastGate: "validate_plan.py 0 errors, 0 warnings"
updatedAt: 2026-10-29T11:44:00Z
---

# Evidence

Slice 2b of T3 runs one governed read-only probe: `vestra probe run`. Slices 1
(#681) and 2a (#686) are on main. The owner decided on 2026-10-29 that 2b
delivers no database credential (the qualified real path is a SQLite file named
by the worker's approved arguments) and that a probe run is a new run kind
`probe`. `plan.md` and AD-086 in `.specs/STATE.md` await the owner's review.
No check or code exists.

Facts found while planning, with their places:

- `runs.run_kind` is a CHECK in `001_runtime`
  (`packages/platform-node/src/runtime-store/runtime-migrations.ts`); no
  migration has rebuilt a table before, and eight tables reference `runs`.
- `ApprovalAction` is validated only in code (`authority.ts`), and every
  review list of the approval surface must be non-empty.
- No Cedar policy allows `database-read`; the task policy view's schema has
  `Actor` and `Task` only (`apps/vestra-cli/src/task/task-policy.ts`).
- `ProbeWorkerSupervisor` compares only the Workspace id of its trust, and
  takes the concrete `MemoryProtectedParameterBroker` and
  `MemoryProbeResultSink` classes.
- `DatabaseEngineAdapterPort.validateNormalizedOperation` has no production
  implementation; the SQLite parser holds SQLite's denial rules.
- Both architecture guards (`extension-host-composition`,
  `database-command-composition`) must admit the probe family.

# Next exact action

The owner reviews `plan.md` and AD-086. On approval, derive `checks.md`
(profile `light` unless the owner raises it), size it against the 150k budget,
build, and dispatch an independent Verifier. The real-database proofs run on
Linux; on Windows the command refuses (AC 15).
