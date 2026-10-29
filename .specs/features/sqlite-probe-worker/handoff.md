---
schema: verchestra-feature-handoff/v1
feature: sqlite-probe-worker
issue: 235
status: planned
branch: plan/235-sqlite-probe-worker
baseRevision: 48e2ae281e4f62f447e64fa9960efa1cfaefe752
lastCompletedTask: null
nextTask: "The owner reviews plan.md and AD-087. After approval, derive checks.md from the plan, build, and dispatch an independent Verifier."
lastGate: "validate_plan: 0 errors, 0 warnings"
updatedAt: 2026-10-29T23:45:00Z
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

# Next exact action

The owner reviews `plan.md` and AD-087 (proposed). After approval, derive
`checks.md` from the plan, build, and dispatch an independent Verifier.
