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
| `listEvents` | `RunEvent` (`packages/platform-node/src/runtime-store/runtime-store.ts:174`), every member a NOT NULL column of a STRICT table | the store (`:664`) | `apps/vestra-cli/src/task/task-review.ts:84-87` reads members, no cast |
| `getRunCapsuleSeal` | `RunCapsuleSeal` (`runtime-store.ts:188`), also the input of `recordRunCapsuleSeal` (`:723`) | the store (`:776`) | `apps/vestra-cli/src/task/task-status.ts:90` reads `.capsuleId`, no key access |
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
(the authority record digest, `runtime-store.ts:874-895`). Writes are
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
(`task-review.ts:87`, VES_TASK_STATE_MALFORMED) instead of reading a member of
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
  `2a5eb81`, both mutants passed: the only tamper case broke both halves);
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
