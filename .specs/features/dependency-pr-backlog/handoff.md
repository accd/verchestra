---
schema: verchestra-feature-handoff/v1
feature: dependency-pr-backlog
issue: null
status: in_progress
branch: maintenance/dependency-pr-backlog
baseRevision: 3d7f4cf2955843864214b9a3ead479c71f9e95f9
lastCompletedTask: T1
nextTask: T2
lastGate: pnpm agent:check
updatedAt: 2026-07-26T10:47:00Z
---

# Scope

Resolve DPR-01–DPR-08 across the seven open Dependabot pull requests while
preserving the exact Node 24.14.0 qualification and protected-main gates.

# Completed Evidence

T1 complete. The dependency backlog specification defines eight precise
requirements, seven atomic tasks, sequential merge safety, exact qualification
boundaries, and zero-open acceptance. `pnpm agent:check` passed.

# Next Exact Action

Correct PR #3 to the exact pnpm Action v6.0.8 release commit and matching
comments, then run its required checks.

# Blockers

None.

# Decisions

- Compatible PRs merge sequentially after required checks.
- Incompatible and superseded PRs close with exact unblock conditions.
- Pi 0.82.1 is one coordinated qualification unit.
- Lighthouse remains at the existing 0.95 minimum.

# Files Intentionally Left Unchanged

- Product implementation and the T69–T77 roadmap chain.
- Node 24.14.0 and `tuf-js` 5.0.1 qualification.
- Public website content and generated contracts.
