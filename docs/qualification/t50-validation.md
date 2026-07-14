# T50 Authoritative Lexical Memory Validation

## Scope

- Task: T50 — Implement memory store, canonical ingestion, and FTS5
- Requirements: VES-MEM-001…003 and VES-DSC-004…005
- Commit target: `feat(memory): add authoritative lexical store`
- Focused evidence: 45 cases (26 integration and 19 fault injection)
- Required minimum: 35 integration/fault cases

T50 adds the local `memory.sqlite` authority, checksummed raw migration, immutable source observations, active source heads, chunk provenance, canonical ingestion generations, FTS5 projection, stale/deleted invalidation, canonical rebuild, integrity inspection, and staged online backup. `sqlite-vec` is intentionally absent: T51 owns the optional replaceable semantic index, while T50 remains fully functional and authoritative in lexical-only mode.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/integration/memory-store.test.mjs tests/fault-injection/memory-store-faults.test.mjs` | PASS — 45 passed, 0 failed/skipped |
| `node --test tests/architecture/*.test.mjs` | PASS — 10 passed, 0 failed/skipped |
| `node scripts/gate.mjs full` | PASS — format, lint, typecheck, 1,518 unit/property, 382 contract, 290 integration, 16 E2E, and 74 fault cases |

## Adequacy matrix

| Done-when criterion / spec AC | Exact assertion evidence | Spec-defined outcome | Result |
| --- | --- | --- | --- |
| SQLite relational records are authoritative and FTS5 is lexical (VES-MEM-001) | `tests/integration/memory-store.test.mjs:20-30,54-87` — qualified settings, persisted provenance, real lexical hit, explicit untrusted marker | Relational rows own truth; FTS5 retrieves only their active projection | PASS |
| Repeated ingestion converges | `tests/integration/memory-store.test.mjs:100-111` — same generation/result, unchanged state digest, one source, two chunks, one active generation | Replaying identical canonical evidence is an exact no-op | PASS |
| Canonical identity ignores input order | `tests/integration/memory-store.test.mjs:113-126,234-244` — source/chunk permutation and independent databases produce equal manifest, generation, and state digests | Ordering cannot create a new memory truth | PASS |
| Changed sources invalidate old lexical visibility | `tests/integration/memory-store.test.mjs:128-147` — prior source ID is invalidated, old term disappears, new term appears, old chunks remain historical | Current authority changes without deleting provenance | PASS |
| Deleted sources become explicit tombstones | `tests/integration/memory-store.test.mjs:149-162` — omitted full-snapshot source is `deleted` and absent from FTS | Missing canonical evidence is explicit, not silently retained | PASS |
| Stale sources invalidate correctly (VES-DSC-005) | `tests/integration/memory-store.test.mjs:164-198` — expiry removes visibility, fresh/non-expiring evidence remains, newer observation revives the source | Freshness state is explicit and never converted into an assumption | PASS |
| Source/chunk provenance remains untrusted data (VES-DSC-004) | `tests/integration/memory-store.test.mjs:54-87,200-219` — identity, revision, retrieval time, classification, content digest, generation, and `untrusted: true` assertions | Retrieved content carries evidence metadata and no instruction authority | PASS |
| Ingestion manifests contain identities, not raw document content | `tests/integration/memory-store.test.mjs:221-232` — digests present and both source sentences absent from serialized manifests | Rebuild metadata is canonical without duplicating unrestricted content | PASS |
| Clean-machine rebuild uses canonical sources (VES-MEM-003) | `tests/integration/memory-store.test.mjs:246-267` — independent store reproduces digest/search and replaces machine-only state | Local SQLite state is rebuilt, never shared through Git | PASS |
| Workspace and Project isolation | `tests/integration/memory-store.test.mjs:269-307` — two Workspaces and Projects return only their own sources and active generations | Local memory never crosses its exact scope | PASS |
| Online backup is staged, complete, and content-bound | `tests/integration/memory-store.test.mjs:309-334`; `tests/fault-injection/memory-store-faults.test.mjs:184-215` — SHA-256, canonical digest, document/migration counts, WAL rows, invalid staging/publication rollback | Published backup is a verified consistent snapshot or no backup is published | PASS |
| Migration and lock failures are stable and atomic | `tests/fault-injection/memory-store-faults.test.mjs:12-47,121-130` — checksum drift, newer migration, raw migration rollback, real exclusive lock | Incompatible state fails closed; contention is recoverable and writes nothing | PASS |
| Complete batches validate before mutation | `tests/fault-injection/memory-store-faults.test.mjs:49-82` — wrong digest, duplicate source/chunk, credential/authority field injection leave zero rows | Invalid external evidence cannot partially enter authority | PASS |
| Transactional crashes converge | `tests/fault-injection/memory-store-faults.test.mjs:84-119,217-233` — chunk/tombstone/reset failures preserve exact prior state and lexical results | Generation, source, chunks, and FTS change as one transaction | PASS |
| Structural and semantic corruption fail closed | `tests/fault-injection/memory-store-faults.test.mjs:132-182` — corrupt bytes, missing FTS schema, changed chunk text, missing FTS row, and forged FTS-only row all yield recoverable corruption | SQLite integrity alone cannot hide semantic/projection tampering | PASS |

## Necessary-test reverse map

| Test range | Maps to | Keep |
| --- | --- | --- |
| `tests/integration/memory-store.test.mjs:20-52` | Qualified SQLite/FTS runtime and migration lifecycle | Yes |
| `tests/integration/memory-store.test.mjs:54-126` | VES-MEM-001 authoritative ingestion/search/convergence | Yes |
| `tests/integration/memory-store.test.mjs:128-198` | VES-DSC-005 contradiction-by-state, invalidation, tombstones, freshness | Yes |
| `tests/integration/memory-store.test.mjs:200-232` | VES-DSC-004 untrusted provenance and sanitized manifests | Yes |
| `tests/integration/memory-store.test.mjs:234-307` | VES-MEM-003 deterministic scoped rebuild | Yes |
| `tests/integration/memory-store.test.mjs:309-354` | Backup, extension denial, restart stability | Yes |
| `tests/fault-injection/memory-store-faults.test.mjs:12-82` | Migration compatibility and pre-transaction validation | Yes |
| `tests/fault-injection/memory-store-faults.test.mjs:84-130` | Transaction rollback and real SQLite contention | Yes |
| `tests/fault-injection/memory-store-faults.test.mjs:132-182` | Structural, semantic, and derived-index corruption | Yes |
| `tests/fault-injection/memory-store-faults.test.mjs:184-246` | Backup/rebuild failure atomicity and invalid request immutability | Yes |

## Non-shallow checks

- Every ingestion batch is fully normalized and validated before `BEGIN IMMEDIATE`; unknown fields, including credential and content-granted authority fields, fail closed.
- Observation, manifest, generation, chunk, database-state, and backup identities are SHA-256 content-bound. Equivalent source/chunk permutations produce one identity.
- Source observations remain historical while one explicit head owns current state. Changed heads become `superseded`; full-snapshot omissions become `deleted`; expired heads become `stale`.
- FTS rows are written and removed in the same transaction as relational authority. Inspection and state digest calculate a bidirectional relational/FTS difference, so both missing and injected index rows fail as corruption.
- Every stored chunk digest is recomputed during inspection and state-digest calculation. A structurally valid SQLite file with altered content still fails closed.
- Search requires exact Workspace and Project, uses bound parameters and a closed normalized token expression, returns only active rows, and labels every result `untrusted: true`.
- Rebuild validates all canonical batches first, resets local derived state transactionally, and accepts one complete batch per Workspace/Project. It has no API that imports another machine's SQLite file.
- Backup uses SQLite's online backup into a unique staging path, then performs integrity, schema, chunk-digest, FTS-projection, byte-digest, and canonical-state validation before atomic publication.
- Extension loading is disabled on active and inspection connections. No sqlite-vec import or vector table participates in lexical authority.

## Verdict

PASS for T50. The relational/FTS memory store is deterministic, scope-isolated, provenance-complete, rebuildable from canonical inputs, atomic under failures, and able to detect both structural and semantic corruption. Lexical authority remains fully independent of the optional vector layer planned for T51.
