---
schema: verchestra-feature-handoff/v1
feature: candidate-cross-platform-gates
issue: 405
status: complete
branch: fix/candidate-cross-platform-gates
baseRevision: 27eced58a714e846576f6a5754a6afba863ddcf8
lastCompletedTask: T6
nextTask: "None. Post-merge independent review of #439 on 2026-10-13: no findings (https://github.com/accd/verchestra/pull/439#issuecomment-6153567250). The five legs were confirmed on every later candidate build, .4 to .7. Tracked in #553."
lastGate: "gate:quick, gate:build, gate:security, agent:check PASS locally; T76 candidate build 36763826241 green on all five legs"
updatedAt: 2026-10-13T19:50:00Z
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

# Post-merge review status (2026-10-13)

Post-merge independent review of #439 on 2026-10-13, verdict no findings:
https://github.com/accd/verchestra/pull/439#issuecomment-6153567250. The five
legs were confirmed on every later candidate build (.4 to .7). No feature task
remains; tracked in #553.
