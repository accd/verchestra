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
  (`packages/platform-node/src/runtime-store/runtime-store.ts:92-117`).
- The migration count stays 12 (`tests/integration/runtime-store.test.mjs:46-50`).
- The runtime error catalog stays 19 (`tests/integration/runtime-store.test.mjs:287`).
  `VES_RUNTIME_CLAIM_CONFLICT` and `VES_RUNTIME_CLAIM_OWNER_MISMATCH` no longer
  have a thrower in the repository. They stay in
  `packages/platform-node/src/runtime-store/runtime-errors.ts:45-51` because
  removing them changes the pinned catalog count; that is an open decision for
  the owner, not something this change takes.

### Deleted case → replacement

| Deleted or changed case (file at `origin/main`) | Property | Replacement |
| --- | --- | --- |
| `runtime-store.test.mjs:140` "approval repository round-trips and revokes authority" (deleted) | An approval round-trips through the store and its revocation is durable | Already proven at the durable interface: `tests/integration/authority-runtime.test.mjs:49-77` (round trip across restart) and `:79-91` (revocation persists across restart) |
| `runtime-store.test.mjs:158` "grant repository returns only active grants" (deleted) | A grant is usable only inside its validity window | New: `tests/integration/authority-runtime.test.mjs:192-215`. A persisted grant invokes at 12:30 (`:209`) and is refused with `VES_CAPABILITY_EXPIRED` at 14:00 without running the operation (`:211-212`). This was the only proof of the window in the repository; `CapabilityBroker.invoke` had no expiry test before |
| `runtime-store.test.mjs:237` "work claim enforces one active owner per scope" (deleted) | One active owner per scope in the local `claims` table | The behaviour is removed with `acquireClaim`. What survives is the schema uniqueness, proven with rows written directly at `tests/integration/claim-digest-reencoding-migration.test.mjs:110-124`. The one-active-owner rule for the surviving lease is at `tests/integration/runtime-store.test.mjs:152-164` |
| `runtime-store.test.mjs:256` "artifact refs are append-only and ordered" (deleted) | A duplicate reference id is rejected as `VES_RUNTIME_CONSTRAINT` | The behaviour is removed with `putArtifactRef` and `listArtifactRefs`. The mapping from a primary-key violation to `VES_RUNTIME_CONSTRAINT` stays proven at `tests/integration/runtime-store.test.mjs:75-81` and `tests/integration/authority-runtime.test.mjs:120-128` |
| `runtime-store.test.mjs:300` "canonical runtime digest is independent of authority insertion order" (re-homed) | `stateDigest()` does not depend on insertion order | Same title, now on `saveAuthorityApproval` and `saveAuthorityGrant`: `tests/integration/runtime-store.test.mjs:213-238`. Strengthened: two tables instead of one (`:225-229`), and the digest is shown to still discriminate content (`:234-235`) |
| `runtime-store.test.mjs:359` "foreign-key enforcement rejects orphan authority records" (re-homed) | A record bound to a missing run is rejected and nothing is written | Same title, now on `saveAuthorityApproval` and `saveAuthorityGrant`: `tests/integration/runtime-store.test.mjs:270-284`. Strengthened: both tables (`:274-279`) and absence of the rows (`:280-281`) |
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
  now cite `runtime-store.ts:148` for `inspectRuntimeDatabase` (the old `:472`
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

## T6b — effect repository in its own file

### What moved

- `packages/platform-node/src/runtime-store/effect-repository.ts` (new) holds
  the durable effect intents, outbox, receipts and inbox behind
  `createSqliteEffectRepository` (`:69`). Its only value import is
  `./runtime-sqlite.ts`; `node:sqlite` and `@verchestra/application` are
  imported as types.
- `packages/platform-node/src/runtime-store/runtime-sqlite.ts` (new) holds the
  failure mapping and statement helper both modules use (`runtimeError`,
  `errorCode`, `mapSqliteError`, `runStatement`), moved unchanged from
  `runtime-store.ts`. Without it the effect repository would have to import the
  store, which loads SQLite and would close an import cycle.
- `RuntimeStore.createEffectRepository`
  (`packages/platform-node/src/runtime-store/runtime-store.ts:1082-1088`)
  delegates with the same three closures the inline version used: the database
  accessor (resolved on every use, so a closed store still fails with
  `VES_RUNTIME_CLOSED`), the clock, and the store's hooks object, from which
  `afterEffectStart`, `beforeEffectComplete` and `afterEffectComplete` are read
  at call time as before.
- The public surface is unchanged: `apps/vestra-cli/src/task/task-run.ts:383`,
  the Self-Test scenario and every test still call
  `RuntimeStore.createEffectRepository()`. Nothing new is exported from
  `packages/platform-node/src/index.ts`.

One deliberate difference from a verbatim move: the three writers that shared
the same failure tail (roll back, pass a `VES_` error through, map anything
else) now call `rolledBack` (`effect-repository.ts:64-67`). The thrown value is
the same object in every case.

### Evidence

| Outcome | Assertion |
| --- | --- |
| The effect repository imports `node:sqlite` as a type only, and never the runtime store | `tests/architecture/runtime-store-effect-repository.test.mjs:33-37` |
| The shared failure mapping imports `node:sqlite` as a type only | `tests/architecture/runtime-store-effect-repository.test.mjs:38` |
| Neither module loads another module dynamically | `tests/architecture/runtime-store-effect-repository.test.mjs:39-41` |
| Loading the effect repository does not load SQLite; the control (loading the store) does | `tests/architecture/runtime-store-effect-repository.test.mjs:45`, `:47` |
| The store delegates with the same closures and carries no effect statement | `tests/architecture/runtime-store-effect-repository.test.mjs:52-59` |
| The three fault hooks still fire at the same points | `tests/fault-injection/effect-kernel-faults.test.mjs:21`, `:44`, `:67` (unchanged cases, still passing) |
| The shared failure tail still rolls back | Removing the rollback from `rolledBack` fails "crash before receipt commit reconciles remote applied state exactly once" in `tests/fault-injection/effect-kernel-faults.test.mjs`; restored byte-for-byte afterwards |
| Durable effect behaviour is unchanged | `tests/integration/effect-kernel.test.mjs`, `tests/integration/worktree-tool-adapter.test.mjs`, `tests/security/worktree-tool-security.test.mjs` pass unchanged |
| The sealed bundle keeps `node:sqlite` lazy | `tests/build/sealed-launcher-closure.test.mjs:463` passes unchanged |
| The secrets closure and the read-only surface are unchanged | `tests/architecture/platform-node-secrets-subpath.test.mjs`, `tests/architecture/platform-node-readonly-subpath.test.mjs` and `tests/architecture/doctor-readonly-graph.test.mjs` pass unchanged |

No test was deleted or weakened in T6b.

### Complexity

- Old key: `packages/platform-node/src/runtime-store/runtime-store.ts :: Async method 'complete'`, value 12.
- New key: none. The same function is now
  `packages/platform-node/src/runtime-store/effect-repository.ts :: Async method 'complete'`
  and measures 9, under the target of 10, so `pnpm complexity:update` ratchets
  the entry out. The baseline goes from 179 keys to 178. No other entry
  changed.

### Census

`pnpm census:refresh` then `pnpm test:census` (13 pass):

- `packages/platform-node/src/runtime-store/runtime-store.ts`: serialization
  7 → 4; canonicalizer 4, digest 2 and localeCompare 0 unchanged;
  classification unchanged.
- `packages/platform-node/src/runtime-store/effect-repository.ts` (new):
  serialization 3, classified `migrated-v2`. The repository stores the
  canonicalization version the application computed and derives no identity of
  its own; `JSON.stringify` compares two receipts in process and stores an
  ordered string array.
- `runtime-sqlite.ts` carries no signal and has no entry.
- The refresh also rewrote two unrelated `\u2014` escapes as literal
  characters; those two lines were restored so unrelated rows keep their
  committed bytes.

### Citations fixed

- `packages/effects/src/effect-kernel.ts:52` names `effect-repository.ts` as
  the home of the outbox ordering it relies on.
- `.specs/features/deep-doctor-live-probes/design.md:90` and `handoff.md:671`
  cite `runtime-store.ts:148`.

### Gates (T6b, final state)

| Command | Result |
| --- | --- |
| `pnpm gate:quick` | PASS — 2330 unit, 315 agent-readiness, 13 census; complexity PASS with 178 keys |
| `pnpm test:architecture` | PASS — 64 |
| `pnpm gate:build` | PASS — 2330 unit, 666 contract, 767 integration, 229 e2e, 64 architecture, 135 build, 272 qualification |
| `pnpm gate:security` | PASS — 1333 security, 310 fault, plus the shared stages |
| `pnpm test:fault` | PASS — 310 |
| `node --test tests/integration/runtime-store.test.mjs tests/integration/runtime-checkpoint-store.test.mjs tests/integration/effect-kernel.test.mjs tests/fault-injection/runtime-store-faults.test.mjs tests/fault-injection/effect-kernel-faults.test.mjs tests/build/sealed-launcher-closure.test.mjs` | PASS — 85 |
| `pnpm agent:check` | PASS |

The first `pnpm gate:build` run reported five failures in the e2e stage
(`tests/e2e/task-cli-e2e.test.mjs`, `tests/e2e/vestra-launcher-activation.test.mjs`)
while the machine was running other gates (load average 18). Both files pass
in isolation (21 of 21), and `pnpm test:e2e`, the second `pnpm gate:build` and
`pnpm gate:security` each passed 229 of 229 on the same tree. The failure did
not reproduce, so it is recorded here as a load-sensitive run and not
attributed to `origin/main`.

## Platform matrix

Local evidence is macOS only. The spec requires every runtime store change to
be proven on the platform matrix before merge; that run is the coordinator's.

## Open decisions for the owner

1. `VES_RUNTIME_CLAIM_CONFLICT` and `VES_RUNTIME_CLAIM_OWNER_MISMATCH` are
   catalogued but no longer thrown. Removing them takes the catalog pin from 19
   to 17.
2. `approvals`, `grants`, `claims` and `artifact_refs` now have no writer.
   Dropping them needs a new migration (the count pin moves) and a decision on
   `stateDigest` coverage.
3. `docs/qualification/t15-validation.md` cites cases this work deleted or
   replaced; it was left as a point-in-time record.
