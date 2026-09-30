# OS Secret Backend Tasks

**Status:** T1–T7 complete on `feat/os-secret-backend`; T8 (the owner's real-keychain run and review) pending

## Test Coverage Matrix

| Layer | Test file | Coverage | Command |
| --- | --- | --- | --- |
| Backend protocol | `tests/unit/os-secret-backend-darwin.test.mjs` | Exit mapping, `-g` decoding, line budget, rotation, access-list invariant, timeouts, keychain-file checks | `pnpm test:unit` |
| CLI input | `tests/unit/secret-cli-input.test.mjs` | Hidden TTY entry, cancel, newline stripping, size budget | `pnpm test:unit` |
| Workspace identity | `tests/unit/workspace-identity.test.mjs` | Round trip with `init`, absent, fail-closed | `pnpm test:unit` |
| Credential controls | `tests/security/os-secret-backend-security.test.mjs` | argv, env, error, and output non-disclosure; Workspace binding; names; key-material contract; evidence digest | `pnpm test:security` |
| Real keychain (not a gate) | `spikes/os-secret-store/test/keychain-backend.test.mjs` | Disposable keychain round trip, fallback guard, oversize, real timeout | `pnpm qualify:keychain` (pending) |
| Real CLI journey (not a gate) | `spikes/os-secret-store/test/credential-cli.test.mjs` (renamed from `keychain-cli.test.mjs` by AD-041) | `secret set/status/delete` and `doctor --deep` `pass` against a disposable keychain | `pnpm qualify:keychain` (pending) |
| Gate isolation | `tests/architecture/no-keychain-spawn-in-tests.test.mjs` | No gate test spawns `security`; spawn guard present wherever a store is reachable | `pnpm test:architecture` |
| Doctor mapping | `tests/integration/doctor-secret-backend.test.mjs` | `pass`, `blocked`, and `fail`; no value request | `pnpm test:integration` |
| CLI refusals | `tests/e2e/secret-cli-e2e.test.mjs` | Every pre-keychain refusal through the binary, with the spawn guard preloaded | `pnpm test:e2e` |
| Import boundary | `tests/architecture/platform-node-secrets-subpath.test.mjs` | `./secrets` closure free of `node:sqlite`; lazy `main.ts` load | `pnpm test:architecture` |

## Execution Plan

1. **T1:** Separate credential contract and adapter (`OS_CREDENTIAL_CONTROLS`,
   `QualifiedOsCredentialAdapter`), with the key-material contract unchanged.
   Requirement: OSB-01. Done.
2. **T2:** Darwin keychain backend with an injectable `security` runner.
   Requirements: OSB-02 to OSB-07. Done.
3. **T3:** Qualification report and the digest-bound evidence constant.
   Requirement: OSB-08. Done.
4. **T4:** `@verchestra/platform-node/secrets` subpath and its architecture
   guard. Requirement: OSB-09. Done.
5. **T5:** `readWorkspaceIdentity` and its two init error codes.
   Requirement: OSB-10. Done.
6. **T6:** `vestra secret set|status|delete`, the `--keychain` option, and deep
   doctor's presence-only wiring. Requirements: OSB-11 and OSB-12. Done.
7. **T7:** Gate isolation (spawn guard, architecture test) and the standalone
   real-keychain qualification suite. Requirements: OSB-13 and OSB-14. Done;
   the suite's own run is T8.
8. **T8:** The owner runs `corepack pnpm qualify:keychain` on an unlocked macOS
   session and records the result in the qualification report; independent
   review; a `doctor --deep` verdict on a provisioned machine. Pending.

## Validation

| Check | Result |
| --- | --- |
| Atomicity | Each task maps to its own module and test file. |
| Test co-location | Source and tests land in the same commit. |
| Discrimination | 12 mutants killed, 0 survived (see `validation.md`). |
