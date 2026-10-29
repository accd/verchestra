# Out-of-Process Probe Host Tasks

## T1 — Protocol on the execution path, spawned transport, workspace trust

**Status:** Done.

- `packages/extension-host/src/framed-probe-worker.ts`: `FramedProbeWorker`
  and the `ProbeWorkerTransport` port (OOP-01, OOP-07).
- `packages/extension-host/src/index.ts`: strict `ProbeSequenceGuard` mode,
  exactly-one trust root, workspace handshake variant with the host-measured
  digest check, and a time bound over every worker call (OOP-01, OOP-06,
  OOP-07).
- `packages/extension-host/src/workspace-trust.ts`: `authorizeSkillExecution`
  (product port of the qualified spike rule) and `admitWorkspaceProbeWorker`
  (OOP-05).
- `packages/agent-runtime/src/skills/governed-skill-registry.ts`:
  `resolveExecutableExtension`, the first consumer of `extensionRef` and
  `approvalRef` (OOP-05).
- `packages/platform-node/src/spawned-probe-worker.ts` and
  `process-tree-terminator.ts`: `SpawnedProbeWorker`; the gate adapter's
  terminator extracted unchanged and shared (OOP-02, OOP-03, OOP-04).
- Reference workers in `tests/fixtures/probe-workers/` (Node and Python) and
  contract, integration, security, fault, and E2E suites (OOP-08).

## T2 — Threat model, ADR, qualification

**Status:** Done. `threat-model.md`, `adr.md` (AD-037 in `.specs/STATE.md`),
`validation.md`, and `docs/qualification/out-of-process-probe-host.md`.

## T3 — Composition root wiring

**Status:** Done. AD-037 was ratified on 2026-10-28, and the owner cut T3 into
three slices, each planned, built and independently verified as its own
feature:

- Slice 1, `.specs/features/probe-host-composition/` (#681): the
  `vestra extension add|approve|list|revoke|check` commands, and the CLI
  composes `WorkspaceProbeAdmission`.
- Slice 2a, `.specs/features/database-registration/` (#686): the
  `vestra database add|list|remove` commands, which keep signed database
  registrations and their access policy in the Workspace.
- Slice 2b, `.specs/features/probe-run/` (#690): `vestra probe run` composes
  `SpawnedProbeWorker`, `FramedProbeWorker` and the supervisor. A controller
  grant is a `CapabilityGrant` in the authority store under a run of kind
  `probe`, which the owner confirms per run.
- The fix `.specs/features/probe-multi-parameter/` (#700): a probe statement
  binds every parameter, on every engine.

Delivering a database credential to the worker is not part of T3; it is its
own feature, not planned (owner, 2026-10-29).
