# Owner-only ACL proof for a non-elevated Windows user

## Problem

`proveOwnerOnlyDirectory` (`packages/platform-node/src/windows-acl.ts`) made a
per-run directory owner-only only through `icacls <parent> /restore <file>`.
`/restore` needs `SeRestorePrivilege`, which only an elevated token holds. For a
standard user, or an administrator in a UAC-filtered session, it exits 1300
(`ERROR_NOT_ALL_ASSIGNED`), the proof stops at `replace`, and the Windows
named-pipe bridge refuses every run with `VES_BRIDGE_NOT_CONFIGURED` /
`owner-only-acl` (#555). Every Windows leg of the platform matrix runs elevated,
so the matrix did not show it.

## Requirements

- **WAN-01**: For a standard, non-elevated user on a default Windows 11
  install, the proof SHALL succeed through `icacls <dir> /inheritance:r
  /grant:r *<SID>:(OI)(CI)F` and its read-back, without attempting `/restore`.
- **WAN-02**: When the grant's read-back is not owner-only (a directory with
  explicit entries of its own, as on the hosted runner), the proof SHALL fall
  back to the whole-DACL `/restore` and its read-back. Without elevation that
  fallback SHALL refuse at `replace`, as before.
- **WAN-03**: `isOwnerOnlyDacl` SHALL be unchanged: no DACL is accepted that
  was refused before, and the grant's result is accepted only through it.
- **WAN-04**: `docs/quick-start.md` SHALL state that the Windows prerequisites
  need no elevation.
- **WAN-05**: The real-host security case SHALL pass for a non-elevated user and
  on the Windows leg of the platform matrix.

## Scope

One function and one argument builder in `windows-acl.ts`, its unit tests, and
one table row of the quick start. `/remove:g` per remaining trustee, which the
issue lists as an option, is not added: on a standard user's directory the
grant alone is owner-only, and a directory with extra explicit entries is the
runner's, which is elevated and takes the existing restore.
