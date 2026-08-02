# Self-Test Smoke and Workspace Profiles Tasks

## Execution plan

| Task | Deliverable                                                                 | Depends on | Verification         | Commit |
| ---- | ---------------------------------------------------------------------------- | ---------- | --------------------- | ------ |
| T1   | `ScenarioCheck`, `semanticFingerprint`, `assertProfileCoverage`, `assertConvergence`, `requiredCheckIds`, three new error codes in `packages/application/src/self-test/self-test.ts` | None       | `test:unit`           | Done |
| T2   | `GitFixtureFactory` in `packages/self-test` producing the five real disposable Git shapes | T1         | `test:integration`    | Done |
| T3   | `offlineGuard()` in `packages/self-test`; application wiring so an attempt fails a run with `VES_SELFTEST_NETWORK_ATTEMPT` | T1         | `test:fault`           | Done |
| T4   | `createSmokeScenario` in `apps/vestra-cli/src/self-test-composition.ts` driving the controller/CLI path | T1, T3     | `test:integration` | Done |
| T5   | `createWorkspaceScenario` covering placement/init/bootstrap/sync/reconcile across all five shapes, ≥25 checks combined with smoke | T1, T2, T3 | `test:integration`    | Done |
| T6   | `self-test` CLI command, exit-code contract, human/JSON rendering; update sealed manifest assertion | T4, T5     | `test:contract`, `test:e2e` | Done |
| T7   | Convergence proof (both profiles), discrimination sensor (9/9 killed), local gate evidence | T1–T6      | all selected gates    | Partial — local evidence gathered; report blocked on external gate dispatch (see handoff) |

## Gate commands

| Level   | Command                                                                 |
| ------- | ------------------------------------------------------------------------ |
| Focused | `node --test tests/unit/self-test-*.test.mjs` (per task, narrowed further to the new file) |
| Quick   | `pnpm gate:quick`                                                       |
| Full    | `pnpm gate:full` (declared by issue #11)                                |
| Selected | Whatever `node scripts/gate-selection.mjs` derives from changed paths — expect `quick`, `full`, `build`, `security`, `release` given `packages/self-test/`, `packages/application/`, `apps/vestra-cli/`, and `tests/fault-injection/` are all touched |

## Test coverage matrix

| Layer                | Requirement outcomes and edge cases                                                                 | Evidence |
| --------------------- | ------------------------------------------------------------------------------------------------------ | -------- |
| unit (application)    | `semanticFingerprint` orders and excludes non-semantic fields; `assertProfileCoverage` fails closed on a missing required id; `assertConvergence` fails closed on any divergence; new codes are attached to the right failures | `tests/unit/self-test-scenario-rules.test.mjs` |
| integration (adapter) | Each of the five shapes produces a real `git init` repository with a distinct owner id; hermetic env does not read the operator's real gitconfig; fixture creation failure surfaces a distinct error rather than a silent skip | `tests/integration/self-test-git-fixtures.test.mjs` |
| fault-injection        | A scenario that calls `net.connect`/`fetch` during `offlineGuard()` scope fails the run with `VES_SELFTEST_NETWORK_ATTEMPT`; guard restores originals even when the scenario throws | `tests/fault-injection/self-test-network-guard-faults.test.mjs` |
| integration (smoke)    | `createSmokeScenario` drives `init --dry-run`, `--help`, `--version`, and error paths through the real `CommandBus`/`runCli` path (via the extracted `createCommandBus` in `main.ts`) and asserts zero filesystem writes outside the disposable root | `tests/integration/self-test-smoke-scenario.test.mjs` |
| integration (workspace) | `createWorkspaceScenario` exercises placement (`scanWorkspace`), init (`CommandBus`), bootstrap (`MachineBootstrapService`), sync/reconcile (`WorkspaceReconcileService`) against each of the five shapes; combined check count ≥25 asserted directly, measured ~800ms per run against the 600s budget | `tests/integration/self-test-workspace-scenario.test.mjs` |
| contract (CLI surface) | Manifest assertion updated to `["init", "self-test"]` with the `profile` option | `tests/contract/cli-surface.test.mjs` (updated) |
| e2e                    | Full CLI process spawn (`apps/vestra-cli/bin/vestra.mjs self-test --profile smoke\|workspace`) returns exit 0/PASS, non-zero on missing/invalid `--profile`, and leaves the invoking repository byte-identical | `tests/e2e/self-test-cli-e2e.test.mjs`, `tests/e2e/cli-launchers-e2e.test.mjs` (updated `--help` text) |
| qualification           | Two full runs of each profile against fresh roots produce identical `semanticFingerprint`; ≥25 total checks; discrimination sensor kills every injected mutation | `docs/qualification/t70-validation.md` |

## Requirement traceability

| Task | Requirement IDs |
| ---- | ---------------- |
| T1   | PRF-03, PRF-04 (rules only) |
| T2   | PRF-02 |
| T3   | PRF-01 |
| T4   | PRF-05, PRF-06, PRF-07 (smoke half) |
| T5   | PRF-02, PRF-03 (combined coverage), acceptance criterion 7 (≥25 checks) |
| T6   | PRF-07 |
| T7   | PRF-04 (proof), all requirements (final evidence binding) |

## Completion rules

- One task, one passing gate, one atomic commit.
- Tests assert specification outcomes and are never weakened, deleted, or
  skipped to obtain a pass.
- Update the portable handoff after every task.
- Independent verification and human review are required before completion.

## Execution evidence

| Task | Status  | Commit  |
| ---- | ------- | ------- |
| T1   | Done    | ae607e5 |
| T2   | Done    | bd67e3d |
| T3   | Done    | ac239e4 |
| T4   | Done    | 8b10e3f |
| T5   | Done    | ec9132c |
| T6   | Done    | 8fc459b |
| T7   | Partial | (pending commit) — report blocked on external gate dispatch |
