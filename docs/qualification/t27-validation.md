# T27 Trust and Data Egress Validation

## Scope

- Task: T27 — Implement trust envelopes, classification, and Data Egress Firewall
- Requirements: VES-CTX-003/006, VES-DSC-004…005, VES-SEC-006, and VES-RLS-003…004
- Commit target: `feat(security): add trust envelopes and egress firewall`
- Focused evidence: 63 cases — 36 unit/property and 27 security
- Explicit mutation evidence: five declassification-field mutations plus forged digest/signature and three egress-binding mutations
- Spec deviations: none

T27 creates structurally marked source/generated-content envelopes, non-escalating trust, most-restrictive sensitivity inheritance, exact declassification evidence, destination profiles, and a pre-serialization Data Egress Firewall. The firewall binds Workspace, run, network mode, destination/endpoint, purpose, retention, fragment identity/classification/trust/digest, Approval, Capability, and Cedar evidence without passing content into authorization.

Context selection/ordering and backend serialization remain T28–T30. T27 exposes the only egress authorization contract those components may consume.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/unit/trust-envelope.test.mjs tests/security/data-egress-firewall.test.mjs` | PASS — 63 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck, build, 1,293 unit, 10 architecture, 248 qualification, 180 security, and 39 fault cases |

## Check A — sufficient, spec-anchored coverage

| Criterion / requirement | Exact assertion evidence | Spec-defined outcome | Covered |
| --- | --- | --- | --- |
| Sensitivity inheritance property | `tests/unit/trust-envelope.test.mjs:10` generated 25-pair matrix | Generated content inherits the most restrictive of every two-classification combination | Yes |
| VES-CTX-003/SEC-006: content cannot promote trust | `tests/unit/trust-envelope.test.mjs:33` generated four-class corpus | Instruction-like content remains bytes under controller-owned `untrusted-data`/`generated-content` metadata | Yes |
| VES-DSC-004 provenance | `tests/unit/trust-envelope.test.mjs:43` | Source identity/revision/time/classification/digest are snapshotted and immutable | Yes |
| Exact declassification evidence | `tests/unit/trust-envelope.test.mjs:66`, `:74` | Only signed exact Workspace/source/from/to evidence can reduce classification | Yes |
| Destination classification ceiling | `tests/security/data-egress-firewall.test.mjs:25` | Public/internal/confidential pass configured ceiling; restricted/secret fail | Yes |
| Offline/no-egress behavior | `tests/security/data-egress-firewall.test.mjs:40` | External endpoints require online mode; local destination remains available offline | Yes |
| Purpose/retention/destination/Workspace | `tests/security/data-egress-firewall.test.mjs:58` | Every incompatible binding denies before policy/serialization | Yes |
| Approval plus Capability | `tests/security/data-egress-firewall.test.mjs:71` | Every external call requires both state-bound authorities | Yes |
| Cedar deny/failure | `tests/security/data-egress-firewall.test.mjs:84`, `:91` | Deny and engine failure produce stable no-egress verdicts without private detail | Yes |
| Hostile destination fallback | `tests/security/data-egress-firewall.test.mjs:104` | Content cannot select endpoint/classification or enter policy request | Yes |
| Pre-serialization manifest | `tests/security/data-egress-firewall.test.mjs:113` | Authorized result is digest-bound and contains fragment IDs but no content | Yes |
| Forgery/empty-input rejection | `tests/security/data-egress-firewall.test.mjs:121`, `:128`, `:136` | Empty sets, changed digest, and invalid declassification signature fail before Cedar | Yes |
| Declassification at actual egress | `tests/security/data-egress-firewall.test.mjs:156` | Purpose, destination, and expiry are reverified against signed evidence | Yes |
| Minimum floors | Focused runner: 63; explicit mutations exceed five | At least 50 unit/property/security and at least 5 mutations | Yes |

No T27-owned precision gap remains. T28 registers Context Sources/Recipes, T29 invokes this firewall for every fragment before inclusion, T30 serializes only an authorized manifest, and T56 adds Support Bundle-specific prohibited-content controls.

## Check B — non-shallow litmus

- All 25 pairs of the five-class lattice are tested, preventing an implementation that handles only adjacent classifications.
- Generated content explicitly contains fake `classification=public` and `trust=authority` instructions; metadata remains controller-derived.
- The policy request is captured and inspected to prove hostile content is absent while the exact configured destination remains.
- Declassification is verified twice: at transformation and again at egress using the complete signed evidence, not a bare evidence ID.
- Fragment content digests are recomputed before authority checks; empty and forged inputs never reach Cedar.
- External authorization requires both Approval and Capability. A three-case matrix proves neither alone is sufficient.
- Network mode, destination ceiling, purpose, retention, Workspace, declassification, and Cedar are independent deny gates.

## Check C — necessary reverse mapping

| Test evidence | Requirement / criterion | Keep |
| --- | --- | --- |
| `trust-envelope.test.mjs:10–31` | Classification inheritance | Yes |
| `trust-envelope.test.mjs:33–51` | Trust non-escalation and provenance | Yes |
| `trust-envelope.test.mjs:66–95` | Declassification success and mutation corpus | Yes |
| `data-egress-firewall.test.mjs:25–82` | Classification, mode, destination, purpose, retention, authority | Yes |
| `data-egress-firewall.test.mjs:84–119` | Cedar failure, hostile content, pre-serialization proof | Yes |
| `data-egress-firewall.test.mjs:121–187` | Empty/forged/declassification-boundary negatives | Yes |

All 63 focused cases map to a named requirement or T27 done-when criterion. No speculative test remains.

## Check D — guideline conformance

- Followed `.specs/features/verchestra-1.0/tasks.md`: property/security and mutation floors are exceeded and `gate:security` passes.
- Reused the domain `DataClassification` lattice; no duplicate classification vocabulary was introduced.
- Followed Design §8.4: content remains data; authorization consumes metadata/digests and precedes serialization.
- Followed AD-040/041: Cedar, Approval, and Capability remain separate mandatory gates.
- Followed AD-042: Workspace/run authority is exact and cannot be changed by retrieved/generated content.

## Adequacy verdict

PASS. T27 exceeds both test floors, all security-gate suites are green, trust and sensitivity cannot self-promote, signed declassification is exact and time-bound, and incompatible external egress fails before content serialization.
