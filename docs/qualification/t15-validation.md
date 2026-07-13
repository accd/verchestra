# T15 Validation — Isolated Runtime Store and Journal

**Gate:** `corepack pnpm@10.34.5 gate:full`  
**Result:** 26 integration, 14 fault-injection, 1,082 unit, and 41 contract cases passed; 0 failed, 0 skipped, 0 todo. Format, lint, strict TypeScript, and the extended full gate passed.  
**SPEC_DEVIATION:** none.

## Check A — Sufficient coverage

| Criterion | Assertion evidence | Spec outcome | Covered |
| --- | --- | --- | --- |
| SQLite safety and migrations | `runtime-store.test.mjs:33–63` | WAL, FK, busy timeout, defensive writable-schema off, checksummed raw migration, idempotent reopen, downgrade refusal | Yes |
| Run projection and journal CAS | `runtime-store.test.mjs:66–135` | Snapshot round-trip, duplicate denial, real domain decision, stale CAS, atomic event, terminal Capsule intent | Yes |
| Approval and grant authority | `runtime-store.test.mjs:137–171` | Approval binding/revocation and time-bounded active grants | Yes |
| Leases and claims | `runtime-store.test.mjs:173–252` | Exclusive active owner, expiry takeover, fencing increment, owner-only release, one scope claim | Yes |
| Artifact refs and integrity | `runtime-store.test.mjs:254–287` | Append-only refs, FK/uniqueness, `integrity_check`, stable reopen digest | Yes |
| Canonical digest and backup | `runtime-store.test.mjs:290–354` | Insertion-order independence, WAL-complete online copy, byte/state/migration metadata, read-only no-extension inspection | Yes |
| Public error contract | final integration case | All 17 runtime failure codes validate against `public-error@1` | Yes |
| Migration and transaction rollback | `runtime-store-faults.test.mjs:16–67` | Checksum drift, failed DDL rollback, post-event crash rollback, duplicate event rollback | Yes |
| CAS race, busy, corruption | `runtime-store-faults.test.mjs:69–105` | Two live connections yield one winner; exclusive lock and corrupt bytes map to stable recoverable errors | Yes |
| Backup failures and concurrent write | `runtime-store-faults.test.mjs:107–179` | Validation/publication failures preserve active state; manifest remains bound to staging snapshot during active mutation | Yes |
| Invalid state/claim/failed-CAS recovery | `runtime-store-faults.test.mjs:140–220` | Malformed transition/state, wrong claim owner, close/reopen after conflict preserve authority and digest | Yes |

## Check B — Non-shallow

Tests execute the real qualified Node 24.14.0 SQLite 3.51.2 engine against file databases. Two independent live connections exercise CAS races and a third connection holds a real exclusive lock. Fault hooks fire inside the transition transaction and between backup staging/validation/publication boundaries. Assertions inspect projection rows, journal cardinality, authority ownership, fencing tokens, canonical state digests, backup bytes, migration ledgers, and post-reopen authority.

The backup manifest derives its state digest from the staged copy, never from the mutable active database. A dedicated fault case mutates the active database during staging validation and proves the manifest equals the copied database while differing from the newer active state.

## Check C — Necessary reverse mapping

| Test group | Maps to | Keep |
| --- | --- | --- |
| Isolated local runtime, migrations, integrity/backup | VES-BST-004…005 | Yes |
| Approval binding/revocation and CAS invalidation support | VES-EXE-003 | Yes |
| Fenced lease and expiring Work Claim | VES-EXE-004…005 | Yes |
| Terminal projection + Capsule sealing intent | VES-RLS-005 | Yes |

## Check D — Guidelines

Tests were authored before implementation. The store is an outer `platform-node` adapter using only `node:sqlite`; domain decisions remain pure. Raw forward migrations are immutable and checksummed. In-place downgrade is deliberately prohibited: older releases must restore a verified compatible backup. All writes use bound parameters. Extension loading is disabled. The schema contains logical references and authority metadata, never credential values, transcripts, or unrestricted evidence content. `gate:full` now includes fault injection so its PASS cannot omit rollback, lock, corruption, or backup-publication behavior.

## Adequacy verdict

PASS — 40 focused integration/fault cases exceed the ≥35 threshold, exercise real SQLite and real concurrency/failure boundaries, reverse-map to every T15 requirement, and the complete `gate:full` passed.
