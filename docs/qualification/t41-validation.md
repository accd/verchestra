# T41 Isolated Probe Worker Validation

## Scope

- Task: T41 — Implement isolated Probe Worker and bounded result stream
- Requirements: VES-DBP-002…004, VES-TST-003/006/008
- Commit target: `feat(probe): add isolated probe worker`
- Focused evidence: 47 cases (29 contract, 12 security, 6 fault injection)
- Spec deviations: none

T41 introduces a bounded Content-Length Probe protocol, exact worker handshake and replay guard, principal/session read-only evidence, scoped protected-parameter delivery, transactional protected result storage, concurrency/timeout/cancellation enforcement, and a deterministic Mock Probe Worker. Raw rows remain behind a protected result reference and no partial result is promoted.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/contract/probe-worker-protocol.test.mjs tests/contract/probe-worker-supervisor.test.mjs tests/security/probe-worker-security.test.mjs tests/fault-injection/probe-worker-faults.test.mjs` | PASS — 47 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck/build, 1,496 unit/property, 10 architecture, 248 qualification, 294 security, and 55 fault cases |

## Adequacy matrix

| Criterion | Evidence | Covered |
| --- | --- | --- |
| Framed protocol | Five chunk boundaries, multiple messages, six malformed frame families | Yes |
| Message integrity | Closed envelope, payload digest, Workspace binding, contiguous sequence, replay conflict | Yes |
| Worker handshake | Exact protocol, schemas, component identity/digest, read-only capability, message bound | Yes |
| Principal read-only | Positive evidence plus overprivileged, missing, and foreign-database failures | Yes |
| Session read-only | Session and transaction flags plus exact plan-digest binding | Yes |
| Protected parameters | Scoped delivery, zeroization, no result-envelope material, echo/leak detection | Yes |
| Bounded results | Row and byte overflow cancellation with transactional rollback | Yes |
| Timeout/cancel | Timeout, external abort, cancellation failure, mandatory termination escalation | Yes |
| Concurrency | Excess rejection before worker start and lease release after failure | Yes |
| Failure atomicity | Worker crash and sink failure produce zero partial promoted evidence | Yes |
| Result provenance | Database, registration, plan/query/grant, classification, bounds, identity, digest, time | Yes |
| Mock engine | Ordered handshake/identity/session/execute, chunks, delays, crashes, cancel and terminate | Yes |
| Minimum floor | 47 focused cases versus required 35 | Yes |

## Non-shallow checks

- Query execution cannot begin until both the database principal and engine session/transaction independently prove read-only status.
- Parameter bytes exist only inside the scoped worker callback and are zeroized on every terminal path.
- Result chunks stage transactionally. Commit occurs only after the stream completes within row, byte, timeout, concurrency, and leak bounds.
- The canonical result envelope contains counts, fingerprints, classifications, bounds, and a protected result reference, never rows or parameter values.
- Timeout first aborts and requests cancellation, then terminates the worker even when cancellation acknowledgement fails.
- Frame, digest, Workspace, sequence, replay, handshake, and capability attacks terminate the worker and require Capability Grant revocation.
- An abort already active before the worker starts is rechecked, closing the lost-abort race across asynchronous setup.

## Verdict

PASS. Tests preceded implementation, identity and session read-only controls are independently mandatory, every required overflow/crash/protocol/secret family fails closed, partial evidence is transactional, the test floor is exceeded, and the full security gate passes.
