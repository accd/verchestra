# Probe run, slice 2b verification

**Verdict**: PASS
**Profile**: light
**Diff range**: 02b50ba8..b22b8068
**Round**: 1 - full
**Verifier**: independent sub-agent (author != verifier)

Verified at `b22b8068` on two platforms. Windows is this checkout, Node 24.14.0. Linux is the
WSL clone `~/verchestra-569`: clean before the checkout, fetched from this checkout, detached at
`b22b8068`, and installed with `pnpm install --frozen-lockfile --offline` on Node 24.14.0. The
run changed no tracked file, git config, branch or commit in this checkout. Before and after,
`git status --porcelain` shows only the pre-existing `?? .claude/`, plus this report afterwards.

The profile is `light`, as `checks.md` declares. Step 1 does not run: the plan marks no binding
source that applies under `light`. The validator's warning about "binding" is a false positive
from the domain term "binding digest". Fault injection does not run under `light`, and the
`Coverage` join is not recomputed.

The claims were checked against `checks.md` as it stands at `b22b8068`. That includes the two
owner amendments: the fixture statement names `main.orders`, and C7 admits the OS credential
store's tool beside Git. The fixture is `tests/helpers/probe-run-fixture.mjs`. It matches the
fixture paragraph: `main.orders` with 3 rows (:54-61), registered as `orders`, engine `sqlite`,
purpose `diagnostics`, `allowedObjects` [`main.orders`], `maxRows` 100 (:67-93). The request is
`SELECT id, status FROM main.orders WHERE id = ?` with `parameters: [1]` (:106-115). The sentinel
is `PARAM-7f3a-SENTINEL` (:13).

Every proof ran in one batched `node --test --test-reporter=spec` invocation per platform. Each
of the 34 proof patterns was passed as its own `--test-name-pattern`. On Windows the sealed
closure ran in a second invocation, with a process-scoped `core.excludesFile` for `.claude/` set
through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0`. Each named test is listed
below as run and passed. Three patterns match more than one test:
- the `--help` pattern matches `vestra ...` and `verchestra ...`;
- C29's first pattern is an alternation that matches two tests;
- C29's second pattern matches the test now titled "only the database family loads data-probe,
  and the probe family plans with it", the title the handoff records.

Each named test exists. `grep -n` over the proof files shows each one at the line cited in the
table. Every file that holds one is in the diff. These are new:
- `tests/contract/probe-run-command.test.mjs`
- `tests/unit/probe-supervisor-grant.test.mjs`
- `tests/architecture/probe-command-composition.test.mjs`
- `tests/unit/probe-run-workflow.test.mjs`
- `tests/integration/runtime-probe-run-migration.test.mjs`
- `tests/unit/probe-run-authority.test.mjs`
- `tests/e2e/probe-cli-e2e.test.mjs`

These are modified:
- `tests/contract/cli-surface.test.mjs` adds the C27 test at :319.
- `tests/e2e/cli-launchers-e2e.test.mjs` changes the `--help` snapshot at :45, adding the
  `probe run` line.
- `tests/build/sealed-launcher-closure.test.mjs` adds `"probe run"` to `SEALED_COMMANDS` at
  :102, and moves the migration pin from 12 to 13 at :298-299.
- `tests/architecture/extension-host-composition.test.mjs` and
  `tests/architecture/database-command-composition.test.mjs` admit the probe family.

The helpers in `tests/contract/probe-run-command.test.mjs` work like this:
- `refused(result, code, exitCode, label)` (:222-227) asserts `result.exitCode === exitCode`,
  `json.ok === false` and `json.error.code === code`.
- `succeeded` (:216-220) asserts exit 0 and `ok === true`.
- `noRun(fixture)` (:406-408) asserts that the runtime store's `runs` table is `[]`.
- `runs`, `approvalsOf` and `grantsOf` (:372-387) read the store the command left behind
  through a read-only `DatabaseSync`.

`tests/e2e/probe-cli-e2e.test.mjs` has the same `succeeded`/`refused` helpers at :40-50. Every
exit code and error code below is the literal passed at the cited call.

**Windows.** On win32 the following proofs take their XP-04 branch:
`refusedOnWindows(fixture)`, then `VES_PROBE_HOST_PLATFORM_UNSUPPORTED`, exit 5, no run and no
credential read (:398-403). For C30 it is the same refusal through the launcher
(`probe-cli-e2e.test.mjs:118-134`).
- Taking that branch: C1-C12, C14, C17, C19 and C30.
- Running in full on win32: C13, under an injected POSIX platform; C15; and the
  platform-independent C16, C18, C20-C29, C31 and C32.

So **the Linux run decides every check whose claim needs a real worker.** The Windows run shows
that each of those proofs asserts the platform refusal instead of skipping.

## Checks

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | review before the digest names database, engine, environment, classification, production, purpose, fingerprint, `main.orders`, 4 bounds, worker id, launch digest, binding digest; one `probe` run in `AWAITING_EXECUTION_APPROVAL` | `node --test --test-name-pattern "the review names the run's binding before the digest is typed" tests/contract/probe-run-command.test.mjs`: passed on linux (10146 ms); win32 (7140 ms) asserted the platform refusal | `tests/contract/probe-run-command.test.mjs:415-417` - review captured in the `answer` callback, when the digest is read; `:422-434` - `line(...)` asserts `^ {2}<label>: +<value>$` for `database` `orders`, `engine` `sqlite`, `logical environment` `staging`, `classification` `confidential`, `production` `false`, `purpose` `diagnostics`, `statement fingerprint` = `data.result.queryFingerprint`, `objects read` `main\.orders`, `bounds` `rows 100, bytes 100000, timeout-ms 20000, concurrency 1`, `worker`, `launch digest`, `binding digest` = the stored approval's; `:436-438` - `assert.deepEqual(shown.runs, [{ runId, runKind: "probe", state: "AWAITING_EXECUTION_APPROVAL", version: 1 }])` | PASS |
| C2 | `PARAM-7f3a-SENTINEL` in none of stdout, stderr, envelope, on a completed and a refused run | `node --test --test-name-pattern "the request's parameters never reach the output" ...probe-run-command.test.mjs`: passed on linux (8195 ms); win32 refusal | `:446` - `probeRequest({ parameters: [SENTINEL] })`; `:452` completed (rowCount 0); `:454` - `refused(leaked, "VES_PROBE_SECRET_LEAK", 5, ...)`; `:459-461` - `assert.equal(result.stdout.includes(SENTINEL), false)`, the same for `stderr` and `JSON.stringify(result.json)`, for both runs | PASS |
| C3 | exit 0; `runId`/`approvalId`/`grantId`/`result`; `status` `complete`, `rowCount` 1, `databaseId` `orders`, `grantRef` = `grantId`; approval `probe-execution` bound to the run; grant `database-read` under the run; `expiresAt - issuedAt` = 600,000 ms | `node --test --test-name-pattern "a confirmed probe run records its approval and grant and prints the envelope" ...`: passed on linux (4488 ms); win32 refusal | `:468` - `succeeded(...)` (exit 0); `:469` - `assert.deepEqual(Object.keys(data).sort(), ["approvalId", "grantId", "result", "runId"])`; `:470-473` - `status === "complete"`, `rowCount === 1`, `databaseId === "orders"`, `grantRef === data.grantId`; `:475-478` - `[[data.approvalId, "probe-execution", data.runId]]`; `:480-483` - `[[data.grantId, "database-read", data.runId]]`; `:484` - `assert.equal(Date.parse(expiresAt) - Date.parse(issuedAt), GRANT_LIFETIME_MS)` (`:49` `600_000`) | PASS |
| C4 | the completed run is `COMPLETED`, kind `probe` | `node --test --test-name-pattern "a completed probe run ends COMPLETED" ...`: passed on linux (4424 ms); win32 refusal | `:492` - `assert.equal(run.state, "COMPLETED")`; `:493` - `assert.equal(run.runKind, "probe")` | PASS |
| C5 | the grant carries a revocation after a completed run and after a worker-refused run | `node --test --test-name-pattern "the grant is revoked when the run ends" ...`: passed on linux (7410 ms); win32 refusal | `:505-506` - completed `COMPLETED`, other `FAILED`; `:512` - `assert.equal(grants.length, 1)`; `:513` - `assert.ok(Number.isFinite(Date.parse(grants[0].revokedAt)))` for both runs | PASS |
| C6 | `leak` worker: exit 5 `VES_PROBE_SECRET_LEAK`, run `FAILED` | `node --test --test-name-pattern "a refusal after the grant fails the run" ...`: passed on linux (4041 ms); win32 refusal | `:519-520` - worker approved with `PROBE_FIXTURE_MODE` `leak` (`:318`); `:523-528` - `refused(..., "VES_PROBE_SECRET_LEAK", 5, ...)`; `:530-531` - `runKind === "probe"`, `state === "FAILED"`; `:532-533` - one approval, one grant (refused after the grant) | PASS |
| C7 | mistyped digest and no terminal/no `--confirm-stdin`: exit 5 `VES_TASK_CONFIRMATION_REQUIRED`, no approval, no grant, only Git and the credential tool started, none after the review, run `ABORTED` | `node --test --test-name-pattern "a run whose digest is not typed back is aborted" ...`: passed on linux (4071 ms); win32 refusal | `:558` - `refused(result, "VES_TASK_CONFIRMATION_REQUIRED", 5, label)`; `:560` - `assert.equal(run.state, "ABORTED")`; `:561-562` - approvals `[]`, grants `[]`; `:563-564` - review shown, `assert.deepEqual(started.slice(reviewedAt), [])`; `:568-569` - `started.filter((file) => !git(file) && !CREDENTIAL_TOOL.test(file))` deep-equals `[]` (`CREDENTIAL_TOOL` at `tests/helpers/deny-keychain-spawn.mjs:19-20`). Sensor note 1 | PASS |
| C8 | unregistered -> `VES_DATABASE_NOT_FOUND`; `maxRows` edited after signing -> `VES_DATABASE_REGISTRATION_INVALID`; exit 5; no run | `node --test --test-name-pattern "a probe of an absent or invalid registration creates no run" ...`: passed on linux (2329 ms); win32 refusal | `:576` - `refused(..., { database: "invoices" }), "VES_DATABASE_NOT_FOUND", 5, ...)`; `:580-583` - signed `maxRows` 100 rewritten to 100,000, signature kept; `:584` - `refused(..., "VES_DATABASE_REGISTRATION_INVALID", 5, ...)`; `:585` - `noRun` | PASS |
| C9 | valid `postgresql` registration -> exit 5 `VES_PROBE_ENGINE_UNAVAILABLE`, no run | `node --test --test-name-pattern "a probe of an engine other than SQLite creates no run" ...`: passed on linux (2066 ms); win32 refusal | `:589` - `orders-pg` added through `database add` (`succeeded`, `:298-307`; `postgresDefinition`, fixture `:97-102`); `:591-596` - `refused(..., "VES_PROBE_ENGINE_UNAVAILABLE", 5, ...)`; `:597` - `noRun` | PASS |
| C10 | `DELETE FROM orders` -> WRITE, `SELECT 1; SELECT 2` -> BATCH, `PRAGMA user_version` -> PRAGMA; exit 5; no run | `node --test --test-name-pattern "SQL the SQLite parser refuses creates no run" ...`: passed on linux (2469 ms); win32 refusal | `:603-607` - the 3 rows `["DELETE FROM orders", "VES_SQLITE_WRITE_DENIED"]`, `["SELECT 1; SELECT 2", "VES_SQLITE_BATCH_DENIED"]`, `["PRAGMA user_version", "VES_SQLITE_PRAGMA_DENIED"]`; `:608` - `refused(..., code, 5, sql)`; `:609` - `noRun` | PASS |
| C11 | purpose `export`, `main.customers`, `rowLimit` 101 -> PURPOSE / OBJECT / BOUNDS denied; exit 5; no run | `node --test --test-name-pattern "a request outside the registration or its policy creates no run" ...`: passed on linux (2283 ms); win32 refusal | `:616` - `purpose: "export"` -> `"VES_PROBE_PURPOSE_DENIED"`; `:617-621` - `SELECT id FROM main.customers WHERE id = ?` -> `"VES_PROBE_OBJECT_DENIED"`; `:622` - `rowLimit: 101` -> `"VES_PROBE_BOUNDS_DENIED"`; `:624` - `refused(..., code, 5, label)`; `:625` - `noRun` | PASS |
| C12 | 5 approval states -> exit 5, no run, code = first failing row of `vestra extension check`; entry -> `VES_PROBE_HOST_ENTRY_DIGEST`, executable -> `VES_PROBE_HOST_LAUNCH_DIGEST` | `node --test --test-name-pattern "a worker approval that does not hold creates no run" ...`: passed on linux (8952 ms); win32 refusal | `:629` - `["unapproved", "revoked", "expired", "entry-edited", "executable-changed"]`; `:649-655` - expected codes, with `[edited, "VES_PROBE_HOST_ENTRY_DIGEST"]` and `[changed, "VES_PROBE_HOST_LAUNCH_DIGEST"]`; `:656-659` - `extension check` exit 4, `failing = checks.find((row) => row.status === "fail")`, `assert.equal(failing.code, expected)`; `:660` - `refused(await probe(...), failing.code, 5, worker.ref)`; `:662` - `noRun` | PASS |
| C13 | 7 bad request files -> exit 2 `VES_CLI_ARGUMENT_INVALID` naming `--request`, no run; 65,536 bytes passes the reader | `node --test --test-name-pattern "a request file that is not a request creates no run" ...`: passed on linux (2751 ms) and win32 (2391 ms, injected POSIX platform) | `:678` - `refused(result, "VES_CLI_ARGUMENT_INVALID", 2, label)`; `:679` - `assert.deepEqual(envelope.safeDetails, { argument: "--request" })`; `:681-687` - no flag, missing, `valid.padEnd(65_537, " ")`, not JSON, extra key `kind`, no `bounds`, `schemaVersion: 2`; `:689` - `assert.equal((await readFile(padded)).length, 65_536)`; `:695-697` - exit 5, code not `VES_CLI_ARGUMENT_INVALID`, `VES_DATABASE_NOT_FOUND` off win32; `:698` - `noRun` | PASS |
| C14 | no passphrase -> exit 5 `VES_TASK_NOT_CONFIGURED`, `requirement` `evidence-signing-passphrase`, no run | `node --test --test-name-pattern "a probe run without the signing passphrase creates no run" ...`: passed on linux (3320 ms); win32 refusal | `:704` - store emptied; `:706` - `refused(..., "VES_TASK_NOT_CONFIGURED", 5, ...)`; `:707` - `assert.deepEqual(envelope.safeDetails, { requirement: SIGNING })` (`:47` `"evidence-signing-passphrase"`); `:711` - `noRun` | PASS |
| C15 | platform `win32` with a missing request file -> exit 5 `VES_PROBE_HOST_PLATFORM_UNSUPPORTED` (not 2), no credential read, no run | `node --test --test-name-pattern "Windows refuses a probe run before reading anything" ...`: passed on linux (729 ms) and win32 (2217 ms) | `:717-718` - `@<missing>` request under `platform: "win32"`; `:719` - `refused(result, "VES_PROBE_HOST_PLATFORM_UNSUPPORTED", 5, ...)`; `:720` - `assert.deepEqual(await credentialLookups(), before)`; `:721` - `noRun`. Code order: `apps/vestra-cli/src/probe/probe-run.ts:350-351`, `refuseUnsupportedPlatform` before `readProbeRequest` | PASS |
| C16 | supervisor admitted under `grant-a` refuses a `grant-b` plan with `VES_PROBE_WORKSPACE_TRUST_GRANT` and starts no worker; a `grant-a` plan proceeds | `node --test --test-name-pattern "the supervisor refuses a plan whose grant is not the admitted one" tests/unit/probe-supervisor-grant.test.mjs`: passed on linux (38 ms) and win32 (38 ms) | `tests/unit/probe-supervisor-grant.test.mjs:63` - `trust.grantRef === "grant-a"`; `:67` - `assert.throws(() => supervisor(otherPlan, ...), { code: "VES_PROBE_WORKSPACE_TRUST_GRANT" })`; `:68` - `assert.deepEqual(refused.calls, [])`; `:72-75` - `status "complete"`, `grantRef "grant-a"`, calls `["handshake", "identity", "session", "execute"]`. Code: `packages/extension-host/src/index.ts:183-184`. Level note 2 | PASS |
| C17 | completed run: credential store asked for exactly `evidence-signing-passphrase`; `report-environment` worker's keys = its approved launch environment's | `node --test --test-name-pattern "the worker gets only its approved launch environment" ...`: passed on linux (4227 ms); win32 refusal | `tests/contract/probe-run-command.test.mjs:745` - `assert.ok(asked.length > 0)`; `:746` - `assert.deepEqual([...new Set(asked.map((entry) => entry.account))], [SIGNING])`; `:752-755` - `assert.deepEqual(report.environmentKeys.filter((key) => !runtimeAdded.has(key)), [...HOST_ENVIRONMENT, "PROBE_FIXTURE_MODE"].sort())` (`HOST_ENVIRONMENT` literal at `:52-60`). Precision note 3 | PASS |
| C18 | no `probe/` module imports `SecretBroker`, `withSecret` or an OS credential backend, or reads `logicalCredentialName` | `node --test --test-name-pattern "the probe family reads no credential but the signing passphrase" tests/architecture/probe-command-composition.test.mjs`: passed on linux and win32 | `tests/architecture/probe-command-composition.test.mjs:87-91` - `assert.deepEqual(files.flatMap(... findings ...), [])` with names at `:21-27`, modules at `:29`, `logicalCredentialName` at `:30`/`:79`; `:93` - `unlockedSigner(` only in `probe-run.ts`; `:96-106` - each of 8 forbidden shapes yields a finding (sensor); `:85` - at least 6 modules scanned | PASS |
| C19 | `task status`/`resume`/`cancel`/`review` refuse the probe run with exit 5; state and version unchanged | `node --test --test-name-pattern "task commands refuse a probe run" ...`: passed on linux (6450 ms); win32 refusal | `tests/contract/probe-run-command.test.mjs:763-768` - the 4 argvs; `:770` - `refused(result, "VES_TASK_RUN_NOT_FOUND", 5, argv[1])`; `:771` - `assert.deepEqual(runOf(fixture, runId), before)` (row holds `runKind`, `state`, `version`) | PASS |
| C20 | `COMPLETE_PROBE` accepted only for `probe` in `EXECUTION_AUTHORIZED`; refused for feature, recovery, and probe in `AWAITING_EXECUTION_APPROVAL`; 7 task/recovery events refused for probe | `node --test --test-name-pattern "the workflow completes a probe run only through COMPLETE_PROBE" tests/unit/probe-run-workflow.test.mjs`: passed on linux and win32 | `tests/unit/probe-run-workflow.test.mjs:70-72` - `accepted === true`, `nextState === "COMPLETED"`; `:77-81` - feature and recovery deep-equal `{ accepted: false, code: "VES_WORKFLOW_RUN_KIND_MISMATCH" }`; `:83-86` - probe in `AWAITING_EXECUTION_APPROVAL` -> `VES_WORKFLOW_COMMAND_REJECTED`; `:55-63` - the 7 events; `:90` - each accepted for its own kind; `:91-95` - each `KIND_MISMATCH` for probe | PASS |
| C21 | 013 on a 012 store with feature (approval, grant, events) and recovery runs: every row equal, empty `foreign_key_check`, `probe` insert succeeds, `other` refused by CHECK | `node --test --test-name-pattern "migration 013 keeps every row and admits the probe kind" tests/integration/runtime-probe-run-migration.test.mjs`: passed on linux (721 ms) and win32 (402 ms) | `tests/integration/runtime-probe-run-migration.test.mjs:188` - all 8 referencing tables and `runs` non-empty; `:194` - `appliedMigrations === 1`; `:205` - `assert.deepEqual({ ...after, ves_migrations: after.ves_migrations.slice(0, 12) }, before)` (rows with rowid, `:146-167`); `:206` - `assert.deepEqual(inspect(dbPath, "PRAGMA foreign_key_check"), [])`; `:222-223` - probe run created, `runKind === "probe"`; `:232-233` - `VES_RUNTIME_CONSTRAINT`, `/CHECK constraint failed: run_kind IN/` | PASS |
| C22 | 13 migrations, last `013_probe_runs`; first 12 refuse with `VES_RUNTIME_MIGRATION_INCOMPATIBLE` | `node --test --test-name-pattern "migration 013 is the last migration and older binaries refuse it" ...`: passed on linux and win32 | `:241` - `assert.equal(DEFAULT_RUNTIME_MIGRATIONS.length, 13)`; `:242` - `.at(-1).id === "013_probe_runs"`; `:247-248` - `slice(0, 12)` store `assert.throws(() => older.open(), { code: "VES_RUNTIME_MIGRATION_INCOMPATIBLE" })` | PASS |
| C31 | rebuild runs with FKs off; a dangling result rolls back with `VES_RUNTIME_MIGRATION_FOREIGN_KEY`, tables and ledger unchanged, `foreign_keys` 1; a good rebuild leaves `foreign_keys` 1 and refuses a dangling insert | `node --test --test-name-pattern "a rebuild migration runs with foreign keys off and commits only without violations" ...`: passed on linux and win32 | `:296` - `assert.throws(() => failing.open(), { code: "VES_RUNTIME_MIGRATION_FOREIGN_KEY" })`; `:297`/`:312` - `assert.deepEqual(tableRows(refusedPath), before)` (includes `ves_migrations`); `:304-308` - on a held connection, same code, `isTransaction === false`, `PRAGMA foreign_keys` `{ foreign_keys: 1 }`; `:324` - rebuild observed `[{ foreign_keys: 0 }]`; `:326` - `safetySettings().foreignKeys === 1`; `:327-335` - dangling approval `FOREIGN KEY constraint failed` | PASS |
| C23 | probe approval binding: action, `packageDigest`, `sourceStateDigest`, `policyDigest`, 3 context digests = digest of `{}`, review lists as door 2 writes them | `node --test --test-name-pattern "the probe approval binds the run as door 2 writes it" tests/unit/probe-run-authority.test.mjs`: passed on linux and win32 | `tests/unit/probe-run-authority.test.mjs:122` - `binding.action === "probe-execution"`; `:124-126` - `packageDigest === plan.statementFingerprint`, `sourceStateDigest === plan.registrationDigest`, `policyDigest === probePolicy.digest`; `:127-130` - each context digest `=== sha256("{}")`; `:131-136` - `capabilities` `["database-read"]`, `scope` `["database:orders"]`, `dataAccess` `["main.orders"]`, `selectedPassports`, `budgets`, `evidenceRefs`; `:137-147` - the other 8 lists `["not-applicable"]`. Together they are all 14 lists of `ApprovalReviewSurface` (`packages/application/src/authority/authority.ts:29-46`) | PASS |
| C24 | grant request principal/action/resource/capability, constraints exactly 5; the policy view's only policy is the door's `permit`; mapped grant `grantRef`, `approvalRef`, `isolationProfile`, `risk` | `node --test --test-name-pattern "the probe grant and its admission grant are shaped as door 3 writes them" ...`: passed on linux and win32 | `:153-157` - `PROBE_POLICY` literal, `view.layers` deep-equals `{ builtIn: { databaseRead: PROBE_POLICY } }`; `:171-174` - `{ type: "Vestra::Actor", ... }`, `{ type: "Vestra::Action", id: "database-read" }`, `{ type: "Vestra::Database", id: "orders" }`, `capability === "database-read"`; `:175-181` - constraints deep-equal the 5 `databaseId`/`registrationDigest`/`statementFingerprint`/`extensionId`/`launchDigest` entries; `:189` - the issued grant has the same constraints; `:197-208` - `admissionGrant(...)` deep-equals `{ grantRef: grant.grantId, approvalRef: "orders-sqlite", ..., isolationProfile: "process-contained", risk: "approved-workspace-executable" }` | PASS |
| C25 | a verifier expecting `execution` refuses the probe approval; a task grant cannot use it | `node --test --test-name-pattern "a probe approval satisfies no task check" ...`: passed on linux and win32 | `:226` - its own binding verifies; `:228-231` - `{ ...binding, action: "execution" }` -> `{ valid: false, code: "VES_APPROVAL_STALE" }`; `:256-260` - `assert.rejects(broker.grant(taskGrant(binding)), { code: "VES_CAPABILITY_APPROVAL_INVALID" })` for both bindings | PASS |
| C26 | run capsule accepts kind `probe`, refuses an unknown kind | `node --test --test-name-pattern "the run capsule accepts a probe run" tests/unit/probe-run-workflow.test.mjs`: passed on linux and win32 | `tests/unit/probe-run-workflow.test.mjs:139-140` - `capsule.payload.runKind === "probe"` for `FAILED` and `ABORTED`; `:142-145` - `runKind: "maintenance"` rejects `{ code: "VES_RUN_CAPSULE_INVALID", message: "Run kind is invalid" }` | PASS |
| C32 | `COMPLETE_PROBE`/`FAIL`/`ABORT` of a probe run carry `terminalCapsuleRequired` false, feature `FAIL` true; ended probe runs not in `listUnsealedTerminalRuns` | `node --test --test-name-pattern "a probe run needs no terminal capsule" ...`: passed on linux and win32 | `:179` - `assert.equal(decision.snapshot.terminalCapsuleRequired, false)` for the 3 events; `:180-184` - events only `${type}_ACCEPTED`; `:190` - feature `FAIL` `true`; `:191-194` - `["FAIL_ACCEPTED", "TERMINAL_CAPSULE_REQUESTED"]`; `:209-213` - `listUnsealedTerminalRuns()` deep-equals only the feature run | PASS |
| C27 | manifest `probe run` with exactly `database`, `approval-ref`, `request`, `confirm-stdin`, `keychain`; mutating; JSON | `node --test --test-name-pattern "the probe slice takes the options its Surface names" tests/contract/cli-surface.test.mjs`: passed on linux and win32 | `tests/contract/cli-surface.test.mjs:321-342` - `assert.deepEqual(probe.map(...), [["probe run", true, true, [["database", "string", false], ["approval-ref", "string", false], ["request", "string", false], ["confirm-stdin", "boolean", false], ["keychain", "string", false]]]])` | PASS |
| C28 | `--help` snapshot lists `probe run` with its summary; `SEALED_COMMANDS` and the sealed health report list it | `node --test --test-name-pattern "emits the exact canonical release output for --help" tests/e2e/cli-launchers-e2e.test.mjs`: `vestra ...` and `verchestra ...` passed on linux and win32; `node --test --test-name-pattern "honest observations of the staged closure" tests/build/sealed-launcher-closure.test.mjs`: passed on linux (6901 ms) and win32 (25185 ms, scoped exclude) | `tests/e2e/cli-launchers-e2e.test.mjs:45` - the snapshot ends `probe run          Run one confirmed read-only statement against a registered database through an approved worker`; `:64` - `assert.equal(result.stdout, expectedStdout)`; `tests/build/sealed-launcher-closure.test.mjs:102` - `"probe run"` in `SEALED_COMMANDS`; `:303-306` - `assert.deepEqual(report.behavior.commands.map((command) => command.name), SEALED_COMMANDS)` | PASS |
| C29 | slice 1's guard admits `FramedProbeWorker`, `ProbeWorkerSupervisor`, `SpawnedProbeWorker` only from the probe run module and flags them elsewhere; slice 2a's guard admits the probe family to data-probe and flags other families | the `checks.md` alternation of "only the extension commands reach admission" and "the walk flags spawning imports and other modules" over `tests/architecture/extension-host-composition.test.mjs`: both tests passed on linux and win32; `node --test --test-name-pattern "only the database family loads data-probe" tests/architecture/database-command-composition.test.mjs`: passed on linux and win32 | `tests/architecture/extension-host-composition.test.mjs:43` - `SPAWNING_NAMES`; `:123-124` - spawning names allowed only for `allowed.runner` from the host index or platform-node; `:186-190` - product findings `[]`; `:191-199` - host edges exactly the 3; `:233-234` - `probe-other.ts` importing `ProbeWorkerSupervisor` and `probe-spawn.ts` importing `SpawnedProbeWorker` each yield 1 finding (`:242`); `:260-262` - the runner's own edges yield none. `tests/architecture/database-command-composition.test.mjs:209-213` - `compositionFindings(..., families(FAMILY, PROBE_FAMILY))` `[]`; `:214-221` - the probe family does import data-probe; `:259`/`:268` - "another family imports data-probe" yields 1 finding; `:31-36` - the probe family's 4 values | PASS |
| C30 | real launcher, Linux, disposable Workspace: setup; `probe run` exit 0, `rowCount` 1, `COMPLETED`, grant revoked; `task status` refuses; mistyped digest exit 5, `ABORTED`, no grant | `node --test --test-name-pattern "the plan's independent test" tests/e2e/probe-cli-e2e.test.mjs`: passed on linux (13860 ms); win32 (6593 ms) asserted the platform refusal through the launcher | `tests/e2e/probe-cli-e2e.test.mjs:143`, `:153`, `:172` - `database add`, `extension add`, `extension approve` `succeeded`; `:176-178` - exit 0, `status "complete"`, `rowCount === 1`; `:180` - `{ state: "COMPLETED", runKind: "probe" }`; `:183` - `Number.isFinite(Date.parse(grant.revokedAt))`; `:187-189` - `task status` exit 5, `ok === false`, run unchanged; `:193` - `refused(mistyped, "VES_TASK_CONFIRMATION_REQUIRED", 5, ...)`; `:196-197` - `{ state: "ABORTED", runKind: "probe" }`, grants `[]`. Launcher: `apps/vestra-cli/bin/vestra.mjs` (`tests/helpers/task-cli-fixture.mjs:34`, `:364-368`, spawned at `:372`/`:388`) | PASS |

### Level, sampling and precision notes

None of these fails a row. Each one records what a green proof does not cover. They are ranked
by how much they weaken the evidence.

1. **C7, sensor without a positive control.** The process spy (`tests/contract/probe-run-command.test.mjs:72-89`) is never shown to record anything. `started` is asserted only through `started.slice(reviewedAt)` deep-equal `[]` (:564) and a filtered list deep-equal `[]` (:568-569). If the spy recorded nothing, both would pass. Slice 2a's C22 carries `assert.ok(files.length > 0)`; this test has no such check. The spy's design is sound: `SpawnedProbeWorker` takes `spawn` as an ESM named import (`packages/platform-node/src/spawned-probe-worker.ts:1`), which `syncBuiltinESMExports()` (:88) rebinds. Under `light` no fault was injected to show it, so the claims "only Git and the credential tool" and "none after the review" rest on an unverified sensor. Suggested fix: assert that the Git start was recorded.
2. **C16, level.** The supervisor refuses in its constructor (`packages/extension-host/src/index.ts:183-184`, through `resolveTrust` at :251). The proof's "starts no worker" means "makes no call on the worker" (`probe-supervisor-grant.test.mjs:68`). In the product, `SpawnedProbeWorker.launch` (`apps/vestra-cli/src/probe/probe-run.ts:229`) has already spawned the process before the supervisor is built. The command protects itself in two ways. It checks `trust.grantRef !== plan.grantRef` before the launch (`probe-run.ts:226-227`). It also plans and admits under the same `grant.grantId` (:214, :224). That pre-launch branch is unreachable by construction and has no proof. AC 16 is worded at the supervisor, so this is not a gap against the claim.
3. **C17, precision.** The environment comparison drops `NODE_V8_COVERAGE` and `__CF_USER_TEXT_ENCODING` (:750-754), so a worker that received either still passes. The handoff records both as runtime-added. "Exactly one name" is checked as one distinct account name (:746), so repeated reads of the passphrase also pass, which agrees with the claim. The expected key list is a literal in the test (:52-60), not derived from the approval.
4. **Windows.** On win32, C1-C12, C14, C17, C19 and C30 assert only the platform refusal. Linux decides those claims. C13 runs on Windows under an injected POSIX platform, and its `VES_DATABASE_NOT_FOUND` sub-assertion is skipped there (:697). macOS was not run; `checks.md` does not claim it before merge.
5. **C6 depends on an extension-host change outside any named proof.** The supervisor now refuses the JSON-escaped echo as well (`packages/extension-host/src/index.ts:346-357`). Its own-layer test, `tests/unit/probe-supervisor-leak.test.mjs`, is no check's proof. It ran inside `test:unit`, part of gate:quick, which is green on both platforms. C6 and C2 exercise the change through the command on Linux.
6. **C18, scope.** The scan reads the direct imports and names of the family's modules (`probe-command-composition.test.mjs:65-81`). The route to the credential store through `unlockedSigner` is intended. The runtime sensor is C17's credential-store log.
7. **C19.** The refusal code is `VES_TASK_RUN_NOT_FOUND` (:770). The task commands refuse because a probe run has no task plan record, not because of its kind, as the handoff records. The claim names exit 5 and an unchanged run, and both are asserted.
8. **Minor.** C13 asserts the length of the 65,536-byte file (:689) but not of the 65,537-byte one, which is ASCII `padEnd(65_537)` (:683). C30's `task status` refusal asserts exit 5 and `ok === false`, not a code (:187-188); the claim names none.

## Coverage

At `light` the join is not recomputed. Below is the author's table as written, with the
verifier's notes. Every member it names maps to a check above that passed on Linux.

| Set (size) | Member -> proof | Unproven | Verifier note |
| --- | --- | --- | --- |
| `vestra probe run` statuses (3) | exit 0 C3, C30 · exit 2 C13 · exit 5 C6-C12, C14, C15 | - | each cited assertion passes the literal exit code |
| run endings (3) | `COMPLETED` C4 · `FAILED` C6 · `ABORTED` C7 | - | confirmed; C30 repeats `COMPLETED` and `ABORTED` through the launcher |
| refusals before any run (8 kinds) | registration C8 · engine C9 · SQL C10 · policy C11 · worker approval C12 · request file C13 · passphrase C14 · platform C15 | - | each ends in `noRun` or deep-equals `[]` on runs |
| SQLite parser refusals (3) | write, batch, PRAGMA C10, table-driven | - | confirmed (`:603-607`) |
| planner refusals (3) | purpose, object, bounds C11, table-driven | - | confirmed (`:615-623`) |
| worker approval states (5) | absent, revoked, expired, entry edited, executable changed C12, table-driven | - | confirmed (`:629`, `:649-655`) |
| request-file refusals (7) | no flag, missing, over 64 KiB, not JSON, extra key, no `bounds`, `schemaVersion` 2 C13 | - | confirmed (`:681-687`); note 8 |
| task commands that read a run (4) | `status`, `resume`, `cancel`, `review` C19 | - | refusal is `VES_TASK_RUN_NOT_FOUND`, note 7 |
| workflow events for a probe run (8) | `COMPLETE_PROBE` and the 7 refused events C20 | - | confirmed (`probe-run-workflow.test.mjs:55-63`) |
| run kinds (3) | `feature` C20, C21, C32 · `recovery` C20, C21 · `probe` C20, C21, C26, C32 | - | confirmed |
| one-way doors (5) | door 1 C20, C21, C22, C31 · door 2 C23, C25 · door 3 C24, C5 · door 4 C13 · door 5 C27, C28 | - | door 1's literal matches `runtime-migrations.ts` `PROBE_RUN_KIND` and `tableRebuild: true` |
| entities (5) | `ProbeRun` C4, C21 · `ProbeApproval` C3, C23 · `DatabaseReadGrant` C3, C5, C24 · `DatabaseRegistration` C8, C23 · `ExtensionApproval` C12, C24 | - | confirmed |
| pinned command lists, L-019 (4) | release manifest C27 · `cli-surface` C27 · `--help` snapshot C28 · `SEALED_COMMANDS` C28 | - | all four change in the diff; test:e2e and test:build ran (Gate) |
| startup config: CLI dispatch (2 assemblies) | `main.ts` routing C3, C30 · release command manifest C27 | - | read directly: `apps/vestra-cli/src/main.ts:144` `await import("./probe/probe-command.ts")`, `:165` `if (command.name.startsWith("probe ")) return executeProbe(command)`; `release-manifest.ts:303-317` adds `probe run`. C3 does not pass through `main.ts`: its runner wires its own command bus (`probe-run-command.test.mjs:181-211`). `main.ts` routing is reached by C30 through the launcher, and by the non-proof test at `:775` |
| platforms (2) | POSIX C3, C30 (WSL, this run) · win32 C15 (this checkout, this run) | - | both run by the verifier; win32 also runs the XP-04 branch of every worker case (note 4); darwin not claimed before merge |

## Swept

Only one row's landing says **existing**: concurrency. "The runtime store applies each transition
with compare-and-set on the run's version (`applyWorkflow`, `task-workflow.ts`)." The constraint
is there:
- `apps/vestra-cli/src/task/task-workflow.ts:30` sets `expectedVersion: snapshot.version`;
- `packages/platform-node/src/runtime-store/runtime-store.ts:612` updates with
  `WHERE run_id=? AND state_version=? AND state=?`;
- `:627` throws `VES_RUNTIME_VERSION_CONFLICT` when no row changed.

The probe command moves its run only through `applyWorkflow` (`apps/vestra-cli/src/probe/probe-run.ts:264`,
`:275`, `:300`, `:324`). The row's second half, the supervisor's per-process concurrency limit,
is an out-of-scope statement in the plan, not a code constraint of this change.

The other rows cite checks verified above: validation, failure modes, authorization, data
lifecycle, dependency failure and state transitions. Idempotency and observability are `n/a`.

## Gate

Windows (this checkout, Node 24.14.0, `b22b8068`):

- the batched proof invocation over the 11 proof files other than the sealed closure (33 patterns): 35 tests, 35 passed, 0 failed, 0 skipped, 0 cancelled (exit 0)
- `node --test --test-reporter=spec --test-name-pattern "honest observations of the staged closure" tests/build/sealed-launcher-closure.test.mjs`, with the process-scoped `.claude/` exclude: 1 test, 1 passed, 0 failed (exit 0)
- `corepack pnpm gate:quick`: PASS (exit 0). format:check, lint, complexity:check ("115 baselined hotspot keys, nothing above 10 unaccounted") and typecheck passed. test:unit: 3664 passed, 0 failed (includes `tests/unit/probe-supervisor-leak.test.mjs`). test:agent-readiness: 428 passed, 0 failed. test:census: 14 passed, 0 failed
- `corepack pnpm test:architecture`: 149 passed, 0 failed (exit 0)

Linux (WSL clone `~/verchestra-569`, detached at `b22b8068`, Node 24.14.0, `pnpm install --frozen-lockfile --offline`; left clean and detached at that sha):

- the same batched proof invocation over all 12 proof files (34 patterns): 36 tests, 36 passed, 0 failed, 0 skipped, 0 cancelled (exit 0)
- `corepack pnpm gate:quick`: PASS (exit 0). format:check, lint, complexity:check and typecheck passed. test:unit: 3664 passed, 0 failed. test:agent-readiness: 428 passed, 0 failed. test:census: 14 passed, 0 failed
- `corepack pnpm test:contract`: 1028 passed, 0 failed (exit 0)
- `corepack pnpm test:architecture`: 149 passed, 0 failed (exit 0)
- `corepack pnpm test:e2e`: 363 passed, 0 failed (exit 0). Includes C30 and both C28 `--help` tests
- `corepack pnpm test:build`: 186 passed, 0 failed (exit 0). Includes the C28 sealed health-report test and "the sealed launcher is the real CLI for every other argument vector"
- `corepack pnpm test:integration`: 1285 passed, 0 failed (exit 0). Includes C21, C22 and C31

`test:integration` was not run on Windows: it has known symlink failures without Developer Mode.
`test:qualification` and the load proofs were not run, as briefed.
