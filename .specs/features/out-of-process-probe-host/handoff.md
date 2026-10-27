---
schema: verchestra-feature-handoff/v1
feature: out-of-process-probe-host
issue: 235
status: verification
branch: feat/235-out-of-process-probe-host
baseRevision: cb563611da8b1ff80aa204536138f9440a0bff91
lastCompletedTask: T2
nextTask: "T3 (composition root wiring, and where grants and approvals are issued and stored) follows the owner's ratification of AD-037 as #569 amended it. The post-merge review of #424 (#553, slice 1) found three limits; #569 fixed them (.specs/features/probe-host-containment)."
lastGate: pnpm gate:security PASS (2026-09-29)
updatedAt: 2026-10-27T19:30:00Z
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

1. Ratify AD-037, in particular that an admitted worker keeps the host user's
   filesystem and network authority under `process-contained` (see
   `threat-model.md`, residual risks).
2. Where controller grants for workspace workers are issued and recorded (T3).

## Next action

Review `adr.md` and `threat-model.md`. After ratification, T3 composes the
host in `apps/vestra-cli`; nothing in this branch is reachable from the CLI yet.

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
