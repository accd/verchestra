# OS Secret Backend — Linux and Windows Tasks

**Status:** T1–T8 complete on `feat/379-linux-windows-credential-stores`; T9 (independent review) pending

## Test Coverage Matrix

| Layer | Test file | Coverage | Command |
| --- | --- | --- | --- |
| Linux protocol | `tests/unit/os-secret-backend-linux.test.mjs` | argv, stdin, timeouts, SearchItems parsing, locked and missing items, error classification, rotation, delete, environment allowlist, platform mapping | `pnpm test:unit` |
| Windows protocol | `tests/unit/os-secret-backend-windows.test.mjs` | fixed argv, one-statement program, advapi32 entry points, generic and machine-local, payload line, logging-policy guard, result parsing, timeout and error mapping, environment allowlist, platform mapping | `pnpm test:unit` |
| Credential controls | `tests/security/os-credential-cross-platform-security.test.mjs` | argv, environment, error, and output non-disclosure; presence never receives the value; Workspace binding; `--keychain` refused; not-configured stores | `pnpm test:security` |
| Contracts and digests | `tests/security/os-secret-backend-security.test.mjs` | per-platform evidence, every control required, key-material contract, report digests | `pnpm test:security` |
| Error registry | `tests/security/secret-broker.test.mjs` | `VES_SECRET_STORE_LOGGED` and `VES_SECRET_STORE_UNAVAILABLE` registered and schema-valid | `pnpm test:security` |
| Doctor mapping | `tests/integration/doctor-secret-backend.test.mjs` | `pass`, `blocked`, `fail` on linux and win32; presence only | `pnpm test:integration` |
| CLI refusals | `tests/e2e/secret-cli-e2e.test.mjs` | value and `--keychain` refusals through the binary on every platform, guard preloaded for all four tools | `pnpm test:e2e` |
| Gate isolation | `tests/architecture/no-keychain-spawn-in-tests.test.mjs` | no real runner named, no tool spawned, guard wherever a store is reachable, guard refuses all four tools | `pnpm test:architecture` |
| Workflow shape | `tests/agent-readiness/os-credential-store-workflow.test.mjs` | triggers, permissions, matrix, apt packages, pins, no interpolation | `pnpm test:agent-readiness` |
| Real stores (not a gate) | `spikes/os-secret-store/test/*.test.mjs` | Linux, Windows, and macOS round trips, measured conventions, CLI and doctor journeys; refusal elsewhere | `pnpm qualify:keychain` (CI: `os-credential-store.yml`) |

## Execution Plan

1. **T1:** Shared credential-tool runner (`credential-tool.ts`): bounded spawn,
   unavailable versus timeout, shared locator check; darwin refactored onto it
   with no behavior change. Requirement: XOS-07. Done.
2. **T2:** Linux Secret Service backend and its fake runner. Requirements:
   XOS-02, XOS-03. Done.
3. **T3:** Windows Credential Manager backend and its fake runner.
   Requirements: XOS-04 to XOS-06. Done.
4. **T4:** Contracts, platform mapping, error codes, and doctor mapping.
   Requirements: XOS-01, XOS-08, XOS-09. Done.
5. **T5:** Gate isolation for `secret-tool`, `dbus-send`, and PowerShell.
   Requirement: XOS-11. Done.
6. **T6:** Real-store qualification suites and the three-platform workflow,
   iterated in CI until green; the measured conventions became invariants.
   Requirement: XOS-12. Done.
7. **T7:** Qualification reports bound by digest, README, acceptance-matrix
   notes, AD-041. Requirement: XOS-10. Done.
8. **T8:** Gates and the recorded green run. Done.
9. **T9:** Independent review of AD-041, including the Windows value channel
   and the logging-policy guard. Pending.
