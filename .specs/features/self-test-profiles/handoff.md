---
schema: verchestra-feature-handoff/v1
feature: self-test-profiles
issue: 11
status: planned
branch: feat/t70-self-test-profiles
baseRevision: b5473f6ee37116f6c58c0489d1a54af369982595
lastCompletedTask: T2
nextTask: T3
lastGate: pnpm test:integration (workspace-scoped subset)
updatedAt: 2026-08-02T01:00:00Z
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

T2: `GitFixtureFactory` in `packages/self-test/src/git-fixtures.ts`.
Provisions all five shapes as real `git init` repositories under the T69
disposable root, each shape scoped to its own subdirectory so repeated
`provision()` calls from one factory never contaminate one another (a real
bug caught by sanity-checking against `scanWorkspace` directly and fixed
before commit — see Decisions). Hermetic Git env (`GIT_CONFIG_NOSYSTEM`,
isolated `HOME`, no terminal prompt/askpass). File writes route through the
existing T69 `BoundedFixtureFactory`, so the escape guard and byte budget
apply unchanged. 10 integration cases in
`tests/integration/self-test-git-fixtures.test.mjs`, including one asserting
cross-shape isolation. Verified against the real
`@verchestra/workspace` `scanWorkspace` (ad hoc script, not committed):
standalone → one root Project; colocated/centralized → root + `projects/widget`
Project, both owned by the control repo; nested → root + independently
Git-owned `projects/service`, not ignored; ignored → same but
`ignoredByControl: true` on both the repository and the Project.
`pnpm typecheck`, `lint`, `complexity:check`, `format:check` all PASS.
`test:integration` run scoped to non-SQLite suites plus the new file (80/80
pass) — this environment's Node v23.11 vs. the pinned v24.14 `node:sqlite`
binding is unrelated and pre-existing (confirmed via `git stash` before
touching T2).

# Next Exact Action

Implement T3: `offlineGuard()` in
`packages/self-test/src/network-guard.ts` wrapping `node:net`/`node:http`/
`fetch` for the duration of a scenario call, restoring originals even on
throw. Wire `VES_SELFTEST_NETWORK_ATTEMPT` so an observed attempt fails the
run (verdict stays in `application`; the guard only reports facts). Fault
tests in `tests/fault-injection/self-test-network-guard-faults.test.mjs`.
Run focused, then `pnpm gate:quick`, then commit.

# Blockers

None.

# Decisions

- Workspace shapes map to `@verchestra/workspace` concepts, not new
  vocabulary: standalone = control root is the only Project; colocated /
  centralized = control root + one marker-only `projects/widget` Project
  (both physically identical Git topology — the colocated/centralized
  distinction is a `PlacementSnapshot` config choice made by the T5
  scenario, not a fixture-level difference); nested = an independently
  Git-initialized, non-ignored `projects/service`; ignored = the same but
  listed in the control root's `.gitignore`.
- `GitFixtureFactory.provision()` scopes every shape to its own
  subdirectory (`<root>/<shape>/...`) rather than reusing the disposable
  root directly for each shape — the first implementation reused the root
  and silently layered shapes on top of each other, only caught by an ad
  hoc `scanWorkspace` sanity check, not by the first draft of the
  integration tests. A regression test now asserts cross-shape isolation
  directly.
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
