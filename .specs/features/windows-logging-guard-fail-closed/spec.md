# Windows logging-policy guard fails closed

## Problem

The Windows Credential Manager backend feeds its program to
`powershell.exe -Command -`. `LOGGING_POLICY_GUARD` must stop a read or write
before the value line when PowerShell Script Block Logging or transcription is
enforced (XOS-05, AD-041). Under `-Command -` a line that throws does not end the
program, even with `$ErrorActionPreference = 'Stop'`: the host reports the error
and runs the next line. In Constrained Language Mode (WDAC or AppLocker) the
preamble and the guard both throw, the write's payload line runs anyway, and the
program exits 0; the write then fails as a generic `VES_SECRET_BACKEND_FAILURE`
(#565). On a locked-down machine that also enforces logging, the payload line is
what that logging would record.

## Requirements

- **LGF-01**: A read or write program SHALL reach its value line only if the
  guard ran to its last statement; otherwise it SHALL end with exit 3 and no
  output.
- **LGF-02**: The guard SHALL refuse any language mode other than
  `FullLanguage` before reading the registry.
- **LGF-03**: Exit 3 SHALL be reported as `VES_SECRET_STORE_LOGGED`, never as a
  generic failure.
- **LGF-04**: On real Windows PowerShell, a write in Constrained Language Mode,
  and a write whose guard throws in full language mode, SHALL end before the
  payload line and write nothing.
- **LGF-05**: Behaviour with a passing guard SHALL be unchanged: the same
  preamble, the guard, then the value line; delete carries no guard.

## Scope

`windows-credential-manager.ts` (the guard, one gate line, the exit-3 outcome),
its unit tests, two real-store cases in the spike, XOS-05 and one sentence in
AD-041. The named-pipe helper embeds the same guard, so its pinned digest moves
(`tests/unit/windows-pipe-transport.test.mjs`); a helper that exits 3 ends
before it listens, which the transport already refuses as
`VES_BRIDGE_CHANNEL_FAILED`. Under `-File` a throw already ends that script, so
it takes no gate. The qualification report
`docs/qualification/os-secret-backend-windows.md` is immutable evidence for its
revision and is not rewritten.
