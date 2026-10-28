---
schema: verchestra-feature-handoff/v1
feature: sonarcloud-quality
issue: null
status: in_progress
branch: refactor/sonar-s7780-string-raw
baseRevision: ff557cf2a31e39625b77b9f11db65ec073742ffb
lastCompletedTask: T8
nextTask: T8
lastGate: pnpm gate:quick plus pnpm test:architecture
updatedAt: 2026-10-28T09:00:00Z
---

# Scope

Phase A of `spec.md` (SQC-01–SQC-06): CI-based SonarCloud analysis that
classifies test code as tests and imports LCOV coverage for the product
sources. Phases B (bugs, vulnerabilities) and C (code smells) follow in their
own changes, one rule family each, as listed in `tasks.md`.

# Completed Evidence

T8, S7780 (`String.raw` for backslash-escaped strings, 19 TypeScript + 2
JavaScript) on `refactor/sonar-s7780-string-raw`: Windows program paths,
registry keys, a PowerShell guard line, four regular expressions built from
templates and the generated probe `versionSupported` source now use
`String.raw`; the two JavaScript issues were the reverse, `String.raw` with
no backslash in `agent-readiness.mjs`, now plain templates. The POSIX quote
escape moved to a `QUOTED_QUOTE` constant so no template nests another.
`tests/unit/string-raw-literals.test.mjs` (4) spells every expected path and
key with ordinary escapes; it passes against `main`'s sources as well
(equivalence run), and the probe-scaffold digest table pins the generated
bytes unchanged.

PR #634 (`e7ec8478`, `a78645d6`) merged by content; the first `main`
SonarCloud run after it passed first time (19:57Z: gate OK, 656 smells).
Linearity sensor hardening on `test/linear-growth-rounds`: T7's
`withoutLeadingTitle` assertion measured 8.1x once on CI (`Quality gate` of
#633, run 40568010443, green on re-run), the second such near-miss after
`rewriteCanonicalLinks`. `tests/helpers/linear-growth.mjs` timed every large
batch after every small one, so a pause landed on one side of the ratio. The
two sizes are now sampled alternately within a round, and a ratio over the
limit is measured again, up to three rounds, keeping the least.
`LINEAR_GROWTH_LIMIT` stays 8. `tests/unit/linear-growth.test.mjs` (2)
pins that linear work measures under the limit and quadratic work over it.

PR #633 (`aa7f4501`) merged by content on 2026-10-27; the eight accepted
S3735 issues are in `validation.md`.
T8, S3735 (the `void` operator, 20 in 11 files) on
`refactor/sonar-s3735-void-operator`: 12 fixed, 8 accepted.

- Fixed: unused trailing parameters are dropped from the three drivers'
  `send` and the SQLite adapter's `inspectPrincipal`,
  `configureAuthorization` and `stream` (a method with fewer parameters
  still satisfies its interface); the no-op `void options.invokedAs;` is
  dropped; `void input.untrustedContent;` becomes an invariant comment; the
  CLI stderr callback gets a block body.
- Accepted (8, `validation.md`): `void x;` that references a property
  omitted by a rest sibling. The repository's ESLint `no-unused-vars` has no
  `ignoreRestSiblings`, so these cannot change without relaxing the lint
  configuration; an underscore rename fails the same rule (17 lint errors when
  tried).
- `pnpm typecheck` clean; the driver `send` contracts and the probe suites
  pass.
  PR #631 (`759ab1da`) merged by content; SonarCloud 2026-10-27T19:11Z: gate
  OK, S6582 0, 668 code smells, new-code coverage 91.5 %.
  T8, S6582 (prefer optional chaining, 22 in 17 files) on
  `refactor/sonar-s6582-optional-chaining`:

- 17 sites become `x?.a !== y` (or `===`, `!x?.list.includes`) only where
  `y` is always defined by type and at run time (a required string or number,
  or a broker's private `#identity` object), so both forms agree on every
  input.
- 5 validation sites over input that could carry an undefined field
  (`context-compiler.ts`, `recovery-bundle.ts`, `driver-version-probe.ts`,
  `database-knowledge.ts` package binding, the OpenCode catalog candidate)
  keep the undefined guard as its own statement with the same failure, because
  `x?.a !== y` would accept `x` undefined when `y` is undefined too.
- `tests/unit/optional-chaining-guards.test.mjs` (2) pins `meetsMinimum` on
  both sides of the split guard; existing model-router, context-compiler,
  protected-path, secret-broker, skill, OpenCode and safe-init suites pass
  (182/182).

PR #630 (`65d59dc6`) merged by content; SonarCloud 2026-10-27T18:31Z: gate
OK, S6551 0, 690 code smells, new-code coverage 91.5 %, coverage 87.6 %.
T8, S6551 (a value that may be an object passed to `String()`, 23 in 8 files)
on `refactor/sonar-s6551-object-stringification`:

- 20 sites read a nullable TEXT column of a STRICT SQLite table. They now go
  through `storedText` (`platform-node/src/runtime-store/runtime-sqlite.ts`,
  `VES_RUNTIME_CORRUPT`) or `nullableText` (`memory/src/stored-text.ts`, with
  each module's own corruption error), which return the string and fail
  closed on anything else. STRICT already guarantees text, so valid data reads
  exactly as before.
- `saveSyncState` refuses a projection whose `observedRemoteVersion` is not a
  string (`VES_RUNTIME_CONSTRAINT`) instead of storing `[object Object]`.
- The Claude Code driver emits a non-string `text_delta` as empty text, and the
  self-test offline guard describes a non-text port as empty and a non-text
  host as `unknown-host`.
- `tests/unit/stored-text-columns.test.mjs` (5) covers both helpers, a run's
  optional text columns read back verbatim, the sync-state refusal (nothing
  stored), and the guard's descriptions.

PR #629 (`e795b1f3`) merged by content; SonarCloud 2026-10-27T17:37Z on
`13fa7935`: gate OK, S4624 0, 713 code smells, new-code coverage 91.5 %. The
first `main` run on `e795b1f3` failed once in "Measure coverage" (security
scope, truncated V8 profile, all tests passed); the next run was green.

T8, S4624 (nested template literals, 25 in 13 files) on
`refactor/sonar-s4624-nested-templates`: each inner template moves into a
local, a small helper, or a `join` over its parts, and no rendered text
changes. `tests/unit/nested-template-output.test.mjs` (4) pins the exact
policy-explanation summaries for both verdicts with and without determining
policies, the self-test network refusal message, the context-recipe
identifiers, and the verifier prompt's done-criteria bullets; all 4 pass
against `main`'s sources as well (equivalence run). PR #628 (`d8e98172`)
confirmed on SonarCloud 2026-10-27T15:33Z: gate OK, new-code coverage 91.5 %,
new conditions to cover 8,965 → 6,297, new uncovered conditions 1,897 → 956,
branch coverage 82.9 %.

Quality gate green. PR #625 (`2eed052f`, `a4e421d6`, `d4756a65`) added the
security scope to coverage and PR #626 (`c9c9e629`) landed T8 (S4043); both
merged by content on 2026-10-27. SonarCloud's first `main` analysis with both
(2026-10-27T15:01Z, `e5389cd1`, after #621): quality gate OK, new-code
coverage 89.7 % (threshold 80 %), overall coverage 85.4 % (69.4 % before),
S4043 0, 740 code smells, 0 bugs, 0 vulnerabilities, ratings A/A/A.

- #625: `COVERAGE_REPORTS` gains `security`, and `sonarcloud.yml` measures
  `test:unit test:contract test:security`. e2e stays out (its runs truncate
  V8 profiles like integration and fault); architecture added nothing.
  `out-of-process-probe-host-security.test.mjs` discounts `NODE_V8_COVERAGE`
  only while the test process is itself measured: Node's `spawn` writes it into
  any explicit child environment. Every host-supplied key is still pinned.
  The scope also passes `--test-coverage-exclude=**/*.test.*`, because Node's
  default exclusion dropped product files named like tests (`self-test.ts`,
  `policy-test.ts`).
- LCOV branch merge fixed on `fix/coverage-lcov-branch-merge`. Adding a scope
  nearly doubled the conditions to cover (4,772 → 8,965) because
  `scripts/coverage-lcov.mjs` keyed branches on `line,block,branch`, and Node
  numbers `block` per run (two real runs over `canonical-json.ts`: line 26 was
  block 2 in one and 3 in the other; the fuller run split line 38 into two
  ranges). Those two real reports merged to 31 conditions where the fuller run
  alone measured 20. A line now keeps the most conditions and the most covered
  of any one report: never more than were measured, at the price of
  under-counting a line whose branches different scopes covered. New tests in
  `tests/unit/coverage-lcov.test.mjs` fail on the old merge (2 fail). The
  former assertion `BRF:2 / BRH:2` for line 2 encoded the bug (it treated
  `2,0,1` from two runs as one branch); it is now `BRF:2 / BRH:1`.

T8 (S4043) complete on `fix/sonar-t8-s4043` — the first maintainability rule
family: 29 open S4043 issues (array-mutating `sort`/`reverse` used inside the
expression that consumes it), 26 `sort` and 3 `reverse` sites in 15 files.

- Every receiver was a fresh local array (a `map`/`filter` result, a spread,
  or a local `push` target), so `toSorted`/`toReversed` with the same
  comparator returns the same order and only stops mutating the local:
  `execution-package.ts` (9), `self-test.ts` (3), `memory-store.ts`,
  `memory-retriever.ts`, `memory-lifecycle.ts` (2 each), `memory-vector-index.ts`,
  `machine-bootstrap.ts`, `source-snapshots.ts`, `task-scheduler.ts`,
  `run-capsule.ts`, `discovery-router.ts`, `model-router.ts`, `work-claims.ts`,
  `scripts/complexity.mjs` (1 each), and the rollback loop in
  `SafeInitService.apply` (only `applied.length` is read afterwards). Comparators are unchanged
  (`codeUnitCompare`, `compareIdentity`, numeric); no `localeCompare`.
- One receiver was read again after the mutation: `SafeInitService.recover`
  passed the reversed `states` to `removeEmptyParents`. It now names the
  reversed copy (`undoOrder`) and uses it for both, so the undo loop and the
  parent cleanup see exactly the order they did before.
- `tests/unit/array-copy-ordering.test.mjs` (9 tests) pins the order each
  previously uncovered site produces, on inputs where push order differs from
  the sorted order: failed role requirements, a round's deferrals (T3 pushed
  before T2), `rebuild` batch order (and its input array untouched), the three
  "unsupported fields" messages, the promotion ancestry walk (a linked
  `.verchestra/context` over a missing `promoted` is refused only by a
  root-first walk), and init rollback plus recovery undoing newest first
  (`afterRecoveryRemove` sees 2, 1, 0; both trees return to the prior bytes).
  Replacing the copies with the unsorted/unreversed arrays fails 4 of them.
- Local (Windows, Node 24.14.0): `pnpm gate:quick` PASS, `pnpm test:census`
  13/13, `pnpm test:architecture` 144/144; `pnpm gate:security` stages build,
  unit 3,125, contract 975, e2e, architecture and qualification green, security
  1,360 pass with only the two known Windows-only failures (task-suspension
  refused extra-usage statement, worktree-tool symbolic-link final component).

T7 complete on `fix/sonar-t7-regex-complexity` — the 22 open S8786
(super-linear backtracking, 15) and S5843 (complexity over 20, 7) issues in 14
files. `tests/unit/regex-linearity.test.mjs` keeps every replaced expression as
text, as the oracle, and holds each rewrite to it over an exhaustive
small-alphabet corpus or the repository's own files (docs, `.specs`, every
`.ts`/`.mjs` source, ROADMAP.md, all 137 site sources), and to a linear
growth ratio (`tests/helpers/linear-growth.mjs`) on the input that made the old
expression backtrack. Timed on those same inputs, all 12 former super-linear
expressions grew 13–18× over a 4× larger input (limit 8×).

- Exact by construction, with a one-pass scanner instead of a regex:
  markdown link targets (`scripts/agent-readiness.mjs`) and description link
  stripping (`apps/site/src/lib/repository-content.ts`) — a start that fails
  fails the same way for every `[` before its `]`, so the scan resumes after
  it; frontmatter `key: value` lines (`frontmatterField`); distribution source
  userinfo (`hasUserinfoBeforeColon`); trailing `\` in the Windows system root
  and trailing `/` in a repository path.
- Exact, regex kept: bundle import specifiers (the `\s*` after `import` was a
  subset of the clause scan); the census V2-import check (each named import
  whose line holds only whitespace before it, found by a backward look that
  stops at the first non-whitespace; its braces then searched for the name —
  a line-anchored `^…*` under `m` still restarted after every `\r`) and canonicalizer count (`async ` never
  changed the count); the documentation gate path (two expressions, a directory
  and a root-level file, whose union is the rule); PostgreSQL write keywords (a whole-word set lookup; the statement
  is ASCII by then); sensitive claim values (one expression per secret shape,
  same union); the two spike version parsers (`(?<!\d)` start; the codex
  `codex-cli ` prefix never changed the digits), held to the old expression in
  new `spikes/{codex,opencode}-driver/test/parse-version.test.mjs`.
- Same on every real input, stricter on malformed ones: the site title
  (`^#[^\S\n]+(\S.*)$`) and the LLM alternate's leading-title strip no longer
  let `\s+` cross a newline — identical on every document in `docs/` and
  README.md. ROADMAP edges are one per line in both readers (scripts and site):
  the old label class `[^\]]*` could swallow the next line and join two lines
  into one edge; ROADMAP.md parses identically.
- One intended fix: `rewriteCanonicalLinks` let the target's `[^)\s]+` eat the
  `#fragment`, so the fragment group never matched and a link to another site
  page's section went to GitHub, while a bare `](#anchor)` was rewritten to a
  GitHub URL. The target now stops at `#` (and `(`); the test pins both cases,
  and a second test shows all 137 published sources render byte-identically,
  since none links to a fragment of another source.
- Local: `pnpm gate:quick`, `pnpm test:census` 13/13, `pnpm agent:check`,
  `pnpm test:architecture` 144/144, `pnpm test:agent-readiness` 388/388, site
  unit tests 57/57, site build + `check:built` (135 pages, links and metadata
  valid). `astro check` did not run locally (`@astrojs/check` is not installed
  here; CI's Site quality job runs it).

T6 complete on `fix/sonar-s6324-control-chars` — the 22 S6324 issues, which
after T5 were every open bug, sat on 8 lines. None was a defect; each named a
control character by hex escape where the rule wants a readable form:

- The six SQL dialect parsers in `packages/data-probe/src/*-adapter.ts`
  (PostgreSQL, MySQL family, SQL Server, SQLite, Oracle, SAP ASE) allow
  printable ASCII plus TAB, LF and CR: `[\x09\x0a\x0d\x20-\x7e]` is now
  `[\t\n\r\x20-\x7e]`, the same set. SQLite and Oracle also tested `\x00`
  beside the backslash; NUL is already outside the allowed set, so that
  alternative was dead and is gone.
- `packages/memory/src/memory-retriever.ts` and
  `packages/application/src/egress/trust-egress.ts` rejected NUL with a
  one-character regex; they now use `includes("\u0000")`.
- New `tests/unit/probe-statement-encoding.test.mjs` (49 cases) holds every
  dialect to the boundary: TAB/LF/CR still parse, and NUL, U+0008, VT, FF,
  U+001F, DEL and backslash are denied with the dialect's `ENCODING_DENIED`
  code; PostgreSQL also denies a dollar quote but keeps `$1`. It passed against
  the old source too, so the rewrite kept the set.
- `tests/unit/memory-retriever.test.mjs` and `tests/unit/trust-envelope.test.mjs`
  gain NUL cases (leading, inner, trailing; the memory one with a matching
  digest so only the NUL check can fail). Both fail with their guard removed
  (discrimination run: 2 fail).
- These tests live in the unit scope on purpose: coverage is collected from
  unit and contract only, and the first PR analysis failed the new-code
  coverage condition (66.7 %) on the branches of the rewritten lines that only
  the security-scope parser tests reached.
- S1534, S7739 and S1764, listed under T6 in `tasks.md`, read 0 open
  on SonarCloud (2026-10-27), so T6 had nothing to change for them.

T5 complete on `fix/sonar-s2871-code-unit-sort` — all 156 S2871 sites (the
largest bug family) state their order instead of relying on the default:

- `codeUnitCompare` is now exported by `@verchestra/domain`
  (`packages/domain/src/canonical/canonical-sets.ts`); `normalizeDeclaredSet`
  and the RFC 8785 encoder's member order use it. It is UTF-16 code-unit order —
  exactly the comparator-less `sort()` (assumption A1), never `localeCompare` —
  so every rewritten sort keeps its bytes. Asserted in
  `tests/unit/canonical-json-sets.test.mjs` against a corpus where code-unit
  order differs from locale, numeric and code-point order (case, digits,
  accents, U+FFFF against a surrogate pair, prefixes).
- 128 sites in 52 TypeScript files of packages that already depend on
  `@verchestra/domain` now call `.sort(codeUnitCompare)`, reusing a file's own
  local comparator where it had one. `tsc --noEmit` passing proves every one
  sorts strings — the comparator accepts nothing else.
- `packages/contracts` (inward of domain) and `apps/site` (no workspace
  dependencies) carry a one-line local comparator with the same rule; the
  repository scripts import it from `canonical-sets.ts` by path (dependency
  free, so `agent:context` still runs before install); the two spikes keep a
  local one, being self-contained. Each of those 28 sites was inspected: all
  sort keys, file names, gate names, task ids or policy ids.
- `pnpm test:census` unchanged (13/13): no canonicalizer changed class.
- Not done here: the ~15 per-file copies of the same comparator across
  packages are left in place (consolidating them is a maintainability change,
  not S2871).

T4 merged to `main` at `51df5040` (verified by content). SonarCloud
2026-10-26T22:03Z: vulnerabilities 0, Security rating A, 976 open issues; the
quality gate still fails on new reliability and new coverage only.

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

After the S7780 change merges, confirm on the next `main` analysis that
`typescript:S7780` and `javascript:S7780` read 0 and the quality gate is still OK
(`api/issues/search?componentKeys=accd_verchestra&rules=typescript:S7780,javascript:S7780&resolved=false&ps=1`).
The eight S3735 issues in `validation.md` still wait for the owner to mark
them Accepted.
Then continue T8 with the next maintainability rule family, one per change
(by count: S3358 16, S6535 16, S6353 15, S7758 7; S7503, S9382 and S3776 need
a per-site decision first):
list the open code smells by rule
(`api/issues/search?componentKeys=accd_verchestra&types=CODE_SMELL&resolved=false&facets=rules&ps=1`)
and take the next family.

# Blockers

None. `SONAR_TOKEN` is set and Automatic Analysis is off (owner, 2026-10-26).

# Decisions

- No coverage dependency: tests import `.ts` sources, so Node's coverage maps
  to source directly (owner-approved plan, 2026-10-26).
- `SonarSource/sonarqube-scan-action` added with owner approval, 2026-10-26.
- The token is scoped to the presence check and the scan step only, never to
  the test steps that execute the change under review.
- Coverage scopes are unit, contract and security (security added by #625,
  2026-10-27). Integration, fault and e2e stay out. The second CI run passed every
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
