# Owner-only ACL proof for a non-elevated Windows user: validation

**Date:** 2026-10-22
**Diff:** `fix/555-windows-acl-non-elevated`, developed on `8056d41b5ab615ce7dc536db400e09f136565c61` and rebased onto `754eb1adb992aa994c04449c54c61cbfc1fe21d6` (#541); the gates below ran on the first base, and the three Windows ACL suites were rerun green on the rebased head
**Host:** Windows 11 Pro x64, Node 24.14.0, PowerShell 7 at the pinned path, a
standard user session that is not elevated (`whoami /priv` lists neither
`SeRestorePrivilege` nor `SeBackupPrivilege`).
**Verifier:** the implementing agent's local pass; independent review and the
platform matrix on the pull request head remain required (T5).

## Reproduction before the change (T1)

`tests/security/windows-pipe-bridge-security.test.mjs`, "win32: the system tools
prove a real per-run directory owner-only", failed with the diagnosis
`{"step":"replace", ..., "restore":{"status":1300,"stdout":"Successfully
processed 0 files; Failed processing 0 files", ...}}`, exactly as #555 records.
`tests/unit/task-windows.test.mjs`, "the node host hands the check the
named-pipe transport and the real ACL proof", failed in `gate:quick` on `main`
for the same reason.

## Acceptance evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| WAN-01 | `tests/unit/windows-acl.test.mjs`, "a standard user's directory is proven owner-only by the grant, and the privileged restore is never attempted (#555)": the calls are `whoami`, the grant, the read-back, and nothing else; no restore file is written. Real host: `windows-pipe-bridge-security.test.mjs` 17 of 17 and `task-windows.test.mjs` 15 of 15 on the non-elevated session above, 0 skipped. | PASS |
| WAN-02 | "on the hosted runner's outputs the grant is not enough, so the whole-DACL restore runs and is proven with the single LA entry": grant, read-back, restore, read-back. "a standard user whose grant leaves other entries is refused, because the restore needs elevation (#555)" and the failure table's `replace` rows: the edited DACL is never accepted, and a refused restore stops at `replace`. | PASS |
| WAN-03 | `isOwnerOnlyDacl` is unchanged in the diff; its tests are unchanged and pass. The grant's result is accepted only through it. | PASS |
| WAN-04 | `docs/quick-start.md`, Windows prerequisites, `owner-only-acl` row: no administrator rights or elevated session are needed. `pnpm site:check` PASS. | PASS |
| WAN-05 | The non-elevated real-host run above. Platform matrix run 39816518151 (`gate: security`) on `ce8b982`: Windows x64, macOS x64 and arm64, Linux glibc x64 and arm64, and the evidence index all green; the Windows leg is the elevated runner path (grant, then restore). #555 asks for one recorded run on a non-elevated Windows user, which the host run above is; a second person's machine qualifies but is not required, and remains welcome. | PASS |

## Discrimination sensor

A mutant of `proveOwnerOnlyDirectory` that accepts the grant's read-back without
`isOwnerOnlyDacl` was killed by seven unit tests (41 of 48 passed), among them
the runner-path test, the standard-user refusal, the planted restore file, and
the `replace` and `verify` rows of the failure table. The source was restored
from memory after the run; the committed file is the reviewed one.

## Gates on this host

| Stage | Result | Failures, all environment cases of this host |
| --- | --- | --- |
| `gate:quick` static stages (format, lint, complexity, typecheck) | PASS | |
| `test:unit` | 2996 of 2997 | `task-billing.test.mjs:192`, symbolic-link privilege (`EPERM symlink`) |
| `test:contract` | 957 of 957 | |
| `test:architecture` | 132 of 132 | |
| `test:qualification` | 358 of 358 | |
| `test:e2e` | 300 of 301 | `task-cli-e2e.test.mjs:888`, symbolic-link privilege |
| `test:security` | 1351 of 1354 | `worktree-tool-security.test.mjs:31` and `:41`, symbolic-link privilege; `task-suspension-security.test.mjs:39`, the temporary directory is under the home directory, so the refusal's path names it |
| `test:fault` | 310 of 310 | |

`gate:security` itself stops at its first failing stage, so the stages after
`test:unit` were run one by one. On `main` at the base revision the same
`test:unit` symbolic-link case fails, and the two ACL cases this change fixes
fail as well. No test was skipped, removed or weakened.

## Security review

Passive pass against command-injection guidance: the tools are System32
executables by absolute path; `runBoundedChild` spawns with `shell: false` and an
argument array; the SID enters the grant only after the strict `SID` pattern,
and `ownerOnlyGrant` refuses anything else (`TypeError`, unit-tested); the
directory comes from `mkdtemp` in the transport's own root and is empty when
the proof runs. The window between the grant and its read-back is the one the
restore already had (threat model D7).
