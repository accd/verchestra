---
schema: verchestra-feature-handoff/v1
feature: cedar-4-14-0
issue: 563
status: complete
branch: main
baseRevision: b5819c6e24d9d7ac97f09171eaf91ff23bcb7bc2
lastCompletedTask: T3
nextTask: "None in this feature."
lastGate: "PR #649 merged by rebase through the maintainer bypass at 2026-10-28T14:28:39Z (main 935ac83; the diff main gained equal to the PR's over #650's 39791d6 apart from blob hashes and hunk offsets, same file set) with Quality gate, Site quality and CodeQL passing on the head 4aeb80c; fleet run 40701350945 (gate=security) green on all five legs; no independent review, so the four injected faults and the upstream review in validation.md and the report are the record"
updatedAt: 2026-10-28T15:20:00Z
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

None in this feature.
