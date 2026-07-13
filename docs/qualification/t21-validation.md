# T21 Machine Bootstrap Validation

## Scope

- Task: T21 — Implement Machine Profile and bootstrap
- Requirements: VES-BST-001…003/005, VES-MDL-002, and the registration boundary of VES-DBP-001
- Commit target: `feat(workspace): implement machine bootstrap`
- Focused evidence: 33 cases — 24 integration, 3 e2e, and 6 security
- Spec deviations: none

T21 resolves and stores locally qualified Passport candidates; T31–T32 still own complete Passport qualification and preference/risk routing, and T34–T37 own concrete Driver discovery implementations. The bootstrap service consumes those future implementations through stable ports and does not embed provider-specific project configuration.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/integration/machine-bootstrap.test.mjs tests/security/machine-bootstrap-security.test.mjs tests/e2e/machine-bootstrap-e2e.test.mjs` | PASS — 33 passed, 0 failed/skipped |
| `pnpm gate:security` | PASS — format, lint, typecheck/build, 1,208 unit, 10 architecture, 248 qualification, 67 security, and 32 fault cases |
| `pnpm gate:full` | PASS — format, lint, typecheck, 1,208 unit, 41 contract, 100 integration, 7 e2e, and 32 fault cases |
| `pnpm install --offline --frozen-lockfile` | PASS — all 17 workspace projects available from the frozen lock |

## Check A — sufficient, spec-anchored coverage

| Criterion / requirement | Exact assertion evidence | Spec-defined outcome | Covered |
| --- | --- | --- | --- |
| VES-BST-001: machine data and model availability stay outside Git | `tests/e2e/machine-bootstrap-e2e.test.mjs:58`, `:70` — `assert.deepEqual(await byteSnapshot(root), before)` | Claude/Codex and Qwen profiles mutate only external Workspace state | Yes |
| VES-BST-002: detect Drivers and locally qualified Passports | `tests/integration/machine-bootstrap.test.mjs:84-88` — exact sorted Driver IDs/profile; `:96-98`, `:106-110` — unqualified/expired exclusion | Only detected, qualified, unexpired local Passports become eligible | Yes |
| VES-BST-002: clean bootstrap on different machine capability sets | `tests/e2e/machine-bootstrap-e2e.test.mjs:57-59`, `:69-71` | Claude+Codex is ready; OpenCode/Qwen-only is explicitly degraded; both leave Git byte-identical | Yes |
| VES-BST-002/004 task criterion: repeated bootstrap converges | `tests/integration/machine-bootstrap.test.mjs:274-276`; `tests/e2e/machine-bootstrap-e2e.test.mjs:79-82` | One durable profile, same digest, second save reports no change | Yes |
| VES-BST-003: missing credential guidance is logical and safe | `tests/integration/machine-bootstrap.test.mjs:170-180` — exact logicalName/store/purpose/blocked capability/required record | Missing mandatory binding blocks without asking for or printing its value | Yes |
| Optional and present bindings behave exactly | `tests/integration/machine-bootstrap.test.mjs:188-189`, `:198-199`; `tests/security/machine-bootstrap-security.test.mjs:59-61` | Optional absence does not block; bound/missing presence is mediated by Secret Broker | Yes |
| VES-BST-005: incompatibility fails before mutation | `tests/integration/machine-bootstrap.test.mjs:32-37`, `:42-45` | Unsupported config/minimum CLI causes zero discovery and zero profile writes | Yes |
| VES-MDL-002: different providers satisfy preferred separation | `tests/integration/machine-bootstrap.test.mjs:131-132` | Claude plus Codex yields `ready` validation independence | Yes |
| VES-MDL-002: one-provider machines report degradation or block mandatory separation | `tests/integration/machine-bootstrap.test.mjs:138-141`, `:150-151`, `:157-161` | Claude-only/Qwen-only explicitly degrade preferred separation; required separation blocks | Yes |
| Missing role capability blocks without silent weakening | `tests/integration/machine-bootstrap.test.mjs:117-125` | Exact role is blocked and reports `capability:review` | Yes |
| VES-DBP-001: database registration contains logical metadata and credential names only | `tests/integration/machine-bootstrap.test.mjs:217-224` | Read-only Data Probe binding is derived from engine/environment/schema/classification/source/purpose/logical name metadata | Yes |
| VES-DBP-001: embedded connection material and incomplete schema scope fail | `tests/integration/machine-bootstrap.test.mjs:239-241`, `:256-258` | Connection-string field and empty approved-schema/source declarations are rejected | Yes |
| Machine Profile identity and deterministic order | `tests/integration/machine-bootstrap.test.mjs:266-267`, `:308-309` | Candidate input order cannot affect profile/digest; profile binds Workspace and machine | Yes |
| Secret/session/provider-local selection exclusion | `tests/security/machine-bootstrap-security.test.mjs:103-105` | Persisted profile contains no credential value, session token, credential value field, or selected model | Yes |
| Boundary input and cross-Workspace safety | `tests/security/machine-bootstrap-security.test.mjs:28-29`, `:37-38`, `:44`, `:77-78` | Control data, duplicate Passports, hidden session fields, and foreign Workspace profiles fail before persistence | Yes |
| Stable sanitized observable failures | `tests/integration/machine-bootstrap.test.mjs:284-286`, `:292-301` | Private discovery text is absent; exact four-code catalog validates against `public-error@1` | Yes |
| Minimum test floor | Focused runner: 33 passed | At least 25 integration/e2e cases, with the required security layer also present | Yes |

No T21-owned spec-precision gap remains. Full role ranking, candidate-by-candidate exclusion explanations, behavioral drift quarantine, and concrete Driver probing remain explicitly assigned to T31–T37 rather than being prematurely duplicated here.

## Check B — non-shallow litmus

- Readiness assertions target exact `ready`, `degraded`, or `blocked` states and exact failed requirements, not port call counts.
- Git separation is proven through recursive byte snapshots including `.git`, while local persistence is independently asserted through `runtime.sqlite` profile reads.
- Secret tests place an actual sentinel value in `MockSecretAdapter` and assert that it never appears in the persisted profile or inspector serialization.
- Compatibility tests assert zero discovery and zero writes, so an implementation that checks versions after mutation fails.
- Determinism tests compare the complete profile and digest under reordered candidates and verify the second persistent upsert reports `changed: false`.

## Check C — necessary reverse mapping

| Test evidence | Requirement / criterion | Keep |
| --- | --- | --- |
| `machine-bootstrap.test.mjs:23,40,73` | VES-BST-005 and canonical input fail-before-mutation | Yes |
| `machine-bootstrap.test.mjs:81,91,101,113` | VES-BST-002 local discovery/qualification/capability readiness | Yes |
| `machine-bootstrap.test.mjs:128,135,144,154` | VES-MDL-002 multi/single-provider independence outcomes | Yes |
| `machine-bootstrap.test.mjs:164,182,192` | VES-BST-003 required/optional/bound secret reporting | Yes |
| `machine-bootstrap.test.mjs:202,226,244` | VES-DBP-001 canonical database registration and prohibited material | Yes |
| `machine-bootstrap.test.mjs:261,270` | T21 deterministic/idempotent profile persistence | Yes |
| `machine-bootstrap.test.mjs:279,291,305` | Stable errors and exact local identity binding | Yes |
| `machine-bootstrap-security.test.mjs:24,32,41` | Input injection and hidden credential/session denial | Yes |
| `machine-bootstrap-security.test.mjs:47,64,82` | Secret Broker mediation, Workspace isolation, and prohibited profile content | Yes |
| `machine-bootstrap-e2e.test.mjs:51,63,75` | Cross-machine clean-Git bootstrap and repeat convergence | Yes |

All 33 cases map to a T21 done-when criterion or named requirement. No speculative test remains.

## Check D — guideline conformance

- Followed `.specs/features/verchestra-1.0/tasks.md`: integration, e2e, and security layers are present and the mandated security gate passes.
- Followed AD-007: canonical roles express capabilities; machine-local state records eligible Passport candidates without committing model selections.
- Followed AD-008/DBP-001: only logical credential names and read-only Probe purpose enter configuration/profile flow; no connection string or value is admitted.
- Followed AD-013/026: orchestration lives in `application`; SQLite and Secret Broker adapters live in `platform-node`; inward dependency and sibling-adapter rules remain green.

## Adequacy verdict

PASS. Every T21-owned criterion has exact assertion evidence, all outcomes match the specification, all 33 focused cases are necessary and discriminating, and the security gate is green.
