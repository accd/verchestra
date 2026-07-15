# T62 Jira Workflow and Claim Connector Validation

## Scope

- Task: T62 — Implement Jira workflow and claim Connector
- Requirements: VES-INT-001, VES-INT-004…005, VES-EXE-004, and VES-HOF-005…006
- Commit target: `feat(connectors): add jira workflow projection`
- Focused evidence: 32 contract, integration, and fault-injection cases
- Required minimum: 30 cases
- Spec deviations: none

T62 adds a closed Jira boundary over the shared Effects kernel. Git and the signed execution artifacts remain canonical. Jira receives only a deterministic managed projection containing stable correlation and package markers, owner, workflow state, current and pending tasks, Approval status, Work Claim, canonical revision digest, and the last reconciled remote version. Human edits to managed fields become explicit drift and are preserved; they never overwrite canonical Git.

The projection adapter uses the existing Effect Broker for deterministic intent identity, durable receipts, acknowledgement-loss classification, and reconcile-before-retry. The read connector exposes only normalized managed records with explicit Jira provenance through bounded pagination. The claim connector uses optimistic compare-and-swap, expiry, exact owner/claim identity, and monotonically increasing fencing tokens for acquire, heartbeat, release, conflict, and takeover behavior.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/contract/jira-connector-contract.test.mjs tests/integration/jira-projection.test.mjs tests/fault-injection/jira-connector-faults.test.mjs` | PASS — 32 passed, 0 failed/skipped |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm gate:full` | PASS — all repository format, lint, typecheck, unit/property, contract, integration, E2E, architecture, qualification, security, fault, and release-scoped stages selected by the full gate |

## Spec-anchored adequacy matrix

| Requirement / done-when criterion | Exact assertion evidence | Spec-defined outcome | Result |
| --- | --- | --- | --- |
| VES-INT-001 managed Jira projection | `tests/contract/jira-connector-contract.test.mjs:11`; `tests/integration/jira-projection.test.mjs:15` | Stable correlation/package identity plus the complete managed delivery surface; no arbitrary Jira payload crosses the contract | PASS |
| VES-INT-004 explicit drift | `tests/integration/jira-projection.test.mjs:46` | A structurally valid human edit is reported as drift, remains remote, and never changes canonical Git | PASS |
| VES-INT-005 idempotency and lost acknowledgements | `tests/integration/jira-projection.test.mjs:22`; `tests/fault-injection/jira-connector-faults.test.mjs:15-49` | Repeated create/update and lost acknowledgements converge by stable marker and projection digest without duplicate remote writes | PASS |
| Optimistic create/update versioning | `tests/integration/jira-projection.test.mjs:29`; `tests/fault-injection/jira-connector-faults.test.mjs:51-71` | Updates require the exact reconciled Jira version; missing/stale targets fail before unsafe creation or overwrite | PASS |
| Bounded read provenance | `tests/integration/jira-projection.test.mjs:63`; `tests/fault-injection/jira-connector-faults.test.mjs:82-142` | Every page is bounded, rate checked, project isolated, normalized, and marked as an untrusted Jira-managed projection | PASS |
| Rate-limit fail-closed behavior | `tests/fault-injection/jira-connector-faults.test.mjs:73-80` | An exhausted remote budget fails before a write and carries no implicit blind retry | PASS |
| VES-EXE-004 remote Work Claim | `tests/integration/jira-projection.test.mjs:79-168`; `tests/fault-injection/jira-connector-faults.test.mjs:145` | Acquire, same-owner reuse, active conflict, expired takeover, heartbeat, release, and CAS races preserve one winner with exact fencing | PASS |
| VES-HOF-005…006 retry and reconciliation | `tests/fault-injection/jira-connector-faults.test.mjs:15-49` | Unknown post-write outcomes are inspected by marker/digest before retry; applied state becomes one durable receipt | PASS |

## Authority and retry boundaries

1. `buildJiraProjectionPlan` closes and canonicalizes all shared input before computing its projection digest and Effect idempotency key.
2. `JiraProjectionEffectAdapter.apply` performs a bounded read, validates the remote record, classifies exact replay versus drift, enforces the canonical last-reconciled version, and invokes one create or CAS update.
3. `JiraProjectionEffectAdapter.inspect` classifies absent, exact, prior, or drifted remote state for the shared Effect Broker; an unknown outcome is never blindly retried.
4. Jira reads return normalized managed fields and provenance only. Raw transport payloads, credentials, provider sessions, and machine paths are not part of the public result.
5. Claim mutation requires exact Workspace, correlation, claim identity, owner, current CAS version, and fencing token. Expired takeover increments fencing instead of reusing authority.

## Independent discrimination sensor

The TLC Verifier copied the staged T62 implementation into a detached disposable Git worktree, installed only the locked offline dependency graph, committed an isolated verifier baseline, injected one production behavior fault at a time, restored the baseline after each run, reran all 32 focused cases, and removed the scratch tree. The active implementation worktree was never mutated.

The first drift mutation exposed a shallow test input: the simulated human edit used an invalid workflow state and therefore failed structural validation before reaching the drift guard. The test was strengthened to use the valid `BLOCKED` state, the verifier baseline was rebuilt, and the drift mutation was then killed specifically by the non-overwrite assertion.

| Mutation | Behavior fault | Result |
| --- | --- | --- |
| M1 | Bypass managed-field drift detection for a structurally valid human edit | KILLED |
| M2 | Classify an exactly applied post-write marker as not applied during reconciliation | KILLED |
| M3 | Bypass canonical last-reconciled Jira version enforcement | KILLED |
| M4 | Bypass exhausted rate-budget rejection | KILLED |
| M5 | Ignore the Work Claim fencing token during heartbeat/release | KILLED |

Sensor depth is P0/full manual behavior mutation: 5/5 killed, 0 survived after the sensor correction. Standalone independent validation was used because agent delegation is prohibited in this environment.

## Non-shallow checks

- Collection order cannot change projection identity; duplicate task identifiers fail closed.
- Marker identity binds product, correlation, package digest, and the complete managed projection digest.
- Exact replay returns the prior durable receipt and performs no second remote write.
- Remote responses are revalidated after create/update and must prove the exact requested projection.
- A valid but externally edited managed state is drift, not a new source of truth.
- Missing issue plus nonzero canonical remote version is a conflict, not an implicit recreation.
- Pagination detects repeated cursors and refuses results beyond the explicit maximum page count.
- Malformed issues and cross-project results cannot become trusted projection records.
- CAS claim conflict returns the observed winner without overwriting it.
- Same-owner reacquisition reuses the active lease; expired takeover increments fencing; wrong fencing cannot heartbeat or release.
- The connector reuses the shared Effect Broker rather than introducing a second effect, receipt, or retry subsystem.

## Verdict

PASS for T62. Jira is a deterministic, bounded, reconcilable projection and claim coordination surface—not canonical state. Create, update, replay, acknowledgement loss, version conflict, rate exhaustion, pagination faults, human drift, and claim races converge without duplicate writes or silent canonical overwrite.
