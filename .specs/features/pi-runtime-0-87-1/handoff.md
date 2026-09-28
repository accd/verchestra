---
schema: verchestra-feature-handoff/v1
feature: pi-runtime-0-87-1
issue: 415
status: verification
branch: requal/pi-0.85.1
baseRevision: 3a752a693aabdee3b6dfa5cbd4f0895dbd76c5a5
lastCompletedTask: T4
nextTask: Push the branch as the qualification successor of Dependabot #415 and wait for exact-head Linux CI and human review.
lastGate: corepack pnpm gate:full && corepack pnpm gate:security && corepack pnpm agent:check
updatedAt: 2026-09-29T14:00:00Z
---

# Evidence

The Pi packages, lockfile, Driver probe, spike contract, readiness policy,
qualification matrix, and report all agree on `0.87.1`. The #415 failures were
the exact-pin probe rejecting the new version. Pi 0.86.0 moved tool
declarations into a leading transcript system message; the freshness
integration test now asserts that exact provider-visible transcript. Local
counts and the discrimination sensor are in `validation.md`.

# Next exact action

Push this branch and wait for Linux CI on the exact head, including the Site job
whose Playwright browsers were not available locally. Close #415 with a link to
the qualified replacement once it merges.
