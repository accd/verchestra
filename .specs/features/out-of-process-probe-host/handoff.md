---
schema: verchestra-feature-handoff/v1
feature: out-of-process-probe-host
issue: 235
status: verification
branch: feat/235-out-of-process-probe-host
baseRevision: cb563611da8b1ff80aa204536138f9440a0bff91
lastCompletedTask: T2
nextTask: Independent review of AD-037 and the threat model; on ratification, start T3 (composition root wiring and grant issuance).
lastGate: pnpm gate:security PASS (2026-09-29)
updatedAt: 2026-09-29T01:00:00Z
---

# Handoff: out-of-process probe host

## State

T1 and T2 are complete on this branch. `verchestra-probe/1` now runs end to end
against a spawned worker: `ProbeWorkerSupervisor` -> `FramedProbeWorker`
(extension-host) -> `SpawnedProbeWorker` (platform-node) -> child process. A
workspace worker is admitted only through
`GovernedSkillRegistry.resolveExecutableExtension` (locked `extensionRef` +
`approvalRef`) plus a bound controller grant, via `admitWorkspaceProbeWorker`.
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
