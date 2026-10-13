---
schema: verchestra-feature-handoff/v1
feature: tuf-timestamp-refresh
issue: 382
status: verification
branch: feat/382-tuf-timestamp-refresh
baseRevision: 43916540bc9e3b86328808887fa2a8c5ce82084c
lastCompletedTask: T5
nextTask: "Merged without independent review on 2026-09-30 (#428); post-merge review pending (#553). Proposed for the security reviewer. The online key was provisioned under custody on 2026-09-30 (#440); the monthly refresh procedure in republish-v3-runbook.md stays the owner's."
lastGate: "gate:quick, gate:build, gate:security, gate:release, agent:check PASS"
updatedAt: 2026-10-13T19:50:00Z
---

# Scope

The monthly online TUF timestamp/snapshot re-signing routine (#382). It makes a
short `timestamp_expires` window (the #18 F2 freeze-attack defense)
operationally safe. See `spec.md` for requirements and `validation.md` for
evidence.

# Next Exact Action

Review and merge. No code task remains on this branch. The branch is stacked on
`fix/tuf-metadata-version-safety` (#391, #387), which must merge first.

# What is intentionally unchanged

- No key is generated, provisioned, or committed. Until the owner commits
  `docs/qualification/trust/release-timestamp-snapshot-public-key.json`, the
  refresh fails closed with `VES_T76_PUBLISH_ANCHOR_MISSING`.
- The publish script does not check anchor purposes. Only the refresh does, so
  existing publish behavior and tests are unchanged.
- `docs/qualification/release-decision-1.0.0.md` is a signed decision record and
  is not edited, although it names #382 as open.

# Open decisions

- The refresh workflow needs `actions: read` besides `contents: read`: the
  offline-signed root, targets, and components come from the exact
  `t76-publish-release` run's metadata artifact, and `download-artifact` needs
  `actions: read` to read another run's artifact. The only alternative is
  fetching them from the live endpoint, which would add a network client to the
  signing job. Both scopes are read-only.
- The publish workflow's new `timestamp_expires` input is required with no
  default, so operators must now pass it (the same value as `expires` keeps the
  full horizon). This follows the `metadata_version` rule from #387.
- The publish artifact the refresh reads is retained for 365 days. A lineage
  refreshed after that needs its offline-signed metadata re-supplied, or a new
  publication.
- A refresh ledger entry is chained against `main`'s ledger at refresh time. If
  another entry lands first, the operator reruns the refresh rather than
  editing the entry.

# Post-merge review status (2026-10-13)

Merged without independent review on 2026-09-30 (#428); post-merge review
pending (#553). Proposed for the security reviewer.
