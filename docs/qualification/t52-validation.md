# T52 Policy-Filtered Hybrid Retrieval Validation

## Scope

- Task: T52 — Implement policy-filtered hybrid retrieval and explanations
- Requirements: VES-MEM-002, VES-CTX-002/005, and VES-SEC-003/006
- Commit target: `feat(memory): add explainable hybrid retrieval`
- Focused evidence: 84 cases (53 unit/property and 31 security)
- Required minimum: 35 unit/property/security cases
- Spec deviations: none

T52 adds a controller-ordered retrieval service and a pure deterministic hybrid ranker. The service resolves an exact Workspace/Project/purpose policy decision before invoking the lexical source and optional vector source, passes closed policy filters to both, and sends the policy port only digests and intent metadata. The ranker rechecks scope, classification, active state, freshness, content and rank bindings; performs reciprocal-rank fusion with canonical tie-breaking and freshness-adjusted confidence; and returns untrusted content with complete provenance, per-result explanations, semantic degradation evidence, and VES-CTX-005 result-limit omissions.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/unit/memory-retriever.test.mjs tests/security/memory-retriever-security.test.mjs` | PASS — 84 passed, 0 failed/skipped |
| `node --test tests/architecture/*.test.mjs` | PASS — 10 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck/build, 1,571 unit/property, 10 architecture, 248 qualification, 570 security, and 90 fault cases |

## Adequacy matrix

| Done-when criterion / spec AC | Exact assertion evidence | Spec-defined outcome | Result |
| --- | --- | --- | --- |
| Policy executes before candidate access | `tests/unit/memory-retriever.test.mjs:385-420`; `tests/security/memory-retriever-security.test.mjs:289-313` — exact `policy → lexical → vector` order, filter propagation, metadata-only authorization request, deny/exception short circuit | No candidate source is touched before an exact policy decision | PASS |
| Deterministic FTS/vector fusion (VES-CTX-002) | `tests/unit/memory-retriever.test.mjs:23-122,226-262,308-331` — lexical/hybrid/vector-only modes, RRF, canonical tie, generation/query identity, six record and six candidate permutations | Identical canonical inputs and generations produce byte-identical order and explanations | PASS |
| Scope isolation (VES-MEM-002/SEC-003) | `tests/security/memory-retriever-security.test.mjs:18-50,105-122,247-250` — foreign Workspace/Project content, IDs, ranks, and sentinels absent; policy bindings mandatory and exact | Cross-scope memory is completely invisible | PASS |
| Classification and freshness filters | `tests/unit/memory-retriever.test.mjs:123-192`; `tests/security/memory-retriever-security.test.mjs:74-103,187-199` — confidence adjustment, expiry, maximum age, four monotonic ceilings, inactive states, future evidence | Denied, stale, expired, future, deleted, and superseded evidence never reaches results | PASS |
| Optional semantic degradation and required blocking | `tests/unit/memory-retriever.test.mjs:73-101,421-458`; `tests/security/memory-retriever-security.test.mjs:201-219` — disabled/unavailable/stale/corrupt, missing embedding, adapter failure, malformed state | Semantic failure degrades only an optional profile and blocks a required profile explicitly | PASS |
| Provenance-preserving explainability (VES-MEM-002) | `tests/unit/memory-retriever.test.mjs:35-55,193-224,237-248` — modality ranks, provider signals, RRF contributions, freshness/final score, lexical/vector generations, semantic-query digest, source/revision/manifest/time/content digest | Every result and retrieval identity explains its evidence and ranking inputs | PASS |
| VES-CTX-005 omissions | `tests/unit/memory-retriever.test.mjs:193-209` — exact fragment, priority, reason, byte estimate, freshness and confidence effects | Whole optional results beyond the limit have explicit omission evidence | PASS |
| Retrieved content remains untrusted (VES-SEC-006) | `tests/security/memory-retriever-security.test.mjs:52-86,123-145,221-225` — policy/Cedar/capability/secret/tool injection corpus, unknown authority fields, no authorization objects or content in explanations | Content bytes cannot modify policy, trust, capability, freshness, or explanation authority | PASS |
| Integrity and closed schemas | `tests/unit/memory-retriever.test.mjs:263-306`; `tests/security/memory-retriever-security.test.mjs:140-185,227-245` — immutability, bounds, duplicate ranks/records, content digest, missing authoritative record, candidate digest substitution, modality disagreement | Malformed or forged candidate material fails closed before result publication | PASS |
| Coordinator adapter boundary | `tests/unit/memory-retriever.test.mjs:385-468`; `tests/security/memory-retriever-security.test.mjs:289-313` — exact filters, Float32 embedding, frozen requests, duplicate-source merge, sanitized optional/mandatory failures | Runtime composition preserves the pure ranker's authority and failure semantics | PASS |

## Necessary-test reverse map

| Test group and assertion range | Maps to | Keep |
| --- | --- | --- |
| `tests/unit/memory-retriever.test.mjs:23-122` | Lexical/hybrid modes, RRF, semantic policy, stable ties | Yes |
| `tests/unit/memory-retriever.test.mjs:123-224` | Freshness, classification, omissions, provenance | Yes |
| `tests/unit/memory-retriever.test.mjs:226-331` | Canonical identity, closed input, immutability, permutation properties | Yes |
| `tests/unit/memory-retriever.test.mjs:385-468` | Operational policy/source ordering and adapter request contract | Yes |
| `tests/security/memory-retriever-security.test.mjs:18-50` | Cross-Workspace/Project invisibility | Yes |
| `tests/security/memory-retriever-security.test.mjs:52-145` | Hostile content, inactive evidence, exact policy bindings, authority-field denial | Yes |
| `tests/security/memory-retriever-security.test.mjs:147-250` | Digest/rank integrity, future/stale semantic state, explanation safety, exact scope | Yes |
| `tests/security/memory-retriever-security.test.mjs:289-313` | Policy short circuit and sanitized source failures | Yes |

## Non-shallow checks

- The service owns the operational order. Policy authorization completes successfully before the lexical port is invoked; the vector port follows lexical retrieval and is never called for disabled semantic policy or a missing embedding.
- Policy receives Workspace, Project, purpose, evaluation time, requested limit, query digest, semantic intent, and optional Float32 embedding digest. It receives neither query text, embedding values, nor retrieved content.
- Both candidate ports receive the exact controller-owned classification ceiling, maximum age, scope, purpose, bounded candidate limit, and frozen canonical query/embedding request. The ranker independently reapplies all filters.
- Scope filtering occurs before foreign record normalization and produces neither result, omission, degradation, count, identity, nor sentinel evidence for another Workspace or Project.
- RRF uses explicit ranks and constant 60. Candidate input order is ignored; final ordering is freshness-adjusted score, raw RRF score, then a content-bound fragment identity. Provider scores remain explanation signals and do not bypass the stable algorithm.
- Confidence is a bounded deterministic function of available-modality ideal RRF, actual fused rank, and policy-window freshness. Optional semantic loss is explicit and marked as confidence-affecting.
- A hybrid result binds the exact semantic query digest, vector generation, lexical generation, policy evidence, source revision, manifest, retrieval/validity times, content digest, modality ranks, raw signals, contributions, and tie-break identity.
- Retrieved bytes are never parsed as policy, trust, freshness, classification, capability, or control instructions. Output trust is controller-owned and fixed to `untrusted-data`.
- Foreign or policy-denied records are absent rather than listed as omissions, preventing existence leakage. Only eligible results excluded by the public result limit receive identity-bearing VES-CTX-005 omission records.
- Lexical failure is a sanitized hard failure. Optional vector failure becomes explicit lexical degradation; required semantic failure becomes `VES_MEMORY_SEMANTIC_REQUIRED`. No raw adapter exception is exposed.

## Verdict

PASS for T52. Hybrid retrieval is controller-ordered, policy-filtered, deterministic across canonical permutations, scope-isolated, freshness-aware, content-bound, provenance-complete, explainable, and resilient to optional semantic loss. Retrieved content remains untrusted data and cannot alter authorization or promote itself.
