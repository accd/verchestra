# OS Secret Backend — Linux and Windows Threat Model

Extends `.specs/features/os-secret-backend/threat-model.md` (AD-034) to the
Secret Service and Credential Manager backends (AD-041).

| Threat | Mitigation | Residual |
| --- | --- | --- |
| The value leaks through argv or the environment of a store program. | The value travels only on stdin; argv is fixed or attribute-only; the child environment is an allowlist. | None known. |
| A PATH entry substitutes the store program. | Absolute paths: `/usr/bin/secret-tool`, `/usr/bin/dbus-send`, and PowerShell under a validated `SystemRoot`; the child PATH is fixed. | A same-user attacker who controls `SystemRoot` already controls the user's session. |
| A presence check (deep doctor) reads the value. | Linux presence is `SearchItems` (paths only). Windows presence returns only `present`/`absent`; the blob is zeroed and freed inside the PowerShell child. | Windows presence decrypts inside the child. |
| A locked keyring reads as "absent", so the user re-binds or a delete silently does nothing. | A lookup miss is confirmed by `SearchItems`; a locked-only match is interaction-required everywhere. | None known. |
| A missing bus autolaunches a new, empty session bus. | `DISPLAY` is withheld from the child, so libdbus cannot autolaunch through X11. | None known. |
| PowerShell logging records the Windows payload line or the read output. | A guard checks Script Block Logging and transcription in both policy hives and stops before the payload line runs. | AMSI providers see each line; the guard's effect is not observed under an enforced policy. |
| A PowerShell module shadows the cmdlet the program calls. | The program calls no cmdlet; it compiles through `CSharpCodeProvider`. | None known. |
| A gate test touches the owner's keyring or Credential Manager. | The spawn guard refuses all four tools; the architecture test enforces it; real-store tests run only in `pnpm qualify:keychain`. | None known. |
| The qualification suite touches the owner's real store. | Linux: a private bus without activation and a temporary HOME, and every spawn is checked against it. Windows: random targets deleted in `finally` and witnessed by `cmdkey`. | The Windows suite writes, then deletes, random targets in the owner's real Credential Manager. |
| Another same-user process reads the credential. | Not mitigated; stated in each report. | By design of every OS store for a CLI-owned readable credential. |
