---
schema: verchestra-feature-handoff/v1
feature: windows-acl-non-elevated
issue: 555
status: verification
branch: fix/555-windows-acl-non-elevated
baseRevision: 754eb1adb992aa994c04449c54c61cbfc1fe21d6
lastCompletedTask: T4
nextTask: "T5 remainder: one run of tests/security/windows-pipe-bridge-security.test.mjs on a second non-elevated Windows machine, recorded in validation.md (the platform matrix, run 39816518151, is recorded); then independent review and maintainer merge."
lastGate: "Windows 11, non-elevated: windows-acl unit 48/48, windows-pipe-bridge security 17/17, task-windows 15/15, 0 skipped; see validation.md"
updatedAt: 2026-10-22T18:30:00Z
---

# Evidence

T1 to T4 are recorded in `validation.md`: the failure reproduced at `replace`
with `/restore` exit 1300 on a non-elevated Windows 11 user; the grant-first
proof passes the real-host cases on the same machine; `isOwnerOnlyDacl` is
unchanged; a mutation that accepts the grant without verifying it is killed by
seven unit tests.

# Next exact action

Read the Windows leg of the pull request's platform matrix run and ask for one
run of the real-host security case on a second non-elevated Windows machine
(offered on #555). Record both in `validation.md`, mark T5, and move this
handoff to `complete` after review and merge.
