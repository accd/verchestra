# T64 Managed Confluence Delivery Connector Validation

## Scope

- Task: T64 — Implement managed Confluence delivery Connector
- Requirements: VES-INT-002/004/005 and VES-HOF-002/005/006
- Commit target: `feat(connectors): add managed confluence projection`
- Focused evidence: 32 contract, integration, fault-injection, and security cases
- Required minimum: 28 cases
- Spec deviations: none

T64 adds `delivery-confluence` as a high-risk application Effect adapter. It renders a single correlation-bound section containing package and Handoff references and digests, publishes only after action-exact Handoff Publication Approval and egress authorization, and treats Git/control artifacts as immutable upstream authority.

The remote compare-and-swap contract binds both the last reconciled page version and the last reconciled owned-section digest. This is necessary to distinguish a legitimate canonical update from a human edit that remains structurally valid and recalculates its marker digest. Unmanaged prefix, suffix, and title bytes remain outside adapter ownership.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/contract/confluence-delivery-contract.test.mjs tests/integration/confluence-delivery.test.mjs tests/fault-injection/confluence-delivery-faults.test.mjs tests/security/confluence-delivery-security.test.mjs` | PASS — 32 passed, 0 failed/skipped |
| `pnpm typecheck` | PASS |
| `pnpm gate:security` | PASS — format, lint, typecheck/build, unit/property, contract, integration, E2E, architecture, qualification, security, and fault stages |

## Spec-anchored adequacy matrix

| Requirement / done-when criterion | Exact assertion evidence | Spec-defined outcome | Result |
| --- | --- | --- | --- |
| VES-INT-002 owned stable projection | `tests/contract/confluence-delivery-contract.test.mjs:12`; `tests/integration/confluence-delivery.test.mjs:9-52` | One marked, digest-bound section is created or updated; title and unmanaged bytes remain unchanged | PASS |
| VES-INT-004 human-edit drift | `tests/integration/confluence-delivery.test.mjs:55-103` | Invalid-digest and self-consistent human edits inside the owned section fail closed and remain untouched | PASS |
| VES-INT-005 acknowledgement-loss recovery | `tests/fault-injection/confluence-delivery-faults.test.mjs:12-47` | Create and update acknowledgement loss reconcile by correlation and exact desired digest without a duplicate write | PASS |
| VES-HOF-002 publication-only Approval | `tests/contract/confluence-delivery-contract.test.mjs:29`; `tests/security/confluence-delivery-security.test.mjs:10-35` | Only action-exact Handoff Publication authority reaches egress or mutation; execution-shaped authority is denied | PASS |
| VES-HOF-005 idempotent observable effect | `tests/integration/confluence-delivery.test.mjs:15`; `tests/fault-injection/confluence-delivery-faults.test.mjs:12-47` | Repeat, retry, and reconciliation converge to one receipt, page, and managed section | PASS |
| VES-HOF-006 unknown outcome reconciliation | `tests/fault-injection/confluence-delivery-faults.test.mjs:12-47` | Unknown create/update outcomes require inspection and are never retried blindly | PASS |
| Stable version and digest CAS | `tests/fault-injection/confluence-delivery-faults.test.mjs:49-70`; `tests/integration/confluence-delivery.test.mjs:40-103` | Stale version or prior-section mismatch performs no overwrite | PASS |
| Closed external boundary | `tests/contract/confluence-delivery-contract.test.mjs:52-70`; `tests/security/confluence-delivery-security.test.mjs:37-67` | Unknown inputs, credentials, foreign page identity, malformed remote records, and exhausted rate budgets fail closed | PASS |

## Independent discrimination sensor

The standalone TLC Verifier copied the complete uncommitted T64 diff into a detached disposable worktree, installed the locked graph offline, committed an isolated verifier baseline, injected one production behavior fault at a time, restored the baseline after every run, reran all 32 focused tests, and removed the scratch tree. The active implementation worktree was never mutated.

| Mutation | Behavior fault | Result |
| --- | --- | --- |
| M1 | Ignore a self-consistent human edit whose section digest differs from the last reconciled digest | KILLED |
| M2 | Bypass Handoff Publication authority denial | KILLED |
| M3 | Bypass egress denial | KILLED |
| M4 | Ignore a stale page version | KILLED |
| M5 | Refuse to recognize an exactly applied section during unknown-outcome reconciliation | KILLED |

Sensor depth is P0/full manual behavior mutation: 5/5 killed, 0 survived. Standalone independent validation was used because agent delegation is prohibited in this environment.

## Non-shallow checks

- The owned marker binds correlation identity and a controller-computed content digest.
- Input, nested package/Handoff records, remote pages, rate state, and write responses use closed runtime schemas.
- Canonical task ordering makes the desired section and idempotency key independent of caller order.
- Existing pages are appended only when the canonical state explicitly records no previously managed section.
- Existing managed sections update only when observed digest equals `lastReconciledSectionDigest` and page version equals `lastReconciledVersion`.
- A valid observed section equal to the desired digest is recognized as already applied, including after acknowledgement loss.
- Invalid, partial, duplicate, correlation-mismatched, digest-drifted, or unexpectedly absent managed sections never mutate remote state.
- Approval is action-exact, egress sees the exact owned section, and both checks occur before any mutation.
- Remote title, human prefix/suffix bytes, credentials, provider sessions, and machine paths never enter canonical authority.
- No connector response can overwrite Git/control-repository content.

## Verdict

PASS for T64. `delivery-confluence` produces one stable, Handoff-authorized, egress-authorized managed section and converges safely across repeat and acknowledgement-loss scenarios. Human edits and stale canonical state remain remote evidence requiring reconciliation; they are never silently promoted to or overwritten as canonical Git authority.
