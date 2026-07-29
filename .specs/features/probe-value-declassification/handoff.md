---
schema: verchestra-feature-handoff/v1
feature: probe-value-declassification
issue: 107
status: in_progress
branch: codex/issue-107-value-declassification
baseRevision: e2d3a251b0fe87de0b566563a258651bd8a467d9
lastCompletedTask: T1
nextTask: Submit for independent verification and human review
lastGate: pnpm gate:security PASS (2026-07-29)
updatedAt: 2026-07-29T21:34:00Z
---

# Scope

Close the raw scalar channel in promoted database Probe evidence. This feature
does not authorize portable raw values.

# Completed Evidence

- The e-mail reproduction is confirmed on `main`.
- Existing Support Bundle and application egress patterns were reviewed.
- The chosen model is a closed digest-only claim representation, avoiding a
  new dependency or an unverified human-review string as authority.
- T1 implements a closed V2 digest-only claim format. Raw e-mail, credential,
  bearer/JWT/API-token, connection-string, private-key, and oversized scalar
  inputs are rejected before promotion; portable claims retain only a digest.
- Exact V2 evidence parsing rejects restored raw fields, tampered digests,
  duplicate claims, and recomputed legacy V1 bodies.
- Focused integration/security tests pass 43/43, and `pnpm gate:security`
  passed on this exact worktree after the dependency minimum-age window opened.

# Next Exact Action

Commit and submit T1 for independent verification and human review. After it
merges, rebase #34 and implement portable evidence references against V2
`valueDigest`, never raw claim values.

# Blockers

None.
