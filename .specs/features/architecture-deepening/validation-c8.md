# Architecture deepening — validation c8 (ADP-8, T8)

Author validation on `refactor/credential-policy-beside-store`, based on
`d58a25f3d80a720000bbdd4cbbc8650cdc8c9686`. No independent verifier has
reviewed it yet, and none is claimed. No test here spawns `security`,
`secret-tool`, `dbus-send`, PowerShell, or `cmdkey`; every case runs against a
fake runner behind `tests/helpers/deny-keychain-spawn.mjs`.

## Requirement evidence

| Requirement | Evidence (file:line — assertion) | Result |
| --- | --- | --- |
| ADP-8: timeouts live beside the store | `packages/platform-node/src/os-secret-backends/credential-tool.ts:40`, `:43`, `:44` define `PRESENCE_TIMEOUT_MS`, `READ_TIMEOUT_MS`, `WRITE_TIMEOUT_MS`. `tests/unit/os-secret-backend-policy.test.mjs:82`: on darwin, linux, and win32 every presence invocation runs with `PRESENCE_TIMEOUT_MS`, which is below `DOCTOR_PROBE_TIMEOUT_MS`. `tests/unit/os-secret-backend-linux.test.mjs:130`, `:167` and `tests/unit/os-secret-backend-windows.test.mjs:34` still pin the read and write timeouts per invocation. | PASS |
| ADP-8: value policy lives beside the store | `credential-tool.ts:186` `isValidCredentialValue`, with its limit at `:182`. `tests/unit/os-secret-backend-policy.test.mjs:69`: only non-empty printable ASCII without whitespace is a value. `:103`: on each platform an empty, whitespace, or oversize value is `VES_SECRET_VALUE_INVALID` and spawns nothing. | PASS |
| ADP-8: the policy limit cannot drift from the darwin derivation | `packages/platform-node/src/os-secret-backends/darwin-keychain.ts:85` still derives `MAX_CREDENTIAL_VALUE_BYTES` from the `security -i` line limit. `tests/unit/os-secret-backend-policy.test.mjs:75`: the derivation is 1416, a value of exactly that many bytes is valid, and one more byte is not. Mutating either side (policy 1415 or 1417, derivation 1415) fails this case. | PASS |
| ADP-8: one provisioning interface | `credential-tool.ts:46` is the only declaration of `CredentialProvisioner`; `credential-store.ts:69` types the bound backend as `OsSecretBackend & CredentialProvisioner`, and `ProvisioningBackend` is gone. All three adapters declare it (`darwin-keychain.ts:113`, `linux-secret-service.ts:126`, `windows-credential-manager.ts:254`); `pnpm typecheck` proves each satisfies it. | PASS |
| ADP-8: one validation prelude | `credential-tool.ts:194` `assertStorable`, called first by every write (`darwin-keychain.ts:188`, `linux-secret-service.ts:186`, `windows-credential-manager.ts:301`). `tests/unit/os-secret-backend-policy.test.mjs:90` and `:103`: a non-canonical locator or an invalid value is refused on each platform with no invocation. Removing the call from any one adapter fails `:103` for that platform. | PASS |
| ADP-8: no adapter imports another adapter | `linux-secret-service.ts` and `windows-credential-manager.ts` import the policy from `./credential-tool.ts` only; `git grep -n 'from "./darwin-keychain.ts"' packages/platform-node/src/` matches `credential-store.ts:15` alone, the one place a platform is mapped to its adapter. | PASS |
| ADP-8: public export names unchanged | `packages/platform-node/src/index.ts:42`–`:46` and `:74`, `packages/platform-node/src/secrets.ts:14` and `:20` export the same names as before; only the module each name comes from changed. `apps/vestra-cli/src/secret-composition.ts` and `spikes/os-secret-store/test/*.test.mjs` are untouched. `tests/architecture/platform-node-secrets-subpath.test.mjs` passes. | PASS |
| ADP-8: digest-bound reports unchanged | `git diff --stat d58a25f -- docs/qualification/` is empty. `credential-store.ts:25`, `:34`, `:42` hold the same three digests. `tests/security/os-secret-backend-security.test.mjs:413` recomputes each digest from its committed report and passes. | PASS |

## Deleted case → replacement

Every replacement is in `tests/unit/os-secret-backend-policy.test.mjs`, which
runs each case against the darwin, linux, and win32 backends. It was added, and
passing, before any case below was removed.

| Deleted or narrowed | Replacement |
| --- | --- |
| darwin `presence finishes inside the doctor's probe budget` (deleted) | `:82` `<platform>: presence runs under the presence timeout, inside the doctor's probe budget` |
| linux `presence is an attribute-only SearchItems call inside the doctor's budget`: the `PRESENCE_TIMEOUT_MS < DOCTOR_PROBE_TIMEOUT_MS` assertion (removed; the case is retitled `… under the presence timeout` and keeps every other assertion) | `:82`, same assertion |
| windows `reads, writes, and deletes run Windows PowerShell …`: the `PRESENCE_TIMEOUT_MS < DOCTOR_PROBE_TIMEOUT_MS` assertion (removed; the case keeps every other assertion) | `:82`, same assertion |
| darwin `a non-canonical locator is refused before any process is spawned` (deleted) | `:90` `<platform>: a non-canonical locator is refused by every operation before any process runs`: the same five locators, now also through `read` and `delete` |
| linux `an invalid locator or value is refused before any process runs` (deleted) | Locators: `:90`, the same four locators through `has`, `store`, `delete`, and now `read`. Values: `:103`, the same three values |
| windows `an invalid locator or value is refused before any process runs` (narrowed to `a target that is not the canonical binding never reaches the program`, which keeps the `credentialTarget` assertions) | Backend locators: `:90`, the same three locators through `has`, `store`, and now `read` and `delete`. Values: `:103`, the same three values |
| linux `a store that exits 0 but did not land is a failure` (deleted) | `:115` `<platform>: a write the tool accepted but that did not land is a failure`, which also requires the failure to come from the presence check after the write |
| darwin `store fails closed when the write exits nonzero or the item is not found afterwards`: the `did not land` half (removed; the case is retitled `store fails closed when the write exits nonzero`) | `:115`, with the same message match |
| windows `a rotation is one replacing write, and a write that did not persist is a failure`: the did-not-persist half (removed; the case is retitled `a rotation is one replacing write`) | `:115` |
| darwin `only non-empty printable ASCII without whitespace is a credential value` (moved, not duplicated: the predicate left the darwin adapter) | `:69`, the same case, unchanged |

Totals: 4 duplicated cases deleted outright (2 darwin, 2 linux), 3 cases
narrowed to their platform-specific half (1 darwin, 2 windows), 2 duplicated
assertions removed (1 linux, 1 windows), and 1 case moved. Unit definitions:
darwin 19 → 16, linux 17 → 15, windows 13 → 13, policy 0 → 6 (14 executions
over three platforms).

Discrimination was checked by mutation, each mutant reverted: policy limit
1415 and 1417, derivation 1415, `PRESENCE_TIMEOUT_MS` 6000, the prelude call
removed from each adapter, and the verify-after-write check removed from each
adapter. Every mutant fails at least one case in the policy file.

## Duplicated cases left where they are, and why

- **Timeout and missing-tool mapping** (darwin
  `a timed-out child is reported as keychain interaction required …`, linux
  `a timeout needs a person and a missing tool is not configured …`, windows
  `a timeout is a retryable failure …`). The digest-bound reports name each
  unit file as the gate evidence for exactly this: "timeout mapping"
  (`docs/qualification/os-secret-backend-darwin.md`), "timeouts" and "missing
  tools" (`docs/qualification/os-secret-backend-linux.md`), "error and timeout
  mapping" (`docs/qualification/os-secret-backend-windows.md`). Moving the
  cases would make a report describe evidence its named file no longer holds,
  and the reports cannot change without re-qualification. The mapping also
  differs per platform (interaction required on darwin and linux, a retryable
  failure on windows).
- **Platform mapping** (linux and windows "the <platform> store is the
  qualified … adapter and refuses a keychain path"). The linux and windows
  reports name their unit files as the evidence for "the platform mapping".
  The darwin case is not the same case: darwin accepts a keychain path and the
  case also covers unqualified platforms.
- **darwin `an oversize value is refused before any process is spawned`.** It
  also proves a value of exactly the limit fits the 4095-byte line, which the
  darwin report attributes to that file as "the line budget". The parametrised
  value case therefore overlaps it on darwin for the oversize value only.

## Deviations from the task as written

- The parametrised cases are a new unit file, not additions to
  `tests/security/os-credential-cross-platform-security.test.mjs`. `test:unit`
  runs in `gate:quick`, `gate:full`, and `gate:build`; `test:security` runs
  only in `gate:security` and `gate:release`. Moved to the security scope, the
  doctor-budget assertion would stop running for a change to
  `DOCTOR_PROBE_TIMEOUT_MS` in `packages/application/`, which selects
  `gate:build` and `gate:full` only (`scripts/gate-selection.mjs`). The
  security file is unchanged.
- `MAX_CREDENTIAL_VALUE_BYTES` stays in the darwin adapter, derived, so the
  darwin report's "the backend derives `MAX_CREDENTIAL_VALUE_BYTES` from the
  worst-case line" stays literally true. The policy holds its own unexported
  limit and the drift case above holds the two equal.
- `.specs/features/architecture-deepening/` did not exist at the base revision;
  `origin/main` gained it in `af7d047` after this branch was cut. This change
  adds only this file there and touches none of `spec.md`, `tasks.md`, or
  `handoff.md`, so it applies on top of `af7d047` without a conflict.

## Guardrails

- `complexity-baseline.json`: unchanged; no hotspot moved
  (`pnpm complexity:check`: 179 baselined keys, nothing above 10 unaccounted).
- Canonical-JSON census: no file under `packages`, `apps`, or `scripts` gained
  or lost `JSON.stringify` or `createHash`; `docs/canonical-json-census.json`
  is unchanged and `pnpm test:census` passes inside `gate:quick`.
- Citations: no `docs` or `.specs` file cites a line of the five source files.
  The line citations of the three reshaped unit files in
  `.specs/features/os-secret-backend/validation.md` and
  `.specs/features/os-secret-backend-cross-platform/validation.md` are updated,
  including the linux ones that were already stale.
- Migration count and runtime error catalog count: untouched.

## Gates

Run on Node 24.14.0, darwin arm64, on the tree this commit records.

| Command | Result |
| --- | --- |
| `node --test tests/unit/os-secret-backend-*.test.mjs tests/security/os-credential-cross-platform-security.test.mjs tests/security/os-secret-backend-security.test.mjs` | PASS — 90 tests, 0 failed, 0 skipped (81 on the base revision for the same command) |
| `pnpm gate:quick` | PASS — unit 2339, agent-readiness 315, census 13; 0 failed, 0 skipped |
| `pnpm test:architecture` | PASS — 61 tests |
| `pnpm gate:security` | PASS — unit 2339, contract 666, e2e 229, architecture 61, qualification 272, security 1333, fault 310; 0 failed, 0 skipped |
| `pnpm gate:build` | PASS — unit 2339, contract 666, integration 770, e2e 229, architecture 61, build 135, qualification 272; 0 failed, 0 skipped |
| `pnpm agent:check` | PASS |

The first `pnpm gate:build` run failed 4 of 135 `test:build` cases with
`ENOSPC: no space left on device` under the system temporary directory, while
other worktrees were building on the same machine. Nothing was changed between
the runs; the second run is the one recorded above.

The real-store suite (`pnpm qualify:keychain`) was not run and is not claimed:
it is outside every gate and must never run on the owner's machine. The
`os-credential-store` workflow runs it on the pull request, because this change
touches `packages/platform-node/src/os-secret-backends/**`.
