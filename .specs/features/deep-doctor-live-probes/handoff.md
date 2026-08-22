---
schema: verchestra-feature-handoff/v1
feature: deep-doctor-live-probes
issue: 207
status: in_progress
branch: feat/deep-doctor-live-probes
baseRevision: 0d7ad9a2bad3b29c4defb4338d1106e4fe22c6e1
lastCompletedTask: T1
nextTask: T2
lastGate: pnpm gate:quick (PASS; test:unit 2064/2064, 0 skipped, 0 todo)
updatedAt: 2026-08-22T00:00:00Z
---

# Scope

Issue #207: upgrade the seven presence-only deep-doctor checks to genuine
read-only observations. Requirements DDL-01 through DDL-14 in `spec.md`; 22
tasks in six phases in `tasks.md`. Parent #13 (T72); lands with or before #16
(T75), which is the current serial task.

T1 is implemented and gated on branch `feat/deep-doctor-live-probes`.

# Completed Evidence

- **T1** — `packages/domain/src/workspace-layout/subsystem-layout.ts` exports
  `WORKSPACE_ROOT_DIRNAME` (`.verchestra`) and `SUBSYSTEM_OBSERVATION_PATHS`,
  a frozen record naming the seven subsystem paths, with zero imports; exported
  from `packages/domain/src/index.ts`. Assertions in
  `tests/unit/subsystem-layout.test.mjs`: `:15` root dirname equals
  `.verchestra`; `:19` the record deep-equals exactly the seven expected
  subsystem/path pairs; `:31` the catalog is closed at seven; `:35,:36,:40`
  the record is frozen and a write throws without changing the value; `:48-52`
  every value is relative, POSIX-separated, and free of empty, `.`, `..`, or
  drive-qualified segments. Gate: `pnpm gate:quick` PASS; `pnpm test:unit`
  2064/2064 with zero failed, skipped, or todo (5 added, 2059 baseline
  preserved).

  Commit hashes for this branch are recorded here as each subsequent task
  lands; T1 is the second commit on the branch, after the planning commit.

# Next Exact Action

T2: replace `packages/workspace/src/init/safe-init.ts:16`'s local
`WORKSPACE_ROOT_DIRNAME` literal with the domain export, re-exporting the value
so no existing call site changes behavior, and confirm the safe-init suite
passes unchanged with no assertion weakened. Then `pnpm gate:quick`.

# Blockers

None. Two findings shape the plan and are already resolved as decisions:

- Every one of the seven probed leaf paths is referenced nowhere in the
  repository except `apps/vestra-cli/src/doctor-composition.ts:127-136`.
  `safe-init.ts` writes six files, none of them; `artifact-placement.ts`
  reserves seven directories, none of them; the only real runtime store is
  `runtime.sqlite` under a scenario root
  (`apps/vestra-cli/src/self-test-full-scenario.ts:343`). The root-level
  `.vestra` → `.verchestra` fix landed; the same drift persists one level down.
  Resolved by AD-019 (layout contract + T75 fixtures) and enforced by T4.
- `inspectRuntimeDatabase` now exists and is exported
  (`packages/platform-node/src/runtime-store/runtime-store.ts:472`), so one of
  the blockers named in the issue body is already resolved.

# Decisions

- **AD-019** — provisioning: one inward layout contract plus T75 qualification
  fixtures. No new user-facing surface; `vestra init` is not extended.
- **AD-020** — read-only guard: narrow read-only package subpaths plus a
  transitive closure guard, replacing the single-file textual scan.
- Probe port becomes async with sequential awaits inside the sentinel bracket;
  pre-computation outside the bracket is rejected because the issue's final
  acceptance criterion forbids it.
- "Available" for driver/connector/probe means a record exists, parses, and
  declares an installed subsystem. Reachability is excluded — it is neither
  read-only nor unpaid.
- Secret presence uses `SecretAdapter.has`, never
  `SecretBrokerBindingInspector.isBound`, which calls `broker.bind()` and mints
  a handle.

# Files Intentionally Left Unchanged

- The five checks already observing live signals: `installation`,
  `contract-schema`, `native-asset`, `git`, `clock`.
- `packages/workspace/src/placement/artifact-placement.ts` — its reserved
  layout covers project artifact classes, a different concern.
- Remediation behavior: doctor names a remediation code and never repairs.
