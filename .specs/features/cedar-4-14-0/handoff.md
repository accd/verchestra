---
schema: verchestra-feature-handoff/v1
feature: cedar-4-14-0
issue: 563
status: verification
branch: build/563-cedar-4-14
baseRevision: b5819c6e24d9d7ac97f09171eaf91ff23bcb7bc2
lastCompletedTask: T3
nextTask: "Open the PR, merge it by rebase through the maintainer bypass only after the required checks pass on its exact head, verify the merge by content, then record in #563 that the Cedar successor is done, leaving Pi 1.x and json-schema-to-typescript 16 open there."
lastGate: "qualify:cedar 52 of 52 at zero skips; policy suites 106 of 106; four injected faults killed; gate:quick and agent:check results in validation.md"
updatedAt: 2026-10-28T13:30:00Z
---

# Evidence

Both manifests, the lockfile, the adapter and spike-oracle pins, both loaders'
reported identity, the corpus, the report and this handoff agree on Cedar
`4.14.0` with language `4.6`. The lockfile moves only Cedar and the peer
suffix of `@strands-agents/sdk`, which names it as an optional peer
(`^4.0.0`). The upstream `v4.12.0...v4.14.0` range is reviewed in
`docs/qualification/cedar-4.14.0.md`: the two changes that reach the
functions Verchestra calls, a misapplied scope becoming a validation warning
and partial schemas with `external` declarations, are each denied with
`VES_POLICY_VALIDATION_FAILED`, proven on the real engine by two new corpus
entries that the spike oracle and the product adapter both run.

# Next exact action

Open the PR, merge it by rebase only after the required checks pass on its
exact head, verify by content, and comment on #563.
