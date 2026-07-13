# T33 Driver Protocol and Mock Driver Validation

## Scope

- Task: T33 — Implement Driver protocol, supervisor, and Mock Driver
- Requirements: VES-MDL-005, VES-VFY-001…002, VES-TST-001/003/006
- Commit target: `feat(drivers): add protocol and mock driver`
- Focused evidence: 53 contract/fault cases (43 contract, 10 fault injection)
- Spec deviations: none

T33 establishes one provider-neutral Driver port, a strict framed transport, exact handshake negotiation, replay and sequence defenses, bounded event flow, cancellation escalation, and a deterministic Mock Driver. Invalid or ambiguous protocol input terminates the host boundary and revokes grants; supervisor faults require cancellation.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/contract/driver-protocol.test.mjs tests/contract/mock-driver.test.mjs tests/fault-injection/driver-supervisor-faults.test.mjs` | PASS — 53 passed, 0 failed/skipped |
| `node scripts/gate.mjs full` | PASS — format, lint, typecheck, 1,418 unit, 174 contract, 156 integration, 16 E2E, and 49 fault cases |

## Check A — sufficient, spec-anchored coverage

| Criterion / requirement | Exact assertion evidence | Spec-defined outcome | Covered |
| --- | --- | --- | --- |
| Framing and chunking | `tests/contract/driver-protocol.test.mjs` | Split and concatenated Content-Length frames decode identically | Yes |
| Malformed/oversized input | `tests/contract/driver-protocol.test.mjs` | Missing, duplicate, invalid, or oversized framing fails closed | Yes |
| Exact envelope | `tests/contract/driver-protocol.test.mjs` | Unknown fields, impossible instants, wrong Workspace, digest, or schema are rejected | Yes |
| Replay and ordering | `tests/contract/driver-protocol.test.mjs` | Exact replay is idempotent; conflict and sequence gaps terminate | Yes |
| Handshake | `tests/contract/driver-protocol.test.mjs` | Identity, schema, capability, protocol, and size bounds negotiate exactly | Yes |
| Common Driver lifecycle | `tests/contract/mock-driver.test.mjs` | Start, model resolution, streaming, usage, tools, diagnostics, close, and cancel are ordered | Yes |
| Start validation | `tests/contract/mock-driver.test.mjs` | Workspace, Passport revision, context digest, and tool schemas are canonical | Yes |
| Deterministic Mock | `tests/contract/mock-driver.test.mjs` | Scripted events and usage are reproducible with contiguous sequence values | Yes |
| Backpressure | `tests/fault-injection/driver-supervisor-faults.test.mjs` | High/low-water behavior is bounded; overflow requires cancellation | Yes |
| Cancellation escalation | `tests/fault-injection/driver-supervisor-faults.test.mjs` | Protocol cancel, process signal, and process-tree kill are ordered and evidenced | Yes |
| Minimum floor | Focused runner: 53 | At least 35 contract/fault cases | Yes |

## Check B — non-shallow litmus

- Frame decoding is exercised at five split points and with multiple frames in one chunk.
- Replay distinguishes a byte-equivalent duplicate from a conflicting reuse of the same message identity.
- Envelope validation rejects additional authority-shaped data and real-calendar-invalid timestamps, not only malformed syntax.
- Handshake failures revoke grants and cannot silently reduce required schemas or expand capabilities.
- Queue overflow and non-contiguous Driver events carry an explicit cancellation requirement.
- Cancellation tests prove early acknowledgement stops escalation and both timeout boundaries advance exactly one stage.

## Check C — necessary reverse mapping

| Test evidence | Requirement / criterion | Keep |
| --- | --- | --- |
| `driver-protocol.test.mjs` | Framing, schema, identity, ordering, replay, handshake | Yes |
| `mock-driver.test.mjs` | Common port, deterministic lifecycle, tools/errors/usage, start validation | Yes |
| `driver-supervisor-faults.test.mjs` | Bounded flow, sequence fault, cancellation escalation | Yes |

All 53 focused cases map to T33 requirements or done-when criteria. Provider-specific SDK behavior remains T34–T37.

## Check D — guideline conformance

- Followed `.specs/features/verchestra-1.0/tasks.md`: tests preceded implementation, the focused floor is exceeded, and `gate:full` passes.
- Uses one common Driver port and event vocabulary; the Mock Driver does not introduce a provider-specific execution path.
- Protocol parsing validates exact closed shapes before accepting payload authority.
- Supervisor flow is bounded and sequence-contiguous; cancellation escalation produces inspectable evidence.
- Mock sessions are local, deterministic, abort-aware, and reject post-close input.

## Adequacy verdict

PASS. T33 exceeds its focused floor, covers ordered/duplicate/malformed/overflow/cancel/kill behavior, provides deterministic scripted tool/error/usage scenarios, and passes the complete repository gate.
