---
schema: verchestra-feature-handoff/v1
feature: out-of-process-probe-host
issue: 235
status: complete
branch: feat/235-out-of-process-probe-host
baseRevision: cb563611da8b1ff80aa204536138f9440a0bff91
lastCompletedTask: T3
nextTask: "None. T1-T3 are done; delivering a database credential to the worker is its own feature, not planned (owner, 2026-10-29)."
lastGate: pnpm gate:security PASS (2026-09-29)
updatedAt: 2026-10-29T22:00:00Z
---

# Handoff: out-of-process probe host

## State

T1, T2 and T3 are complete. `verchestra-probe/1` now runs end to end
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

None. T3 is done (`tasks.md`): slice 1 (#681), slice 2a (#686), slice 2b
(#690) and the multi-parameter fix (#700) each landed with an independent
verification. Slice 2b's C7 process spy gained the positive control its
Verifier asked for: the test now requires a Git start before the review, so
a spy that recorded nothing fails it. Delivering a database credential to the
worker is its own feature, not planned (owner, 2026-10-29).
`docs/qualification/out-of-process-probe-host.md` still lists "a CLI
composition" among what the host's qualification does not cover; that is
true of its qualified revision, and a qualification document changes only
with a qualification report.

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
