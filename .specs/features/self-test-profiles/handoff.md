---
schema: verchestra-feature-handoff/v1
feature: self-test-profiles
issue: 11
status: planned
branch: feat/t70-self-test-profiles
baseRevision: b5473f6ee37116f6c58c0489d1a54af369982595
lastCompletedTask: T1
nextTask: T2
lastGate: pnpm test:unit
updatedAt: 2026-08-02T00:30:00Z
---

# Scope

T70 (#11): give the T69 Self-Test trust domain real `smoke` and `workspace`
scenarios, ≥25 combined black-box checks, PRF-01–PRF-07 from
`.specs/features/self-test-profiles/spec.md`. Extends the three AD-010
places only; adds a `self-test` CLI command.

# Completed Evidence

T1: `ScenarioCheck`, `semanticFingerprint`, `assertProfileCoverage`,
`assertConvergence`, `requiredCheckIds` on `SelfTestProfile`,
`SMOKE_CHECK_IDS` (6 ids), `WORKSPACE_CHECK_IDS` (25 ids: five shapes ×
placement/init/bootstrap/sync/reconcile), and three new error codes
(`VES_SELFTEST_SCENARIO_MISSING`, `VES_SELFTEST_NONCONVERGENT`,
`VES_SELFTEST_NETWORK_ATTEMPT`) added to
`packages/application/src/self-test/self-test.ts`. Coverage is asserted
inside `SelfTestOrchestrator.run` after cleanup, before payload sealing.
12 new unit cases in `tests/unit/self-test-scenario-rules.test.mjs`. Updated
T69 test doubles in `tests/unit/self-test-rules.test.mjs`,
`tests/security/self-test-escape.test.mjs`, and
`tests/fault-injection/self-test-composition-faults.test.mjs` to supply the
now-required `SubjectRunFacts.checks` field (additive fixture maintenance,
no assertion weakened). `pnpm test:unit` (1830 cases), `pnpm typecheck`,
`pnpm lint`, `pnpm complexity:check`, `pnpm format:check` all PASS.

One pre-existing, unrelated failure observed and left alone:
`tests/security/self-test-escape.test.mjs:35` ("a link-like ancestor into
guarded state...") fails on this macOS environment before and after this
change (`/tmp` vs `/private/tmp` symlink-chain ordering) — confirmed via
`git stash`.

# Next Exact Action

Implement T2: `GitFixtureFactory` in `packages/self-test/src/git-fixtures.ts`
producing the five real disposable Git shapes (standalone, colocated,
centralized, nested, ignored), hermetic Git env, under the profile byte
budget. Integration tests in
`tests/integration/self-test-git-fixtures.test.mjs`. Run focused, then
`pnpm gate:quick`, then commit.

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
