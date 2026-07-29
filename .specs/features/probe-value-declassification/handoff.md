---
schema: verchestra-feature-handoff/v1
feature: probe-value-declassification
issue: 107
status: in_progress
branch: codex/issue-107-value-declassification
baseRevision: e2d3a251b0fe87de0b566563a258651bd8a467d9
lastCompletedTask: T0
nextTask: T1
lastGate: not-run
updatedAt: 2026-07-29T21:30:00Z
---

# Scope

Close the raw scalar channel in promoted database Probe evidence. This feature
does not authorize portable raw values.

# Completed Evidence

- The e-mail reproduction is confirmed on `main`.
- Existing Support Bundle and application egress patterns were reviewed.
- The chosen model is a closed digest-only claim representation, avoiding a
  new dependency or an unverified human-review string as authority.

# Next Exact Action

Implement T1 with tests derived from PVD-01 through PVD-03.

# Blockers

The local security gate remains subject to the existing Cedar
minimum-release-age policy; no policy relaxation is permitted.
