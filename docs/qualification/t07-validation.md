# T07 Validation — SQLite, FTS5, Backup, and sqlite-vec

**Gate:** `corepack pnpm@10.34.5 gate:security`  
**Result:** 153 passed, 0 failed, 0 skipped, 0 todo (31 T07 cases)  
**SPEC_DEVIATION:** none.

## Check A — Sufficient coverage

| Done-when / requirement | Assertion evidence | Spec-defined outcome | Covered |
| --- | --- | --- | --- |
| Exact runtime and asset identity | Runtime/version, SHA-256, and byte-size cases | Exact Node/SQLite/FTS5/sqlite-vec identity recorded | Yes |
| Safe database initialization | WAL/foreign-key/timeout/defensive case | Required safety settings active | Yes |
| Extension lock-down | Default-deny and post-bootstrap denial cases | No extension loading after controlled initialization | Yes |
| Vector failure isolation | Wrong-checksum, missing-asset, dropped-index cases | Relational/FTS remains authoritative and searchable | Yes |
| Checksummed migrations | Apply-once and checksum-drift cases | Idempotent migration or stable fail-closed result | Yes |
| Scoped explainable retrieval | FTS result, Workspace, Project, missing-scope cases | Scoped provenance/freshness/trust/explanation | Yes |
| Idempotent synchronization | Repeat and changed-content cases | No duplicate mutation; stable digest | Yes |
| Transaction safety | Invalid-batch, lock, foreign-key cases | No partial canonical state | Yes |
| Derived semantic retrieval | Nearest-neighbor, drop, rebuild cases | Optional index is useful but replaceable | Yes |
| Online backup and closure | Integrity, WAL records, digest-binding cases | Valid staged snapshot with checksum manifest | Yes |
| Recovery fault behavior | Validation, publication, corruption cases | Stable recoverable error; active state unchanged | Yes |

## Check B — Non-shallow

The 31 cases execute the real Node SQLite engine and real pinned sqlite-vec DLL. They assert database contents, state digests, FTS results, vector neighbors, exact error codes, integrity checks, and post-failure authority. Faults are injected at validation and atomic-publication boundaries; a second live SQLite connection creates a real exclusive lock.

## Check C — Necessary reverse mapping

| Test group | Maps to | Keep |
| --- | --- | --- |
| Runtime, migrations, FTS, vector lifecycle | VES-MEM-001 | Yes |
| Scoped explainable results and untrusted marker | VES-MEM-002 | Yes |
| Canonical digest and rebuildable derived index | VES-MEM-003 | Yes |
| Repeated ingestion/migration/reopen | VES-BST-004 | Yes |
| Online staged backup, checksums, integrity, WAL closure | VES-SEC-004 | Yes |
| Lock/corruption/validation/publication failures | VES-SEC-005 | Yes |

## Check D — Guidelines

Tests follow AD-009/015 and design sections 4.4, 7.2, 8, and 10. The vector adapter is explicitly subordinate to relational/FTS authority. No dependency behavior is tested without a Verchestra requirement or T07 qualification criterion.

## Adequacy verdict

PASS — all 31 new cases are requirement-bound, exceed the ≥25 threshold, use real pinned dependencies, and prove that vector and recovery failures cannot corrupt active relational/FTS authority. The complete security gate passes without skips.
