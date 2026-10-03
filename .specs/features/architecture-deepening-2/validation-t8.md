# Validation T8 — an approval request declares its own ports

Task T8 of the second architecture deepening round, requirement ADR2-8: an
approval request declares the ports it uses, so planning builds no refusing
stub. Source: the architecture review of `main` at `9eb2881`, card 9. Branch
`refactor/approval-request-ports`, based on `refactor/scoped-path-rule`
(`c7755c4`, T1).

## 1. The friction, verified at the base

Every citation of card 9 holds at `c7755c4`:

- A request reads three dependencies: `ApprovalService.request`
  (`packages/application/src/authority/authority.ts:249-266`) reads only
  `#digest`, `#clock` and `#uuid`.
- The module demands five: `AuthorityDependencies` (`authority.ts:136-142`)
  is a six-method store, a digest, a clock, an id source and a sealer, for
  every operation.
- Eight refusing stubs: `requestApproval`
  (`apps/vestra-cli/src/task/task-plan.ts:215-231`) builds six store methods
  and `seal` and `verify` that all reject with "planning never persists
  authority", to call `request` once.
- A seal that throws: `TaskAuthority` (`apps/vestra-cli/src/task/task-authority.ts:68-69`)
  gives every command a `seal` that throws "This command cannot seal
  approvals" unless it was built with a signer, which only `approve` does.
- A verify-only signer (`task-authority.ts:56-58`): see section 3; it does not
  exist for the approval interface.

## 2. What changed

Each approval operation is its own class with its own port interface, the
shape AD-011's verification module took in the first round (C5). The
combined `ApprovalService` class and `AuthorityDependencies` are removed;
nothing forwards to them. Method names stay, so callers and complexity keys
do not move.

| Operation | Class | Port interface | Ports |
| --- | --- | --- | --- |
| `request` | `ApprovalRequester` (`authority.ts:253`, method `:264`) | `ApprovalRequestPorts` (`authority.ts:138`) | `digest`, `clock`, `uuid` |
| `record` | `ApprovalRecorder` (`authority.ts:284`, method `:297`) | `ApprovalRecordPorts` (`authority.ts:144`) | `digest`, `clock`, `artifacts.seal`, `store.saveApproval` |
| `verify` | `ApprovalVerifier` (`authority.ts:325`, method `:338`) | `ApprovalVerificationPorts` (`authority.ts:151`) | `digest`, `clock`, `artifacts.verify`, `store.loadApproval` |
| `revoke` | `ApprovalRevoker` (`authority.ts:388`, method `:397`) | `ApprovalRevocationPorts` (`authority.ts:158`) | `clock`, `store.revokeApproval` |

`AuthorityStorePort` and `ApprovalArtifactPort` stay as the interfaces an
adapter implements (`RuntimeAuthorityStore` implements the store; the
self-test's one sealer is an `ApprovalArtifactPort`); each operation declares
a `Pick` of the members it calls. The capability broker had taken
`Omit<AuthorityDependencies, "artifacts">` and a whole `ApprovalService`; it
now declares `CapabilityBrokerPorts` (`authority.ts:478`): the four store
methods it calls (`loadApproval`, `saveGrant`, `loadGrant`, `revokeGrant`)
and an approval port that is only `verify`. Its behaviour is unchanged.

The composition roots:

- `apps/vestra-cli/src/task/task-plan.ts:293-297`: planning supplies the
  three request ports and nothing else.
- `apps/vestra-cli/src/task/task-authority.ts:58` builds the requester,
  `:64` the verifier, `:76` the broker over the verifier. `record` takes the
  signer as its argument (`:102-120`), so a recorder exists only inside the
  one operation that seals. The optional `signer` member of
  `TaskAuthorityOptions` is gone.
- `apps/vestra-cli/src/task/task-approve.ts:34`, `:50`: `approve` builds one
  `TaskAuthority` and passes the signer to `record`. It had built a second,
  identical one only to carry the signer; the trust root it re-read was never
  used by `record` or `currentBindingDigest`, the two calls made on it.
- `apps/vestra-cli/src/self-test-full-scenario.ts:466-505`: the requester,
  recorder and verifier over the scenario's one store and sealer.

## 3. Deleted, and what stays

- **Deleted:** the eight refusing stubs of `task-plan.ts` and the throwing
  seal of `task-authority.ts`. The message "This command cannot seal
  approvals" goes with the seal. It was reachable only by calling `record`
  on a `TaskAuthority` built without a signer, and no command did; that call
  is now a type error.
- **Stays: the verify-only signer** (`task-authority.ts:59-63`). It is not
  there for the approval interface: `ArtifactSealer`'s constructor takes a
  signer (`packages/evidence/src/integrity/artifact-sealer.ts:348-349`) even
  though `verify` (`:406`) never reads it, so every command that verifies an
  approval needs one. A `why:` comment now records this. Removing it means an
  evidence verifier that takes no signer, a change to the evidence module and
  outside this task; it is left as a residue for the coordinator.

## 4. Behaviour unchanged

**Golden of a planned approval request.** `tests/unit/approval-golden.test.mjs`
was committed first (`3d43201`), on the base, against `ApprovalService`. It
builds a request from an intent shaped as `task plan` shapes it (path-scoped
scope, `worktree-write`, the two provider passports and destinations,
`single-writer` and `no-merge`) with a fixed clock and id source, and records
it with a fixed Ed25519 seed. The refactor commit changes only the
construction lines of that file; every golden value is the same line in both
commits:

| Value | Golden |
| --- | --- |
| `approvalId` | `approval_018f0b6d-7b1a-7abc-8def-000000000001` |
| `bindingDigest` | `sha256:24fa6956afd76eacc7e04f6fa1ffc584460e8c1033cd33775b53eb6a7dee500c` |
| digest of the canonical request | `sha256:ab48e1583f3a94b5d12322bf5e281d7ae4b5537273dbc64a67b1b8540d9cbf6a` |
| sealed `artifactId` | `6d9adccd94da1e391ebfa57b3572108ac8d4cc313cc3246fd059ca89cc2a3c70` |
| DSSE signature | `_D1PD48SYZCu_ll3mHo1VJg8hqLjkAnDrPpPt_rdHguAJoKESqKdaMtljevKhjNwS-Tg7pr9w6rDuBmLrMv9DQ` |
| digest of the canonical approval record | `sha256:0111d6f19e739b7f9969baeafc850818efc45aac4c02a365f95240a462df1661` |

The golden passes 2/2 on `3d43201` and on the refactor, and under
`LANG=fr_FR.UTF-8 LC_ALL=fr_FR.UTF-8 TZ=Asia/Tokyo`.

**Moved bytes.** The bodies of `request`, `record`, `verify` and `revoke`, of
the broker's `grant`, `invoke` and `revoke`, every helper of the module, and
everything above `ApprovalArtifactPort` are byte-identical between `c7755c4`
and the refactor (compared as extracted text). No error code or message of the
module changed.

**Suites.** The approval and authority suites pass 67/67 before and after:
`tests/unit/approval-service.test.mjs` 11, `tests/security/authority-binding.test.mjs`
41, `tests/integration/authority-runtime.test.mjs` 10,
`tests/integration/authority-binding-digest-reencoding-migration.test.mjs` 3,
the golden 2. `tests/e2e/task-cli-e2e.test.mjs` (43) drives the real `plan`,
`approve`, `start` and `review` through the source CLI, so the planned
request, the recorded approval and every verification before an effect run
through the new classes. `tests/mutation/*` is not in the diff.

## 5. Requirement → evidence

| Requirement | Evidence |
| --- | --- |
| ADR2-8: a request declares only digest, clock and id source | `ApprovalRequestPorts` `authority.ts:138-142`. `tests/unit/approval-ports.test.mjs:50-55`: given exactly those three ports, `request` reads exactly `clock.now`, `digest.sha256`, `uuid` (`:54`); a read of any other port would surface as its bare name. |
| ADR2-8: planning builds no refusing stub | `task-plan.ts:293-297` supplies three ports; `pnpm typecheck` proves no other port is required. The eight stubs are deleted. |
| record, verify, revoke take the store and sealer only where they call them | `authority.ts:144-161`. `approval-ports.test.mjs:63` (`artifacts.seal`, `clock.now`, `digest.sha256`, `store.saveApproval`), `:71` (`artifacts.verify`, `clock.now`, `digest.sha256`, `store.loadApproval`), `:78` (`clock.now`, `store.revokeApproval`). |
| The combined interface is removed, not forwarded | `approval-ports.test.mjs:81-97`: each class carries its own operation and none of the other three, and the package exports no `ApprovalService` (`:96`). `AuthorityDependencies` no longer exists. |
| The throwing seal is deleted | `task-authority.ts:102-120`; `TaskAuthorityOptions` has no `signer`. |
| Behaviour, sealed bytes and approval digests unchanged | Section 4. |

## 6. Discrimination sensor

A temporary mutant made the `ApprovalRequester` constructor read `store`, a
port the request does not declare. `approval-ports.test.mjs:54` failed with the
extra `'store'` entry (1 failed, 4 passed). The mutant was reverted; the file
is byte-identical to the committed one and passes 5/5.

## 7. Tests: replaced, not layered

No case was deleted and no expected value changed. The changes build the
per-operation classes where a test had built the combined one:

| File | Change |
| --- | --- |
| `tests/unit/approval-service.test.mjs` | The helper and the cases build `ApprovalRequester`, `ApprovalRecorder`, `ApprovalVerifier`, `ApprovalRevoker`. Eight assertion lines change only the object they call: six `context.service.verify`, `context.service.revoke` and `service.verify` calls go to the verifier or the revoker, and two `assert.rejects(service.record(service.request(…)))` become `assert.rejects(new ApprovalRecorder(fixture).record(request, …))` with the request built on the line above. |
| `tests/security/authority-binding.test.mjs` | The context records through the recorder and hands the broker a verifier; the locale case uses a requester. No assertion line changed. |
| `tests/integration/authority-runtime.test.mjs` | `persisted()` builds the four classes over the runtime store; the restart cases build a verifier; the revocation case calls the revoker. No assertion line changed. |
| `tests/integration/authority-binding-digest-reencoding-migration.test.mjs` | Records through the requester and recorder. No assertion line changed. |
| `tests/unit/approval-golden.test.mjs` | Construction and the verifier receiver; every golden value unchanged. |
| `tests/unit/approval-ports.test.mjs` | New: the port reads of each operation, at the interface. |

Deleted case → replacement: none.

## 8. Guardrails

- **Complexity.** `pnpm complexity:update` rewrites `complexity-baseline.json`
  to the same bytes (178 keys). The approval methods keep their names and stay
  below the target, so none is baselined; `authority.ts :: Async method 'grant'`
  13 and `:: Async method 'invoke'` 16 are unchanged.
- **Census.** No file gained or lost `JSON.stringify` or `createHash`.
  `pnpm census:refresh` writes `docs/canonical-json-census.json` unchanged;
  `authority.ts` keeps 20 canonicalizer signals.
- **Citations fixed.** `.specs/features/architecture-deepening/validation-c5.md`:
  `self-test-full-scenario.ts:731-772` is now `:733-774`.
  `.specs/features/architecture-deepening/validation-c6.md`:
  `authority-runtime.test.mjs:41-69`, `:71-83`, `:112-120`, `:184-207`,
  `:201`, `:203-204` are now `:49-77`, `:79-91`, `:120-128`, `:192-215`,
  `:209`, `:211-212`.
- **Comments naming the removed class.** `packages/platform-node/src/authority-store-adapter.ts:28`
  now names `ApprovalRecorder`, and `packages/platform-node/src/runtime-store/runtime-migrations.ts:264`
  names `ApprovalVerifier.verify()`. Comment-only; no migration changed.
- **Not rewritten.** `docs/qualification/t25-validation.md` cites the
  authority test files by line; it is a point-in-time qualification record and
  was already stale at the base. `validation-c4.md:454` records an earlier
  citation fix. `platform-qualification-matrix/matrix.md` cites
  `authority.ts:367,388,437`, and `.specs/STATE.md`,
  `context-tokenizers/handoff.md`, `deep-doctor-live-probes/handoff.md` and
  `dsse-attestation/migration.md` cite `self-test-full-scenario.ts:251`, `:343`,
  `:380`; all were already stale at the base. `self-test-full-driver-profiles/design.md`
  names `ApprovalService` in the design record of a completed feature.
- Migration count (12) and runtime error catalog count (19) unchanged. The
  digest-bound reports of `credential-store.ts` are untouched. No dependency.
- **No decision entry.** The change applies the first round's C5 pattern,
  which recorded none.
- **Platform matrix.** `task-plan.ts`, `task-authority.ts` and
  `task-approve.ts` are on the task path, so the spec's constraint asks for the
  platform matrix on this branch before merge.

## 9. Gates

macOS (Darwin 25.6.0), Node 24.14.0, run sequentially on the refactor.
`git fetch origin && git rebase origin/main` was a no-op: `origin/main` was
still `9a67904`, without T1, so the branch carries T1's three commits until
they merge.

| Command | Result |
| --- | --- |
| `node --test tests/unit/approval-ports.test.mjs` | PASS 5/5 |
| approval and authority suites (5 files, section 4) | PASS 67/67 (67/67 on `3d43201`) |
| `node --test tests/integration/self-test-full-scenario.test.mjs tests/integration/task-run-containment.test.mjs` with the above | PASS 128/128 |
| `pnpm gate:quick` | PASS (unit 2617/2617, agent-readiness 323/323, census 13/13) |
| `pnpm test:architecture` | PASS 109/109 |
| `pnpm gate:full` | PASS (unit 2617, contract 782, integration 1056, e2e 275, fault 310, mutation 8) |
| `pnpm test:mutation` | PASS 8/8; `tests/mutation/` not in the diff |
| `node --test tests/e2e/task-cli-e2e.test.mjs` | PASS 43/43 |
| `node --test tests/unit/task-cli-composition.test.mjs tests/security/task-cli-security.test.mjs` | PASS 15/15 |
| `pnpm agent:check` | PASS |

No test was skipped in any stage.
