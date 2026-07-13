# T30 Backend Semantic Serializer Validation

## Scope

- Task: T30 — Implement backend serializers and semantic-equivalence oracle
- Requirements: VES-CTX-002…004, VES-MDL-005, and VES-HOF-004
- Commit target: `feat(context): add backend semantic serializers`
- Focused evidence: 42 cases — 27 contract and 15 security
- Spec deviations: none

T30 projects a signed T29 Context Manifest into one closed neutral semantic tree and serializes its canonical JSON into exact Pi, Claude Code, Codex, and OpenCode transport envelopes. A cross-backend oracle performs strict native-envelope extraction, closed-vocabulary validation, content-digest validation, canonical-byte validation, and meaning-digest comparison. Capacity is estimated over the final native envelope through a Driver-owned port before delivery.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/contract/context-serializers.test.mjs tests/security/context-serializer-security.test.mjs` | PASS — 42 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck, build, 1,346 unit, 10 architecture, 248 qualification, 215 security, and 39 fault cases |
| `pnpm test:contract` | PASS — 131 passed, 0 failed/skipped |

## Check A — sufficient, spec-anchored coverage

| Criterion / requirement | Exact assertion evidence | Spec-defined outcome | Covered |
| --- | --- | --- | --- |
| Four native serializers | `tests/contract/context-serializers.test.mjs:11–79` | Pi, Claude Code, Codex, and OpenCode emit exact target envelopes, round-trip one digest, preserve obligations/trust order, and estimate final bytes | Yes |
| VES-CTX-004 capacity | `tests/contract/context-serializers.test.mjs:81` | Every backend fails before delivery when qualified input capacity is insufficient | Yes |
| Closed target set | `tests/contract/context-serializers.test.mjs:95` | Unsupported generic backend has no fallback serializer | Yes |
| VES-MDL-005/HOF-004 equivalence | `tests/contract/context-serializers.test.mjs:108` | All six pairings among four backends produce the same normalized meaning digest | Yes |
| Injection-safe content boundary | `tests/security/context-serializer-security.test.mjs:9` | Four hostile delimiter/JSON/instruction payloads round-trip only as untrusted content strings | Yes |
| Transport tamper detection | `tests/security/context-serializer-security.test.mjs:36` | Changed content in each backend fails expected semantic equivalence | Yes |
| No fallback parsing | `tests/security/context-serializer-security.test.mjs:52` | Malformed native envelopes fail rather than treating arbitrary prompt text as context | Yes |
| Estimator fail-closed | `tests/security/context-serializer-security.test.mjs:68` | Non-finite capacity evidence blocks serialization | Yes |
| No target-only semantics | `tests/security/context-serializer-security.test.mjs:81` | Pi system instructions outside the neutral tree are forbidden | Yes |
| Closed semantic vocabulary | `tests/security/context-serializer-security.test.mjs:96` | Recomputed digest cannot authorize an extra instruction field | Yes |
| Minimum floor | Focused runner: 42 | At least 35 contract/security cases | Yes |

## Check B — non-shallow litmus

- Every backend independently proves native shape, semantic round-trip, obligation/fragment/trust order, final-envelope estimation, insufficient capacity, hostile content, tamper failure, and malformed-envelope rejection.
- The cross-backend oracle covers all six unordered backend pairs rather than comparing each only to a preferred backend.
- Hostile content includes a closing tag, a system instruction, a forged semantic-obligations object, an authority trust claim, and a reopening tag.
- Canonical JSON provides the structural boundary: content remains an escaped string and cannot create a sibling field.
- The oracle validates an exact field vocabulary at tree, fragment, source, and native-envelope levels; there is no permissive fallback parser.
- Even an attacker who recomputes the wrapper meaning digest cannot introduce a new instruction field.
- Provider-only controller instructions are prohibited, preventing semantic behavior that the shared digest cannot observe.

## Check C — necessary reverse mapping

| Test evidence | Requirement / criterion | Keep |
| --- | --- | --- |
| `context-serializers.test.mjs:11–79` | Native transport, round-trip, semantic/trust order, estimator port | Yes |
| `context-serializers.test.mjs:81–106` | Capacity and unsupported target | Yes |
| `context-serializers.test.mjs:108–132` | Complete cross-backend equivalence graph | Yes |
| `context-serializer-security.test.mjs:9–50` | Injection containment and tamper detection | Yes |
| `context-serializer-security.test.mjs:52–79` | Structural failure and estimator evidence | Yes |
| `context-serializer-security.test.mjs:81–119` | No hidden target semantics and closed tree vocabulary | Yes |

All 42 focused cases map to a T30 done-when criterion. Driver execution/session behavior remains with T34–T37 and is not duplicated here.

## Check D — guideline conformance

- Followed `.specs/features/verchestra-1.0/tasks.md`: contract/security tests preceded implementation, the 35-case floor is exceeded, and `gate:security` passes.
- Reused the T29 `serializedMeaningDigest`; serializer-specific envelopes do not invent another semantic model.
- Capacity is a port evaluated on final target bytes, allowing qualified Driver tokenizers without coupling the agent runtime to provider SDKs.
- Mandatory semantics and trust order are part of the neutral tree and therefore participate in every backend digest.
- Structural JSON fields are closed and content digests are recomputed by the oracle; prompt-like bytes cannot become controller fields.

## Adequacy verdict

PASS. All four serializers preserve one neutral meaning and mandatory trust order, all six cross-backend comparisons agree, hostile content remains structurally data, insufficient capacity fails before delivery, and the security gate is green.
