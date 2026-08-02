---
schema: verchestra-feature-handoff/v1
feature: self-test-profiles
issue: 11
status: planned
branch: feat/t70-self-test-profiles
baseRevision: b5473f6ee37116f6c58c0489d1a54af369982595
lastCompletedTask: null
nextTask: T1
lastGate: null
updatedAt: 2026-08-02T00:00:00Z
---

# Scope

T70 (#11): give the T69 Self-Test trust domain real `smoke` and `workspace`
scenarios, ≥25 combined black-box checks, PRF-01–PRF-07 from
`.specs/features/self-test-profiles/spec.md`. Extends the three AD-010
places only; adds a `self-test` CLI command.

# Completed Evidence

None.

# Next Exact Action

Implement T1: add `ScenarioCheck`, `semanticFingerprint`,
`assertProfileCoverage`, `assertConvergence`, `requiredCheckIds` on
`SelfTestProfile`, and the three new error codes
(`VES_SELFTEST_SCENARIO_MISSING`, `VES_SELFTEST_NONCONVERGENT`,
`VES_SELFTEST_NETWORK_ATTEMPT`) to
`packages/application/src/self-test/self-test.ts`, with unit tests in
`tests/unit/self-test-scenario-rules.test.mjs`. Run `test:unit` focused,
then `pnpm gate:quick`, then commit.

# Blockers

None.

# Decisions

- Per-check detail (`ScenarioCheck[]`) rides outside the sealed
  `SelfTestReportPayload` — a new field on `SubjectRunFacts`, not a report
  field — so PRF-06 (sealed allowlist unchanged) holds without a new report
  schema.
- T70 adds a `vestra self-test` command (design.md D1): AC5's "black-box"
  language and the issue's "production CLI" scope point to spawning the real
  binary, matching the precedent in `tests/e2e/cli-launchers-e2e.test.mjs`.
- New spec directory `self-test-profiles`, sibling to the completed
  `self-test` (T69) directory, following the T68a–T68d one-dir-per-task
  precedent.

# Files Intentionally Left Unchanged

- `.specs/features/self-test/` (T69) stays as completed evidence; not
  reopened.
- `packages/application/src/self-test/self-test.ts`'s `PROFILES` id set,
  `SelfTestOrchestrator.run`, and the sealed report field list are extended
  additively only (`requiredCheckIds`), never restructured — T69's
  qualified control flow is unchanged.
