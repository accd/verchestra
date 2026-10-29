# Probe multi-parameter verification

**Verdict**: PASS
**Profile**: light
**Diff range**: 6ce57bc7..ba4aa226
**Round**: 1 - full
**Verifier**: independent sub-agent (author != verifier)

Verified at `ba4aa226` on two platforms. Windows is this checkout, Node 24.14.0. Linux is the
WSL clone `~/verchestra-569`: clean before the checkout, fetched from this checkout
(`FETCH_HEAD` = `ba4aa226`), detached at `ba4aa226`, and installed with
`pnpm install --frozen-lockfile --offline` on Node 24.14.0. The run changed no tracked file, git
config, branch or commit in this checkout. Before and after, `git status --porcelain` shows only
the pre-existing `?? .claude/`, plus this report afterwards.

The profile is `light`, as `checks.md` declares. Step 1 does not run: `checks.md` uses the
`## Intent` escape, there is no `plan.md`, and no source is marked binding. Fault injection does
not run under `light`. The `Coverage` join is not recomputed; the author's table is read below.

**Base values, checked independently.** On Linux, before checking out `HEAD`, the clone was
detached at `6ce57bc7`. `package.json`, `pnpm-lock.yaml` and `tests/helpers/` do not differ
between `6ce57bc7` and `ba4aa226`. An inline `node --input-type=module -e` script (no file
written) planned through `sqliteFixture` there and printed:
- the one-bind default plan: `statementFingerprint`
  `sha256:8cadb74e0584b94a15a7449dc159b69a53b00fe054cf9ba24be7590062adb428`, `planDigest`
  `sha256:ad1cadf015b572df1fb2760677c4e65e54f8ddd0c5838ef05c0832214f4036c3`;
- the zero-bind plan of `SELECT count(*) FROM main.orders`: `statementFingerprint`
  `sha256:162ccb5ea28fcc9f584822ea6053f995f97f983a7112d5b70fd85982648b09ad`, `planDigest`
  `sha256:5617095ad7ff2c67c444f773257ac94283e248a64025358772a1dc3e16ca66bb`.

These are the four values C2 pins, character for character. Each of the four appears exactly once
in the C2 test. The same script reproduced the defect the Intent describes: at `6ce57bc7` a
two-bind plan held `["internal"]`, and the supervisor refused it with
`VES_SQLITE_PARAMETERS_INVALID`.

**Product diff.** `git diff --name-only 6ce57bc7..HEAD` names 10 files. Only one is outside
`tests/`, `.specs/` and `CHANGELOG.md`: `packages/data-probe/src/index.ts`. In it:
- `sortedValues` (:191-196) validates and sorts the values without de-duplicating them.
- `uniqueSorted` (:198-200) is now `[...new Set(sortedValues(...))]`. De-duplicating a sorted list
  gives the same sorted unique list as before, so its seven other callers (:271, :277, :283,
  :459, :496, :502, :509) are unchanged.
- `normalizeOperation` builds `parameterClassifications` with `sortedValues` (:442-448). It still
  refuses a value outside `CLASSIFICATIONS` (:449-451; the five are at :97).

Every proof ran in one batched `node --test --test-reporter=spec` invocation per platform. The
six proof patterns of `checks.md` were each passed as their own `--test-name-pattern`. A seventh
pattern was added for the modified slice 2b test, "the SQLite engine adapter admits only the
statement's own operation in main". The invocation covered five files:
- `tests/unit/probe-operation-classifications.test.mjs`
- `tests/contract/probe-multi-parameter.test.mjs`
- `tests/integration/sqlite-probe-adapter.test.mjs`
- `tests/contract/probe-run-command.test.mjs`
- `tests/unit/probe-family.test.mjs`

On both platforms it reported 7 tests, 7 passed, 0 failed, 0 skipped, 0 cancelled (exit 0). Each
named test is listed below as run and passed. No pattern matched nothing, and none matched more
than one test. Every proof resolves to a test the diff adds:
- `tests/unit/probe-operation-classifications.test.mjs` is new (C1, C2).
- `tests/contract/probe-multi-parameter.test.mjs` is new (C3, C5).
- The C4 test is added to `tests/integration/sqlite-probe-adapter.test.mjs` (:76-103).
- The C6/C7 test is added to `tests/contract/probe-run-command.test.mjs` (:465-483).

**Windows.** C6 and C7 share one test. On win32 it takes its XP-04 branch at :471:
`refusedOnWindows(fixture, probeRequest({ sql, parameters: [1, "paid"] }))`. That asserts
`VES_PROBE_HOST_PLATFORM_UNSUPPORTED`, exit 5, no run and no credential read (:398-403), which
is C6's Windows claim. C7 makes no Windows claim, and its sentinel assertions run only off win32.
**The Linux run decides C6's POSIX half and C7**, with a real worker: 10,553 ms on Linux against
3,674 ms for the win32 refusal. C1-C5 run in full on both platforms.

## Checks

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | the planner keeps one classification per bind, sorted: [`internal`, `internal`] -> [`internal`, `internal`]; [`public`, `internal`, `public`] -> [`internal`, `public`, `public`]; a value outside the five refused with `VES_PROBE_OPERATION_INVALID` | `node --test --test-name-pattern "the planner keeps one classification per bind" tests/unit/probe-operation-classifications.test.mjs` (batched): passed on linux (13 ms) and win32 (19 ms) | `tests/unit/probe-operation-classifications.test.mjs:24-27` - `assert.deepEqual((await planWith(["internal", "internal"])).operation.parameterClassifications, ["internal", "internal"])`; `:28-32` - `planWith(["public", "internal", "public"])` deep-equals `["internal", "public", "public"]`; `:33` - `assert.rejects(planWith(["internal", "private"]), { code: "VES_PROBE_OPERATION_INVALID" })` (`private` is not in `CLASSIFICATIONS`, `packages/data-probe/src/index.ts:97`). `planWith` plans through `ProbePlanner.plan` (`:16-21`) | PASS |
| C2 | zero- and one-bind plans keep their digests: the 4 `sha256` values C2 names, = main at `6ce57bc7` | `node --test --test-name-pattern "plans with zero or one bind keep their digests" tests/unit/probe-operation-classifications.test.mjs`: passed on linux (12 ms) and win32 (11 ms) | `tests/unit/probe-operation-classifications.test.mjs:38-41` - `assert.equal(one.plan.statementFingerprint, "sha256:8cadb74e0584b94a15a7449dc159b69a53b00fe054cf9ba24be7590062adb428")`; `:42` - `assert.equal(one.plan.planDigest, "sha256:ad1cadf015b572df1fb2760677c4e65e54f8ddd0c5838ef05c0832214f4036c3")`; `:43` - zero bind: `sqliteFixture({ sql: "SELECT count(*) FROM main.orders", parameterClassifications: [] })`; `:44-47` - `zero.plan.statementFingerprint` = `"sha256:162ccb5ea28fcc9f584822ea6053f995f97f983a7112d5b70fd85982648b09ad"`; `:48` - `zero.plan.planDigest` = `"sha256:5617095ad7ff2c67c444f773257ac94283e248a64025358772a1dc3e16ca66bb"`. The verifier reproduced all four at `6ce57bc7` (base values, above) | PASS |
| C3 | 8 engines: a 2-parameter read planned through `ProbePlanner` with [`internal`, `internal`], run under `ProbeWorkerSupervisor` with the engine's adapter, completes with `status` `complete` | `node --test --test-name-pattern "every engine runs a read with two parameters of one classification" tests/contract/probe-multi-parameter.test.mjs`: passed on linux (96 ms) and win32 (92 ms) | `tests/contract/probe-multi-parameter.test.mjs:100` - `assert.equal(ENGINES.length, 8)` over the rows at `:22-97`: `postgresql`, `mysql`, `mariadb`, `sqlserver`, `sybase`, `oracle`, `sqlite`, `mongodb`, each with two placeholders, `parameters: VALUES` and `parameterClassifications: TWO` (`:19`); `:103` - `assert.deepEqual(f.plan.operation.parameterClassifications, TWO, ...)`; `:105` - `assert.equal(result.status, "complete", ...)` after `f.supervisor.execute()` (`:104`). At `6ce57bc7` the `:103` assertion fails for every engine, since the plan held `["internal"]`. Level note 1 | PASS |
| C4 | real SQLite file with rows (1, `paid`, 50) and (2, `pending`, 25): [`paid`, 10] -> one row, `id` 1; [`paid`, 60] -> no row | `node --test --test-name-pattern "a real SQLite read binds two parameters of one classification" tests/integration/sqlite-probe-adapter.test.mjs`: passed on linux (138 ms) and win32 (106 ms) | `tests/integration/sqlite-probe-adapter.test.mjs:79-82` - cases `[["paid", 10], [1]]` and `[["paid", 60], []]`; `:84` - `SELECT id FROM main.orders WHERE status = ? AND amount > ?`; `:86` - `parameterClassifications: ["internal", "internal"]`; `:96` - `assert.equal(result.status, "complete")`; `:97` - `assert.equal(result.rowCount, ids.length)`; `:98-101` - `assert.deepEqual(rows.map((row) => row.id), ids)`. The rows are `realSqliteFixture`'s, `tests/helpers/sqlite-probe-fixture.mjs:76-78` (`INTEGER PRIMARY KEY`, ids 1 and 2 by insert order) | PASS |
| C5 | the SQLite parser refuses two binds under one classification with `VES_SQLITE_PARAMETERS_INVALID`; a two-bind plan whose protected request carries one parameter fails under the supervisor with `VES_SQLITE_PARAMETERS_INVALID` | `node --test --test-name-pattern "a bind count that differs from its classifications is refused" tests/contract/probe-multi-parameter.test.mjs`: passed on linux (11 ms) and win32 (6 ms) | `tests/contract/probe-multi-parameter.test.mjs:110-118` - `assert.throws(() => parseSqliteReadOperation("SELECT count(*) FROM main.orders WHERE status = ? OR status = ?", { ..., parameterClassifications: ["internal"] }), { code: "VES_SQLITE_PARAMETERS_INVALID" })`; `:119-123` - `parameters: ["paid"]` under `parameterClassifications: TWO`; `:124` - `assert.rejects(f.supervisor.execute(), { code: "VES_SQLITE_PARAMETERS_INVALID" })`; `:125` - `assert.equal(f.results.commits, 0)`. Note 5 | PASS |
| C6 | Linux/macOS: `SELECT id, status FROM main.orders WHERE id = ? AND status = ?` with [1, `paid`] exits 0, `status` `complete`, `rowCount` 1, run `COMPLETED`; with [1, `pending`] exits 0, `rowCount` 0. Windows: `VES_PROBE_HOST_PLATFORM_UNSUPPORTED`, no run | `node --test --test-name-pattern "a probe run binds every parameter" tests/contract/probe-run-command.test.mjs`: passed on linux (10,553 ms, real worker); win32 (3,674 ms) asserted the platform refusal | `tests/contract/probe-run-command.test.mjs:470` - the statement; `:472` - `succeeded(await probe(fixture, probeRequest({ sql, parameters: [1, "paid"] })), ...)` (exit 0 and `ok === true`, `:216-220`); `:473` - `assert.equal(matched.result.status, "complete")`; `:474` - `assert.equal(matched.result.rowCount, 1)`; `:475` - `assert.equal(runOf(fixture, matched.runId).state, "COMPLETED")`; `:476-477` - `[1, "pending"]` `succeeded`, `assert.equal(other.result.rowCount, 0)`. Windows: `:471` -> `:400` `refused(..., "VES_PROBE_HOST_PLATFORM_UNSUPPORTED", 5, ...)`, `:401` `assert.deepEqual(runs(fixture), [])`. Fixture rows (1, `paid`), (2, `pending`), (3, `shipped`) at `tests/helpers/probe-run-fixture.mjs:55-59` | PASS |
| C7 | Linux/macOS: the C6 statement with [1, `PARAM-7f3a-SENTINEL`] exits 0, `rowCount` 0; the sentinel is in none of stdout, stderr or the JSON envelope | the C6 invocation (same test): passed on linux (10,553 ms); win32 takes the refusal branch and does not reach these lines | `tests/contract/probe-run-command.test.mjs:478` - `probeRequest({ sql, parameters: [1, SENTINEL] })`; `:479` - `assert.equal(succeeded(sentinel, ...).result.rowCount, 0)`; `:480` - `assert.equal(sentinel.stdout.includes(SENTINEL), false, "stdout")`; `:481` - the same for `stderr`; `:482` - `assert.equal(JSON.stringify(sentinel.json).includes(SENTINEL), false, "envelope")`. `SENTINEL` = `"PARAM-7f3a-SENTINEL"` (`tests/helpers/probe-run-fixture.mjs:13`). Note 3 | PASS |

## The changed slice 2b assertion

`tests/unit/probe-family.test.mjs`, in "the SQLite engine adapter admits only the statement's own
operation in main". It ran and passed on both platforms in the batched invocation (linux 11 ms,
win32 14 ms).

- **Before** (`6ce57bc7`): `await assert.rejects(plan("SELECT id FROM main.orders WHERE id = ? OR id = ?", [1, 2]), { code: "VES_PROBE_ENGINE_POLICY_DENIED" })`.
  This pinned the defect: the planner de-duplicated the list, so the CLI engine adapter's
  canonical comparison failed.
- **After** (`:122-123`): `const twoBinds = await plan("SELECT id FROM main.orders WHERE id = ? OR id = ?", [1, 2]);`
  then `assert.deepEqual(twoBinds.operation.parameterClassifications, [sqlite.classification, sqlite.classification])`.
  `sqlite` is the registration built at `:31-33`. Its classification is not a literal at the
  assertion, which is a small precision gap. The same registration's classification is asserted
  as `"confidential"` at `:49`: `Array(4).fill("confidential")` for `sqliteStatement`. The
  expectation compares the plan with the registration the statement was classified under, which
  is the semantics the claim needs.

**Verdict: not weakened. It is the same input, at the same layer, with the expectation inverted
to the new behaviour and an exact value.**

The plan resolves only if the planner's engine-adapter step returns no violation
(`packages/data-probe/src/index.ts:641-643`). That step is the CLI adapter's canonical equality
between the re-parse and the plan (`apps/vestra-cli/src/probe/probe-statement.ts:64-65`). So
`await plan(...)` asserts the adapter's admission, and the `deepEqual` asserts the exact
one-per-bind list. Each assertion fails under the other implementation: at `6ce57bc7`, `await
plan(...)` throws.

What the old assertion exercised that is no longer exercised here is the adapter refusing a
classification-count mismatch. `sqliteStatement` can no longer produce that mismatch. The adapter's
generic mismatch path is still asserted in the same test (`VES_SQLITE_PLAN_MISMATCH`, :90-96),
and a count mismatch is asserted at the parser and the worker by C5.

The comment change (:98-100) and the slice 2b `checks.md` note
(`.specs/features/probe-run/checks.md:234`) record the change, as the `## Handoff` of `checks.md`
says.

### Level, sampling and precision notes

None of these fails a row. Each one records what a green proof does not cover. They are ranked by
how much they weaken the evidence.

1. **C3, level: fixture connections and stub planner adapters.** Every engine fixture plans
   through a stub engine adapter, `validateNormalizedOperation: () => []`. Examples are
   `tests/helpers/postgresql-probe-fixture.mjs:33`, `mysql-family-probe-fixture.mjs:31` and
   `sqlite-probe-fixture.mjs:37`. Each fixture also runs on a fixture connection, such as
   `PostgreSqlFixtureConnection` (`postgresql-probe-fixture.mjs:45`) or `SqliteFixtureConnection`
   (`sqlite-probe-fixture.mjs:59`).

   So C3 proves the decisive path: the plan's list against each worker adapter's re-parse bind
   count. For SQLite that count is `packages/data-probe/src/sqlite-adapter.ts:170-172`, reached
   through `:295`. C3 does not prove binding against a real database for the seven non-SQLite
   engines. Real binding is shown only for SQLite: a real file in C4, and a real worker in C6/C7.
   The claim is worded at the supervisor and is met. The Intent's "plans and runs on every
   engine" is fixture-level outside SQLite.

   The table also does not assert each row's label against `f.plan.engine`. A fixture that
   planned under another engine would still pass.
2. **C2, sampling.** The pinned digests are the SQLite fixture's two plans. That every zero- or
   one-bind plan, on every engine, keeps its digest follows from the code, not from a proof.
   `sortedValues` and `uniqueSorted` return the same list for any input without a repeated value
   (`packages/data-probe/src/index.ts:191-200`), and that includes zero or one value.
   `statementFingerprint` is `digest(operation)` (:659), so only an operation with a repeated
   classification changes its fingerprint.
3. **C6/C7, platforms.** On win32 the test asserts only the platform refusal (C6's Windows half),
   and C7's sentinel assertions run only off win32. Linux decides C6's POSIX half and C7. macOS
   was not run; `checks.md` names it beside Linux, so the macOS half of C6 and C7 rests on the
   shared POSIX path.
4. **C7, sensor.** The sentinel assertions are absence-only. The sentinel run is shown to complete
   (:479, exit 0, `rowCount` 0), so stdout and the envelope are real output. That this sensor can
   see a leaked parameter is shown only by slice 2b's single-parameter leak worker (:453-461).
   Here the sentinel is the second bind, and there is no leak case for the multi-parameter path.
5. **C5, scope.** The parser half exercises code this diff does not change
   (`sqlite-adapter.ts:170-172`), so it is a regression guard. The worker half crosses the new
   path: a two-entry plan list reaching the supervisor.
6. **C1, sampling.** One out-of-set value is sampled (`private`). The 256-entry cap of
   `sortedValues` (:192) and each parser's 64-entry cap (for example `sqlite-adapter.ts:112`)
   are unchanged and unclaimed.
7. **Consumers.** No other consumer of the plan's list assumes it is unique:
   - the extension host copies it (`packages/extension-host/src/index.ts:314`);
   - each worker adapter hands it to its own parser (`sqlite-adapter.ts:295`,
     `mysql-family-adapter.ts:331`, `postgresql-adapter.ts:354`, `oracle-adapter.ts:316`,
     `sqlserver-adapter.ts:307`, `sap-ase-adapter.ts:325`, `mongodb-adapter.ts:351`);
   - `database-knowledge.ts:616-625` sorts without de-duplicating.

## Coverage

At `light` the join is not recomputed. Below is the author's table as written, with the
verifier's notes. Every member it names maps to a check above that passed on Linux.

| Set (size) | Member -> proof | Unproven | Verifier note |
| --- | --- | --- | --- |
| engines (8) | `postgresql` C3 · `mysql` C3 · `mariadb` C3 · `sqlserver` C3 · `sybase` C3 · `oracle` C3 · `sqlite` C3, C4, C6 · `mongodb` C3 | - | all 8 rows present (`probe-multi-parameter.test.mjs:22-97`, `:100`); level note 1 |
| bind count (3 edges) | 0 C2 · 1 C2 · 2 C1, C3, C4, C6 | - | confirmed; C1 also covers 3 |
| classification mix (2) | one class repeated C1 · several classes, one repeated C1 | - | confirmed (`:24-27`, `:28-32`) |
| count mismatch (2 places) | parser C5 · worker C5 | - | confirmed (`:110-118`, `:119-125`); note 5 |

## Swept

Only one row says **existing**: authorization. It says the probe approval binds the statement
fingerprint, which this change does not alter for zero or one bind. The constraint is there:
- `apps/vestra-cli/src/probe/probe-authority.ts:107` - the approval's `packageDigest:
  plan.statementFingerprint`;
- `:162` - the grant constraint `statementFingerprint:${plan.statementFingerprint}`;
- `packages/data-probe/src/index.ts:659` - `statementFingerprint: digest(operation)`, so the
  classification list is part of what the approval binds.

C2 pins the zero- and one-bind fingerprints unchanged, and the verifier reproduced them at
`6ce57bc7`.

The other rows cite checks verified above: validation (C1, C5), failure modes (C5), data
lifecycle (C2), state transitions (C6) and observability (C7). Idempotency, concurrency and
dependency failure are `n/a`.

## Gate

Windows (this checkout, Node 24.14.0, `ba4aa226`):

- the batched proof invocation (7 patterns over 5 files): 7 tests, 7 passed, 0 failed, 0 skipped, 0 cancelled (exit 0)
- `corepack pnpm gate:quick`: PASS (exit 0). format:check, lint, complexity:check ("115 baselined hotspot keys, nothing above 10 unaccounted") and typecheck passed. test:unit: 3666 passed, 0 failed. test:agent-readiness: 464 passed, 0 failed. test:census: 14 passed, 0 failed
- `corepack pnpm test:architecture`: 149 passed, 0 failed (exit 0)

Linux (WSL clone `~/verchestra-569`, detached at `ba4aa226`, Node 24.14.0, `pnpm install --frozen-lockfile --offline`; left clean and detached at that sha):

- the same batched proof invocation: 7 tests, 7 passed, 0 failed, 0 skipped, 0 cancelled (exit 0)
- `corepack pnpm gate:quick`: PASS (exit 0). format:check, lint, complexity:check ("115 baselined hotspot keys, nothing above 10 unaccounted") and typecheck passed. test:unit: 3666 passed, 0 failed. test:agent-readiness: 464 passed, 0 failed. test:census: 14 passed, 0 failed
- `corepack pnpm test:contract`: 1031 passed, 0 failed (exit 0). Includes C3, C5 and the C6/C7 test (6,741 ms)
- `corepack pnpm test:architecture`: 149 passed, 0 failed (exit 0)
- `corepack pnpm test:integration`: 1286 passed, 0 failed (exit 0). Includes C4 (103 ms)
- `corepack pnpm test:e2e`: 363 passed, 0 failed (exit 0)

`test:integration` was not run on Windows, which has known symlink failures without Developer
Mode. `test:qualification` and the load proofs were not run, as briefed.
