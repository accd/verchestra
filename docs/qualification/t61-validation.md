# T61 Portable Handoff and Successor Validation

## Scope

- Task: T61 — Implement portable Handoff and successor runs
- Requirements: VES-HOF-001…006, VES-EXE-001…003, and VES-BST-002…004
- Commit target: `feat(handoff): add portable successor workflow`
- Focused evidence: 56 integration, end-to-end, fault-injection, and security cases
- Required minimum: 40 cases
- Spec deviations: none

T61 adds one closed application coordinator with explicit `prepare`, `publish`, `inspect`, `verify`, `accept`, `continue`, and `reconcile` operations. A source run verifies the signed Execution Package and current source state, creates a content-addressed portable Handoff artifact, binds a distinct successor identity, discards source Execution Approval, publishes through local CAS or a publication-only remote authority, disposes the source claim by policy, enters `HANDED_OFF`, and seals an exact terminal Run Capsule.

The receiver independently reopens and hashes the portable artifact, re-verifies package and capsule closure, compares source state and semantic obligations, resolves local Passports, rebinds logical secrets and integrations, reevaluates policy, acquires a new claim, and derives the first pending task. It creates a new linked `EXECUTION_READY` run with no Approval. `continue` requires a new receiver-local Execution Approval bound to the combined current local binding before reaching `EXECUTION_AUTHORIZED`.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/integration/portable-handoff.test.mjs tests/e2e/handoff-journey.test.mjs tests/fault-injection/handoff-faults.test.mjs tests/security/handoff-security.test.mjs` | PASS — 56 passed, 0 failed/skipped |
| `node --test tests/unit/workflow-machine.test.mjs ...T61 focused suites...` | PASS — canonical workflow matrix plus 53 then-current T61 cases |
| `pnpm gate:security` | PASS — format, lint, typecheck/build, unit/property, architecture, qualification, security, and 156 fault cases |

## Spec-anchored adequacy matrix

| Requirement / done-when criterion | Exact assertion evidence | Spec-defined outcome | Result |
| --- | --- | --- | --- |
| VES-HOF-001 source Handoff closure | `tests/integration/portable-handoff.test.mjs:16-80` | Verify/package, prepare, publish, claim release/transfer, terminal `HANDED_OFF`, and Capsule form one exact linked result; receiver Approval is never inherited | PASS |
| VES-HOF-002 publication-only authority | `tests/integration/portable-handoff.test.mjs:40`; `tests/security/handoff-security.test.mjs:75` | Remote effect follows an exact `handoff-publication` Approval; local CAS needs no remote effect; Execution Approval cannot substitute | PASS |
| VES-HOF-003 receiver reconstruction | `tests/integration/portable-handoff.test.mjs:83-105`; `tests/fault-injection/handoff-faults.test.mjs:163` | Package/capsule/source are verified before local Passports, secrets, integrations, policy, new claim, successor, and first pending task | PASS |
| VES-HOF-004 backend-independent continuation | `tests/e2e/handoff-journey.test.mjs:24-44`; `tests/e2e/handoff-journey.test.mjs:89` | Claude-profile source continues under OpenCode/Qwen local bindings with identical obligations and no transcript; source Approval is invalidated | PASS |
| VES-HOF-005 deterministic retries | `tests/e2e/handoff-journey.test.mjs:55-87`; `tests/fault-injection/handoff-faults.test.mjs:98-161` | Prepare/publish/accept/continue and lost acknowledgements converge to one artifact, effect, claim disposition, terminal transition, capsule, final record, and successor | PASS |
| VES-HOF-006 reconcile-first unknown effects | `tests/fault-injection/handoff-faults.test.mjs:13-47` | Unknown high-risk remote outcome cannot retry blindly; applied/not-applied/unknown inspection maps to resume/retry/reconciliation-required | PASS |
| VES-EXE-001…003 receiver authority | `tests/integration/portable-handoff.test.mjs:96`; `tests/security/handoff-security.test.mjs:162` | Successor starts without Approval, owns a new claim, and needs an exact fresh local binding Approval before execution authorization | PASS |
| VES-BST-002…004 portable local resolution | `tests/e2e/handoff-journey.test.mjs:24-39`; `tests/fault-injection/handoff-faults.test.mjs:163` | Machine profile resolves only local Passport/secret/integration bindings; missing local bindings create no successor | PASS |
| No private/environment transfer | `tests/security/handoff-security.test.mjs:16`; `tests/e2e/handoff-journey.test.mjs:31` | Provider/backend/model/session/transcript/credential/secret/path material is structurally absent and rejected before effects | PASS |
| Artifact and closure integrity | `tests/security/handoff-security.test.mjs:35-73`; `tests/security/handoff-security.test.mjs:92-149` | Cross-Workspace, stale source, invalid package/capsule, semantic substitution, content tamper, forged digest, and Approval inheritance fail closed | PASS |

## Durable retry boundaries

Publication records three content-bound checkpoints:

1. `PRETERMINAL_READY` after one publication effect and one source-claim disposition.
2. `TERMINAL_COMMITTED` after the canonical workflow reaches `HANDED_OFF`.
3. `CAPSULE_SEALED` after one terminal capsule is sealed.

Each checkpoint binds Workspace, Handoff ref/digest, current source snapshot, publication receipt, claim disposition, and all later stage outputs. Retries reopen the exact checkpoint and skip already-durable effects. Final-record acknowledgement loss returns the already-stored terminal record. A remote `uncertain` result creates no checkpoint and can advance only after explicit reconciliation.

## Independent discrimination sensor

The TLC Verifier copied the T61 diff into a detached disposable Git worktree, linked only installed dependencies, injected one production behavior fault at a time, and removed the scratch tree afterward. The active worktree was never mutated.

| Mutation | Behavior fault | Result |
| --- | --- | --- |
| M1 | Disable private-material field rejection | KILLED |
| M2 | Bypass reconcile-first handling for an unknown remote outcome | KILLED |
| M3 | Disable durable checkpoint resume | KILLED |
| M4 | Accept stale receiver Execution Approval binding | KILLED |
| M5 | Invert terminal Capsule status validation | KILLED |

Sensor depth is P0/full manual behavior mutation: 5/5 killed, 0 survived.

## Non-shallow checks

- The portable artifact is a closed schema whose canonical bytes and store receipt are independently hashed on save and reopen.
- Handoff identity binds Workspace, source/successor runs, signed package, destination, source state, and semantic obligations.
- Package proof is independently verified on source preparation, publication, receiver verification, and acceptance.
- Remote publication has a deterministic semantic idempotency key and an action-specific Approval; it never grants code mutation.
- Claim release and transfer are explicit dispositions with exact evidence. The receiver always acquires its own claim.
- Source Workflow Machine state owns successor lineage and clears prior Approval on preparation.
- Receiver local model choice is represented only by machine-local Passport refs and a combined local binding digest; it never changes the portable semantic obligations.
- Acceptance requires package/capsule/source identity, local binding readiness, policy reevaluation with Approval invalidation, and a new claim before creating the successor.
- Continuation authenticates acceptance and exact current bindings, then uses canonical request/grant workflow transitions with a fresh receiver Approval.
- Standalone independent validation was used because agent delegation is prohibited in this environment.

## Verdict

PASS for T61. The Claude-to-OpenCode/Qwen journey preserves semantic obligations without provider state, transcript, credentials, or machine paths; creates one linked successor with local bindings and no inherited Approval; and converges through crashes, acknowledgement loss, and remote uncertainty without duplicate observable effects.
