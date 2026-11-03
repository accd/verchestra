---
schema: verchestra-feature-handoff/v1
feature: opencode-runtime-1-19-4
issue: 581
status: complete
branch: requal/opencode-1.19.4
baseRevision: 58ad85ea05ef02a2ec6bfa392d87fedaa7c6d132
lastCompletedTask: T3
nextTask: "None. Merged by the owner on 2026-10-24 as 81d7fd26 (#581) after the required checks passed on the exact head; no independent review is recorded (#553). The successor was recorded in #563 the same day, and #563 closed on 2026-10-28."
lastGate: "qualify:opencode 23 of 23 with VES_REQUIRE_PINNED_PROVIDERS=1; every gate:quick stage, agent:check, and gate:full contract, fault and mutation PASS; integration and e2e fail only on this host's symlink EPERM and one named-pipe timing case that passes alone (validation.md)"
updatedAt: 2026-11-03T15:50:00Z
---

# Evidence

The manifest, lockfile, OpenCode probe, drift discrimination, policy test,
matrix, report, and handoff all agree on `1.19.4`, npm's `latest` at
requalification time, rather than the `1.18.35` of #549 or the `1.19.3` of
#581. The lockfile change moves only the two packages and their platform
binaries. The upstream `v1.18.33...v1.19.4` range was reviewed; no change
weakens cancellation, event handling, permissions, abort and shutdown, or
session privacy, and session sharing is now impossible upstream. The published
SDK's runtime files are byte-identical to `1.18.33`. Local OpenCode
qualification passes at zero skips; GitHub Linux checks remain authoritative.

# Context

#580 had moved Pi to `1.3.0` without its successor and turned `main` red;
#587 reverted it (`58ad85e`) before this change was rebased, so this branch
starts from the qualified Pi `0.99.1`.

# Next exact action

Push this qualification surface to the PR #581 branch, then merge it by rebase
only after the required checks pass on that exact head, and verify the merge by
content.

# Reconciliation (2026-11-03)

Merged to `main` through #581 on 2026-10-24 as `81d7fd26`, by rebase
through the maintainer bypass, after every required check passed on the
exact head `9862635d`. The owner's is the only review; #553 governs a
post-merge independent review. Nothing is left in this feature.

The OpenCode successor was recorded in #563 the same day. #563 closed on
2026-10-28, once the Cedar, `json-schema-to-typescript` and Pi successors had
landed. Dependabot's OpenCode 1.19.5 proposal (#717) was closed on
2026-11-01 without a successor, because that release carries no security
fix.
