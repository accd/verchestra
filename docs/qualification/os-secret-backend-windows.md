# Windows Credential Manager Credential Backend Qualification

**Scope:** issue #379, decision AD-041 (extends AD-034)
**Status:** Candidate. The contract and the program protocol are proven by gate tests, and the real Credential Manager round trip passed in CI (see "Real-store evidence"). Independent review is pending.
**Adapter:** `windows-credential-manager` (`QualifiedOsCredentialAdapter` over `WindowsCredentialManagerBackend`)

## Qualification boundary

This report qualifies one thing: storing a **readable provider credential**
(an API key that a governed task later injects into a child process) as a
generic credential in the invoking user's Windows Credential Manager, through
Windows PowerShell (`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`)
running a small program that calls advapi32 `CredReadW`, `CredWriteW`, and
`CredDeleteW` through an inline P/Invoke, and, for presence only, the system
program `%SystemRoot%\System32\cmdkey.exe`. It does not qualify key material.
Signing and recipient keys stay on the separate key-material contract, which
still requires a non-exportable CNG key, and this backend's evidence cannot
satisfy that contract (asserted in
`tests/security/os-secret-backend-security.test.mjs`).

A logon without a Credential Manager (for example a network or service logon
with no loaded profile, Win32 error 1312) reports `VES_SECRET_STORE_UNAVAILABLE`,
and deep doctor's secret-presence check reports `blocked` (not configured).

## The credential

| Field | Value | Why |
| --- | --- | --- |
| Type | `CRED_TYPE_GENERIC` | An application secret, not a Windows logon credential. |
| Target | `verchestra/<workspaceId>/<logical name>` | One target per Workspace and name. |
| User name | the logical name | Shown by Credential Manager and `cmdkey`; never the value. |
| Persistence | `CRED_PERSIST_LOCAL_MACHINE` | Kept for this user on this machine across logon sessions. `CRED_PERSIST_ENTERPRISE` would also copy the credential into a roaming profile, moving a local provider key to other machines and to profile servers the user never chose. `CRED_PERSIST_SESSION` would lose it at logoff. |

## Controls claimed

| Control | Meaning | Proof |
| --- | --- | --- |
| `credential-manager` | The value is a generic credential in the invoking user's Credential Manager, written and read only through advapi32 `CredWriteW` and `CredReadW`. | Gate: the program protocol against a fake runner. Real round trip: `pnpm qualify:keychain` on Windows, with `cmdkey` as a witness to what the PowerShell program wrote |
| `dpapi-at-rest` | Credential Manager keeps the credential blob encrypted at rest with DPAPI under the user's own master key. That is the operating system's guarantee for every credential it stores, relied on here, not implemented here. | Platform documentation; the witness confirms the credential is a generic, machine-local Credential Manager entry |
| `user-scope` | Credential Manager is per user: a credential is visible to the user that wrote it, and not to another standard user. | The real run writes and reads as one user; the platform guarantee is relied on |
| `workspace-namespace` | The target is `verchestra/<workspaceId>/<logical name>`. One Workspace's name never resolves another Workspace's credential. The target is checked against the canonical shape before it is placed in the program. | Workspace-binding cases in `tests/security/os-credential-cross-platform-security.test.mjs` and `tests/integration/doctor-secret-backend.test.mjs` |
| `not-in-argv` | The value never appears in any process argv or environment. PowerShell's argv is fixed (`-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command -`), the program arrives on stdin, and the value arrives on stdin inside it (below). A read takes the value, base64-encoded, from PowerShell's captured stdout. The child environment is an allowlist. | Unit and security tests: argv, environment, error, and output assertions; the real run asserts PowerShell's stdout, stderr, and argv never carried the value |
| `presence-without-value` | Presence is `cmdkey /list:<target>`, a Windows system program that prints the credential's target, type, user, and persistence and never its value. The backend counts only the `<label>: <target>` line; the header that echoes the query ends with a colon and never counts, and the label may be localized. Deep doctor receives only this operation. | Unit and doctor tests assert presence is `cmdkey` alone with nothing on stdin; the real run asserts its output never carries the raw or base64 value |

## Controls not claimed

- **`non-exportable`.** A credential that must be handed to a child process is
  readable by construction.
- **`access-control` beyond the user's own.** Any process running as the same
  user can call `CredReadW` for the target and read the value without a prompt.
  That is the Credential Manager model for a generic credential, recorded here
  as a limit.
- **What `cmdkey` does internally.** It is the operating system's program; the
  claim is only that it prints no value and that no value reaches Verchestra
  on a presence check. Presence depends on its output format: an English or
  localized `<label>: <target>` line.
- **Absence from PowerShell logging under every policy.** Under `-Command -`,
  PowerShell reads stdin ahead of the program (measured below), so the value
  cannot be handed to the program as a separate data line. It travels as the
  base64 literal of one assignment line, `$verchestraPayload = '<base64>'`.
  That line holds no keyword that triggers PowerShell's automatic logging of
  suspicious script blocks. A machine that enforces **Script Block Logging** or
  **transcription** by policy would record it, so a write (and a read, which
  prints the value) first checks both policies in both policy hives and, if
  either is on, stops before the payload line runs and reports
  `VES_SECRET_STORE_LOGGED`. That the payload line is then never recorded
  relies on PowerShell running `-Command -` input one statement at a time,
  which the measurements below are consistent with; it was not observed under
  an enforced policy. Antimalware (AMSI) providers still see each line that
  runs, as they see every PowerShell line on the machine.
- **Zeroing of .NET strings.** The base64 literal and the base64 read result
  are .NET strings in the PowerShell child and cannot be zeroed. Every byte
  buffer that held the value is.

## Measured behavior that shaped the design

Each of these was observed on a hosted `windows-latest` runner (Windows
PowerShell 5.1). Each one is a guarded invariant with a test.

1. **`-Command -` owns stdin.** A program line that calls
   `[Console]::In.ReadLine()` receives nothing: the host has already read the
   following lines. The value is therefore part of the program text, on its own
   line, after a guard that stops on an enforced logging policy (see
   "Controls not claimed").
2. **`Add-Type` is slow in a clean environment.** With the allowlisted child
   environment, the `Add-Type` cmdlet took 23 to 33 s before it compiled
   anything (PowerShell's command discovery and a cold module-analysis cache),
   against about 0.7 s with the runner's full environment. The program
   therefore compiles its C# through `CSharpCodeProvider` directly and uses no
   cmdlet at all, so no module is discovered, loaded, or shadowed.
3. **A cold PowerShell start exceeds the presence budget.** Warm, the
   PowerShell program answered in about 0.3 to 0.4 s; the first start on a cold
   runner took 4083 ms in one run and, in run 36682126079, timed out at the 4 s
   presence budget on the first check of two suites. Deep doctor's probe
   budget is 5 s. Presence therefore runs `cmdkey`, a small native program,
   and PowerShell is used only for reads, writes, and deletes (read 30 s, write
   and delete 15 s). `cmdkey /list:<target>` reports `Type: Generic`,
   `User: <logical name>`, and `Local machine persistence` for what the
   program wrote, and never the value.
4. **The Credential Manager API never prompts.** A PowerShell or `cmdkey`
   child killed at its timeout is slow or stuck, not waiting for the user, so
   the timeout is a retryable `VES_SECRET_BACKEND_FAILURE`, not
   `VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED`. Every spawn is bounded (presence
   4 s, read 30 s, write and delete 15 s).
5. **A rotation is one call.** `CredWriteW` replaces the credential with the
   same target and type, so a rotation never leaves the credential absent.

## Value policy

The same policy as every platform: 1 to `MAX_CREDENTIAL_VALUE_BYTES` (1416)
bytes of printable ASCII without whitespace, inside Credential Manager's
2560-byte blob limit. An invalid value is refused before PowerShell is started.

## Evidence

### Gate evidence (every platform, never starts PowerShell)

No gate suite starts PowerShell or `cmdkey`. `tests/architecture/no-keychain-spawn-in-tests.test.mjs`
proves it, and `tests/helpers/deny-keychain-spawn.mjs` makes any such spawn
throw.

- `tests/unit/os-secret-backend-windows.test.mjs`: the fixed argv, the
  one-statement-per-line program, the advapi32 entry points, the
  logging-policy guard, generic type and machine-local persistence, the
  payload line, `cmdkey` presence parsing, result parsing, error and timeout
  mapping, rotation, the environment allowlist, and the platform mapping.
- `tests/security/os-credential-cross-platform-security.test.mjs`: argv,
  environment, error, and output non-disclosure; presence never receives the
  value; Workspace binding; `--keychain` refused; not-configured stores.
- `tests/integration/doctor-secret-backend.test.mjs`: deep doctor's `pass`,
  `blocked`, and `fail` on Windows.

### Real-store evidence

Credential Manager has no disposable instance, so the standalone suite
`spikes/os-secret-store/test/` (`pnpm qualify:keychain`) confines itself on
Windows to targets under a fresh random Workspace ID and deletes every one of
them in `finally`, then confirms through `cmdkey` that none remains. It covers
the round trip, rotation, the maximum value, persistence and type through the
witness, presence timing and non-disclosure of the value in PowerShell's argv,
stdout, and stderr, the value policy, the real timeout, and the full
`vestra secret` and `doctor --deep` journey with doctor reporting `pass` for a
bound credential.

It runs in `.github/workflows/os-credential-store.yml` on `windows-latest`.

### Recorded result

| Field | Value |
| --- | --- |
| Result | **PASS** — 20 tests, 20 passed, 0 failed, 0 skipped, 0 todo, 0 cancelled |
| Run | [36682622312](https://github.com/accd/verchestra/actions/runs/36682622312) (`workflow_dispatch`), job `credential-store (Windows)` 109782101995 |
| Revision | `a885a2b479d3dbb999765af9c5a0b9d2d19f96e3` on `feat/379-linux-windows-credential-stores` |
| Runner | `windows-2025-vs2026` image 20260922.246.2 (Windows Server 2025), win32 x64, Node v24.14.0, Windows PowerShell 5.1 |
| Witness | `cmdkey /list:<target>`: `Type: Generic`, `User: anthropic-api-key`, `Local machine persistence` |
| Measured | presence (`cmdkey`) 21 ms |

The same run passed the Linux and macOS legs (the macOS leg on a second
attempt, after the first attempt's pnpm setup failed on an npm network
timeout before any test ran). On this leg the Linux and macOS cases asserted
that their backends are refused on Windows. The revision before presence moved
to `cmdkey` (`e272a489e091f04847c56c17228e07f8f8418ad2`, run
[36682126079](https://github.com/accd/verchestra/actions/runs/36682126079))
failed exactly as measurement 3 describes; the one before that
(`95fbf7704bfe57e1a59d18053efdaed0ae809b2f`, run
[36681219761](https://github.com/accd/verchestra/actions/runs/36681219761))
passed on a warmer runner. This report changes only by recording results; the
revision after it differs from the tested one in documentation and in the
evidence digests alone.
