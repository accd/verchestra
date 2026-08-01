---
schema: verchestra-feature-handoff/v1
feature: self-test
issue: 10
status: in_progress
branch: feat/t69-self-test-t1
baseRevision: ac251e4fe4403600c3351c6f7a39cbd2ee00a59b
lastCompletedTask: T1
nextTask: T2
lastGate: pnpm gate:security
updatedAt: 2026-08-01T13:30:00Z
---

# Scope

T69: the isolated Self-Test trust domain. Specification, design, and tasks are
written from verified code reading recorded in the design document; no product
code exists yet.

# Next Exact Action

T2: build the rules in `packages/application/src/self-test/` — errors, the
closed profile registry (`smoke | full | workspace | drivers`, sealed by T57
evidence), the non-overlap rule over `RootFacts`, Sentinel Set comparison,
the quarantine state machine, report allowlist rules, port interfaces, and
the orchestrator — with unit tests in `tests/unit/`. Ports return facts,
never verdicts.

# Blockers

None. T68d is complete and the resolver reads T69 next.

# Decisions

- Profile ids reuse the sealed support-bundle enum; crash-recovery is a mode
  of `full`, never a fifth id.
- Ports return facts; overlap and sentinel verdicts are pure rules in
  application.
- No report JSON schema before T72.
