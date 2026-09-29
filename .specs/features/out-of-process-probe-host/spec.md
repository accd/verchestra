# Out-of-Process Probe Host Specification

Issue: #235. Decision: AD-034 (`adr.md`). Threat model: `threat-model.md`.

## Problem statement

`packages/extension-host` fully specifies and contract-tests the
`verchestra-probe/1` wire protocol (Content-Length frames, a 9-key envelope,
Workspace binding, payload digests, sequence guard, handshake), but nothing
executes it: `ProbeWorkerSupervisor` dispatches to an in-process worker by
direct method call and never touches the frame codec. The handshake pins the
worker component to a product-hardcoded id and digest, so a worker a team
writes for its own engine can never be admitted. The governed-skill registry
already forces every executable lock entry to declare an `extensionRef` with an
`approvalRef`, and the qualified isolation policy already says executable
behavior needs a Tool or Plugin classification plus an explicit controller
grant (`authorizeSkillExecution`), but neither is consumed.

## Goals

- Put `verchestra-probe/1` on the execution path through a spawned worker
  process, end to end, under the unchanged supervisor bounds.
- Admit a workspace-supplied worker only through the locked `extensionRef` +
  `approvalRef` path and an explicit controller grant; deny by default.
- Make the worker contract language-neutral and prove it with a second
  language.

## Out of scope

| Item | Reason |
| --- | --- |
| OS sandboxing (filesystem, network, CPU, memory) | The host implements the `process-contained` grade only; `native-restricted` and `container-isolated` stay unqualified (`docs/qualification/isolation.md`). |
| Windows | Process-group semantics differ; the host refuses win32 explicitly rather than claim it. |
| Database credential delivery to a workspace worker | No secret handle is passed; the reference workers are protocol references with synthetic evidence. |
| CLI composition and a user-facing command | The composition root wiring is a follow-up once the owner ratifies AD-034. |
| Any change to the signed 1.0.0 hold or a release claim | This is a post-1.0 surface with its own qualification. |

## Requirements

| ID | Requirement |
| --- | --- |
| OOP-01 | The supervisor drives an out-of-process worker only through the frame codec: every inbound frame passes the bounded decoder (header and body size, JSON, 9-key envelope, Workspace binding, payload digest) and a strict sequence guard that rejects any replay; any violation terminates the worker and revokes the grant. |
| OOP-02 | The spawned transport builds the child environment from nothing (no inherited value), runs in a private `0700` temp directory it removes, uses stdio frames only, and kills the process group (plus any `setsid` descendant) on timeout, cancel, protocol fault, and completion through the shared process-group terminator. |
| OOP-03 | The executed file is a private copy written from the exact bytes whose SHA-256 matches the approved digest; a mismatch refuses to spawn. |
| OOP-04 | stderr is captured with a digest and a byte count, bounded (exceeding the limit kills the tree), retained only as a bounded excerpt, sanitized for control characters and secret shapes, and scrubbed of the protected parameter. |
| OOP-05 | A workspace worker is admitted only from a signed lock entry's `extensionRef` (`tool` or `plugin`) with a non-empty `approvalRef`, plus a controller grant bound to the same Workspace, lock, extension, approval, and digest, classified `approved-workspace-executable` under `process-contained`; admission is denied by default and the minted trust cannot be forged by shape. |
| OOP-06 | Under workspace trust the handshake pins the admitted component id and digest, the host-measured launch digest must equal the approved digest, and the product component namespace is reserved. |
| OOP-07 | Every existing supervisor bound stays mandatory on the out-of-process path: read-only principal and session proofs before execute, row, byte, and time limits (the time limit now covers every worker call), secret-leak detection, zeroization of the parameter bytes and the outbound parameter frame, and sanitized errors. |
| OOP-08 | A plain Node reference worker and a Python standard-library worker, neither importing repository code, both complete a probe; a missing interpreter is an explicit skip, never a pass. |
| OOP-09 | The change leaves the signed 1.0.0 release decision untouched and makes no release-readiness claim. |

## Wire contract (`verchestra-probe/1`, payload schema version 1)

Controller to worker: `probe.hello` `{maximumMessageBytes}`,
`probe.identity.request` `{plan}`, `probe.session.request` `{plan}`,
`probe.execute` `{planDigest, parameters}` (base64), `probe.cancel` `{}`.

Worker to controller: `probe.handshake`
`{protocol, supportedSchemas, component: {id, digest}, capabilities, maximumMessageBytes}`,
`probe.identity` `{evidence: {databaseId, principalReadOnly, principalFingerprint} | null}`,
`probe.session` `{planDigest, sessionReadOnly, transactionReadOnly}`,
`probe.result.chunk` `{rows}`, `probe.result.end` `{chunkCount}`,
`probe.error` `{...}` (never relayed; mapped to `VES_PROBE_WORKER_FAILURE`).

Every payload key set is exact. Each direction numbers its own frames from 0.
`payloadDigest` is `sha256:` over the RFC 8785 canonical JSON of the payload.
The worker receives its Workspace id in `VERCHESTRA_PROBE_WORKSPACE_ID`.
