---
schema: verchestra-feature-handoff/v1
feature: tuf-metadata-version-safety
issue: 391
status: in_progress
branch: fix/tuf-metadata-version-safety
baseRevision: 20071a78eb5b96b9de63e5e9c863b6997643c767
lastCompletedTask: T1
nextTask: "T2: add docs/qualification/tuf-publication-ledger.json and enforce strict per-root metadataVersion monotonicity in scripts/t76-publish-release.mjs before signing."
lastGate: "focused TUF suites PASS (79 tests)"
updatedAt: 2026-09-29T00:00:00Z
---

# Scope

Client-side naming of a reused TUF metadata version (#391) and publication-side
enforcement of strictly increasing metadata versions per root (#387 follow-up).
See `spec.md`.

# Next Exact Action

Implement T2 in `tasks.md`.
