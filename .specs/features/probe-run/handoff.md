---
schema: verchestra-feature-handoff/v1
feature: probe-run
issue: 235
status: in_progress
branch: feat/235-probe-run
baseRevision: 02b50ba88bea5d8917f9cdcfd03a2d82df9ba878
lastCompletedTask: null
nextTask: "Build batch A (C16, C20-C22, C26, C31), then batch B on green; then dispatch an independent Verifier over 02b50ba8..HEAD."
lastGate: "validate_plan.py and validate_checks.py 0 errors, 0 warnings"
updatedAt: 2026-10-29T14:51:13Z
---

# Evidence

Slice 2b of T3 runs one governed read-only probe: `vestra probe run`. Slices 1
(#681) and 2a (#686) are on main. The owner decided on 2026-10-29 that 2b
delivers no database credential (the qualified real path is a SQLite file named
by the worker's approved arguments) and that a probe run is a new run kind
`probe`. The owner approved `plan.md` and AD-086 on 2026-10-29 (#688). `checks.md` holds
31 checks at profile `light`, about 190k, over the 150k budget; the owner chose
a handoff in two batches: A (C16, C20-C22, C26, C31, the foundations), then B (the
rest, the command), B only on A's green. No code exists.

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

Build batch A on `feat/235-probe-run`, then batch B from `checks.md` and A's
diff, then dispatch an independent Verifier over `02b50ba8..HEAD` with every
check. The real-worker proofs run on Linux; on Windows the command refuses
(AC 15).
