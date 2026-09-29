# Out-of-Process Probe Host Qualification

Issue #235. Decision AD-034 (proposed). Specification, threat model, and
assertion-level evidence: `.specs/features/out-of-process-probe-host/`.

This is a post-1.0 security surface with its own qualification. It is not part
of the 1.0 critical path, it does not change the signed 1.0.0 release decision
(a recorded hold), and it makes no release or production-readiness claim.

## Decision

A workspace-supplied database probe worker may run as a separate process that
speaks `verchestra-probe/1` over stdio. The product supervises it with the same
bounds as an in-process worker. A worker is admitted only when a signed skill
lock pins its executable bytes by digest under an approved Tool or Plugin
`extensionRef`, and a controller grant binds that exact Workspace, lock,
extension, approval, and digest. Everything else is denied.

## Qualified runtime fixture

| Item | Qualified value |
| --- | --- |
| Node | 24.14.0 |
| Executed platform | darwin-arm64 (POSIX); Linux CI runs the same suites |
| Refused platform | win32 (`VES_PROBE_HOST_PLATFORM_UNSUPPORTED`) |
| Transport | stdio, UTF-8 JSON, ASCII `Content-Length` header |
| Protocol | `verchestra-probe/1`, payload schema version 1 |
| Isolation grade | `process-contained` |
| Second language | Python 3 standard library (`python3 -I -B`) |

## What is qualified

- **Framing:** header and body limits before allocation, unique canonical
  `Content-Length`, JSON, exact 9-key envelope, Workspace binding, and a
  payload digest re-derived on every frame.
- **Sequencing:** a strict guard; any replay, gap, or identity conflict
  terminates the worker and revokes the grant.
- **Launch:** absolute executable, no shell, NUL-free arguments, a
  from-nothing environment, a private `0700` working directory removed after
  use, and a private `0500` copy of the digest-verified entry bytes.
- **Lifetime:** the whole process group, plus any `setsid` descendant seen
  before the kill, is terminated on timeout, cancel, protocol fault, output
  overflow, and completion. The time bound covers every worker call.
- **Output:** stdout and stderr byte limits; stderr is kept only as a digest,
  a count, and a bounded excerpt that is sanitized and scrubbed of the
  protected parameter.
- **Admission:** denied by default; the minted trust cannot be forged by shape;
  the product component namespace is reserved; the host-measured launch digest
  and the worker's self-reported digest must both equal the approved digest.
- **Supervisor bounds (unchanged):** read-only principal and session proofs
  before execute, row and byte limits, secret-leak detection, zeroization of
  the delivered parameter bytes and the outbound parameter frame, sanitized
  errors, rollback of partial output.
- **Language neutrality:** a plain Node worker and a Python worker, neither
  importing repository code, complete the same probe.

## What is not qualified

- **OS sandboxing.** An admitted worker runs with the host user's filesystem
  and network authority. The isolation policy refuses `high-untrusted-executable`
  work under `process-contained`, and so does this host
  (`VES_STRONG_ISOLATION_UNAVAILABLE`); only human-approved code runs here.
  `native-restricted` and `container-isolated` remain unqualified
  (`isolation.md`).
- CPU and memory limits beyond wall-clock time.
- Database credential delivery to a workspace worker; the reference workers
  return synthetic evidence and rows.
- Windows, and a CLI composition (a follow-up after AD-034 is ratified).

## Evidence

72 focused tests across contract, integration, security, fault-injection, and
E2E scopes; file and line mapping in
`.specs/features/out-of-process-probe-host/validation.md`, threat-to-test
mapping in `threat-model.md`.
