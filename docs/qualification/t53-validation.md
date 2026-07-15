# T53 Memory Promotion and Reference-Aware Lifecycle Validation

## Scope

- Task: T53 — Implement memory promotion and reference-aware lifecycle
- Requirements: VES-MEM-004/005, VES-BST-001, and VES-SEC-003
- Commit target: `feat(memory): add promotion and lifecycle`
- Focused evidence: 60 cases (19 integration, 27 security, and 14 fault injection)
- Required minimum: 35 integration/fault/security cases
- Spec deviations: none

T53 adds a human-reviewed memory-promotion plan and atomic canonical writer, an application-owned Artifact Planning port, content-addressed managed objects, a Workspace-isolated reference graph, legal holds, retention and quota planning, explicit invalidation and forget operations, recoverable quarantine, idempotent content-bound garbage collection, sensitive-object crypto-shredding, and checksummed SQLite lifecycle migrations. Unknown files are outside the managed-object graph and are never candidates.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/integration/memory-lifecycle.test.mjs tests/security/memory-lifecycle-security.test.mjs tests/fault-injection/memory-lifecycle-faults.test.mjs` | PASS — 60 passed, 0 failed/skipped |
| `node --test tests/architecture/*.test.mjs` | PASS — 10 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck/build, 1,571 unit/property, 10 architecture, 248 qualification, 597 security, and 104 fault cases |

## Adequacy matrix

| Done-when criterion / spec AC | Exact assertion evidence | Spec-defined outcome | Result |
| --- | --- | --- | --- |
| Promotion is reviewable and never silently mutates truth | `tests/integration/memory-lifecycle.test.mjs:34-101`; `tests/security/memory-lifecycle-security.test.mjs:37-119` | Proposal performs zero writes; only exact human review can publish; different existing bytes survive | PASS |
| Canonical placement uses the Artifact Resolver without adapter coupling | `tests/integration/memory-lifecycle.test.mjs:64-82`; `tests/security/memory-lifecycle-security.test.mjs:311-333`; architecture gate | Application owns `ArtifactPlanningPort`; Workspace implements it; Memory consumes only the port | PASS |
| Promotion provenance and deterministic identity | `tests/integration/memory-lifecycle.test.mjs:43-62,251-263`; `tests/security/memory-lifecycle-security.test.mjs:55-108` | Artifact carries exact source links, reviewed content, canonical ordering, and content-bound plan/review identities | PASS |
| Reference-aware retention and quota | `tests/integration/memory-lifecycle.test.mjs:124-201`; `tests/fault-injection/memory-lifecycle-faults.test.mjs:150-167` | Canonical/evidence roots, transitive references, and legal holds survive; stale plans fail closed | PASS |
| Dry-run and idempotent mark/sweep quarantine | `tests/integration/memory-lifecycle.test.mjs:135-164`; `tests/security/memory-lifecycle-security.test.mjs:124-148`; `tests/fault-injection/memory-lifecycle-faults.test.mjs:234-252` | Dry-run changes nothing; apply moves only the content-bound candidate set; retry returns the durable receipt | PASS |
| Unknown and human files survive | `tests/security/memory-lifecycle-security.test.mjs:124-134` | Files absent from the authoritative graph are never deletion or quarantine candidates | PASS |
| Invalidation and forget are policy/reference aware | `tests/integration/memory-lifecycle.test.mjs:203-249`; `tests/security/memory-lifecycle-security.test.mjs:150-190` | Eligible objects quarantine idempotently; canonical, evidence, referenced, and held objects are protected | PASS |
| Sensitive-object crypto-shred is convergent | `tests/integration/memory-lifecycle.test.mjs:237-249`; `tests/fault-injection/memory-lifecycle-faults.test.mjs:169-212` | Only the logical key handle reaches the adapter; failure restores active state; acknowledgement loss does not repeat destruction | PASS |
| Crash-safe filesystem/SQLite convergence | `tests/fault-injection/memory-lifecycle-faults.test.mjs:32-148,214-252` | Pre-commit faults restore original paths/state; post-commit loss reports outcome unknown and converges on retry | PASS |
| Workspace isolation and closed mutation shapes | `tests/security/memory-lifecycle-security.test.mjs:100-119,181-224` | Foreign objects/references and credential/authority fields cannot enter lifecycle operations | PASS |
| Path and link safety | `tests/security/memory-lifecycle-security.test.mjs:226-278` | Parent junctions and linked targets cannot redirect canonical or managed-object writes | PASS |
| Migration and authoritative schema integrity | `tests/security/memory-lifecycle-security.test.mjs:280-309`; `tests/fault-injection/memory-lifecycle-faults.test.mjs:214-232` | Checksum drift, incomplete schema, corrupt bytes, and writer contention fail closed with stable outcomes | PASS |

## Necessary-test reverse map

| Test group | Maps to | Keep |
| --- | --- | --- |
| Integration promotion and lifecycle cases | Review surface, placement, canonical bytes, retention, quota, references, idempotency, invalidation, forget | Yes |
| Security promotion cases | Review/plan binding, trust boundary, scope, traversal, link races, unknown-file survival | Yes |
| Security lifecycle cases | Candidate substitution, protected roots, cross-Workspace denial, migration/schema integrity | Yes |
| Fault-injection promotion cases | Stage/publish crash, target race, acknowledgement recovery | Yes |
| Fault-injection lifecycle cases | Move rollback, stale plan, SQLite lock/corruption, crypto-shred and GC outcome uncertainty | Yes |

## Non-shallow checks

- Promotion plans bind artifact bytes, target placement, lifecycle policy, Git owner, and human review. Retrieved memory remains untrusted input and cannot choose its authority or placement.
- The Artifact Planning contract lives in the application layer. The Workspace adapter implements the port and the Memory adapter receives it through composition, so no sibling adapter dependency remains.
- Managed objects are content-addressed inside an exact Workspace/Project boundary. Re-registering the same content with conflicting retention, protection, key, or lifecycle metadata fails instead of silently changing policy.
- Mark roots include canonical and required-evidence objects plus the complete outbound reference closure and legal holds. A legal hold or managed-object change invalidates a previously issued GC plan.
- GC validates the complete received plan against its digest before touching any candidate. Its durable receipt is committed in the same SQLite transaction as quarantine state, enabling safe replay after acknowledgement loss.
- Filesystem publication and quarantine revalidate owner ancestry and the target itself. Windows junctions, symlink-like targets, traversal, target races, and externally controlled ignored repositories cannot redirect writes.
- Lifecycle schema creation is a checksummed raw migration with an independent ledger that can coexist with the authoritative memory-store migrations. Startup verifies SQLite integrity, exact table columns, required index, foreign keys, and disabled writable schema.
- Sensitive forget first establishes recoverable quarantine state. Key destruction receives only an opaque logical handle; successful destruction clears the handle before acknowledgement, while pre-destruction failure restores bytes and active metadata.
- No operation recursively scans and deletes storage. Unknown files, including human-created files inside managed directories, remain outside the reference graph and survive dry-run and apply.

## Verdict

PASS for T53. Memory can now be promoted only through an inspectable human-reviewed canonical artifact, while local derived state has deterministic, Workspace-isolated, reference-aware, idempotent, crash-tested retention and quarantine semantics. Protected evidence and unknown human files survive, and crypto-shred uncertainty converges without silent data-authority changes.
