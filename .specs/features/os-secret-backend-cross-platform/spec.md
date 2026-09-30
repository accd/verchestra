# OS Secret Backend — Linux and Windows Specification

**Issue:** #379 (the credential source for #405; L2 in the acceptance matrix)
**Decision:** AD-041 in `.specs/STATE.md` (extends AD-034)
**Status:** Implemented on `feat/379-linux-windows-credential-stores`; pending independent review

## Problem Statement

AD-034 qualified a macOS keychain credential store and left Linux and Windows
reporting `VES_SECRET_STORE_UNQUALIFIED`. On those platforms `vestra secret`
could not bind a provider key and deep doctor's secret-presence check stayed
`blocked`, so #379 was resolved on one supported platform of three.

## Goals

- Qualified credential stores on Linux (Secret Service) and Windows
  (Credential Manager), under the same readable-credential contract as macOS,
  each claiming only what its store guarantees and bound by digest to its own
  qualification report.
- The value never in any argv or environment, never in an error or output.
- Presence without returning the value; a store that is locked, not running,
  or too slow reported as such, never as absent or as a pass.
- Real-store evidence from CI on all three platforms, with no gate ever
  touching a real store.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Key material on Linux or Windows | The key-material contract (`non-exportable`) is unchanged; no credential evidence satisfies it. |
| A store selector on Linux or Windows | There is one Secret Service per session and one Credential Manager per user. `--keychain` is refused there. |
| Non-GNOME Secret Service providers in CI | The protocol is the freedesktop.org API; CI proves it against gnome-keyring only. |
| Observing the Windows logging-policy guard under an enforced policy | Enforcing a policy would change the runner or the owner's machine; the guard is proven by protocol tests and documented as designed. |

## Requirements

| ID | Requirement |
| --- | --- |
| XOS-01 | `OS_CREDENTIAL_CONTROLS` has `linux` (`secret-service`, `user-scope`, `workspace-namespace`, `not-in-argv`, `presence-without-value`) and `win32` (`credential-manager`, `dpapi-at-rest`, `user-scope`, `workspace-namespace`, `not-in-argv`, `presence-without-value`). Neither claims `non-exportable` or `access-control`. One platform's evidence never qualifies another, and dropping any control fails closed. |
| XOS-02 | Linux: store is `/usr/bin/secret-tool store --label=… service verchestra/<ws> account <name>` with the value on stdin; read is `secret-tool lookup` (value on captured stdout, exactly the bytes); presence is `SearchItems` through `/usr/bin/dbus-send` (item paths only); delete decides from presence before and after `secret-tool clear`. Rotation is one replacing store. |
| XOS-03 | Linux: an item found only among locked paths is `VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED` for presence, read, delete, and store; a lookup miss is confirmed by `SearchItems` before it is called absent. No session bus, no provider, or a missing program is `VES_SECRET_STORE_UNAVAILABLE`. A timeout is interaction-required. |
| XOS-04 | Windows: presence runs `%SystemRoot%\System32\cmdkey.exe /list:<target>` and counts only a `<label>: <target>` line; every read, write, and delete runs `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command -` with the program on stdin, one complete statement per line, no cmdlet, compiling an inline P/Invoke of advapi32 `CredReadW`, `CredWriteW`, and `CredDeleteW` through `CSharpCodeProvider`, for a `CRED_TYPE_GENERIC` credential, target `verchestra/<ws>/<name>`, user the logical name, persistence `CRED_PERSIST_LOCAL_MACHINE`. |
| XOS-05 | Windows: the value reaches PowerShell only on stdin, as the base64 literal of one assignment line, after a guard that stops with `VES_SECRET_STORE_LOGGED` when Script Block Logging or transcription is enforced in either policy hive. A read is guarded the same way. |
| XOS-06 | Windows: program results are one `verchestra-credential:` line; Win32 1312 or 1004 is `VES_SECRET_STORE_UNAVAILABLE`; a missing PowerShell or `cmdkey` is unavailable; a timeout is a retryable `VES_SECRET_BACKEND_FAILURE` (the API never prompts); anything malformed, or a nonzero `cmdkey` exit, is a failure. |
| XOS-07 | On both, the value never appears in any argv, the child environment (an allowlist), an error, command output, or a presence answer. Buffers that held it are zeroed. |
| XOS-08 | `createOsCredentialStore` maps darwin, linux, and win32 to their stores, refuses `--keychain` on linux and win32 with `VES_SECRET_KEYCHAIN_INVALID`, and refuses every other platform with `VES_SECRET_STORE_UNQUALIFIED`. |
| XOS-09 | Deep doctor on linux and win32: bound is `pass`; unbound or another Workspace's is `blocked`; a store not running in the session is `blocked` (not configured); a store that cannot answer is `fail`; the probe only ever runs presence. |
| XOS-10 | `LINUX_SECRET_SERVICE_CREDENTIAL_QUALIFICATION` and `WINDOWS_CREDENTIAL_MANAGER_QUALIFICATION` digests equal the SHA-256 of `docs/qualification/os-secret-backend-linux.md` and `…-windows.md`, which name every claimed control and hold no machine path. |
| XOS-11 | No gate suite spawns `security`, `secret-tool`, `dbus-send`, PowerShell, or `cmdkey`. The spawn guard refuses all five, in process and in a preloaded child, and the architecture test forbids naming a real runner or spawning a tool directly. |
| XOS-12 | `pnpm qualify:keychain` asserts each platform's own store works and that the others are refused, with no skip: Linux in a disposable D-Bus session and gnome-keyring with a temporary HOME, Windows under random targets deleted in `finally` with `cmdkey` as witness, macOS in a disposable keychain. `.github/workflows/os-credential-store.yml` runs it on `ubuntu-latest`, `windows-latest`, and `macos-latest`, read-only, SHA-pinned to reviewed actions, with no secret, and its shape is asserted. |

## Assumptions

| Decision | Chosen default | Confirmed? |
| --- | --- | --- |
| Linux presence mechanism | `SearchItems` via `dbus-send` (attribute-only), because `secret-tool search` prints secrets and a locked lookup misses silently | Measured; owner reviews |
| Windows persistence | `CRED_PERSIST_LOCAL_MACHINE` | Proposed; owner reviews |
| Windows presence mechanism | `cmdkey /list:<target>`, because a cold PowerShell start exceeded the 4 s presence budget | Measured (run 36682126079); owner reviews |
| Windows value channel | A base64 literal line in the stdin program, guarded by a logging-policy check, because `-Command -` owns stdin | Measured; owner reviews the alternative (script via `-EncodedCommand`, value as stdin data) |
| Store not running | `VES_SECRET_STORE_UNAVAILABLE`; doctor `blocked` | Proposed |
