# T55 Immutable Run Capsule Validation

## Scope

- Task: T55 — Implement terminal Run Capsule sealing and recovery
- Requirements: VES-RLS-005, VES-HOF-001, VES-VFY-006, and VES-TST-003/006
- Commit target: `feat(evidence): add immutable run capsules`
- Focused evidence: 71 cases (17 integration, 16 fault injection, and 38 security)
- Required minimum: 30 integration/fault cases
- Spec deviations: none

T55 adds risk-proportional, content-addressed, Ed25519-signed Run Capsules for `COMPLETED`, `FAILED`, `ABORTED`, `INTERRUPTED`, `HANDED_OFF`, and `RECOVERED`. A capsule closes reproducible request/workspace/source/release/policy/Skill/package inputs, decisions, evidence references, effects, outputs, terminal transition, and status without provider sessions, credentials, prompts, rows, or machine paths. A new checksummed runtime migration records exactly one terminal seal per run. Startup recovery deterministically rebuilds, publishes, and journals any unsealed terminal intent, converging after filesystem or SQLite acknowledgement loss.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/integration/run-capsule.test.mjs tests/fault-injection/run-capsule-faults.test.mjs tests/security/run-capsule-security.test.mjs` | PASS — 71 passed, 0 failed/skipped |
| `node --test tests/architecture/*.test.mjs` | PASS — 10 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck/build, 1,602 unit/property, 10 architecture, 248 qualification, 674 security, and 120 fault cases |

## Adequacy matrix

| Done-when criterion / spec AC | Exact assertion evidence | Spec-defined outcome | Result |
| --- | --- | --- | --- |
| Every terminal state seals and verifies | `tests/integration/run-capsule.test.mjs:19-31` | Completed, failed, aborted, interrupted, handed-off, and recovered fixtures produce authenticated terminal Capsules | PASS |
| Evidence closure is proportional to risk | `tests/integration/run-capsule.test.mjs:33-40`; `tests/security/run-capsule-security.test.mjs:5-27` | Low, medium, high, and critical tiers have an increasing closed evidence requirement; every critical section is mandatory | PASS |
| Clean-process reconstruction is deterministic | `tests/integration/run-capsule.test.mjs:42-61` | Stable terminal time, canonical source/policy sets, and the same signing key produce byte-identical Capsules independent of wall clock and insertion order | PASS |
| Terminal status has status-specific evidence | `tests/security/run-capsule-security.test.mjs:29-44` | Completed requires verification/Human Review; failure terminals require reason evidence; Handoff requires publication/claim evidence; recovered requires recovery evidence | PASS |
| Completion cannot bypass Human Review | `tests/security/run-capsule-security.test.mjs:119-132` | Only `COMPLETED` may carry final review and its terminal transition must originate at `HUMAN_REVIEW` | PASS |
| Handoff closes publication and claim disposition without receiver Approval | `tests/integration/run-capsule.test.mjs:19-31`; `tests/security/run-capsule-security.test.mjs:105-117` | Signed package, publication receipts, claim disposition, and terminal evidence are present; receiver Approval inheritance is structurally false | PASS |
| Capsule excludes private runtime and sensitive content | `tests/security/run-capsule-security.test.mjs:46-73` | Provider/backend/model/session/thread/transcript/credential/secret/token/local-path fields and absolute paths fail recursively | PASS |
| Authentication precedes semantics | `tests/security/run-capsule-security.test.mjs:75-103` | Signature and payload tamper fail before status or receiver expectation comparison; valid Capsules cannot replay across runs | PASS |
| Storage is immutable, canonical, atomic, and idempotent | `tests/integration/run-capsule.test.mjs:63-84`; `tests/fault-injection/run-capsule-faults.test.mjs:13-32,159-168` | Canonical bytes publish once under concurrency; reload is deeply frozen; acknowledgement loss converges; competing bytes survive | PASS |
| Terminal intent and seal receipt are authoritative runtime state | `tests/integration/run-capsule.test.mjs:86-112,141-165` | `runtime.sqlite` lists unsealed terminal runs, records one exact state-bound seal, includes it in state digest, and rejects conflicting replacement | PASS |
| Startup recovers every unsealed terminal | `tests/integration/run-capsule.test.mjs:114-139`; `tests/fault-injection/run-capsule-faults.test.mjs:34-71` | Recovery publishes then journals in deterministic order; a crash after publication resumes with the same Capsule for all six statuses | PASS |
| Durable-boundary uncertainty converges | `tests/fault-injection/run-capsule-faults.test.mjs:73-109` | SQLite acknowledgement loss leaves the committed seal discoverable and restart performs no duplicate publication or record | PASS |
| Drift fails before authority mutation | `tests/fault-injection/run-capsule-faults.test.mjs:111-157` | Stale terminal version or resolver/intent mismatch produces no seal record and no unauthorized publication | PASS |

## Necessary-test reverse map

| Test group | Maps to | Keep |
| --- | --- | --- |
| Six terminal integration fixtures | Universal terminal coverage and status-specific signed identity | Yes |
| Risk and canonicalization integration cases | Proportional closure, deterministic cross-process recovery, stable content address | Yes |
| Runtime/store integration cases | Terminal intent, one-seal journal, state digest, atomic publication, startup recovery | Yes |
| Filesystem and coordinator fault matrix | Publication acknowledgement loss, post-publication crash, exact retry for all statuses | Yes |
| Runtime fault cases | Journal acknowledgement loss, version drift, resolver drift, competing target survival | Yes |
| Security closure matrix | Required evidence, no Human Review bypass, no inherited Approval, sensitive/private data denial | Yes |
| Security tamper/replay cases | Signature-first use, payload integrity, receiver/run binding | Yes |

## Non-shallow checks

- The terminal timestamp is part of the canonical payload and is also the signed envelope issue time. Recovery therefore reproduces the same Capsule after process restart instead of generating a new identity from the current wall clock.
- The runtime terminal transition and the Capsule file are separate durable systems. T55 does not claim cross-resource atomicity: terminal intent commits first, publication is content-addressed and no-clobber, and the SQLite seal receipt commits last. Startup reconciliation closes either gap safely.
- `run_capsule_seals.run_id` is the primary key and the Capsule identity is unique. Re-recording identical content is idempotent; any status, version, digest, timestamp, or identity conflict fails without replacement.
- The Capsule schema carries references and digests, not unrestricted evidence bodies. Recursive field inspection blocks private runtime vocabulary and machine paths before canonicalization or signing.
- Risk requirements increase monotonically. High/critical runs cannot omit authority, claims, effects, gates, or outputs; when an activity did not occur, the required reference must point to signed absence evidence instead of disappearing silently.
- `COMPLETED` requires both independent verification and a Human Review reference and must close from `HUMAN_REVIEW`. No other terminal status may forge these fields.
- `HANDED_OFF` requires the Execution Package, publication receipts, claim-disposition evidence, operation evidence, and an explicit `receiverApprovalInherited: false`; the receiving environment must authorize itself later.
- The file store uses private staging plus a same-filesystem hard link, which has no replacement semantics. Concurrent identical writers converge; different existing bytes are never overwritten.

## Verdict

PASS for T55. Every run terminal can now be closed by one immutable, reproducible, secret-free signed Capsule, including Handoff and recovery. Missing evidence, Human Review bypass, private runtime leakage, tamper, replay, stale state, and conflicting storage fail closed, while crashes and lost acknowledgements converge to one durable logical seal.
