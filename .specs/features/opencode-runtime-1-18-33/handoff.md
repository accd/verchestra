---
schema: verchestra-feature-handoff/v1
feature: opencode-runtime-1-18-33
issue: 400
status: verification
branch: requal/opencode-1.18.23
baseRevision: e0beb57dc72f7a125184ce46130415b74d7c6fa2
lastCompletedTask: T3
nextTask: Push the exact qualification surface to PR #400, wait for Quality/Site/CodeQL, then merge with rebase only if all pass
lastGate: pnpm gate:full
updatedAt: 2026-09-29T14:00:00Z
---

# Evidence

The manifest, lockfile, OpenCode probe, policy test, matrix, report, and
handoff all agree on `1.18.33`, the latest `1.18.x` release at
requalification time, rather than the `1.18.23` that #400 first proposed. The
upstream `v1.18.18...v1.18.33` range was reviewed; no change weakens
cancellation, event handling, permissions, abort and shutdown, or session
privacy. Local OpenCode qualification, `test:qualification`, and the quick and
full gates pass; GitHub Linux checks remain authoritative.

# Next exact action

Push this qualification surface to the PR #400 branch, re-approve the exact
head, and merge only after the required checks pass.
