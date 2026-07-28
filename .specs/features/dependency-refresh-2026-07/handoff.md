---
schema: verchestra-feature-handoff/v1
feature: dependency-refresh-2026-07
issue: null
status: in_progress
branch: deps/opencode-1.18.7-requalification
baseRevision: 8cf6783787c7f61e570fa04a38e02b3bf17ecaf5
lastCompletedTask: T2
nextTask: T3
lastGate: pnpm gate:full
updatedAt: 2026-07-28T21:58:00Z
---

# Scope

Resolve DRF-01–DRF-08 across the four open Dependabot pull requests (#29–#32)
without weakening a qualification boundary, and stop Dependabot from splitting
the OpenCode qualification unit again.

# Completed Evidence

T1 complete. prettier 3.9.6 merged as `8cf6783787c7f61e570fa04a38e02b3bf17ecaf5`
(#32). `format:check` reformatted nothing and `gate:quick` passed before merge.

T2 complete. Both OpenCode packages move to 1.18.7 as one unit. The change is
deliberately narrow: only
`spikes/opencode-driver/test/opencode-driver.test.mjs:57` tracks the installed
version, because it is the sole assertion that probes the real repo-local
binary. Everything else in that suite, and the whole product contract suite,
drives a fake host through `tests/helpers/opencode-driver-fixture.mjs`, so
`minimumVersion` stays 1.17.18 in the spike and in
`packages/drivers/src/opencode-driver.ts` and a 1.17 host is still accepted.

`docs/qualification/opencode-driver-1.18.7.md` supersedes the package-version
identity in the T05 report without editing it, following the Pi 0.82.1
precedent. `.github/dependabot.yml` now groups `opencode-ai` with
`@opencode-ai/*`, and `tests/agent-readiness/dependency-policy.test.mjs`
asserts both the grouping and that the manifest and every lockfile entry
resolve to one exact 1.18.7 — the same pair of guarantees the Pi runtime has.

Gates: `corepack pnpm qualify:opencode` 17 passed / 0 failed / 0 skipped;
`pnpm test:qualification` 248 passed / 0 failed / 0 skipped; `pnpm gate:full`
PASS across format:check, lint, typecheck, test:unit, test:contract,
test:integration, test:e2e, and test:fault; `pnpm agent:check` PASS.

An intermediate attempt raised `minimumVersion` to 1.18.7 in four places and
was reverted: it would have rejected 1.17 hosts that work today, which is a
product decision rather than a dependency refresh.

# Next Exact Action

T3: after this pull request merges, close #30 and #31 as superseded by the
coordinated change, each with the reason (a split unit installs an unqualified
1.18.7 / 1.17.18 pair) and the unblock condition (future OpenCode updates
arrive grouped, so no split pull request should reappear). Then T4: jose 6.2.4
(#29) under `gate:quick` and `gate:security`.

# Blockers

None.

# Decisions

- OpenCode 1.18.7 is one coordinated qualification unit; the split proposals
  are superseded, not merged.
- The supported floor stays 1.17.18; narrowing it needs its own change.
- 1.18.7 is qualified rather than the newer 1.18.9, so the change stays
  traceable to the pull requests it closes.
- Recurrence is prevented by a grouping rule plus a test, not by documentation.
- The stale `dependency-pr-backlog` handoff is closed in the same change: its
  batch (#2–#8) merged long ago, but its body still directed a successor to
  push the already-merged PR #5.

# Files Intentionally Left Unchanged

- `docs/qualification/opencode-driver.md` and `t05-validation.md`; superseded,
  not rewritten.
- `minimumVersion` in `packages/drivers/src/opencode-driver.ts` and the fake
  host default.
- Product implementation and the T68a–T77 roadmap chain.
