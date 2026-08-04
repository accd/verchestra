---
schema: verchestra-feature-handoff/v1
feature: structural-verifier-isolation
issue: 35
status: planned
branch: feat/35-structural-verifier-isolation
baseRevision: a1e317f3bf1575e0243d597bbfa67785e94d7094
lastCompletedTask: null
nextTask: T1
lastGate: pnpm gate:quick
updatedAt: 2026-08-02T18:00:00Z
---

# Scope

#35: make verification's independence structural rather than self-reported,
reusing existing driver process isolation (`packages/drivers`) instead of a
new adapter. See design.md for why no new package is introduced.

# Next Exact Action

T1: add `VES_VERIFIER_DRIVER_CONFLICT`, require
`implementerDriverId`/`verifierDriverId` on `VerificationInput`, check
immediately after the existing actor-identity check in
`IndependentVerificationCoordinator.verify`.

# Blockers

None.

# Decisions

- No new package: driver process isolation already exists in
  `packages/drivers`; duplicating it would be the rejected pattern.
- Read-only grant = empty tool array, not a guessed writer-tool name list
  (corrected during Specify after finding no such classification exists
  anywhere in the repository; the data-probe `sessionReadOnly` pattern — a
  fact asked of the session, never inferred from an operation-name list —
  is the closer analogy).
- Report schema bumps to `schemaVersion: 2`; old fixtures updated to assert
  correct rejection, not silently upgraded.
