# T51 Rebuildable Vector Index Validation

## Scope

- Task: T51 — Implement optional sqlite-vec generations and lexical fallback
- Requirements: VES-MEM-001…003
- Commit target: `feat(memory): add rebuildable vector index`
- Focused evidence: 35 cases (19 integration and 16 fault injection)
- Required minimum: 25 integration/fault cases

T51 adds an optional, exact-pinned `sqlite-vec` adapter over T50's authoritative relational and FTS5 memory. Semantic data is a replaceable per-Workspace/Project projection: each generation binds the current lexical authority, embedding model identity, exact active chunks, Float32 embedding bytes, qualified extension runtime, and a two-slot atomic publication protocol. Disabled and preferred profiles preserve lexical-only operation; only an explicitly required semantic profile fails closed when the extension or a verified generation is unavailable.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/integration/memory-vector-index.test.mjs tests/fault-injection/memory-vector-index-faults.test.mjs` | PASS — 35 passed, 0 failed/skipped |
| `node --test tests/architecture/*.test.mjs` | PASS — 10 passed, 0 failed/skipped |
| `node scripts/gate.mjs full` | PASS — format, lint, typecheck, 1,518 unit/property, 382 contract, 309 integration, 16 E2E, and 90 fault cases |

## Adequacy matrix

| Done-when criterion / spec AC | Exact assertion evidence | Spec-defined outcome | Result |
| --- | --- | --- | --- |
| Only the qualified sqlite-vec artifact executes | `tests/integration/memory-vector-index.test.mjs:48-66` — exact package/runtime version, byte length and SHA-256; connection is locked against later extension loads | Native code identity is explicit and extension loading is temporary | PASS |
| Optional semantic retrieval preserves lexical-only operation | `tests/integration/memory-vector-index.test.mjs:68-115` — disabled, missing, checksum-mismatched, and version-mismatched extension cases; explicit required-mode failure | Incompatible/corrupt/missing extension never blocks lexical authority unless the profile requires semantic retrieval | PASS |
| A generation is complete, content-addressed, and deterministic | `tests/integration/memory-vector-index.test.mjs:117-139,269-281` — verified generation metadata, order convergence, and identity changes for model/authority/vector changes | Equal evidence converges; materially different evidence cannot alias | PASS |
| Retrieval uses real sqlite-vec and exact scope | `tests/integration/memory-vector-index.test.mjs:141-174` — nearest-neighbor query, provenance-bound untrusted identity, Workspace/Project isolation | Semantic candidates come from the requested scope and remain untrusted | PASS |
| Metadata is explicit and never stores vectors as JSON | `tests/integration/memory-vector-index.test.mjs:176-186` — model/runtime/vector digests present; serialized metadata contains no embedding values | Rebuild metadata is auditable without duplicating vector payloads | PASS |
| Generation replacement verifies before atomic swap | `tests/integration/memory-vector-index.test.mjs:188-201`; `tests/fault-injection/memory-vector-index-faults.test.mjs:98-184` — inactive slot, rollback at insert/verify/pre-swap, post-commit acknowledgement convergence | A failed replacement leaves the prior active generation usable or no generation published | PASS |
| Vector state never becomes lexical authority | `tests/integration/memory-vector-index.test.mjs:204-236` — stable lexical state digest, valid backup with vec tables, clear-and-rebuild identity | Derived state can be discarded without changing canonical memory | PASS |
| Authority change makes a vector generation stale | `tests/integration/memory-vector-index.test.mjs:239-255`; `tests/fault-injection/memory-vector-index-faults.test.mjs:70-96,114-131` — missing/forged/stale inputs and TOCTOU mutation under writer lock | Semantic results never survive divergence from active lexical evidence | PASS |
| Reopen verifies the complete active generation | `tests/integration/memory-vector-index.test.mjs:257-267`; `tests/fault-injection/memory-vector-index-faults.test.mjs:187-248` — missing table, required corruption, member digest and control-slot tampering | Structurally valid but semantically inconsistent vector state is rejected before retrieval | PASS |
| Invalid vectors and contention are atomic and recoverable | `tests/fault-injection/memory-vector-index-faults.test.mjs:41-112,250-271` — dimension, finite-number, duplicate, completeness, digest, crash and real SQLite lock cases | Bad input or transient failure writes no partial derived truth and leaves lexical state intact | PASS |

## Necessary-test reverse map

| Test range | Maps to | Keep |
| --- | --- | --- |
| `tests/integration/memory-vector-index.test.mjs:48-115` | Exact native dependency qualification and profile fallback policy | Yes |
| `tests/integration/memory-vector-index.test.mjs:117-186` | Content-bound generation, real KNN, scope, and metadata | Yes |
| `tests/integration/memory-vector-index.test.mjs:188-236` | Two-slot replacement and separation from lexical authority | Yes |
| `tests/integration/memory-vector-index.test.mjs:239-281` | Staleness, reopen verification, and generation identity | Yes |
| `tests/fault-injection/memory-vector-index-faults.test.mjs:41-96` | Closed build input and authority binding | Yes |
| `tests/fault-injection/memory-vector-index-faults.test.mjs:98-184` | Transaction, swap, TOCTOU, and acknowledgement failures | Yes |
| `tests/fault-injection/memory-vector-index-faults.test.mjs:187-248` | Missing/corrupt/tampered active generation | Yes |
| `tests/fault-injection/memory-vector-index-faults.test.mjs:250-271` | Real SQLite writer contention | Yes |

## Non-shallow checks

- `sqlite-vec` is pinned exactly to `0.1.9`; the runtime version, loadable asset byte count, and SHA-256 are checked before use. Native extension loading is disabled immediately after the controlled bootstrap.
- Build input is closed-schema and complete. It must contain exactly one finite Float32 embedding for every active authoritative chunk and may not introduce foreign chunk identities or content digests.
- Embedding digests use explicit IEEE-754 Float32 little-endian bytes. They do not depend on host JSON number formatting.
- Generation identity binds scope, authority snapshot, source observations, active chunks, model metadata, extension identity, member identities, content digests, embedding digests, and the aggregate vector digest.
- Each Workspace/Project has two safely derived vec0 slots. Replacement builds and verifies the inactive slot inside `BEGIN IMMEDIATE`, rechecks authority after acquiring the writer lock, and publishes the control row only after verification.
- Reopen and pre-search checks validate control-slot consistency, runtime/model/generation identity, member set and digests, vector row count, vector payload digests, and current authority digest.
- Preferred mode degrades to an explicit availability status; required mode raises a stable recoverable error. Neither path changes T50 relational/FTS records or their canonical state digest.
- Backups remain valid with vec0 tables present, while vector tables and metadata remain excluded from the canonical lexical authority digest.

## Verdict

PASS for T51. The semantic index is exact-pinned, optional, scope-isolated, content-bound, atomically replaceable, corruption-detecting, and reproducible. Lexical memory remains authoritative and fully operational without sqlite-vec; semantic retrieval blocks only when a profile explicitly requires it.
