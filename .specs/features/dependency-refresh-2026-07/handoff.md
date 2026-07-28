---
schema: verchestra-feature-handoff/v1
feature: dependency-refresh-2026-07
issue: null
status: verification
branch: deps/requalify-opencode-1.18.9-cedar-4.12.0
baseRevision: e9e9def5314a69822aaff75df8a67bfa256fb41d
lastCompletedTask: T6
nextTask: T7
lastGate: pnpm gate:security
updatedAt: 2026-07-28T22:35:40Z
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

T3 complete. #30 auto-closed when `main` moved and carries a comment recording
the supersession reason; #31 was closed explicitly, because it would have set
`@opencode-ai/sdk` to 1.18.9 against `opencode-ai` 1.18.7 — the split pair the
new policy test now rejects outright. Both comments state the unblock
condition.

T4 complete. jose 6.2.4 merged as `c927876` (#29) after `pnpm gate:security`
PASS, including the 912-test security suite that covers the recovery and
support bundle paths where jose is used
(`packages/evidence/src/{recovery,support}-bundle/`).

T5 complete. The original batch reached zero open Dependabot pull requests.
The weekly Dependabot run then opened five more, which this feature absorbs:
\#44 `pnpm/action-setup` v6.0.9, #46 `@astrojs/check` 0.9.10, #48
`@astrojs/starlight` 0.41.5, #45 the grouped OpenCode 1.18.9, and #47
`@cedar-policy/cedar-wasm` 4.12.0.

T6 complete. #44, #46, and #48 merged after verification. The
`pnpm/action-setup` v6.0.9 annotated tag was dereferenced against the GitHub
API and matches the proposed commit
`0ebf47130e4866e96fce0953f49152a61190b271` exactly. The two Astro bumps were
verified together: `gate:quick` PASS, 31 site unit tests, `astro check` clean
across 27 files, a 120-page build, and `check:built` reporting
`internalLinks: valid`.

T7 in progress on this branch. #45 (OpenCode 1.18.9) and #47 (Cedar 4.12.0)
both carry qualification pins, so both are superseded by this coordinated
requalification:

- OpenCode moves to 1.18.9 with
  `docs/qualification/opencode-driver-1.18.9.md`. Arriving as **one** grouped
  pull request is the T2 grouping rule working as intended.
- Cedar moves to 4.12.0 with `docs/qualification/cedar-4.12.0.md`. Cedar is
  different from a driver floor: the oracle denies on any version inequality
  and `@cedar-policy/cedar-wasm` is a direct runtime dependency of
  `packages/policy`, so the expected version must move with the shipped engine
  or every authorization fails closed. The Cedar **language** version stays
  4.5, so no policy changes meaning, and the deliberately mismatched 4.11.1
  used to prove fail-closed behavior stays different from the real engine.

Gates on this branch: `qualify:cedar` 50/50, `qualify:opencode` 17/17,
`pnpm gate:security` PASS across all nine stages.

# Next Exact Action

T7: merge this pull request, then close #45 and #47 as superseded with their
reasons and unblock conditions, and confirm zero open Dependabot pull requests
with `main` green.

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
