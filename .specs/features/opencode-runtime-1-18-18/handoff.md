---
schema: verchestra-feature-handoff/v1
feature: opencode-runtime-1-18-18
issue: 277
status: verification
branch: codex/rebase-pr277
baseRevision: 7028d7fc4f3483b38569001e9b5cb0754e9f04a4
lastCompletedTask: T3
nextTask: Push the exact qualification surface, wait for Quality/Site/CodeQL, then merge with rebase only if all pass
lastGate: corepack pnpm gate:quick
updatedAt: 2026-08-22T12:05:00Z
---

# Evidence

The manifest, lockfile, OpenCode probe, policy test, matrix, report, and
handoff all agree on `1.18.18`. Local OpenCode qualification and the quick gate
pass; GitHub Linux checks remain authoritative.

# Next exact action

Push this final qualification surface, re-approve the exact head, and merge
only after the required checks pass.
