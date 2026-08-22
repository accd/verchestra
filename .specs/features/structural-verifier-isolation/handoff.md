---
schema: verchestra-feature-handoff/v1
feature: structural-verifier-isolation
issue: 35
status: complete
branch: feat/35-structural-verifier-isolation
baseRevision: a1e317f3bf1575e0243d597bbfa67785e94d7094
lastCompletedTask: T7
nextTask: No further action; issue #35 is closed after the composed verifier landed.
lastGate: pnpm gate:security
updatedAt: 2026-08-22T18:00:00Z
---

# Scope

#35: make verification's independence structural rather than self-reported,
reusing existing driver process isolation (`packages/drivers`) instead of a
new adapter. See design.md for why no new package is introduced.

# Next Exact Action

Independent Verifier pass complete: PASS, 60/60 tests, 4/4 independently
chosen mutations killed (see validation.md). Awaiting human review and merge.
**#35 stays open after this merges** — its full acceptance bar (a real
composed verifier session in a live workflow) is T71/T74/T75 composition-root
work per this feature's stated non-goals; this PR delivers only the reusable
rules and resolution mechanism those tasks consume.

# Blockers

None.

# T1-T7 Evidence

31 cases across `tests/unit/verification-driver-isolation.test.mjs` (12),
`tests/unit/independent-verification.test.mjs` (19 total, 8 new), covering
SVI-01..07. Discrimination campaign: 5/5 killed against the rule file (V1
driver-conflict bypass, V2 resolution excludes-implementer bypass, V3
read-only-grant bypass, V4 tool-request-detection bypass, V5 schema-version
bypass), clean rerun 0 failures. `pnpm gate:quick` and `pnpm gate:security`
PASS locally. Complexity ratchet: `verify()` improved 21 → 19 via
`assertIndependentVerifier` extraction, locked in.

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
