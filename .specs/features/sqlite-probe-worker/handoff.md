---
schema: verchestra-feature-handoff/v1
feature: sqlite-probe-worker
issue: 235
status: in_progress
branch: feat/235-sqlite-probe-worker
baseRevision: d3c64cce1b6cf8eb839809fbf0d7d09adeb7596e
lastCompletedTask: null
nextTask: "Build C1-C21 from checks.md with one builder, then dispatch an independent Verifier over the plan's merge base..HEAD with every check."
lastGate: "validate_plan and validate_checks: 0 errors, 0 warnings; no code yet"
updatedAt: 2026-10-29T23:55:00Z
---

# Evidence

`vestra probe run` (#690, #700) has no worker to run: the only SQLite worker is
the test fixture `tests/fixtures/probe-workers/sqlite-worker.mjs`, and no user
document mentions the `extension`, `database` or `probe` commands. On
2026-10-29 the owner chose to ship a first-party SQLite worker with a guide.
The owner also chose that a command writes the worker into the Workspace and
that the worker takes its database file and component id from two approved
environment variables.

Facts found while planning, with their places:

- An extension's entry must be a regular file inside the Workspace's Git top
  level, with no symlink on its path and at most 16 MiB
  (`apps/vestra-cli/src/extension/extension-workspace.ts` `resolveEntry`).
- The probe host spawns a copy of the entry in a temporary directory, with
  the approved arguments before it and an environment built from nothing, so
  the entry must be self-contained
  (`packages/platform-node/src/spawned-probe-worker.ts`).
- An approval's launch digest covers the executable's realpath and bytes, the
  arguments, the extra environment and the entry's digest, but not its path
  (`packages/platform-node/src/probe-launch-digest.ts`).
- Environment names must match `^[A-Z][A-Z0-9_]{0,63}$` and must be neither
  reserved, secret-like nor loader names (`spawned-probe-worker.ts`).
- The release builder already emits two child bundles beside the launchers,
  under a `node:`-only import check (`scripts/t76-build-candidate.mjs`
  `SEALED_CHILD_ENTRIES`), and `release-layout.ts` finds them.
- `--output` is the CLI's global output-format flag (`apps/vestra-cli/src/cli.ts`),
  so the write command's path flag is `--entry`.

The owner approved `plan.md` and AD-087 on 2026-10-29 (#703). `checks.md`
holds 21 checks at profile `light`; the distinct files the build reads or
touches come to ~75-100k, under the 150k budget, so one builder.

# Next exact action

Build C1-C21 test-first from `checks.md` on `feat/235-sqlite-probe-worker`,
running the real-worker proofs on Linux (WSL clone `~/verchestra-569`) and
test:e2e and test:build there (lesson L-019). Then dispatch an independent
Verifier over the plan's merge base `..HEAD` with every check.
