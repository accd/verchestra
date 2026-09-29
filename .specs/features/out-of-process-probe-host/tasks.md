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

**Status:** Done. `threat-model.md`, `adr.md` (AD-034 in `.specs/STATE.md`),
`validation.md`, and `docs/qualification/out-of-process-probe-host.md`.

## T3 — Composition root wiring (not started)

**Status:** Planned, blocked on AD-034 ratification. Compose
`SpawnedProbeWorker` + `FramedProbeWorker` + the registry and grant issuance in
`apps/vestra-cli`, and decide how a controller grant is issued and recorded
(the authority store is the likely home).
