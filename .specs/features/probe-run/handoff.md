---
schema: verchestra-feature-handoff/v1
feature: probe-run
issue: 235
status: verification
branch: feat/235-probe-run
baseRevision: 02b50ba88bea5d8917f9cdcfd03a2d82df9ba878
lastCompletedTask: null
nextTask: "Dispatch the independent Verifier over 02b50ba8..HEAD with every check (C1-C32); the owner rules on the three deviations batch B recorded under checks.md `## Handoff` (the fixture statement names `main.orders`, the supervisor leak fix, C7 admitting the credential store's tool)."
lastGate: "Batch B closed at a5c5310e. Every Proof: line passes on Linux (WSL, real worker) and on Windows (the real-worker cases assert the platform refusal), batch A's six included. Linux at 8f65c2cb: gate:quick exit 0 (unit 3664/3664, agent-readiness 428/428, census 14/14); test:contract 1028/1028; test:e2e 363/363; test:build 186/186; test:integration 1285/1285; test:architecture 148/149, the failure the keychain guard on the new probe composition test, fixed in a5c5310e and 149/149 at a5c5310e. Windows at a5c5310e: gate:quick exit 0 (3664/3664, 428/428, 14/14); test:architecture 149/149; at 8f65c2cb test:contract 1028/1028, e2e probe-cli, cli-launchers, database-cli and extension-cli 40/40, sealed-launcher-closure 14/14 with the process-scoped exclude."
updatedAt: 2026-10-29T16:52:20Z
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
escaped. Three proofs depart from the letter of checks.md and need the owner's
ruling; they and everything else batch B settled are under `## Handoff` in
`checks.md`. New-code coverage on Linux from the unit and contract tests:
every module under `apps/vestra-cli/src/probe/` at 99-100%.

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

Dispatch an independent Verifier over `02b50ba8..HEAD` with every check
(C1-C32) and `checks.md`'s `## Handoff`. The real-worker proofs run on Linux
or macOS; on Windows the command refuses (AC 15). The owner rules on the three
deviations recorded there: the fixture statement reads `main.orders` (SQLite's
parser refuses the unqualified name), the supervisor's leak guard now also
refuses the escaped form (a change to `packages/extension-host`), and C7's
proof admits the credential store's own tool for the passphrase read before
the run exists.
