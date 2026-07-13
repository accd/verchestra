# T39 Bounded Discovery Routing Validation

## Scope

- Task: T39 — Implement discovery intake and optional Reversa/CodeNavi strategies
- Requirements: VES-DSC-001…005, VES-SKL-004, VES-SPC-001
- Commit target: `feat(discovery): add bounded reconnaissance routing`
- Focused evidence: 56 cases (26 unit, 17 contract, 13 security)
- Spec deviations: none

T39 introduces a complete, provenance-bound discovery intake; deterministic routing between intake, built-in reconnaissance, Reversa, and CodeNavi; normalized bounded Discovery Packets with stable logical anchors; and an explicit human promotion review. Optional strategies receive read/search authority only, own no lifecycle phase, and cannot persist their own state.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/unit/discovery-router.test.mjs tests/contract/discovery-packet.test.mjs tests/security/discovery-strategy-security.test.mjs` | PASS — 56 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck/build, 1,465 unit, 10 architecture, 248 qualification, 255 security, and 49 fault cases |

## Adequacy matrix

| Criterion | Evidence | Covered |
| --- | --- | --- |
| Complete intake | Ten mandatory intake sections, explicit absence, canonical provenance, and input digest | Yes |
| Documented repository routing | Reliable current documentation selects built-in intake without an optional strategy | Yes |
| Legacy/stale routing | Unreliable, legacy, and stale evidence selects qualified Reversa or bounded built-in reconnaissance | Yes |
| CodeNavi qualification | Current qualification, positive measured benefit, eligible project class, and policy permission are all required | Yes |
| Stable anchors | Logical project/path/symbol/line anchors are canonical, bounded, and machine-independent | Yes |
| Evidence provenance | Source identity, revision, retrieval instant, classification, and content digest remain explicit | Yes |
| Findings | Available, missing, stale, contradictory, and outside-scope states remain explicit and never become assumptions | Yes |
| Read-only authority | Every strategy receives only exact read/search operations and zero lifecycle ownership | Yes |
| Persistence prohibition | `.notebook`, absolute paths, traversal, and every strategy-owned persistent path are rejected | Yes |
| Promotion review | Every packet is pending human review and cannot self-promote into Specify or later phases | Yes |
| Resource bounds | Evidence count, content size, path, anchor, and packet bounds fail closed | Yes |
| Minimum floor | 56 focused cases versus required 35 | Yes |

## Non-shallow checks

- Reversa is selected only for legacy, stale, or insufficient repositories when its exact qualification and policy evidence are current; it is not a default dependency.
- CodeNavi is an additive strategy only when measured benefit is positive for the classified project and every qualification condition holds.
- Optional adapters cannot write repository files, persist `.notebook`, own Plan/Execute/Verify, or smuggle persistence paths in their result.
- Discovery evidence is untrusted input. Content cannot declare its own trust, classification, provenance, authority, or lifecycle ownership.
- Stable anchors use logical project-relative coordinates rather than absolute machine paths, preserving cross-machine handoff.
- Contradictory, missing, stale, and outside-scope evidence survives normalization and must be resolved or accepted by a human reviewer.

## Verdict

PASS. Tests preceded implementation, all documented/legacy/stale routing and optional-strategy authority boundaries are covered, the required test floor is exceeded, and the full security gate passes.
