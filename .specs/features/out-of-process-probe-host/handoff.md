---
schema: verchestra-feature-handoff/v1
feature: out-of-process-probe-host
issue: 235
status: in_progress
branch: feat/235-out-of-process-probe-host
baseRevision: cb563611da8b1ff80aa204536138f9440a0bff91
lastCompletedTask: T2
nextTask: "T3 slice 2b (`vestra probe run`) is complete and verified in .specs/features/probe-run/ and lands with its PR; after it, the owner decides what remains of T3 (the database credential is its own feature)."
lastGate: pnpm gate:security PASS (2026-09-29)
updatedAt: 2026-10-29T17:26:51Z
---

# Handoff: out-of-process probe host

## State

T1 and T2 are complete on this branch. `verchestra-probe/1` now runs end to end
against a spawned worker: `ProbeWorkerSupervisor` -> `FramedProbeWorker`
(extension-host) -> `SpawnedProbeWorker` (platform-node) -> child process. A
workspace worker is admitted only through
`GovernedSkillRegistry.resolveExecutableExtension` (locked `extensionRef` +
`approvalRef`) plus a bound controller grant, via `WorkspaceProbeAdmission`
(since #569; `admitWorkspaceProbeWorker` before, which took the extension as a
value).
The gate adapter's process-group terminator was extracted unchanged into
`packages/platform-node/src/process-tree-terminator.ts` and is shared.

## Open decisions for the owner

1. ~~Ratify AD-037~~ — ratified by the owner on 2026-10-28, as amended on
   2026-10-27, accepting that an admitted worker keeps the host user's
   filesystem and network authority under `process-contained`.
2. ~~Where controller grants for workspace workers are issued and recorded~~ —
   decided by the owner on 2026-10-28: a `CapabilityGrant` in the authority
   store under a run row, built in T3 slice 2.

## Next action

T3 slice 1 is complete and verified (`.specs/features/probe-host-composition/`):
the CLI composes `WorkspaceProbeAdmission` only, through the `./admission`
export, and starts nothing. The owner cut slice 2 in two on 2026-10-28. Slice
2a is complete and verified (`.specs/features/database-registration/`):
`vestra database add|list|remove` keeps signed database registrations in the
Workspace. Slice 2b is complete and verified (`.specs/features/probe-run/`):
`vestra probe run` runs one approved read-only statement through an admitted
worker under a grant the owner confirms per run, in a run of kind `probe`.
Delivering a database credential to the worker is its own feature (owner,
2026-10-29).

## Verification

See `validation.md` for assertion-level evidence. Gate results on darwin-arm64, Node 24.14.0:

- `pnpm gate:quick` PASS (unit 2166, agent-readiness 252).
- `pnpm gate:build` PASS (unit 2166, contract 553, integration 673, e2e 193,
  architecture 50, build 103, qualification 254).
- `pnpm gate:security` PASS (unit 2166, contract 553, e2e 193, architecture
  50, qualification 254, security 1223, fault 305).
- `pnpm test:e2e` PASS (193). `pnpm agent:check` PASS.

No test was skipped on this host; on win32 the spawned-process cases skip
with an explicit reason and the refusal case still runs.

# Post-merge review status (2026-10-13)

Merged without independent review on 2026-09-30 (#424); post-merge review
pending (#553). Proposed for the security reviewer.

The review found three limits (#569). #569 fixed them in code on 2026-10-27;
see `.specs/features/probe-host-containment/` and the amended AD-037.
