# T26 Work Claim and Lease Validation

## Scope

- Task: T26 — Implement local leases and remote Work Claims
- Requirements: VES-EXE-004…005, VES-HOF-001/003, and VES-INT-001
- Commit target: `feat(coordination): add leases and work claims`
- Focused evidence: 41 cases — 23 unit/property, 11 integration, and 7 fault injection
- Spec deviations: none

T26 creates canonical change-scope normalization, segment-aware overlap detection, mandatory Workspace-local SQLite writer leases, and a remote Work Claim lifecycle behind an atomic Connector port. Team Mode supports enforced and explicitly degraded advisory coordination. Personal Mode requires no remote service but retains a fenced local lease with heartbeat and release.

The Jira implementation of atomic remote claim persistence remains owned by T61. T26 defines and qualifies the trusted controller contract, signed-claim validation, conflict behavior, and a deterministic in-memory Connector oracle used by later adapters.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/unit/change-scope.test.mjs tests/integration/coordination-service.test.mjs tests/fault-injection/coordination-faults.test.mjs` | PASS — 41 passed, 0 failed/skipped |
| `node scripts/gate.mjs full` | PASS — format, lint, typecheck, 1,257 unit, 82 contract, 156 integration, 16 e2e, and 39 fault cases |
| `node --test tests/architecture/*.test.mjs` | PASS — 10 passed, 0 failed/skipped |

## Check A — sufficient, spec-anchored coverage

| Criterion / requirement | Exact assertion evidence | Spec-defined outcome | Covered |
| --- | --- | --- | --- |
| Canonical scope normalization | `tests/unit/change-scope.test.mjs:13`, `:24`, `:30` | Sort, dedupe, ancestor-collapse, whole-project coverage, and order-independent digest | Yes |
| Partial-overlap property corpus | `tests/unit/change-scope.test.mjs:89` generated 15-case matrix | Equality, both ancestor directions, segment siblings, text prefixes, projects, whole-project, multi-target, depth, and case are correct and symmetric | Yes |
| Unsafe paths fail before coordination | `tests/unit/change-scope.test.mjs:96` generated five-case corpus | Traversal, absolute, backslash, wildcard, and drive paths are rejected | Yes |
| VES-EXE-005: Personal Mode local-only | `tests/integration/coordination-service.test.mjs:13`, `:28`, `:196` | No remote dependency; local acquire/heartbeat/release and restart single-writer enforcement remain mandatory | Yes |
| VES-EXE-004: signed Team claim | `tests/integration/coordination-service.test.mjs:46` | Local lease precedes a signed, expiring, scope-bound remote claim | Yes |
| Enforced/advisory overlap | `tests/integration/coordination-service.test.mjs:60`, `:85` | Enforced overlap blocks before mutation; advisory overlap is explicit degraded state | Yes |
| Heartbeat/expiry/takeover | `tests/integration/coordination-service.test.mjs:106`, `:122` | Heartbeat preserves fencing; expired claim permits a strictly higher takeover token | Yes |
| Local and remote stale fencing | `tests/integration/coordination-service.test.mjs:144`, `:158` | Expired local owner cannot resurrect; stale remote reference cannot heartbeat or release successor | Yes |
| Release lifecycle | `tests/integration/coordination-service.test.mjs:181` | Confirmed remote release precedes local release | Yes |
| Connector/signature fault behavior | `tests/fault-injection/coordination-faults.test.mjs:15`, `:24`, `:32`, `:41`, `:57`, `:68` | Enforced outage/signature failure closes and releases; advisory is explicit; heartbeat/release uncertainty never lies | Yes |
| Local conflict before remote effect | `tests/fault-injection/coordination-faults.test.mjs:77` | Competing local writer causes zero remote request | Yes |
| Minimum test floor | Focused runner: 41 | At least 30 property/integration/fault cases | Yes |

No T26-owned precision gap remains. T57 consumes the lease/claim verification before writers, T60 handles Handoff release/reacquisition, and T61 implements the production Jira claim Connector using the qualified atomic port.

## Check B — non-shallow litmus

- Overlap is based on parsed path segments, so `src/app` does not collide with `src/application`, while `src` correctly covers `src/api`.
- Normalization removes descendants already covered by an ancestor and treats a pathless Project target as the entire Project.
- The remote port must atomically decide acquire versus conflict; the controller never implements a race-prone list-then-create sequence.
- Every acquired, conflicting, renewed, and current remote claim is signature-checked; immutable fields cannot change during heartbeat.
- Local heartbeat uses expected fencing-token CAS. An expired owner cannot renew with its old token, even under the same run identity.
- Enforced remote acquisition failures release the provisional local lease; uncertain remote release preserves local protection for reconciliation.
- A real SQLite restart proves Personal Mode protection is durable rather than process-local.

## Check C — necessary reverse mapping

| Test evidence | Requirement / criterion | Keep |
| --- | --- | --- |
| `change-scope.test.mjs:13–103` | Normalization, overlap properties, and input safety | Yes |
| `coordination-service.test.mjs:13–219` | Personal/Team lifecycle, conflict modes, heartbeat, takeover, fencing, release, restart | Yes |
| `coordination-faults.test.mjs:15–87` | Outage, invalid signatures, uncertain release, local-before-remote ordering | Yes |

All 41 focused cases map to a named requirement or T26 done-when criterion. No speculative case remains.

## Check D — guideline conformance

- Followed `.specs/features/verchestra-1.0/tasks.md`: property/integration/fault floor is exceeded and `gate:full` passes.
- Followed Design §4.6: the application service owns normalized scopes and orchestration; local SQLite and remote Connectors remain ports/adapters.
- Followed Design §8.4: local and remote writer authority is established before any mutable tool path.
- Followed AD-013/026: application imports only domain; platform-node implements the local lease without sibling-adapter coupling.
- Followed AD-041: Work Claim identity is suitable for binding into Approval and Capability verification without widening either authority.

## Adequacy verdict

PASS. All T26-owned behaviors have discriminating evidence, the 41 focused cases exceed the required floor, full and architecture gates are green, partial overlaps are deterministic, and stale/outage/signature cases fail before unauthorized mutation.
