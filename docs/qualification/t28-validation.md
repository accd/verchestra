# T28 Context Recipe and Source Snapshot Validation

## Scope

- Task: T28 — Implement Context Recipe and source snapshot resolution
- Requirements: VES-CTX-001…002/005, VES-DSC-001/004…005, and VES-SPC-004
- Commit target: `feat(context): add recipes and source snapshots`
- Focused evidence: 42 cases — 20 unit and 22 contract
- Spec deviations: none

T28 validates and canonicalizes backend-neutral Context Recipes, resolves repository/tracker/knowledge/memory selectors through explicit ports, creates controller-owned Trust Envelopes, freezes source/revision/time/scope identities, evaluates freshness, and preserves missing, unavailable, stale, out-of-scope, revision-mismatch, and contradictory evidence. It does not rank, budget, omit, egress-authorize, sign, or serialize context; those operations remain T29–T30.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/unit/context-recipe.test.mjs tests/contract/context-source-ports.test.mjs` | PASS — 42 passed, 0 failed/skipped |
| `node scripts/gate.mjs full` | PASS — format, lint, typecheck, 1,313 unit, 104 contract, 156 integration, 16 e2e, and 39 fault cases |
| `node --test tests/architecture/repository-boundaries.test.mjs` | PASS — 10 passed, 0 failed/skipped |

## Check A — sufficient, spec-anchored coverage

| Criterion / requirement | Exact assertion evidence | Spec-defined outcome | Covered |
| --- | --- | --- | --- |
| Recipe validity | `tests/unit/context-recipe.test.mjs:26–53` | Seventeen malformed schema, identity, selector, query, classification, obligation, budget, freshness, trust, and purpose forms fail before source access | Yes |
| VES-CTX-001/002 canonical recipe | `tests/unit/context-recipe.test.mjs:55` | Selector and query-key ordering yield one recipe and snapshot identity | Yes |
| Immutable snapshot | `tests/unit/context-recipe.test.mjs:72` | Result, sources, fragments, and provenance are frozen | Yes |
| Exact Workspace | `tests/unit/context-recipe.test.mjs:81` | Non-Workspace identity fails before resolution | Yes |
| Four source ports | `tests/contract/context-source-ports.test.mjs:25–40` | Repository, tracker, knowledge, and memory receive a frozen typed query and return envelopes | Yes |
| Repeated resolution | `tests/contract/context-source-ports.test.mjs:42` | Identical frozen observations yield byte-identical snapshots/fragments | Yes |
| Canonical port order | `tests/contract/context-source-ports.test.mjs:50` | Recipe order cannot change source invocation order | Yes |
| VES-DSC-005 missing/unavailable | `tests/contract/context-source-ports.test.mjs:63–96` | Required/optional absence and private adapter failures remain explicit and sanitized | Yes |
| Freshness evidence | `tests/contract/context-source-ports.test.mjs:98`, `:107`, `:232` | Old, future, and evaluation-time changes produce explicit deterministic evidence | Yes |
| Scope and revision binding | `tests/contract/context-source-ports.test.mjs:113`, `:206` | Outside-scope and revision-mismatch observations contribute no assumed facts | Yes |
| Contradiction preservation | `tests/contract/context-source-ports.test.mjs:121`, `:140` | Conflicting values preserve both alternatives; equal facts do not create false conflict | Yes |
| VES-DSC-004 source identity/content | `tests/contract/context-source-ports.test.mjs:145`, `:160` | Revision and controller-computed content digest bind snapshot identity | Yes |
| Malformed source fail-closed | `tests/contract/context-source-ports.test.mjs:183` | Duplicate fragment identities make the observation unavailable | Yes |
| Trust boundary | `tests/contract/context-source-ports.test.mjs:213` | Instruction-like content cannot overwrite classification, trust, revision, or scope | Yes |
| Fixture sources | `tests/contract/context-source-ports.test.mjs:239`, `:253` | Reusable fixtures snapshot caller input and enforce exact source kind | Yes |
| Minimum floor | Focused runner: 42 | At least 30 unit/contract cases | Yes |

## Check B — non-shallow litmus

- The recipe corpus mutates every controller-owned dimension, rather than testing schema version alone.
- Canonicality is checked across selector ordering and nested query-key ordering, while source invocation order is independently asserted.
- Private adapter exception text is injected and proven absent from the snapshot.
- A hostile tracker fragment contains fake classification, trust, revision, and scope instructions; all structured metadata remains controller-derived.
- Contradiction detection distinguishes equal multi-source agreement from two different values for the same fact key and retains both fragment identities.
- Source revision, content, and evaluation time are independently mutated and each changes the frozen snapshot identity.
- Fixture sources clone and freeze observations at construction, so later caller mutation cannot rewrite test evidence.

## Check C — necessary reverse mapping

| Test evidence | Requirement / criterion | Keep |
| --- | --- | --- |
| `context-recipe.test.mjs:26–87` | Recipe validation, canonical identity, immutability, Workspace binding | Yes |
| `context-source-ports.test.mjs:25–61` | Four ports, deterministic replay/order | Yes |
| `context-source-ports.test.mjs:63–119` | Missing, unavailable, stale, future, and scope findings | Yes |
| `context-source-ports.test.mjs:121–181` | Contradictions and source/content identity | Yes |
| `context-source-ports.test.mjs:183–230` | Malformed identity, revision, and hostile content | Yes |
| `context-source-ports.test.mjs:232–265` | Evaluation identity and reusable fixtures | Yes |

All 42 focused cases map to a named requirement or T28 done-when criterion. No speculative compiler/serializer test was introduced early.

## Check D — guideline conformance

- Followed `.specs/features/verchestra-1.0/tasks.md`: tests preceded implementation, the 30-case floor is exceeded, and `gate:full` passes.
- Followed Design §§4.7 and 5.6: Context Recipe and Context Source contracts are backend-neutral and source ordering is deterministic.
- Reused T27 Trust Envelopes and the domain classification lattice rather than creating parallel trust/classification vocabularies.
- Preserved package boundaries: `agent-runtime` depends only on approved inward packages; architecture passes 10/10.
- Deferred resolve/classify/freshness/dedupe/rank/budget/omit/egress/sign composition to T29 as explicitly tasked.

## Adequacy verdict

PASS. T28 exceeds its test floor, repeated source state produces byte-identical snapshots and fragments, every degraded evidence state remains explicit, contradictions preserve alternatives, hostile content cannot self-promote, and the full repository gate is green.
