---
schema: verchestra-feature-handoff/v1
feature: probe-value-declassification
issue: 107
status: in_progress
branch: codex/issue-107-value-declassification
baseRevision: e2d3a251b0fe87de0b566563a258651bd8a467d9
lastCompletedTask: T0
nextTask: T1
lastGate: focused-tests-pass; security-gate-blocked-by-supply-chain-policy
updatedAt: 2026-07-29T21:45:00Z
---

# Scope

Close the raw scalar channel in promoted database Probe evidence. This feature
does not authorize portable raw values.

# Completed Evidence

- The e-mail reproduction is confirmed on `main`.
- Existing Support Bundle and application egress patterns were reviewed.
- The chosen model is a closed digest-only claim representation, avoiding a
  new dependency or an unverified human-review string as authority.
- T1 is implemented but intentionally uncommitted: focused integration and
  security tests pass 41/41, including an adversarial raw-field restoration
  and legacy V1 schema version whose outer evidence digests were recomputed.

# Next Exact Action

After the Cedar release-age window clears, run `pnpm gate:security` on this
exact worktree. If it passes, commit T1 with only the three listed source/test
files plus this handoff, then update #34 to consume V2 `valueDigest` rather
than raw claim values.

# Blockers

The local security gate remains subject to the existing Cedar
minimum-release-age policy; it currently rejects
`@cedar-policy/cedar-wasm@4.12.0`. No policy relaxation or lockfile rewrite is
permitted. Uncommitted T1 files: `packages/data-probe/src/database-knowledge.ts`,
`tests/integration/database-knowledge.test.mjs`, and
`tests/security/database-knowledge-security.test.mjs`.
