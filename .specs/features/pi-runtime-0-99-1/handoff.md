---
schema: verchestra-feature-handoff/v1
feature: pi-runtime-0-99-1
issue: 490
status: verification
branch: deps/pi-runtime-0-99-1
baseRevision: 9448f139f51780ae39bb08aafe023c5217128f94
lastCompletedTask: T4
nextTask: Push the branch as the qualification successor of Dependabot #490 and wait for exact-head Linux CI and human review.
lastGate: corepack pnpm gate:build && corepack pnpm gate:security && corepack pnpm agent:check
updatedAt: 2026-10-03T16:50:00Z
---

# Evidence

The Pi packages, lockfile, Driver probe, spike contract, readiness policy,
qualification matrix, and report all agree on `0.99.1`. The #490 failure was
the exact-pin probe rejecting the new version. Every Driver sequence the Pi
suites pin passed unchanged. Pi 0.99.0 now completes a tool that reports
`isError: true` as an error; the spike pins that outcome. Local counts and the
discrimination sensor are in `validation.md`.

# Next exact action

Push this branch and wait for Linux CI on the exact head, including the Site job
that renders the new report. Close #490 with a link to the qualified replacement
once it merges.
