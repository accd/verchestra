# T24 Cedar Authorization Validation

## Scope

- Task: T24 — Implement Cedar policy adapter and monotonic policy views
- Requirements: VES-SEC-001…002, VES-CTX-006, and VES-EXE-001…003 at the authorization boundary
- Commit target: `feat(policy): implement cedar authorization`
- Focused evidence: 66 cases — 46 security, 15 unit, and 5 integration
- Spec deviations: none

T24 creates the production Cedar boundary, the monotonic layered Policy View validator, stable deny evidence, last-known-good activation, and the Workspace-local SQLite persistence adapter. Built-in policy is the only layer that may grant authority; organization, Workspace, Project, user preference, and run override can only narrow it. Every parse, schema, validation, evaluation, diagnostic, and engine-version failure produces a stable deny result.

Execution Approval lifecycle and its human review surface remain owned by T25. This slice provides the immutable Policy View digest and authorization evidence required to bind and invalidate those approvals.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/integration/policy-activation-runtime.test.mjs tests/security/cedar-policy.test.mjs tests/unit/policy-activation.test.mjs` | PASS — 66 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck, build, 1,223 unit, 10 architecture, 248 qualification, 113 security, and 32 fault cases |
| `node --test spikes/opencode-driver/test/opencode-driver.test.mjs` | PASS — 17 passed after restoring the declared OpenCode postinstall artifact; no product or test change |
| `corepack pnpm@10.34.5 install --offline --frozen-lockfile` | PASS — all 17 workspace projects resolved from the frozen lock |

## Check A — sufficient, spec-anchored coverage

| Criterion / requirement | Exact assertion evidence | Spec-defined outcome | Covered |
| --- | --- | --- | --- |
| VES-SEC-001: exact precedence and deny-wins | `tests/security/cedar-policy.test.mjs:13`; frozen corpus cases `builtin-workspace-forbid` through `run-forbid` | Every restrictive layer can deny a built-in grant | Yes |
| VES-SEC-001: lower layers never expand authority | Frozen corpus cases `organization-cannot-permit` through `run-cannot-permit`; `tests/unit/policy-activation.test.mjs:57` | A lower-layer permit is invalid and cannot become active | Yes |
| VES-SEC-002: parser/schema/validation failures deny | Frozen corpus cases `policy-parse-failure` through `request-context-type` | Stable explainable deny; no exception or prior-view mutation | Yes |
| VES-SEC-002: version/engine/diagnostic failures deny | Frozen corpus cases `engine-version-mismatch` through `engine-warning-on-allow`; `tests/security/cedar-policy.test.mjs:106` | Mismatch, thrown error, failed answer, or diagnostics fail closed | Yes |
| VES-CTX-006: pre-serialization egress dimensions | Frozen corpus cases `egress-allow` through `egress-policy-deny` | Classification, purpose, destination, retention, and Workspace are all authorized | Yes |
| VES-EXE-001…003 policy binding | Frozen corpus cases `invoke-allow` through `invoke-wrong-action` | Approval, policy, capability, evidence, claim, and action drift deny invocation | Yes |
| Backend-neutral request translation | `tests/security/cedar-policy.test.mjs:87` | Only principal, action, resource, context, and entities reach Cedar | Yes |
| Cross-form oracle agreement | `tests/security/cedar-policy.test.mjs:31`, `:49` | Frozen oracle and official Node/ESM forms produce identical decision semantics | Yes |
| Content and order independence | `tests/security/cedar-policy.test.mjs:63`, `:77`; `tests/unit/policy-activation.test.mjs:105` | Untrusted text cannot compile; insertion order cannot change evidence or view identity | Yes |
| Last-known-good activation | `tests/unit/policy-activation.test.mjs:18`, `:45`; generated invalid-candidate cases | Only a fully valid newer view activates; every failure preserves the active view | Yes |
| Idempotent and concurrent activation | `tests/unit/policy-activation.test.mjs:26`, `:35`, `:94` | Same identity is a no-op; conflicts and downgrades preserve the winner | Yes |
| Durable Workspace-local activation | `tests/integration/policy-activation-runtime.test.mjs:23`, `:39`, `:56`, `:70`, `:101` | Restart, no-op, CAS, invalid candidate, and tamper behavior are durable and fail closed | Yes |
| Minimum test floor | Focused runner: 66 passed | At least 45 property/security cases plus cross-form oracle fixtures | Yes |

No T24-owned precision gap remains. T25 consumes the policy digest and decision evidence to implement approval creation, review, expiry, and invalidation without duplicating Cedar semantics.

## Check B — non-shallow litmus

- The 40-case frozen corpus drives the product adapter, including allow, deny, malformed input, stale bindings, lower-layer expansion attempts, and engine faults.
- Five independent lower layers are tested both as valid restrictions and invalid grants; an implementation that merely concatenates policies fails.
- The request-translation test captures the exact object entering Cedar and proves invocation spelling and untrusted extras cannot cross the boundary.
- Node and ESM Cedar forms must emit byte-equivalent evidence, while a separate frozen oracle checks decision semantics.
- SQLite tests close and reopen the database, compare runtime digests, exercise real generation CAS, and corrupt persisted bytes to prove integrity checks are not in-memory conventions.
- Invalid candidates assert the last-known-good digest and write count remain unchanged.

## Check C — necessary reverse mapping

| Test evidence | Requirement / criterion | Keep |
| --- | --- | --- |
| Frozen corpus cases 1–18 | VES-SEC-001 and VES-EXE-001…003 authorization/monotonicity | Yes |
| Frozen corpus cases 19–25 | VES-CTX-006 pre-serialization egress authorization | Yes |
| Frozen corpus cases 26–40 | VES-SEC-002 fail-closed parser/schema/engine behavior | Yes |
| `cedar-policy.test.mjs:31,49,63,77,87,106` | Oracle, runtime form, trust boundary, determinism, translation, cyclic failure | Yes |
| `policy-activation.test.mjs:18–113` | Last-known-good, generation monotonicity, restriction, conflict, digest | Yes |
| `policy-activation-runtime.test.mjs:23–101` | Durable restart, no mutation, idempotency, CAS, integrity | Yes |

All 66 focused cases map to a named requirement or the T24 done-when criterion. No speculative test remains.

## Check D — guideline conformance

- Followed `.specs/features/verchestra-1.0/tasks.md`: the property/security floor and cross-form oracle requirement are exceeded and `gate:security` passes.
- Followed Design §4: policy owns backend-neutral authorization semantics; platform-node owns SQLite and the runtime adapter without importing policy.
- Followed AD-013/026: dependencies point inward and the composition boundary remains explicit.
- Followed AD-027/029: authorization failures are stable, safe, digest-bound evidence rather than private engine exceptions.
- Followed AD-039: CLI work remains separate; policy decisions contain no launcher spelling or interface-specific field.

## Adequacy verdict

PASS. Every T24-owned criterion has discriminating evidence, the 66 focused cases exceed the mandated floor, all security-gate suites pass, the last-known-good survives real SQLite restart and adversarial mutation, and frozen offline installation succeeds.
