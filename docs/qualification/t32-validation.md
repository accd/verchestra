# T32 Capability Model Router Validation

## Scope

- Task: T32 — Implement hard-filter-first Model Router
- Requirements: VES-MDL-001…005, VES-BST-002, and VES-HOF-003
- Commit target: `feat(models): implement capability router`
- Focused evidence: 43 unit/property cases
- Explicit mutation evidence: ten independent hard-filter mutations
- Spec deviations: none

T32 resolves only exact Passport ID/revision references from the local Machine Profile, applies every hard exclusion before ranking, evaluates required/preferred independence against already selected roles, and returns deterministic selections plus per-Passport exclusion evidence. Preference ranking cannot make an ineligible Passport selectable.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/unit/model-router.test.mjs` | PASS — 43 passed, 0 failed/skipped |
| `node scripts/gate.mjs quick` | PASS — format, lint, typecheck, and 1,418 unit/property cases |

## Check A — sufficient, spec-anchored coverage

| Criterion / requirement | Exact assertion evidence | Spec-defined outcome | Covered |
| --- | --- | --- | --- |
| Closed route contract | `tests/unit/model-router.test.mjs:8–98` | Twelve malformed Machine/role/capability/risk/capacity/transport/data/independence/preference forms fail before resolution | Yes |
| Hard-filter-first | `tests/unit/model-router.test.mjs:42–98` | Capability, risk, input/output capacity, training, retention, region, transport, degraded status, and confidence independently exclude despite preferences | Yes |
| Claude + Codex | `tests/unit/model-router.test.mjs:100` | Anthropic planner plus independent OpenAI validator are selected exactly | Yes |
| Only Claude | `tests/unit/model-router.test.mjs:114` | Required second-role independence produces exact no-eligible error | Yes |
| Only Codex | `tests/unit/model-router.test.mjs:127` | One compatible Passport serves non-independent planning and validation | Yes |
| OpenCode + Qwen | `tests/unit/model-router.test.mjs:137` | Qwen Passport is selected for implementation | Yes |
| API-only | `tests/unit/model-router.test.mjs:144` | Remote API is eligible only under compatible transport/data handling | Yes |
| No writer | `tests/unit/model-router.test.mjs:156` | Missing write capability returns explainable no-eligible evidence | Yes |
| Preferred independence | `tests/unit/model-router.test.mjs:165` | Single-class environment continues only with explicit degraded independence | Yes |
| Local profile resolution | `tests/unit/model-router.test.mjs:172–213` | Missing profile, non-current Passport, and revision mismatch fail/exclude explicitly | Yes |
| Order property | `tests/unit/model-router.test.mjs:215` | All six candidate permutations produce the same selection and ranking vector | Yes |
| Explainable ranking | `tests/unit/model-router.test.mjs:229–291` | Status, provider, model, confidence, capacity, and stable Passport tie-break are deterministic | Yes |
| Minimum floors | Focused runner: 43; hard mutations: 10 | At least 40 unit/property and at least 4 mutations | Yes |

## Check B — non-shallow litmus

- Ten independent hard-filter mutations each retain a strong preferred-provider signal and still produce no eligible model.
- Required and preferred independence are tested separately: one blocks, the other continues with explicit degradation.
- Machine Profile identity is exact to both Passport ID and revision; neither a stale ref nor an unindexed new revision can route.
- All six permutations of three real provider families yield one Qwen implementation selection and identical ranking evidence.
- Ranking dimensions are independently isolated: qualification status precedes preferences, then provider/model preference, confidence, verified capacity, and stable Passport identity.
- The six task-mandated environment fixtures produce exact selections or exact errors rather than merely a nonempty result.

## Check C — necessary reverse mapping

| Test evidence | Requirement / criterion | Keep |
| --- | --- | --- |
| `model-router.test.mjs:8–98` | Input contract, hard exclusions, mutation floor | Yes |
| `model-router.test.mjs:100–164` | Six mandatory environment fixtures | Yes |
| `model-router.test.mjs:165–213` | Independence and Machine Profile exactness | Yes |
| `model-router.test.mjs:215–291` | Ordering property and explainable ranking | Yes |

All 43 cases map to T32 requirements or done-when criteria. Driver protocol/execution behavior remains T33.

## Check D — guideline conformance

- Followed `.specs/features/verchestra-1.0/tasks.md`: tests preceded implementation, both floors are exceeded, and `gate:quick` passes.
- Reused T31 verified-current Passport and Machine index ports rather than reading provider aliases or sessions.
- Hard filters run before construction of any preference vector.
- Role independence references only an earlier resolved role, making multi-role routing deterministic.
- Every no-eligible result carries stable Passport-specific exclusion reasons without private adapter details.

## Adequacy verdict

PASS. T32 exceeds both floors, hard requirements cannot be outranked, all required environment fixtures are exact, Machine Profile revision binding is enforced, independence is explicit, and the global quick gate is green.
