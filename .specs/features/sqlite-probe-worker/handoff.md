---
schema: verchestra-feature-handoff/v1
feature: sqlite-probe-worker
issue: 235
status: complete
branch: feat/235-sqlite-probe-worker-2
baseRevision: 17427ba687e3c0a197b5a1490600d7be3d3a699e
lastCompletedTask: null
nextTask: "None in this feature: #711 landed it on main. Credential delivery for engines other than SQLite is the next #235 step, its own feature and the owner's call."
lastGate: "Independent Verifier round 1 PASS at 1f31e259 (21/21; Windows: gate:quick, test:architecture 149, named proofs; Linux: gate:quick, test:contract 1040, test:architecture 149, test:build 190, test:integration 1289, test:e2e 366, named proofs, C11-C15 against the real worker); validate_verification exit 0; after the S4036 fix, Windows C7-C8 2/2 and test:architecture 149/149"
updatedAt: 2026-10-30T22:30:00Z
---

# Evidence

`vestra probe run` (#690, #700) had no worker to run: the only SQLite worker
was the test fixture `tests/fixtures/probe-workers/sqlite-worker.mjs`, and no
user document mentioned the `extension`, `database` or `probe` commands. On
2026-10-29 the owner chose to ship a first-party SQLite worker with a guide,
written into the Workspace by a command, taking its database file and
component id from two approved environment variables (AD-087).

C1-C21 are built, one builder, on `feat/235-sqlite-probe-worker-2`:

- `88c28b3d` bundles the worker: `apps/vestra-cli/src/probe/sqlite-probe-worker.ts`
  (data-probe's SQLite adapter over the read-only connection, the probe
  protocol's frame codec), the sealed child entry `probe:sqlite-worker`
  (`bin/sqlite-probe-worker.mjs`, `core-code`), `corepack pnpm
  build:probe-worker` (`scripts/build-probe-worker.mjs`, git-ignored output in
  `apps/vestra-cli/dist/`), the two guard edges (C18), and C7, C8, C9 (builder
  half), C10-C12.
- `39cbe766` adds `vestra probe worker` (`apps/vestra-cli/src/probe/probe-worker.ts`)
  on the entry rule `extension add` applies, now shared as
  `resolveWorkspaceFile`, its four refusals in the probe family's registry,
  every pinned command list (lesson L-019), and C1-C6, C9 (sealed half),
  C13-C17.
- `4b67eccc` adds `docs/probe-quick-start.md`, the two site links and the
  CHANGELOG entries (C19-C21).
- `3eb5c279` names, in C14's diagnostics, the code an unconfigured worker
  fails its run with: `VES_PROBE_WORKER_EXITED`.
- `168cdba3` moves the bundle entry to
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
`5eb3197b..1f31e259`, profile `light` (`verification.md`), on the branch of
#705, which GitHub keeps as `refs/pull/705/head`. The real-worker
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

#705 did not land. Main's `0.0.0-qualification.9` release had put its section
between `[Unreleased]` and the `### Added` list the CHANGELOG entries joined, so
a rebase merge would have filed the worker under a release built before it.
The same commits were replayed onto `17427ba6` as
`feat/235-sqlite-probe-worker-2`, with the two entries under `[Unreleased]`
(one sentence rewrapped so a code span stays on one line). Apart from
`CHANGELOG.md`, its diff from `17427ba6` equals #705's diff from `5eb3197b`
byte for byte.

#711 landed those commits on main as `f94d61ef..63fb1d47`, each with the same
patch as on its branch, and the commit ids this file and `checks.md`
`## Handoff` cite are main's.

# Next exact action

None in this feature. Credential delivery for engines other than SQLite is the
next #235 step, its own feature and the owner's call.
