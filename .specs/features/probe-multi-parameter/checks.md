# Probe multi-parameter checks

Profile: light
Plan: none - the `## Intent` escape (one source file, no one-way door)

## Intent

Every data-probe engine parser returns a read operation with one parameter classification per
bind, sorted (`sqlite-adapter.ts`, `postgresql-adapter.ts` and the other five). The probe
planner's `normalizeOperation` (`packages/data-probe/src/index.ts`) passes that list through
`uniqueSorted`, which drops duplicates. So a statement with two binds of one classification is
planned with one classification, and the worker's adapter, which parses the statement again
against the plan's list, refuses it: the bind count no longer matches
(`VES_SQLITE_PARAMETERS_INVALID` on SQLite, the engine's own code elsewhere). `vestra probe run`
classifies every parameter as the database is (slice 2b, `probe-statement.ts`), so today it
refuses every statement with two or more parameters, on every engine. The test fixtures plan one
bind by default, so no proof crossed that path.

When this ships, the planner keeps one classification per bind, sorted, as the parsers already
produce it. A statement with several parameters plans and runs on every engine, and
`vestra probe run` binds them all. A plan with zero or one bind is byte-for-byte the plan it was,
so its digests do not move. The owner chose this shape on 2026-10-29: the planner, not the seven
adapters, changes.

7 checks in 2 slices · 0 one-way doors · 0 open

## Checks

### S1 - the planner keeps one classification per bind · ~14 files · ~95 KB · ~24k

**C1** - `ProbePlanner.plan` keeps a classification per bind, sorted: an operation whose `parameterClassifications` is [`internal`, `internal`] plans as [`internal`, `internal`], and [`public`, `internal`, `public`] plans as [`internal`, `public`, `public`]. A value outside the five classifications is still refused with `VES_PROBE_OPERATION_INVALID`.
Proof: `node --test --test-name-pattern "the planner keeps one classification per bind" tests/unit/probe-operation-classifications.test.mjs`

**C2** - A plan with zero or one bind keeps its digests. Through `sqliteFixture` (`tests/helpers/sqlite-probe-fixture.mjs`), the one-bind default plan has `statementFingerprint` `sha256:8cadb74e0584b94a15a7449dc159b69a53b00fe054cf9ba24be7590062adb428` and `planDigest` `sha256:ad1cadf015b572df1fb2760677c4e65e54f8ddd0c5838ef05c0832214f4036c3`; the zero-bind plan of `SELECT count(*) FROM main.orders` has `statementFingerprint` `sha256:162ccb5ea28fcc9f584822ea6053f995f97f983a7112d5b70fd85982648b09ad` and `planDigest` `sha256:5617095ad7ff2c67c444f773257ac94283e248a64025358772a1dc3e16ca66bb`. These are the values main produced at `6ce57bc7`, before the change.
Proof: `node --test --test-name-pattern "plans with zero or one bind keep their digests" tests/unit/probe-operation-classifications.test.mjs`

**C3** - For each of the eight engines (`postgresql`, `mysql`, `mariadb`, `sqlserver`, `sybase`, `oracle`, `sqlite`, `mongodb`), a statement or command with two parameters, planned through `ProbePlanner` with classifications [`internal`, `internal`] and run under `ProbeWorkerSupervisor` with that engine's adapter, completes with `status` `complete`.
Proof: `node --test --test-name-pattern "every engine runs a read with two parameters of one classification" tests/contract/probe-multi-parameter.test.mjs`

**C4** - Against a real SQLite file (`realSqliteFixture`: `(1, paid, 50)` and `(2, pending, 25)`), `SELECT id FROM main.orders WHERE status = ? AND amount > ?` with [`paid`, 10] returns one row, `id` 1, and with [`paid`, 60] returns no row.
Proof: `node --test --test-name-pattern "a real SQLite read binds two parameters of one classification" tests/integration/sqlite-probe-adapter.test.mjs`

**C5** - A bind count that differs from the classifications is still refused: the SQLite parser refuses two binds under one classification with `VES_SQLITE_PARAMETERS_INVALID`, and a plan of two binds whose protected request carries one parameter fails under the supervisor with `VES_SQLITE_PARAMETERS_INVALID`.
Proof: `node --test --test-name-pattern "a bind count that differs from its classifications is refused" tests/contract/probe-multi-parameter.test.mjs`

### S2 - vestra probe run binds every parameter · ~4 files · ~45 KB · ~11k

**C6** - On Linux and macOS, `vestra probe run` with `SELECT id, status FROM main.orders WHERE id = ? AND status = ?` and the first fixture row's `id` and `status` exits 0 with `result.status` `complete` and `result.rowCount` 1, and the run ends `COMPLETED`; with that `id` and another row's `status` it exits 0 with `result.rowCount` 0. On Windows the command refuses with `VES_PROBE_HOST_PLATFORM_UNSUPPORTED` and creates no run.
Proof: `node --test --test-name-pattern "a probe run binds every parameter" tests/contract/probe-run-command.test.mjs`

**C7** - The parameter values of C6 appear in none of stdout, stderr or the JSON envelope.
Proof: `node --test --test-name-pattern "a probe run binds every parameter" tests/contract/probe-run-command.test.mjs`

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| engines (8) | `postgresql` C3 · `mysql` C3 · `mariadb` C3 · `sqlserver` C3 · `sybase` C3 · `oracle` C3 · `sqlite` C3, C4, C6 · `mongodb` C3 | - |
| bind count (3 edges) | 0 C2 · 1 C2 · 2 C1, C3, C4, C6 | - |
| classification mix (2) | one class repeated C1 · several classes, one repeated C1 | - |
| count mismatch (2 places) | parser C5 · worker C5 | - |

- C3 is table-driven over all eight engines; C4 and C6 cross a real SQLite connection.
- No other check claims more than the cases its proof exercises.

## Swept

- validation: C1 (a classification outside the five is still refused), C5 (bind count against classifications)
- failure modes: C5
- idempotency: n/a - planning is a pure function of its inputs and stores nothing
- authorization: existing - the probe approval binds the statement fingerprint (slice 2b's approval binding, `.specs/features/probe-run/checks.md`), which this change does not alter for zero or one bind (C2)
- concurrency: n/a - no shared state changes
- data lifecycle: C2 (no plan is kept across versions; the digests of every plan that could be made before stay the same)
- dependency failure: n/a - no new dependency, file or process
- state transitions: C6 (the run ends `COMPLETED`)
- observability: C7 (no parameter reaches the output)

## Out of scope

- A classification per parameter in the request file - slice 2b's door 4 gives the request file none; every parameter takes the registration's classification.
- The positive control for slice 2b's C7 process spy - a separate change.

## Handoff

- S1 = ~24k (data-probe's normalizer, the eight engine fixtures, two test files); S2 enters the CLI at ~35k total, under the 150k budget - one builder
