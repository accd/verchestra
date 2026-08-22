---
schema: verchestra-feature-handoff/v1
feature: opencode-cancellation-race
issue: 109
status: complete
branch: codex/issue-109-opencode-cancellation
baseRevision: e2d3a251b0fe87de0b566563a258651bd8a467d9
lastCompletedTask: T1
nextTask: No further action; issue #109 is closed.
lastGate: GitHub Quality/Site/CodeQL PASS on 170b3fc; rerun required after sensor strengthening
updatedAt: 2026-08-22T18:00:00Z
---

# Scope

Make the synthetic OpenCode pre-prompt cancellation qualification deterministic.

# Next Exact Action

Run the focused five-iteration barrier sensor, then CI. The local worktree's
package-install policy may prevent a full local gate; CI evidence must name the
exact strengthened head. The barrier must prove an SDK abort exists, precedes
server close, and prevents prompt dispatch in every iteration.

# Blockers

None.
