# Validation T7 — the runtime store returns declared records (ADR2-7)

Requirement ADR2-7: the runtime store SHALL return declared records, the lease
adapter SHALL earn its place or go, and a public method with only test callers
SHALL be justified or removed.

The work is three contiguous commit ranges on `refactor/runtime-store-records`,
one pull request each. Every range keeps sealed bytes, stored bytes, the
schema, the twelve migrations and their order, the nineteen runtime error
codes, `STATE_TABLE_ORDER`, and the backup, integrity and downgrade-refusal
behaviour.

## Range 1 — declared records

### Before

Seven reads returned a record of no declared shape
(`getMachineProfile`, `listMachineProfiles`, `getSyncState`,
`getActivePolicyView`, `listEvents`, `getRunCapsuleSeal`, and
`loadAuthorityApproval`/`loadAuthorityGrant` through one private helper).
Six callers cast what came back: the policy, sync and authority adapters
(the authority adapter twice), `task review` (the terminal event) and
`task status` (the seal, read by key). The policy, sync and authority
records are text an adapter encodes; the store parsed it on read, and for
the policy view also verified a digest defined by the view's own encoding.

### What changed

| Read | Declared record | Who decodes | Caller change |
| --- | --- | --- | --- |
| `listEvents` | `RunEvent` (`packages/platform-node/src/runtime-store/runtime-store.ts:174`), every member a NOT NULL column of a STRICT table | the store (`:656`) | `apps/vestra-cli/src/task/task-review.ts:94-97` reads members, no cast |
| `getRunCapsuleSeal` | `RunCapsuleSeal` (`runtime-store.ts:188`), also the input of `recordRunCapsuleSeal` (`:715`) | the store (`:768`) | `apps/vestra-cli/src/task/task-status.ts:116` reads `.capsuleId`, no key access |
| `loadAuthorityApproval`, `loadAuthorityGrant` | `StoredAuthorityRecord` (`runtime-store.ts:200`): the text and its revocation | `decodeAuthorityRecord` (`packages/platform-node/src/authority-store-adapter.ts:47`) | no cast (`:86`, `:107`) |
| `getActivePolicyView` | `StoredPolicyView` (`runtime-store.ts:209`): the text and the digest it was activated under | `decodePolicyView` (`packages/platform-node/src/policy-store-adapter.ts:25`) | no cast (`:46`) |
| `getSyncState` | `StoredSyncState` (`runtime-store.ts:216`): the text and the digest `saveSyncState` bound it to | `decodeSyncState` (`packages/platform-node/src/sync-adapters.ts:32`) | no cast (`:53`) |

`getMachineProfile` and `listMachineProfiles` have only test callers and no
caller that casts in product code; range 3 decides their fate.

The rule (proposed as a decision in `.specs/STATE.md`, "A runtime store read
returns a declared record…"): a record the store owns column by column is
declared by the store; a record an adapter encodes comes back as the stored
text plus the columns the store bound it to, and the adapter that encodes it
decodes it. The store keeps the integrity it can prove without the encoding
(the authority record digest, `runtime-store.ts:866-887`). Writes are
unchanged: the policy and sync writes still parse the text they are given to
check it binds to its columns.

Each decoder narrows `unknown` with a type predicate that checks what the
store bound the text to; no `as` cast of a store record remains in the three
adapters or the two commands.

### Behaviour

| Outcome | Assertion |
| --- | --- |
| A journal event is the declared record of its row, value and type | `tests/integration/runtime-store-records.test.mjs:20-35` |
| The terminal event the Run Capsule seals keeps its bytes (digest recorded from origin/main) | `runtime-store-records.test.mjs:13`, `:36` |
| A Run Capsule seal reads back as the record it was recorded from | `runtime-store-records.test.mjs:51-53` |
| An authority record reads back as the text the store was given, with its revocation | `runtime-store-records.test.mjs:70-76` |
| An active policy view reads back as the text and its digest | `runtime-store-records.test.mjs:84-89` |
| A sync state reads back through the adapter as the state saved, frozen | `tests/integration/sync-state-runtime.test.mjs:40-42` |
| Authority text that is not JSON is still VES_RUNTIME_CORRUPT with the old message | `tests/integration/authority-runtime.test.mjs:239-242` |
| **New:** an authority record filed under another identity is VES_RUNTIME_CORRUPT | `authority-runtime.test.mjs:264-266` |
| A policy view whose digest member or content was edited is VES_RUNTIME_CORRUPT | `tests/integration/policy-activation-runtime.test.mjs:110`, `:133-163` |
| **New:** policy view text that is not JSON is VES_RUNTIME_CORRUPT (was a SyntaxError) | `policy-activation-runtime.test.mjs:126` |
| **New:** a sync state rewritten with the digest of its own content is VES_RUNTIME_CORRUPT (was reconciled) | `sync-state-runtime.test.mjs:62-66` |
| **New:** sync state text that is not JSON is VES_RUNTIME_CORRUPT (was a SyntaxError) | `sync-state-runtime.test.mjs:78-82` |
| The sync Workspace check and content check keep their code (VES_SYNC_STATE_INVALID) | `tests/integration/workspace-reconcile.test.mjs:320-331`, unchanged |

`task review` now refuses a run whose journal holds no transition
(`task-review.ts:97`, VES_TASK_STATE_MALFORMED) instead of reading a member of
`undefined`. The review seals after its own terminal transition, which the
store journals in the same transaction as the state, so the refusal guards an
invariant. The in-process task fixture cannot reach it (sealing reads a
credential first), so it has no test; the e2e journey covers the sealing path.

### Changed cases → replacement

| Case (file at origin/main) | Property | Now |
| --- | --- | --- |
| `policy-activation-runtime.test.mjs:94` read `runtime.getActivePolicyView(...).generation` | the CAS winner is the active view | same line, read through `RuntimePolicyViewStore.load()` |
| `policy-activation-runtime.test.mjs:110` expected `runtime.getActivePolicyView` to throw | a tampered view fails closed | same line, `load()` rejects; the verification lives in the adapter |
| `tests/e2e/workspace-reconcile-e2e.test.mjs:55`, `:90` read `runtime.getSyncState(...)` | the stored topology and projection survive restart | same lines, read through `RuntimeSyncStateStore.load()` |

No test was deleted or weakened in range 1. The migration, checkpoint, fault
and qualification suites are not in the range's diff.

### Discrimination

Each mutant was applied to one file and the file restored byte-for-byte
afterwards (SHA-256 compared):

- `listEvents` returning `sequence` as a string fails the golden case;
- the authority decoder without the identity check fails the identity case;
- the policy decoder without the content digest, and separately without the
  member check, each fail one of the two edit cases (before
  the commit that added the two edit cases, both mutants passed: the only tamper case broke both halves);
- the sync decoder without the digest binding fails the self-consistent
  forgery case.

### Complexity and census

- Complexity: no key moved and no value changed; 177 keys (178 before the
  rebase onto origin/main, which ratcheted one out).
- Census (`pnpm census:refresh`, `pnpm test:census` 13 pass):
  `packages/platform-node/src/policy-store-adapter.ts` canonicalizer 0 → 2,
  digest 0 → 2 (it now verifies the content digest); its classification stays
  `retained-v1-versioned` and its reason names the verification.
  `packages/platform-node/src/runtime-store/runtime-store.ts` canonicalizer
  4 → 3. No other row changed.

### The split by aggregate

Not taken. The casts are gone without it. What it would add is moving the
remaining statements (the policy and sync writes, which still parse the text)
into their adapters. The policy and sync adapters have no production
composition today, and `tests/integration/runtime-store.test.mjs`,
`tests/fault-injection/runtime-store-faults.test.mjs` and the migration tests
call the store's statements directly; the split would rewrite them for no
caller in the product.

### Citations fixed

- `.specs/features/architecture-deepening/validation-c6.md`: `runtime-store.ts:1053-1059` is now `:1096-1102`.
- `.specs/features/architecture-deepening/validation-c5.md`: `task-review.ts:172-198` and `:265` are now `:174-200` and `:267`.
- `.specs/features/architecture-deepening-2/validation-t8.md`: `authority-store-adapter.ts:27` is now `:28`.

Not rewritten: `docs/qualification/t15-validation.md`, `t21`, `t22`, `t24`,
`t25`, `t26` (point-in-time qualification records). The appended tests sit
after every line they cite.

### Gates (range 1, last commit, on origin/main 6fae651)

| Command | Result |
| --- | --- |
| `pnpm gate:quick` (every commit) | PASS — 2617 unit, 331 agent-readiness, 13 census; complexity PASS with 177 keys |
| `pnpm test:architecture` (every commit) | PASS — 111 |
| `pnpm gate:build` | PASS — 2617 unit, 797 contract, 1106 integration, 275 e2e, 111 architecture, 172 build, 337 qualification; 0 skipped |
| `pnpm gate:security` | PASS — 1324 security, 310 fault, plus the shared stages; 0 skipped |
| `pnpm test:fault` | PASS — 310 |
| `node --test tests/integration/runtime-store.test.mjs tests/integration/runtime-checkpoint-store.test.mjs tests/fault-injection/runtime-store-faults.test.mjs` | PASS — 53 (unchanged files) |
| `node --test tests/e2e/task-cli-e2e.test.mjs` | PASS — 43, 0 skipped |
| `pnpm agent:check` | PASS |

Local evidence is macOS only; the platform matrix run before merge is the
coordinator's.

## Range 2 — the lease adapter

### The deletion test

`RuntimeLocalLease` (`packages/platform-node/src/coordination-adapters.ts` at
origin/main) forwarded `acquire` and `release` to the store's `acquireLease`
and `releaseLease` with the same arguments, the same result and the same
errors. It added no translation, no state and no error mapping.

- **Not a seam where the product used it.** Both production callers
  constructed it in place (`task run`, `apps/vestra-cli/src/task/task-run.ts`
  constructor; the idle cancel in `apps/vestra-cli/src/task/task-status.ts`),
  so nothing could substitute it.
- **The real seam is `LocalLeasePort`**
  (`packages/application/src/coordination/work-claims.ts:54`), read by
  `WorkClaimService` (`:164`). It has two adapters, both in tests: the
  in-memory `MemoryLeasePort` and the SQLite one. `WorkClaimService` has no
  production composition.

Verdict: the deletion test passes, so the class is deleted. The commands call
the store's lease pair (`task-run.ts:265`, `:276`, `:283`;
`task-status.ts:171`). The one case that composes `WorkClaimService` over the
SQLite lease binds the store's lease pair to the port in the coordination
fixture (`tests/helpers/coordination-fixture.mjs:39`), used at
`tests/integration/coordination-service.test.mjs:205` and `:217`. The
forwarding reappears in that one test helper only, which is what the deletion
test calls a pass-through.

### Behaviour

| Outcome | Assertion |
| --- | --- |
| Personal mode still enforces one writer across a SQLite restart through `LocalLeasePort` | `tests/integration/coordination-service.test.mjs:202-231` (same case; it fails when the fixture's `acquire` stops reaching the store) |
| **New coverage:** an idle cancel releases its run's writer lease and leaves another run's | `tests/integration/task-cancel-lease.test.mjs:39`, `:41`. Before this range no test reached that release: removing it left every suite green |
| The task run's acquire, verify and release go through the store's lease pair | `tests/e2e/task-cli-e2e.test.mjs` (43 pass); the arguments are unchanged and `pnpm typecheck` binds them to `acquireLease` |

No error code, message or stored byte changes. No test was deleted; the
coordination case changed only how it builds the port.

`tests/architecture/platform-node-readonly-subpath.test.mjs:26` still lists
`RuntimeLocalLease` among the symbols the read-only subpath must not export.
The list is a denylist, so a name that no longer exists weakens nothing and
still refuses its return; it is left as it is.

### Complexity and census

No complexity key moved. `coordination-adapters.ts` carried no census signal;
the census is unchanged.

### Citations fixed

- `.specs/features/architecture-deepening-2/validation-t1.md`: `task-run.ts:334` is now `:331`.
- `.specs/features/architecture-deepening/validation-c6.md`: `task-run.ts:332` is now `:329`.
- `.specs/features/live-task-pilot/validation.md`: `task-run.ts:52`, `:566-567`, `:355`, `:602-604` are now `:51`, `:563-564`, `:352`, `:599-601`.

Not rewritten: `docs/qualification/t26-validation.md` cites
`coordination-service.test.mjs` by line; the import of the fixture port moves
its cases by five lines. It is a point-in-time qualification record.
`.specs/features/architecture-deepening/validation-c6.md:20` names
`RuntimeLocalLease` as it stood then.

### Gates (range 2, last commit, on origin/main 6fae651)

| Command | Result |
| --- | --- |
| `pnpm gate:quick` (every commit) | PASS — 2617 unit, 331 agent-readiness, 13 census; complexity PASS with 177 keys |
| `pnpm test:architecture` (every commit) | PASS — 111 |
| `pnpm gate:build` | PASS — 2617 unit, 797 contract, 1108 integration, 275 e2e, 111 architecture, 172 build, 337 qualification; 0 skipped |
| `pnpm gate:security` | PASS — 1324 security, 310 fault, plus the shared stages; 0 skipped |
| `pnpm test:fault` | PASS — 310 |
| `node --test tests/integration/runtime-store.test.mjs tests/integration/runtime-checkpoint-store.test.mjs tests/fault-injection/runtime-store-faults.test.mjs` | PASS — 53 (unchanged files) |
| `node --test tests/e2e/task-cli-e2e.test.mjs` | PASS — 43, 0 skipped |
| `pnpm agent:check` | PASS |

## Range 3 — methods with only test callers

### Callers

The store had 33 public methods at origin/main, and ranges 1 and 2 removed
none of them. Seven had no caller outside tests: the six the review listed
(`downgradeTo`, `safetySettings`, `getMachineProfile`, `listMachineProfiles`,
`integrityCheck`, `backupTo`) and `stateDigest`, which the review did not
list. `RuntimeStore` is not a `SnapshotSource` (it has no `sourceId` or
`snapshot`), and nothing in `apps` or `packages` calls its `stateDigest`.
`migrationLedger` is called only by `backupTo` and by tests. Range 3 removes
three methods, so the store now has 30.

### Fate of each method

| Method | Fate | Why |
| --- | --- | --- |
| `getMachineProfile`, `listMachineProfiles` | **removed** | The product writes a Machine Profile and never reads it back: `MachineProfileStorePort` declares only `save`. They also returned records of no declared shape |
| `integrityCheck` | **removed** | The product checks runtime integrity through `inspectRuntimeDatabase` (the doctor, and the backup's staged copy), which already proves the same case on an open store's database |
| `downgradeTo` | **kept**, comment at `packages/platform-node/src/runtime-store/runtime-store.ts:1098-1107`, shared with `backupTo` (it sits outside the block SonarCloud counts as duplicated with `memory-store.ts`) | The first round's approved plan keeps the downgrade refusal as a method, and it is the only thrower of VES_RUNTIME_DOWNGRADE_UNSUPPORTED; removing it would leave that code catalogued with nothing that can raise it. A downgrade the product meets is refused by `open()` (VES_RUNTIME_MIGRATION_INCOMPATIBLE), which had no test and now has one |
| `backupTo` | **kept**, comment at `runtime-store.ts:1098-1107` | The only producer of a verified backup, the recovery the catalog prescribes for VES_RUNTIME_CORRUPT and VES_RUNTIME_CHECKPOINT_CORRUPT, which the task commands raise. No command composes it yet |
| `migrationLedger` | **kept**, comment at `runtime-store.ts:1098-1107`, shared with `backupTo` | What the backup manifest carries |
| `stateDigest` | **kept**, comment at `runtime-store.ts:1090-1093` | The live side of the digest the backup manifest binds, and the only whole-state observation; the fault suite proves through it that a refused or failed write changes nothing |
| `safetySettings` | **kept**, comment at `runtime-store.ts:322-325` | The only observation of the per-connection settings `open()` applies; nothing outside the connection can read its busy timeout or writable_schema. Removing it would delete the T15 proof of both, which is weakening a proof, not removing a behaviour |

None of the five kept methods has a production caller. Each comment says so
and names what needs it.

### Deleted case → replacement

| Deleted or changed case (file at origin/main) | Property | Replacement |
| --- | --- | --- |
| `tests/integration/runtime-store.test.mjs:202` "integrity check reports ok on active database" (deleted with `integrityCheck`) | `PRAGMA integrity_check` reports ok on an open store's database | Already proven through the product's path: `runtime-store.test.mjs:260-268` (`inspectRuntimeDatabase` on the open store's file, integrity `ok`) and `:270-284` (integrity `ok` after refused writes). The corrupt case stays at `tests/fault-injection/runtime-store-faults.test.mjs:99-105` |
| `tests/e2e/machine-bootstrap-e2e.test.mjs:59`, `:71`, `:82` (changed) | The stored profile holds the discovered Drivers; one row per Workspace | Same cases, reading the stored rows: `:60`, `:72-73`, `:84`, through `storedMachineProfiles` (`tests/helpers/runtime-store-fixture.mjs:73`) |
| `tests/security/machine-bootstrap-security.test.mjs:80` (changed) | A rejected profile writes nothing | `:80`, strengthened: no row at all, not only none for the Workspace |
| `machine-bootstrap-security.test.mjs:105`, `:164` (changed) | The stored profile is in canonical member order; it holds no credential, session or local selection | Same lines, reading the stored row |

**New case:** "an older build refuses a database a newer build migrated, and
changes nothing" (`runtime-store.test.mjs:309-324`), appended so the lines
other records cite do not move. A build missing the last migration is refused
with VES_RUNTIME_MIGRATION_INCOMPATIBLE (`:316`), and the database then opens
with nothing pending (`:318`) and its full ledger (`:319-322`). The case for
`downgradeTo` itself ("runtime store refuses automatic downgrade", `:62-66`)
is unchanged.

The fault, checkpoint, migration and qualification suites are not in the diff
of any range. `runtime-store.test.mjs` changes only where a case exercised a
removed method, and by the appended case.

### Discrimination

Applied to one file each and restored byte-for-byte (SHA-256 compared):

- removing the incompatible-migration check from `#migrate` fails the new
  case on open;
- an adapter that stores a profile with a `sessionToken` member fails three
  security cases through the stored rows;
- an adapter that stores a profile without Drivers fails two e2e cases
  through the stored rows.

### Catalog and constraints

- The catalog stays at 19 codes (`runtime-store.test.mjs:287`), and
  `VES_RUNTIME_DOWNGRADE_UNSUPPORTED` keeps its thrower.
- Migrations (12), their order and checksums, the schema, `STATE_TABLE_ORDER`,
  the backup, the integrity checks and the downgrade behaviour are unchanged.

### Complexity and census

No complexity key moved; 177 keys. No file gained or lost `JSON.stringify` or
`createHash`; `pnpm census:refresh` leaves the inventory unchanged.

### Citations fixed

- `.specs/features/architecture-deepening/validation-c6.md`:
  `runtime-store.test.mjs:293`, `:219-244` (`:231-235`, `:240-241`) and
  `:276-290` (`:280-285`, `:286-287`) are now `:287`, `:213-238`
  (`:225-229`, `:234-235`) and `:270-284` (`:274-279`, `:280-281`);
  `runtime-store.ts:1096-1102` (after range 1) is now `:1082-1088` (`:1088-1094` until two comments moved out of the block SonarCloud counts as duplicated).
- `.specs/features/governed-task-cli/validation.md:21`: `runtime-store.test.mjs:293` is now `:287`.
- This file's range 1 citations of `runtime-store.ts` follow the code.

Not rewritten: `docs/qualification/t15-validation.md` and
`t21-validation.md` (point-in-time qualification records; `t15` cites the
deleted integrity case).

### Gates (range 3, last commit, on origin/main 6fae651)

| Command | Result |
| --- | --- |
| `pnpm gate:quick` | PASS — 2617 unit, 331 agent-readiness, 13 census; complexity PASS with 177 keys |
| `pnpm test:architecture` | PASS — 111 |
| `node --test tests/integration/runtime-store.test.mjs tests/integration/runtime-checkpoint-store.test.mjs tests/fault-injection/runtime-store-faults.test.mjs` | PASS — 53 (the integrity case deleted, the case on open added) |
| `pnpm gate:security` | PASS — 1324 security, 310 fault, 797 contract, 275 e2e, 337 qualification, plus the shared stages; 0 skipped |
| `pnpm agent:check` | PASS |

`pnpm gate:build` (1107 integration, 172 build, 0 skipped), `pnpm test:fault`
(310) and `node --test tests/e2e/task-cli-e2e.test.mjs` (43) passed on the
earlier range 3, which also removed `downgradeTo`; restoring it adds back the
method and its unchanged case.

## Open decisions for the owner

1. Five store methods stay without a production caller (`downgradeTo`,
   `backupTo`, `migrationLedger`, `stateDigest`, `safetySettings`). The
   product tells the operator to recover from a verified backup and offers no
   command that makes one.
2. `WorkClaimService` has no production composition, so `LocalLeasePort` is a
   seam only tests cross.
3. The policy and sync writes still parse the text they are given. Moving
   their statements into the adapters is the deferred split by aggregate.
