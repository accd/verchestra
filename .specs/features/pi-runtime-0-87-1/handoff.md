---
schema: verchestra-feature-handoff/v1
feature: pi-runtime-0-87-1
issue: 415
status: complete
branch: requal/pi-0.85.1
baseRevision: c4bfe0d7d61edd2d6e739c920736a553a220835d
lastCompletedTask: T4
nextTask: "None. Superseded: Pi moved to 0.99.1 (#510) and then to 1.4.0 (#659), and the owner closed this handoff as superseded on 2026-11-03, as it offered. #415 stays on the list #553 regenerates."
lastGate: corepack pnpm gate:full && corepack pnpm gate:security && corepack pnpm agent:check
updatedAt: 2026-11-03T15:50:00Z
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

# Post-merge review status (2026-10-13)

Merged without independent review on 2026-09-30 (#415); post-merge review
pending (#553). Superseded by pi-runtime-0-99-1 (#510).

# Reconciliation (2026-11-03)

Closed as superseded by the owner's decision of 2026-11-03, which this
handoff offered. Pi moved from `0.87.1` to `0.99.1` in #510
(`pi-runtime-0-99-1`) and to `1.4.0` in #659 on 2026-10-28, so `0.87.1` is no
longer the qualified version. #415 was merged without independent review and
stays on the list #553 regenerates.
