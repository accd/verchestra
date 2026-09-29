---
schema: verchestra-feature-handoff/v1
feature: tuf-metadata-version-safety
issue: 391
status: verification
branch: fix/tuf-metadata-version-safety
baseRevision: 20071a78eb5b96b9de63e5e9c863b6997643c767
lastCompletedTask: T3
nextTask: "Independent review of both commits, then maintainer merge. After merge, every future publication appends its ledger entry to docs/qualification/tuf-publication-ledger.json before the next candidate is built."
lastGate: "gate:quick, gate:build, gate:security, gate:release, agent:check PASS"
updatedAt: 2026-09-29T00:00:00Z
---

# Scope

Client-side naming of a reused TUF metadata version (#391) and publication-side
enforcement of strictly increasing metadata versions per root (#387 follow-up).
See `spec.md`; evidence in `validation.md`.

# Next Exact Action

Review and merge. No code task remains on this branch.

# Open decisions

- Resolved by `tuf-timestamp-refresh` (#382): the publish and refresh workflows
  now read the ledger from `origin/main`'s tip and fail unless the checked-out
  copy is an unedited prefix of it.
- The full root digest of the v1/`.2` lineage, its root version, and `.2`'s
  releaseId and host are not recorded in the repository. They stay `null` (only
  the digest prefix `sha256:491673b9` is recorded). An owner who holds the
  published `release-inputs/` could add them only by appending a new entry,
  because the ledger is append-only.
- The only signature made before the ledger check is the in-memory signature on
  the root envelope, which is needed to derive the pinned root digest. No
  timestamp, snapshot, or targets metadata is signed, and nothing is written.
