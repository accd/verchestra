---
schema: verchestra-feature-handoff/v1
feature: dependency-pr-backlog
issue: null
status: complete
branch: dependabot/npm_and_yarn/earendil-works/pi-ai-0.82.1
baseRevision: b35dd6e8e1cd49b9f493e7306e35efb96a997cdf
lastCompletedTask: T5
nextTask: None; the #2-#8 batch is resolved
lastGate: pnpm gate:full
updatedAt: 2026-07-28T21:58:00Z
---

# Scope

Resolve DPR-01–DPR-08 across the seven open Dependabot pull requests while
preserving the exact Node 24.14.0 qualification and protected-main gates.

# Completed Evidence

T1 defined eight precise requirements and sequential merge safety. PR #3
merged as `595ea2d5d0d02fc6a76aad31e2e193094f974b39` after correcting both
pnpm Action pins to v6.0.8. PR #2 merged as
`5a887d1bef09381c3251c62c614aea464e6a3553` after every setup-node pin
reached v7.0.0; the manual agent-eval run also passed. PR #4 merged as
`b35dd6e8e1cd49b9f493e7306e35efb96a997cdf`; post-merge CI run
`30201082362` and CodeQL run `30201082347` passed.

The coordinated PR #5 worktree now pins both Pi packages to 0.82.1, records a
new immutable requalification report, groups future Pi updates, ignores only
the incompatible major `tuf-js` and `@types/node` proposals, and fixes the
OpenCode fixture path for Windows directories containing spaces. Frozen
offline install, 12 Pi outcomes, 17 OpenCode outcomes, 21 readiness outcomes,
`pnpm agent:check`, `pnpm gate:full`, `pnpm site:test`, and
`pnpm site:build` pass. Lighthouse met the unchanged 0.95 minimum on the first
clean run.

PR #5 merged as `build(deps): qualify Pi runtime 0.82.1`. The superseded and
incompatible proposals closed with their unblock conditions: #6 (`tuf-js` 6.0.0
major), #7 (split Pi proposal, superseded by #5), and #8 (`@types/node` 26
major). GitHub reports #2–#5 merged and #6–#8 closed, so DPR-01 through DPR-08
are resolved.

# Next Exact Action

None. This batch is complete. The July 2026 batch (#29–#32) is tracked
separately in `.specs/features/dependency-refresh-2026-07/`, which reuses this
feature's decisions: sequential merges, coordinated qualification units, and
closing superseded proposals with a stated unblock condition.

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
