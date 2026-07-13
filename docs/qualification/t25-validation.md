# T25 Approval and Capability Validation

## Scope

- Task: T25 — Implement Capability Broker and state-bound Approvals
- Requirements: VES-EXE-001…003/006, VES-HOF-002/004, VES-RLS-004, and VES-TST-005
- Commit target: `feat(authority): add approvals and capability broker`
- Focused evidence: 56 cases — 11 unit, 40 security/mutation, and 5 integration
- Explicit mutation evidence: 35 bound-field, Grant-field, wildcard, and inheritance mutations
- Spec deviations: none

T25 creates signed, human-inspectable Approval artifacts and a separate ephemeral Capability Broker. An Approval binds its complete review surface and all current-state digests. A Capability Grant is exact to principal, action, resource, Workspace, run, declared capability, constraints, policy evidence, Approval, issue/expiry, and nonce. Invocation reloads durable state and re-verifies Approval and policy immediately before calling the effect callback.

Claims and repair-budget production services remain owned by T26 and T58. T25 binds their declared digests and proves any mutation invalidates authority; later owners supply the live claim and repair inputs.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/unit/approval-service.test.mjs tests/security/authority-binding.test.mjs tests/integration/authority-runtime.test.mjs` | PASS — 56 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck, build, 1,234 unit, 10 architecture, 248 qualification, 153 security, and 32 fault cases |

## Check A — sufficient, spec-anchored coverage

| Criterion / requirement | Exact assertion evidence | Spec-defined outcome | Covered |
| --- | --- | --- | --- |
| VES-EXE-001: human authority before writer | `tests/unit/approval-service.test.mjs:34`; `tests/security/authority-binding.test.mjs:57` | Non-human approval fails; the effect callback runs only after exact Approval, Grant, and policy checks | Yes |
| VES-EXE-002: complete review surface | `tests/unit/approval-service.test.mjs:17`, `:26` | Package/source, scope, protected paths, tasks, data, capabilities, Passports, destinations, budgets, claims, gates, risks, assumptions, criteria, and evidence are displayed and signed | Yes |
| VES-EXE-003: every bound input invalidates | `tests/security/authority-binding.test.mjs:44` generated 23-field matrix | Any source/scope/policy/context/capability/evidence/budget/claim mutation returns stale before effect | Yes |
| Exact Grant authority | `tests/security/authority-binding.test.mjs:80` generated seven-field matrix | Principal, action, resource, Workspace, run, capability, and constraints must match exactly | Yes |
| No wildcard or inherited authority | `tests/security/authority-binding.test.mjs:111` generated five-case corpus | `*`, namespace wildcard, glob, inherit, and inherited are rejected at grant creation | Yes |
| VES-HOF-002: publication-only Approval | `tests/security/authority-binding.test.mjs:144` | A Handoff Publication Approval cannot issue a code-write capability | Yes |
| Approval/capability linkage | `tests/security/authority-binding.test.mjs:136` | A capability absent from the signed review surface cannot be granted | Yes |
| Immediate policy reauthorization | `tests/security/authority-binding.test.mjs:161` | A post-grant deny or Policy View change prevents callback invocation | Yes |
| Expiry, signature, and revocation | `tests/unit/approval-service.test.mjs:43`, `:60`, `:70`; `tests/security/authority-binding.test.mjs:123` | Expired, tampered, or revoked authority fails closed | Yes |
| Action separation | `tests/unit/approval-service.test.mjs:83` | Execution, publication, support export, and recovery approvals are exact and non-interchangeable | Yes |
| Durable restart/integrity | `tests/integration/authority-runtime.test.mjs:40`, `:70`, `:84`, `:95`, `:111` | Signed records and revocation survive restart; tamper and conflicting identity fail closed | Yes |
| Minimum floors | Focused runner: 56; explicit mutations: 31 | At least 45 unit/security and at least 5 mutations | Yes |

No T25-owned precision gap remains. T26 supplies live claim acquisition/expiry; T27 supplies the Data Egress Firewall; T56 consumes support-export authority; T57 consumes execution authority; and T58 applies repair-budget continuation.

## Check B — non-shallow litmus

- The signed Ed25519 payload contains the review surface itself, not only caller-provided hashes. Verification reconstructs every digest from that content.
- Twenty-three independent Approval-binding mutations include package, source, scope, protected paths, tasks, data, capabilities, Passports, destinations, budgets, claims, gates, risks, assumptions, criteria, evidence, policy, and context.
- Seven Grant-field mutations assert the effect callback count remains zero.
- Capability issuance reloads the signed Approval and requires literal membership in its reviewed capability list.
- Policy is called both at grant issue and immediately before invocation; a stored allow cannot authorize a later deny.
- SQLite tests close and reopen the real database, persist revocation separately from the signed immutable record, and corrupt raw JSON to exercise the independent record digest.

## Check C — necessary reverse mapping

| Test evidence | Requirement / criterion | Keep |
| --- | --- | --- |
| `approval-service.test.mjs:17–94` | Human review, signing, expiry, revocation, action separation | Yes |
| `authority-binding.test.mjs:44–55` | VES-EXE-003 complete Approval mutation matrix | Yes |
| `authority-binding.test.mjs:57–109` | Exact pre-effect Grant verification | Yes |
| `authority-binding.test.mjs:111–159` | No wildcard/inheritance, revocation, signed capability membership, Handoff separation | Yes |
| `authority-binding.test.mjs:161–175` | Immediate policy reauthorization | Yes |
| `authority-runtime.test.mjs:40–123` | Durable restart, revocation, integrity, idempotency/conflict | Yes |

All 56 focused cases map to a named requirement or the T25 done-when criterion. The 35 generated mutations are test inputs, not weakened copies of production logic.

## Check D — guideline conformance

- Followed `.specs/features/verchestra-1.0/tasks.md`: unit/security floors and the explicit mutation floor are exceeded and `gate:security` passes.
- Followed Design §4.5/4.6 and §5.5: Approval and Capability are separate types with separate lifetimes and authority semantics.
- Followed Design §8.4: invocation performs state, Approval, exact Grant, and policy checks before the effect callback.
- Followed AD-013/026: application owns backend-neutral services/ports; platform-node implements durable storage without sibling-adapter coupling.
- Followed AD-040: every Approval and Grant binds the active Policy View digest and fails on drift.

## Adequacy verdict

PASS. Every T25-owned criterion has discriminating evidence, all 35 explicit mutations fail before effect, the complete security gate is green, signed review contents are reconstructably bound, and durable authority survives restart while tamper and revocation fail closed.
