# T29 Deterministic Context Compiler Validation

## Scope

- Task: T29 — Implement Deterministic Context Compiler
- Requirements: VES-CTX-001…006, VES-MDL-001/004, and VES-EXE-003
- Commit target: `feat(context): implement deterministic compiler`
- Focused evidence: 53 cases — 33 unit/property and 20 security
- Explicit mutation evidence: six independently bound snapshot mutations
- Spec deviations: none

T29 implements the frozen resolve-input validation → provenance/classification validation → freshness filter → deduplication → stable rank → mandatory/priority budgets → omission evidence → egress authorization → semantic digest → signing pipeline. It produces one backend-neutral immutable Context Manifest; provider-specific serialization remains T30.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/unit/context-compiler.test.mjs tests/security/context-compiler-security.test.mjs` | PASS — 53 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck, build, 1,346 unit, 10 architecture, 248 qualification, 200 security, and 39 fault cases |

## Check A — sufficient, spec-anchored coverage

| Criterion / requirement | Exact assertion evidence | Spec-defined outcome | Covered |
| --- | --- | --- | --- |
| VES-CTX-002 determinism | `tests/unit/context-compiler.test.mjs:19` | All 24 source-order permutations plus reversed fragment order yield one manifest identity | Yes |
| Frozen stable rank | `tests/unit/context-compiler.test.mjs:35` | Priority, trust, source identity/revision, fragment identity, and digest determine order without a model | Yes |
| Deduplication | `tests/unit/context-compiler.test.mjs:47` | Same content retains one canonical winner and records an exact duplicate omission | Yes |
| Priority budgets | `tests/unit/context-compiler.test.mjs:60` | High/medium/low fragments are whole-item omitted with priority, size, freshness, and confidence evidence | Yes |
| VES-CTX-004 model capacity | `tests/unit/context-compiler.test.mjs:80`, `tests/security/context-compiler-security.test.mjs:48` | Optional low rank omits first; mandatory context fails eligibility at five insufficient capacities and is never truncated | Yes |
| Semantic obligations/signing | `tests/unit/context-compiler.test.mjs:93` | Canonical obligations and their digest enter the signed manifest | Yes |
| Frozen pipeline order | `tests/unit/context-compiler.test.mjs:103` | Exact included fragments reach egress before any signer invocation | Yes |
| Discovery evidence | `tests/unit/context-compiler.test.mjs:117` | Stale findings, omission, and contradiction alternatives survive in the signed result | Yes |
| Six bound mutations | `tests/security/context-compiler-security.test.mjs:17–46` | Workspace, recipe ID/digest, snapshot identity, content digest, and fragment Workspace fail before egress | Yes |
| VES-CTX-006 egress | `tests/security/context-compiler-security.test.mjs:61` | Classification, purpose, authority, policy, and network-mode denials prevent signing | Yes |
| VES-CTX-003 injection boundary | `tests/security/context-compiler-security.test.mjs:88` | Hostile bytes cannot change priority, trust, destination, or purpose | Yes |
| Signed-only output | `tests/security/context-compiler-security.test.mjs:110` | Signer failure yields no unsigned manifest and exposes no private exception | Yes |
| Estimator fail-closed | `tests/security/context-compiler-security.test.mjs:126` | Invalid estimate blocks before egress and budgeting | Yes |
| Required evidence | `tests/security/context-compiler-security.test.mjs:146` | Missing required source makes the invocation ineligible | Yes |
| Minimum floors | Focused runner: 53; mutation corpus: 6 | At least 50 unit/property/security and at least 6 mutations | Yes |

## Check B — non-shallow litmus

- Determinism covers all 24 permutations of four source groups and reverses every nested fragment list; it is not a two-input spot check.
- Six mutations target independent source-state bindings and prove failure occurs before egress.
- Five distinct insufficient capacities prove mandatory context is rejected whole rather than accidentally fitting at one boundary.
- Five independent egress denial families prove signing is downstream from the complete firewall decision.
- Duplicate and budget omissions assert structured reason, identity, priority, estimated size, freshness, and confidence rather than only fragment counts.
- Hostile content embeds fake destination, purpose, priority, and trust directives; controller-owned values remain unchanged.
- Snapshot validation rechecks recipe binding, source/selector identity, requiredness, status, time, classification floor, trust class, Workspace, revision, and content digest; content addressing is not mistaken for authenticity.

## Check C — necessary reverse mapping

| Test evidence | Requirement / criterion | Keep |
| --- | --- | --- |
| `context-compiler.test.mjs:19–45` | Determinism and stable order | Yes |
| `context-compiler.test.mjs:47–91` | Deduplication, budgets, capacity, omission evidence | Yes |
| `context-compiler.test.mjs:93–132` | Semantic digest, pipeline order, source evidence | Yes |
| `context-compiler-security.test.mjs:17–59` | Snapshot binding and mandatory non-truncation mutations | Yes |
| `context-compiler-security.test.mjs:61–108` | Egress fail-closed and injection isolation | Yes |
| `context-compiler-security.test.mjs:110–153` | Signing, estimator, and required-source failures | Yes |

All 53 cases map to a named requirement or T29 done-when criterion. Backend serialization assertions are intentionally deferred to T30.

## Check D — guideline conformance

- Followed `.specs/features/verchestra-1.0/tasks.md`: tests preceded implementation, both numerical floors are exceeded, and `gate:security` passes.
- Followed Design §4.7: the pipeline order and tie-break order are encoded directly and no model participates.
- Reused T28 Context Snapshots and T27 Data Egress Firewall; compiler signing and token estimation remain ports rather than concrete adapter imports.
- Mandatory evidence is eligibility-bound and never truncated; optional omissions are explicit and deterministic.
- The manifest binds Workspace, run, recipe, snapshot, source generations, policy/egress evidence, budgets, obligations, semantic meaning, compile instant, key, and signature.

## Adequacy verdict

PASS. T29 exceeds both test floors, identical canonical inputs yield one manifest identity, mandatory context never truncates, every omission explains itself, hostile bytes retain data-only status, egress precedes signing, and the full security gate is green.
