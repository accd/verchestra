---
schema: verchestra-feature-handoff/v1
feature: opencode-cancellation-race
issue: 109
status: in_progress
branch: codex/issue-109-opencode-cancellation
baseRevision: ff29bd9cfe549e4099cd05b0fd47d2e9c152f454
lastCompletedTask: T1
nextTask: Run the repository qualification gate
lastGate: focused cancellation sensor PASS (2026-07-29)
updatedAt: 2026-07-29T20:58:00Z
---

# Scope

Make the synthetic OpenCode pre-prompt cancellation qualification deterministic.

# Next Exact Action

Run the matching repository qualification gate after the package-install
minimum-age policy permits the isolated worktree. The focused barrier sensor
passes and preserves the abort-before-close and no-prompt assertions.

# Blockers

None.
