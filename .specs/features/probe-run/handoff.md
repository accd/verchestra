---
schema: verchestra-feature-handoff/v1
feature: probe-run
issue: 235
status: complete
branch: feat/235-probe-run
baseRevision: 02b50ba88bea5d8917f9cdcfd03a2d82df9ba878
lastCompletedTask: null
nextTask: "Owner review of the slice 2b PR; after it lands, the owner decides what remains of T3 (the database credential is its own feature, owner decision 2026-10-29)."
lastGate: "Independent Verifier round 1 PASS at b22b8068 (32/32; Windows proofs 35/35, gate:quick, test:architecture 149, sealed closure; Linux proofs 36/36, gate:quick, test:contract 1028, test:architecture 149, test:e2e 363, test:build 186, test:integration 1285); validate_verification exit 0"
updatedAt: 2026-10-29T17:26:51Z
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

Batch B is built (b58e145d..a5c5310e): `vestra probe run` in
`apps/vestra-cli/src/probe/` (the request file, the SQLite statement and its
engine adapter, the authority glue and the built-in probe policy view, the
review, the run module that alone starts a worker, and the family's public
errors), the release manifest and every pinned command list, both guards
admitting the probe family and a new one pinning that it reads no credential
but the signing passphrase, a SQLite worker fixture over data-probe's real read
connection, the probe run's terminal decisions owing no capsule (C32), and a
supervisor fix: it now refuses a result echoing the JSON protected request
escaped. Three proofs departed from the letter of checks.md; the owner ruled on
2026-10-29 (b22b8068): the fixture statement names `main.orders`, the leak fix
stays and the plan's Impact row names it, and C7 admits the credential store's
tool beside Git. Everything else batch B settled is under `## Handoff` in
`checks.md`. New-code coverage on Linux from the unit and contract tests:
every module under `apps/vestra-cli/src/probe/` at 99-100%.

The independent Verifier proved C1-C32 at `b22b8068` (`verification.md`,
round 1, PASS, profile `light`). It re-ran every proof on Windows (35/35; the
real-worker cases assert the platform refusal) and on Linux (36/36, real
worker), and on Linux `gate:quick`, `test:contract` (1028),
`test:architecture` (149), `test:e2e` (363), `test:build` (186) and
`test:integration` (1285), all passing. Its non-failing notes: C7's process
spy is only asserted empty, with no positive control; the run module's own
pre-launch grant comparison is unreachable by construction, so C16 holds at
the supervisor; C17 drops two runtime-added environment names; on Windows
C13's `VES_DATABASE_NOT_FOUND` case is skipped; macOS is not run.

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

The owner reviews the slice 2b PR. After it lands, the owner decides what
remains of T3; delivering a database credential to the worker is its own
feature, amending the probe host's spec and AD-037 (owner, 2026-10-29).
