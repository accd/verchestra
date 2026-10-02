# Validation C6 — runtime store (ADP-6)

Requirement ADP-6: the nine legacy runtime store methods with no production
caller are removed with their proofs re-homed, and the effect repository lives
in its own file. No schema change.

This file covers two commits on `refactor/runtime-store-legacy-and-effects`:
T6a (legacy methods removed) and T6b (effect repository in its own file).

## T6a — legacy methods removed

### What was removed

`RuntimeStore` in `packages/platform-node/src/runtime-store/runtime-store.ts`
loses `putApproval`, `getApproval`, `revokeApproval`, `putGrant`,
`listActiveGrants`, `acquireClaim`, `releaseClaim`, `putArtifactRef` and
`listArtifactRefs`. None had a production caller, an adapter or a port. The
durable authority path (`saveAuthorityApproval`, `loadAuthorityApproval`,
`revokeAuthorityApproval` and the grant equivalents, reached through
`RuntimeAuthorityStore`) and the lease pair behind `RuntimeLocalLease` are
untouched.

### What was kept on purpose

- No schema change. Migration `001_runtime` still creates `approvals`,
  `grants`, `claims` and `artifact_refs`; its text and checksum are unchanged.
- `STATE_TABLE_ORDER` still lists the four tables, so `stateDigest()` keeps
  covering rows an older build left there
  (`packages/platform-node/src/runtime-store/runtime-store.ts:156-181`).
- The migration count stays 12 (`tests/integration/runtime-store.test.mjs:46-50`).
- The runtime error catalog stays 19 (`tests/integration/runtime-store.test.mjs:293`).
  `VES_RUNTIME_CLAIM_CONFLICT` and `VES_RUNTIME_CLAIM_OWNER_MISMATCH` no longer
  have a thrower in the repository. They stay in
  `packages/platform-node/src/runtime-store/runtime-errors.ts:45-51` because
  removing them changes the pinned catalog count; that is an open decision for
  the owner, not something this change takes.

### Deleted case → replacement

| Deleted or changed case (file at `origin/main`) | Property | Replacement |
| --- | --- | --- |
| `runtime-store.test.mjs:140` "approval repository round-trips and revokes authority" (deleted) | An approval round-trips through the store and its revocation is durable | Already proven at the durable interface: `tests/integration/authority-runtime.test.mjs:41-69` (round trip across restart) and `:71-83` (revocation persists across restart) |
| `runtime-store.test.mjs:158` "grant repository returns only active grants" (deleted) | A grant is usable only inside its validity window | New: `tests/integration/authority-runtime.test.mjs:184-207`. A persisted grant invokes at 12:30 (`:201`) and is refused with `VES_CAPABILITY_EXPIRED` at 14:00 without running the operation (`:203-204`). This was the only proof of the window in the repository; `CapabilityBroker.invoke` had no expiry test before |
| `runtime-store.test.mjs:237` "work claim enforces one active owner per scope" (deleted) | One active owner per scope in the local `claims` table | The behaviour is removed with `acquireClaim`. What survives is the schema uniqueness, proven with rows written directly at `tests/integration/claim-digest-reencoding-migration.test.mjs:110-124`. The one-active-owner rule for the surviving lease is at `tests/integration/runtime-store.test.mjs:152-164` |
| `runtime-store.test.mjs:256` "artifact refs are append-only and ordered" (deleted) | A duplicate reference id is rejected as `VES_RUNTIME_CONSTRAINT` | The behaviour is removed with `putArtifactRef` and `listArtifactRefs`. The mapping from a primary-key violation to `VES_RUNTIME_CONSTRAINT` stays proven at `tests/integration/runtime-store.test.mjs:75-81` and `tests/integration/authority-runtime.test.mjs:112-120` |
| `runtime-store.test.mjs:300` "canonical runtime digest is independent of authority insertion order" (re-homed) | `stateDigest()` does not depend on insertion order | Same title, now on `saveAuthorityApproval` and `saveAuthorityGrant`: `tests/integration/runtime-store.test.mjs:219-244`. Strengthened: two tables instead of one (`:231-235`), and the digest is shown to still discriminate content (`:240-241`) |
| `runtime-store.test.mjs:359` "foreign-key enforcement rejects orphan authority records" (re-homed) | A record bound to a missing run is rejected and nothing is written | Same title, now on `saveAuthorityApproval` and `saveAuthorityGrant`: `tests/integration/runtime-store.test.mjs:276-290`. Strengthened: both tables (`:280-285`) and absence of the rows (`:286-287`) |
| `claim-digest-reencoding-migration.test.mjs:59` "a claim written before the re-encoding does not outlive it" (re-homed) | Migration `008_claim_digest_reencoding` discards stale claims | Same title, rows written directly: `tests/integration/claim-digest-reencoding-migration.test.mjs:79-108`. The row exists before the upgrade (`:84-87`), exactly one migration is pending (`:92`), the row is gone (`:93-96`) and the same scope can be taken again (`:103-107`) |
| `claim-digest-reencoding-migration.test.mjs:78` "discarding stale claims does not weaken exclusivity itself" (re-homed) | The migration leaves the `(workspace_id, scope_digest)` uniqueness in place | Retitled "…does not weaken the scope uniqueness the table enforces": `tests/integration/claim-digest-reencoding-migration.test.mjs:110-124` |
| `claim-digest-reencoding-migration.test.mjs:89` "the migration runs once, not on every open" (re-homed) | A claim written after the upgrade survives a reopen | Same title, rows written directly: `tests/integration/claim-digest-reencoding-migration.test.mjs:126-140` |
| `runtime-store-faults.test.mjs:182` "claim release by wrong owner leaves claim active" (replaced) | A release by the wrong owner changes nothing | The behaviour is removed with `releaseClaim`. Replaced by the same case on the surviving lease: `tests/fault-injection/runtime-store-faults.test.mjs:182-200`. The wrong owner is refused (`:192`), still cannot acquire (`:195`), and the owner's fenced renewal keeps its token (`:198`) |

The claim migration tests proved the migration, not the legacy method: the
method was only the way they wrote a row. They now write that row with
`node:sqlite` directly, so the migration proof no longer depends on a writer
the product does not have.

### Discrimination

Both re-homed proofs were checked against a mutated store and restored
byte-for-byte afterwards (file hash compared):

- ordering `authority_grants` by `rowid` instead of `grant_id` fails the
  insertion-order case;
- opening with `PRAGMA foreign_keys=OFF` fails the foreign-key case.

### Citations fixed

- `.specs/features/governed-task-cli/validation.md:21` now cites
  `runtime-store.test.mjs:46-50` and `:293`.
- `.specs/features/deep-doctor-live-probes/design.md:90` and `handoff.md:671`
  now cite `runtime-store.ts:212` for `inspectRuntimeDatabase` (the old `:472`
  was already stale).

Not changed: `docs/qualification/t15-validation.md` and
`docs/qualification/t25-validation.md`. They are point-in-time qualification
records. The new authority test was appended at the end of its file so the
ranges `t25-validation.md` cites do not move. `t15-validation.md` rows
"Approval and grant authority", "Leases and claims", "Artifact refs and
integrity" and "Invalid state/claim/failed-CAS recovery" cite cases this change
deletes or replaces; whether to annotate that record is an open decision for
the owner.

### Gates (T6a)

| Command | Result |
| --- | --- |
| `pnpm gate:quick` | PASS — 2330 unit, 315 agent-readiness, 13 census; complexity PASS with 179 keys |
| `pnpm test:architecture` | PASS — 61 |
| `pnpm test:integration` | PASS — 767 |
| `pnpm test:fault` | PASS — 310 |
