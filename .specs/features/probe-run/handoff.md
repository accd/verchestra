---
schema: verchestra-feature-handoff/v1
feature: probe-run
issue: 235
status: in_progress
branch: feat/235-probe-run
baseRevision: 02b50ba88bea5d8917f9cdcfd03a2d82df9ba878
lastCompletedTask: null
nextTask: "Build batch B (C1-C15, C17-C19, C23-C25, C27-C30) from checks.md and batch A's diff (55e2b7ea..053c7c07), then dispatch an independent Verifier over 02b50ba8..HEAD with every check."
lastGate: "Batch A (C16, C20-C22, C26, C31) closed at 053c7c07, on Windows: the six batch-A proofs pass; gate:quick exit 0 (unit 3654/3654, agent-readiness 428/428, census 14/14); test:contract 1009/1009; test:architecture 148/148; sealed-launcher-closure 14/14; test:integration 1263/1285, the 22 failures all the fixture symlink refusal of a host without Developer Mode (L-017), none in a file this batch touches"
updatedAt: 2026-10-29T15:29:05Z
---

# Evidence

Slice 2b of T3 runs one governed read-only probe: `vestra probe run`. Slices 1
(#681) and 2a (#686) are on main. The owner decided on 2026-10-29 that 2b
delivers no database credential (the qualified real path is a SQLite file named
by the worker's approved arguments) and that a probe run is a new run kind
`probe`. The owner approved `plan.md` and AD-086 on 2026-10-29 (#688). `checks.md` holds
31 checks at profile `light`, about 190k, over the 150k budget; the owner chose
a handoff in two batches: A (C16, C20-C22, C26, C31, the foundations), then B (the
rest, the command), B only on A's green.

Batch A is built and green (55e2b7ea..053c7c07, four commits): the run kind
`probe` and `COMPLETE_PROBE` in the workflow and the run capsule (C20, C26);
migration `013_probe_runs` and the runner's `tableRebuild` flag, with
`VES_RUNTIME_MIGRATION_FOREIGN_KEY` (C21, C22, C31); the supervisor's
`VES_PROBE_WORKSPACE_TRUST_GRANT` check (C16); and the `probe-execution`
approval action, which batch B proves (C23, C25). What batch A settled, and
what batch B must know, is under `## Handoff` in `checks.md`.

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

Build batch B on `feat/235-probe-run` from `checks.md` and batch A's diff
(`55e2b7ea..053c7c07`): the `vestra probe run` family in
`apps/vestra-cli/src/probe/`, its authority glue and probe policy view, the
worker fixture, the guards and the pinned command lists. Then dispatch an
independent Verifier over `02b50ba8..HEAD` with every check. The real-worker
proofs run on Linux; on Windows the command refuses (AC 15).
