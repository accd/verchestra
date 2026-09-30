---
schema: verchestra-feature-handoff/v1
feature: candidate-cross-platform-gates
issue: 405
status: verification
branch: fix/candidate-cross-platform-gates
baseRevision: d37c533f02e44adababb27211ad610b1499da98b
lastCompletedTask: T6
nextTask: "Independent review and maintainer merge. After merge, dispatch the T76 candidate build on main to confirm the five legs on the merged revision."
lastGate: "gate:quick, gate:build, gate:security, agent:check PASS locally; T76 candidate build 36763826241 green on all five legs"
updatedAt: 2026-09-30T00:00:00Z
---

# Scope

Fix the three legs of T76 candidate build 36756695837 that PR CI (Ubuntu only)
could not see: Windows x64 mediated and fixture assumptions plus probe host
skips, the macOS arm64 prompt-injection witness race, and the macOS x64
Darwin zombie-group EPERM in the process tree terminator. See `spec.md`;
evidence in `validation.md`.

# Next Exact Action

Review and merge. No code task remains on this branch.

# Open decisions

- The `if (!DARWIN) return` cases in the task CLI e2e and security suites still
  pass without asserting on Linux and Windows; the off-macOS refusal is asserted
  separately. Converting them is left to the task CLI owners.
- On win32 the mediated and probe host cases each assert the same refusal, so
  their counts match POSIX. A named-pipe bridge would replace those refusals.
