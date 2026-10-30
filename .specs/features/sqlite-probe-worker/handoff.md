---
schema: verchestra-feature-handoff/v1
feature: sqlite-probe-worker
issue: 235
status: complete
branch: feat/235-sqlite-probe-worker
baseRevision: 5eb3197b526247aef1af0b97cb79082320d15814
lastCompletedTask: null
nextTask: "Owner review of the sqlite-probe-worker build PR; after it lands, the next #235 step (credential delivery for engines other than SQLite) is its own feature and the owner's call."
lastGate: "Independent Verifier round 1 PASS at 1f31e259 (21/21; Windows: gate:quick, test:architecture 149, named proofs; Linux: gate:quick, test:contract 1040, test:architecture 149, test:build 190, test:integration 1289, test:e2e 366, named proofs, C11-C15 against the real worker); validate_verification exit 0; after the S4036 fix, Windows C7-C8 2/2 and test:architecture 149/149"
updatedAt: 2026-10-30T10:30:00Z
---

# Evidence

`vestra probe run` (#690, #700) had no worker to run: the only SQLite worker
was the test fixture `tests/fixtures/probe-workers/sqlite-worker.mjs`, and no
user document mentioned the `extension`, `database` or `probe` commands. On
2026-10-29 the owner chose to ship a first-party SQLite worker with a guide,
written into the Workspace by a command, taking its database file and
component id from two approved environment variables (AD-087).

C1-C21 are built, one builder, on `feat/235-sqlite-probe-worker`:

- `69fc8a12` bundles the worker: `apps/vestra-cli/src/probe/sqlite-probe-worker.ts`
  (data-probe's SQLite adapter over the read-only connection, the probe
  protocol's frame codec), the sealed child entry `probe:sqlite-worker`
  (`bin/sqlite-probe-worker.mjs`, `core-code`), `corepack pnpm
  build:probe-worker` (`scripts/build-probe-worker.mjs`, git-ignored output in
  `apps/vestra-cli/dist/`), the two guard edges (C18), and C7, C8, C9 (builder
  half), C10-C12.
- `84d6a704` adds `vestra probe worker` (`apps/vestra-cli/src/probe/probe-worker.ts`)
  on the entry rule `extension add` applies, now shared as
  `resolveWorkspaceFile`, its four refusals in the probe family's registry,
  every pinned command list (lesson L-019), and C1-C6, C9 (sealed half),
  C13-C17.
- `ff225bbb` adds `docs/probe-quick-start.md`, the two site links and the
  CHANGELOG entries (C19-C21).
- `d4623a77` names, in C14's diagnostics, the code an unconfigured worker
  fails its run with: `VES_PROBE_WORKER_EXITED`.
- `64c3c761` moves the bundle entry to
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

# Verification

An independent Verifier passed every check, C1-C21, at `1f31e259` over
`5eb3197b..1f31e259`, profile `light` (`verification.md`). The real-worker
proofs (C11-C15) ran on Linux; on Windows they assert the platform refusal, and
macOS runs only in the nightly platform matrix after merge. Its non-failing
notes are two precision gaps in the checks' wording (C9 names the sealed child
entries where the descriptor holds the `bin/` path; C17 gives no explicit
position), now lessons L-020 and L-021, and the pre-rebase commit ids this
file and `checks.md` cited, now replaced by their rebased ids.

After verification, SonarCloud's quality gate on the PR failed its security
rating on one finding, S4036: `scripts/build-probe-worker.mjs` started `git` by
bare name. It now starts git through `scripts/git-executable.mjs`, as the
gate-selection and agent-readiness scripts do, and
`tests/architecture/absolute-child-executables.test.mjs` pins it among them;
that test fails on the bare name. C7 and C8, the proofs over the build script,
and `test:architecture` re-ran green on Windows.

# Next exact action

Owner review of the sqlite-probe-worker build PR. After it lands, credential
delivery for engines other than SQLite is its own feature and the owner's call.
