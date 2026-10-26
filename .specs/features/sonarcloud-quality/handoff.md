---
schema: verchestra-feature-handoff/v1
feature: sonarcloud-quality
issue: null
status: in_progress
branch: fix/sonar-t4-hotspots
baseRevision: b8802cee49a03b7f7e9190561a34acc680a2a47b
lastCompletedTask: T4
nextTask: T5
lastGate: pnpm gate:quick plus pnpm test:architecture and pnpm site:test unit
updatedAt: 2026-10-26T21:29:25Z
---

# Scope

Phase A of `spec.md` (SQC-01–SQC-06): CI-based SonarCloud analysis that
classifies test code as tests and imports LCOV coverage for the product
sources. Phases B (bugs, vulnerabilities) and C (code smells) follow in their
own changes, one rule family each, as listed in `tasks.md`.

# Completed Evidence

T4 complete on `fix/sonar-t4-hotspots` — the 9 vulnerabilities left after T3:

- S6505 ×3 — `ci.yml`, `full-validation.yml`, `platform-matrix.yml` installed
  the pinned provider CLIs with every lifecycle script on. They now follow
  `t76-candidate-build.yml`: `npm install --global --ignore-scripts …` then
  `npm rebuild --global @anthropic-ai/claude-code @openai/codex`, so only the
  two reviewed postinstalls run (Claude Code's `install.cjs` places its native
  binary; read before relying on it). The existing `claude --version` /
  `codex --version` pins prove the binaries still run. New
  `tests/agent-readiness/workflow-install-scripts.test.mjs` holds every
  workflow install to `--ignore-scripts` (pnpm's frozen install is exempt: pnpm
  10 runs only `allowBuilds` scripts) and every global provider install to the
  by-name rebuild; `gate-selection` and `platform-matrix-workflow` shape tests
  now require the same line.
- S4036 ×4 — `scripts/agent-readiness.mjs` and `scripts/select-gates.mjs`
  started `git` by bare name. New `scripts/git-executable.mjs` resolves it with
  the product rule `absoluteExecutableOnPath` (imported by path; it imports
  nothing, so `agent:context` still runs before install). The resolver joins
  the shared table in `tests/unit/git-executable.test.mjs` (planted relative
  entry ignored), and `tests/architecture/absolute-child-executables.test.mjs`
  guards both scripts. Follow-up, not flagged by SonarCloud:
  `scripts/agent-eval.mjs` and `scripts/t76-build-candidate.mjs` still start
  `git` by bare name.
- S2612 ×1 — the node-runtime bundle's runtime and launchers are owner-only
  (`0o700`) instead of world-executable; asserted on POSIX by
  `spikes/node-runtime/test/bundle.test.mjs` (skipped on Windows, so proven by
  Linux/macOS runs only).
- S5443 ×1 — a false positive on a regex: `run-lighthouse.mjs` used no
  directory, it matched Windows' `…\Temp\lighthouse.` cleanup error to retry
  once. The matcher moved to `apps/site/scripts/lighthouse-retry.mjs`, which
  recognises Lighthouse's own `lighthouse.*` directory name instead of the
  temporary-directory location; `apps/site/tests/unit/lighthouse-retry.test.mjs`
  covers the retried case and four final ones.

T3 complete on `fix/sonar-s8707-build-bundle`. Under the corrected test scope
the open S8707 (path injection) issues were 14, all in
`spikes/node-runtime/src/build-bundle.mjs`, all one taint flow: the command
line's `argv[2]` became `outputRoot`, which `buildBundle` removed recursively
with `force: true` before writing — `node build-bundle.mjs <any directory>`
deleted that directory. Fixed at the source, not suppressed:

- The command takes no path: it always writes the ignored
  `spikes/node-runtime/.bundle` (`DEFAULT_BUNDLE_ROOT`) and exits 2 on any
  argument. No caller passed one.
- `buildBundle` clears an existing root only when it is empty or its
  `release.json` is a Verchestra bundle (`schemaVersion: 1`); anything else is
  refused and left intact.
- `spikes/node-runtime/test/bundle.test.mjs` gains three cases (foreign
  directory refused and intact; rebuild over its own bundle and into an empty
  directory; command with a path exits 2 and deletes nothing). The first and
  third fail against the previous source (discrimination run, 17 pass / 2 fail);
  all 19 pass with the fix.

T2 complete. PR #610 rebase-merged to `main` at `73670f54` (verified by
content: the merged tree equals the locally tested rebase). First `main`
analysis with coverage, 2026-10-26T20:37Z (run 40397018517): coverage 69.3 %
(line 67.7 %, branch 80.4 %, 67,811 lines to cover); open issues 1,135 → 998
(178 bugs, 22 vulnerabilities, 798 code smells) once test code is analysed as
tests; quality gate still ERROR on new reliability, new security and new
coverage.

T1 complete on `ci/sonarcloud-coverage`:

- `scripts/test-scope.mjs` adds Node's built-in coverage with an LCOV reporter
  only when `VES_COVERAGE=1`, restricted to `COVERED_SOURCES`, writing
  `coverage/<name>` where the name comes from the fixed `COVERAGE_REPORTS`
  table (unit, contract) — no argv or environment text
  reaches a path or a spawn argument (the first PR scan flagged S8705/S8707
  when it did).
- `scripts/coverage-lcov.mjs` (`mergeLcov`) and `scripts/merge-coverage.mjs`
  merge `coverage/*.lcov` into `coverage/lcov.info`, failing closed on none.
- `sonar-project.properties` and `.github/workflows/sonarcloud.yml`; the scan
  action is pinned to `d209202bc7d53ff1cc128f7f907dac145c9d6ae9` (v8.3.0).
- `packages/platform-node/src/bounded-child-run.ts` hands `spawn` a copy of the
  caller's environment: `spawn` writes `NODE_V8_COVERAGE` into the env object it
  receives whenever the parent carries it, so every frozen record threw under
  coverage (5 integration failures in the first CI run). Regression test in
  `tests/integration/bounded-child-run.test.mjs`, shown to fail on the old code.
- Tests: `tests/unit/coverage-lcov.test.mjs` (7),
  `tests/agent-readiness/sonarcloud-workflow.test.mjs` (6);
  `tests/unit/test-scope.test.mjs` now strips the outer run's coverage switches
  from nested scopes so a coverage run cannot measure into its own report.
- Local run on Windows, Node 24.14.0: `VES_COVERAGE=1 pnpm test:unit`
  exited 0 at 61.47 % lines, 83.35 % branches, 54.26 % functions for the unit
  scope alone; the merged report lists 238 product files under `apps/` and
  `packages/` only, with forward-slash paths.

Baseline before Phase A (SonarCloud, analysis 2026-10-26T17:46Z): 1,135 open
issues; 179 bugs, 32 vulnerabilities, 924 code smells; quality gate ERROR.

# Next Exact Action

After this change merges, confirm open vulnerabilities read 0:
`curl "https://sonarcloud.io/api/issues/search?componentKeys=accd_verchestra&types=VULNERABILITY&resolved=false&ps=1"`.
Then start T5 on a new branch off `main`: S2871 (`sort()` without a
comparator) using one shared code-unit comparator — never `localeCompare` —
with `pnpm test:census` and `pnpm gate:security` green.

# Blockers

None. `SONAR_TOKEN` is set and Automatic Analysis is off (owner, 2026-10-26).

# Decisions

- No coverage dependency: tests import `.ts` sources, so Node's coverage maps
  to source directly (owner-approved plan, 2026-10-26).
- `SonarSource/sonarqube-scan-action` added with owner approval, 2026-10-26.
- The token is scoped to the presence check and the scan step only, never to
  the test steps that execute the change under review.
- Coverage scopes are unit and contract only. The second CI run passed every
  integration test (1,278) yet failed the scope with "Could not report code
  coverage. SyntaxError: Unexpected end of JSON input": Node hands every child
  NODE_V8_COVERAGE, integration and fault kill Node children by design, and a
  child killed mid-write leaves a truncated profile the runner cannot parse.
  Covering those scopes needs a collector that tolerates partial profiles
  (a dependency decision for the owner), not a weaker test.

# Files Intentionally Left Unchanged

- `.github/workflows/ci.yml` — the quality gate keeps running without coverage.
- `scripts/gate-stages.mjs` — no gate gains or loses a stage.
- Every file SonarCloud reports issues against except
  `spikes/node-runtime/src/build-bundle.mjs` — the rest of Phases B and C. The
  `chmod` on that file (S2612) is T4's, not T3's.
