# T65 Complete Cross-Backend Delivery Journey Validation

## Scope

- Task: T65 — Prove complete cross-backend execution and idempotency journey
- Requirements: VES-BST-001…005, VES-HOF-001…006, VES-VFY-001…006, and VES-INT-001…005
- Commit target: `test(e2e): prove cross backend delivery journey`
- Focused evidence: 14 packaged E2E, fault-injection, and security journey variants
- Required minimum: 12 variants
- Spec deviations: none

T65 adds no second orchestration runtime. Its packaged fixture composes the already-qualified application, evidence, Effect, Connector, execution, verification, and machine-bootstrap boundaries and carries their real content identities through one journey: Claude/Codex local bootstrap; Grill/TLC discovery evidence; signed backend-neutral Execution Package; remote Handoff; Jira and Confluence projections; OpenCode/Qwen-only receiver bootstrap; fresh local Approval; claim; isolated task; gate and atomic commit; independent verification; and authenticated Human Review.

The fixture uses the production builders and coordinators with bounded mock transports/ports. It deliberately keeps machine profiles outside the shared artifact set and computes the shared-state digest over the full signed package, portable Handoff, Jira record, Confluence page section, and gate result rather than over placeholder labels.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/e2e/cross-backend-delivery-journey.test.mjs tests/fault-injection/cross-backend-journey-faults.test.mjs tests/security/cross-backend-journey-security.test.mjs` | PASS — 14 passed, 0 failed/skipped |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm gate:security` | PASS — format, lint, typecheck/build, unit/property, contract, integration, E2E, architecture, qualification, security, and 176 fault cases |

## Spec-anchored adequacy matrix

| Requirements / done-when criterion | Exact assertion evidence | Spec-defined outcome | Result |
| --- | --- | --- | --- |
| Complete Claude → OpenCode/Qwen journey | `tests/e2e/cross-backend-delivery-journey.test.mjs:6-16` | Package, Handoff, receiver execution, commit, verification, Human Review, and completion form one successful chain | PASS |
| Grill/TLC package under Claude | `tests/e2e/cross-backend-delivery-journey.test.mjs:18-28` | Both skill evidence records are sealed while Claude is a qualified local source Driver | PASS |
| VES-HOF-003/004 semantic portability | `tests/e2e/cross-backend-delivery-journey.test.mjs:30-35` | Semantic obligations and first pending work remain identical after backend/model change | PASS |
| VES-INT-001/002 exact projections | `tests/e2e/cross-backend-delivery-journey.test.mjs:37-44` | Jira and Confluence reference the exact signed package and Handoff digests | PASS |
| VES-BST-004 / VES-HOF-005 idempotency | `tests/e2e/cross-backend-delivery-journey.test.mjs:46-65`; `tests/e2e/cross-backend-delivery-journey.test.mjs:75-83` | Repeated bootstrap, package/Handoff operations, projections, claim, Capsule, commit, report, and review remain singular | PASS |
| VES-HOF-001/002 fresh receiver authority | `tests/e2e/cross-backend-delivery-journey.test.mjs:67-73` | Source Approval is absent and a new receiver-local Execution Approval is required | PASS |
| VES-INT-005 unknown Connector outcomes | `tests/fault-injection/cross-backend-journey-faults.test.mjs:6-20` | Jira and Confluence create acknowledgement loss reconcile to one remote object with no blind duplicate | PASS |
| VES-VFY-001/002 task/gate/commit recovery | `tests/fault-injection/cross-backend-journey-faults.test.mjs:22-29` | A resumed task produces one Tool request and one gated atomic commit | PASS |
| VES-BST-001/002 local/shared separation | `tests/security/cross-backend-journey-security.test.mjs:6-12`; `tests/security/cross-backend-journey-security.test.mjs:22-32` | Backend/session/transcript/profile/credential material is absent from portable and shared artifacts; local profile changes do not change shared digest | PASS |
| VES-VFY-003/004/006 independent verification and Human Review | `tests/security/cross-backend-journey-security.test.mjs:14-20` | Verifier differs from author; PASS stops at Human Review; only a human review completes | PASS |

## Independent discrimination sensor

The standalone TLC Verifier copied the complete uncommitted T65 diff into a detached disposable worktree, installed the locked graph offline, committed an isolated verifier baseline, injected one journey-level behavior fault at a time, restored after every run, reran all 14 focused variants, and removed the scratch tree. The active implementation worktree was never mutated.

| Mutation | Behavior fault | Result |
| --- | --- | --- |
| M1 | Replace the OpenCode/Qwen receiver profile with Claude | KILLED |
| M2 | Remove TLC evidence from the signed package | KILLED |
| M3 | Change semantic obligations at Handoff package verification | KILLED |
| M4 | Ignore the requested Jira acknowledgement-loss injection | KILLED |
| M5 | Insert the receiver machine profile into shared artifacts | KILLED |

Sensor depth is P0/full manual behavior mutation: 5/5 killed, 0 survived. Standalone independent validation was used because agent delegation is prohibited in this environment.

## Non-shallow checks

- The journey builds and verifies a real Ed25519-sealed Execution Package; it does not substitute a fixture digest for package construction.
- Grill and TLC appear as content-addressed discovery evidence, while source and receiver model identities stay machine-local.
- Portable Handoff preparation consumes the exact package and source-state digests and independently validates semantic obligations.
- Jira and Confluence use their production plan builders, Effect intents, adapters, brokers, receipts, and reconciliation paths.
- OpenCode/Qwen bootstrap uses a qualified local Passport and may degrade role independence without altering portable artifacts.
- Acceptance discards source Approval, rebinds local Passports/secrets/integrations, reevaluates policy, and acquires a new claim before continuation.
- Task execution resumes from a durable checkpoint inside one authorized worktree and emits one mediated Tool request.
- Gate evidence covers the task requirements and leads to one atomic commit, cleanup, and writer release.
- Verification uses a distinct actor, independently derived evidence/mutations, and stops at Human Review before human completion.
- Repeated stable operations and acknowledgement-loss recovery preserve one observable effect at every externally visible surface.
- Shared-state identity covers full artifact content before and after local profile repetition; local profiles are separate objects and are never serialized into shared artifacts.

## Verdict

PASS for T65. The complete delivery chain preserves signed semantic obligations across Claude and OpenCode/Qwen environments, keeps backend and credential state local, publishes exact Jira/Confluence views without making them canonical, creates one gated commit, requires independent verification and Human Review, and converges to one observable logical effect under retries and Connector acknowledgement loss.
