---
schema: verchestra-feature-handoff/v1
feature: opencode-runtime-1-19-4
issue: 581
status: verification
branch: requal/opencode-1.19.4
baseRevision: 58ad85ea05ef02a2ec6bfa392d87fedaa7c6d132
lastCompletedTask: T3
nextTask: "Push this qualification surface to the PR #581 branch and merge it by rebase through the maintainer bypass only after the exact-head required checks pass; then record in #563 that its OpenCode successor is done, leaving Pi 1.x and json-schema-to-typescript 16 open there."
lastGate: "qualify:opencode 23 of 23 with VES_REQUIRE_PINNED_PROVIDERS=1; every gate:quick stage, agent:check, and gate:full contract, fault and mutation PASS; integration and e2e fail only on this host's symlink EPERM and one named-pipe timing case that passes alone (validation.md)"
updatedAt: 2026-10-24T13:30:00Z
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
