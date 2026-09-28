# OS Secret Backend Tasks

**Status:** T1–T7 complete on `feat/os-secret-backend`; T8 awaits human review

## Test Coverage Matrix

| Layer | Test file | Coverage | Command |
| --- | --- | --- | --- |
| Backend protocol | `tests/unit/os-secret-backend-darwin.test.mjs` | Exit mapping, `-g` decoding, line budget, rotation, access-list invariant, timeouts, keychain-file checks | `pnpm test:unit` |
| CLI input | `tests/unit/secret-cli-input.test.mjs` | Hidden TTY entry, cancel, newline stripping, size budget | `pnpm test:unit` |
| Workspace identity | `tests/unit/workspace-identity.test.mjs` | Round trip with `init`, absent, fail-closed | `pnpm test:unit` |
| Credential controls | `tests/security/os-secret-backend-security.test.mjs` | argv, env, error, and output non-disclosure; Workspace binding; names; key-material contract; evidence digest | `pnpm test:security` |
| Real keychain | `tests/integration/os-secret-backend-darwin-keychain.test.mjs` | Disposable keychain round trip, fallback guard, oversize, real timeout | `pnpm test:integration` |
| Doctor mapping | `tests/integration/doctor-secret-backend.test.mjs` | `pass`, `blocked`, and `fail`; no value request | `pnpm test:integration` |
| CLI journey | `tests/e2e/secret-cli-e2e.test.mjs` | `vestra secret` and `doctor --keychain` through the binary | `pnpm test:e2e` |
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
7. **T7:** Disposable-keychain test harness, darwin integration and e2e tests,
   and non-darwin refusal assertions. Requirement: OSB-13. Done.
8. **T8:** Independent review, and a full `doctor --deep` `PASS` observed on a
   provisioned macOS machine by the owner (see handoff). Not started.

## Validation

| Check | Result |
| --- | --- |
| Atomicity | Each task maps to its own module and test file. |
| Test co-location | Source and tests land in the same commit. |
| Discrimination | 11 mutants killed, 0 survived (see `validation.md`). |
