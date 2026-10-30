---
schema: verchestra-feature-handoff/v1
feature: sqlite-probe-worker
issue: 235
status: verification
branch: feat/235-sqlite-probe-worker
baseRevision: d3c64cce1b6cf8eb839809fbf0d7d09adeb7596e
lastCompletedTask: C1-C21
nextTask: "Dispatch an independent Verifier over the plan's merge base..HEAD with every check, C1-C21, running the real-worker proofs (C10-C15) and test:e2e and test:build on Linux."
lastGate: "Linux at 751677ad: gate:quick PASS (unit 3672/3672, agent-readiness 466/466, census 14/14), test:contract 1040/1040, test:architecture 149/149, test:build 190/190, test:integration 1289/1289, test:e2e 366/366, 0 skipped; Windows at 751677ad: gate:quick PASS (unit 3672/3672, agent-readiness 466/466, census 14/14), test:architecture 149/149, sealed-launcher-closure 15/15 with the .claude/ exclude; complexity:check, agent:check, lint and format:check PASS"
updatedAt: 2026-10-30T02:30:00Z
---

# Evidence

`vestra probe run` (#690, #700) had no worker to run: the only SQLite worker
was the test fixture `tests/fixtures/probe-workers/sqlite-worker.mjs`, and no
user document mentioned the `extension`, `database` or `probe` commands. On
2026-10-29 the owner chose to ship a first-party SQLite worker with a guide,
written into the Workspace by a command, taking its database file and
component id from two approved environment variables (AD-087).

C1-C21 are built, one builder, on `feat/235-sqlite-probe-worker`:

- `610c9d41` bundles the worker: `apps/vestra-cli/src/probe/sqlite-probe-worker.ts`
  (data-probe's SQLite adapter over the read-only connection, the probe
  protocol's frame codec), the sealed child entry `probe:sqlite-worker`
  (`bin/sqlite-probe-worker.mjs`, `core-code`), `corepack pnpm
  build:probe-worker` (`scripts/build-probe-worker.mjs`, git-ignored output in
  `apps/vestra-cli/dist/`), the two guard edges (C18), and C7, C8, C9 (builder
  half), C10-C12.
- `7baae2f2` adds `vestra probe worker` (`apps/vestra-cli/src/probe/probe-worker.ts`)
  on the entry rule `extension add` applies, now shared as
  `resolveWorkspaceFile`, its four refusals in the probe family's registry,
  every pinned command list (lesson L-019), and C1-C6, C9 (sealed half),
  C13-C17.
- `01712335` adds `docs/probe-quick-start.md`, the two site links and the
  CHANGELOG entries (C19-C21).
- `5eb5bef4` names, in C14's diagnostics, the code an unconfigured worker
  fails its run with: `VES_PROBE_WORKER_EXITED`.
- `751677ad` moves the bundle entry to
  `apps/vestra-cli/closure/sqlite-probe-worker-entry.ts`, beside the launcher
  entries.

The builder's reversible choices and what was abandoned are in `checks.md`
`## Handoff`. No Landing row was added: nothing found mid-build was a one-way
door. No assertion was weakened; the pinned lists that move with a new command
(`cli-surface`, the `--help` snapshot, `SEALED_COMMANDS`, `SEALED_BIN_IDS`,
the census's closed exclusion list) gained their new member.

New-code coverage from the unit and contract scopes, measured with Node's
coverage over `tests/unit/sqlite-probe-worker.test.mjs` and
`tests/contract/probe-worker-command.test.mjs`: `probe-worker.ts` and
`sqlite-probe-worker.ts` 100% of lines and branches; the bundle entry is in
`closure/`, which SonarCloud excludes from coverage like the launcher entries.

# Next exact action

Dispatch an independent Verifier over the plan's merge base `..HEAD` with
every check, C1-C21. The real-worker proofs (C11-C15) assert the platform
refusal on Windows, so the Verifier runs them, test:e2e, test:build and
test:integration on Linux; macOS runs only in the nightly platform matrix
after merge.
