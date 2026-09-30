---
schema: verchestra-feature-handoff/v1
feature: os-secret-backend-cross-platform
issue: 379
status: verification
branch: feat/379-linux-windows-credential-stores
baseRevision: f0d01e01ad2a98d7521e9aca0ae4f28ffe666899
lastCompletedTask: T8
nextTask: "T9 — independent review of AD-041, in particular the Windows value channel (a base64 literal line guarded by the PowerShell logging-policy check) versus the alternative of a script via -EncodedCommand with the value as stdin data"
lastGate: "GATE_PLACEHOLDER"
updatedAt: 2026-09-30T00:00:00Z
---

# Scope

Issue #379 on Linux and Windows: qualified readable-credential stores under
the AD-034 contract, so `vestra secret` and deep doctor's secret-presence check
work on every supported platform. Requirements XOS-01 to XOS-12 in `spec.md`;
decision AD-041 in `.specs/STATE.md`; threats in `threat-model.md`.

# Completed Evidence

- `LinuxSecretServiceBackend`: `secret-tool` store, lookup, and clear, with
  presence through SearchItems via `dbus-send`, locked-item detection, and
  not-configured reporting.
- `WindowsCredentialManagerBackend`: Windows PowerShell with an inline
  P/Invoke of advapi32 `CredReadW`, `CredWriteW`, and `CredDeleteW`, compiled
  without cmdlets. It uses generic, machine-local credentials and a
  logging-policy guard.
- The shared bounded runner (`credential-tool.ts`) and two new public errors:
  `VES_SECRET_STORE_UNAVAILABLE` and `VES_SECRET_STORE_LOGGED`.
- `docs/qualification/os-secret-backend-linux.md` and `…-windows.md`, bound by
  digest.
- `.github/workflows/os-credential-store.yml`, green on all three platforms in
  run 36681219761.
- Gate isolation now also covers `secret-tool`, `dbus-send`, and PowerShell.

# Next Exact Action

Submit `feat/379-linux-windows-credential-stores` for independent review. The
reviewer ratifies or amends AD-041, and in particular:

- the Windows value channel;
- `CRED_PERSIST_LOCAL_MACHINE`;
- `dbus-send` as a second Linux program;
- doctor `blocked` for a store that is not running.

# Owner actions

1. After review, merge, then run `vestra secret set --name anthropic-api-key`
   and `vestra doctor --deep` once on a real Linux desktop and a real Windows
   logon, and record the verdicts.
2. When PR #430, which records the macOS owner run, merges, update the darwin
   report's paragraph that says Linux and Windows have no backend, then rebind
   `DARWIN_KEYCHAIN_CREDENTIAL_QUALIFICATION.digest`. That paragraph was left
   alone here to avoid a conflict with #430.
