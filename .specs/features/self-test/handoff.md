---
schema: verchestra-feature-handoff/v1
feature: self-test
issue: 10
status: planned
branch: feat/t69-self-test-specs
baseRevision: 3d5846b8b2a6e40d37b14807a7142125531040af
lastCompletedTask: null
nextTask: T1
lastGate: pnpm gate:quick
updatedAt: 2026-08-01T12:00:00Z
---

# Scope

T69: the isolated Self-Test trust domain. Specification, design, and tasks are
written from verified code reading recorded in the design document; no product
code exists yet.

# Next Exact Action

T1: add `packages/self-test` to `EXPECTED_PACKAGES` in
`scripts/architecture.mjs`, the repository-map row, and the gate-selection
security rule, then create the package skeleton — in that order, because the
boundary test fails the moment the directory exists undeclared.

# Blockers

None. T68d is complete and the resolver reads T69 next.

# Decisions

- Profile ids reuse the sealed support-bundle enum; crash-recovery is a mode
  of `full`, never a fifth id.
- Ports return facts; overlap and sentinel verdicts are pure rules in
  application.
- No report JSON schema before T72.
