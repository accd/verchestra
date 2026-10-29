# Probe run, slice 2b checks

Profile: light
Plan: `.specs/features/probe-run/plan.md`

32 checks in 1 slice · 5 one-way doors · 0 open, of which 0 block

The proofs name tests this slice writes or extends:
- `D` is `tests/contract/probe-run-command.test.mjs`. It runs `executeProbeCommand` and `main()` in process, against a Workspace the real `vestra init` set up, with the fake keychain, so SonarCloud's coverage counts it (lesson of #682). Its worker cases spawn a real worker, so they run on Linux and macOS. On Windows each asserts the platform refusal instead of skipping (repository rule XP-04).
- `M` is `tests/integration/runtime-probe-run-migration.test.mjs`.
- `W` is `tests/unit/probe-run-workflow.test.mjs`.
- `A` is `tests/unit/probe-run-authority.test.mjs`.
- `S` is `tests/unit/probe-supervisor-grant.test.mjs`.
- `G` is `tests/architecture/probe-command-composition.test.mjs`.
- `E` is `tests/e2e/probe-cli-e2e.test.mjs`.

Every proof runs as `node --test --test-name-pattern "<name>" <file>`.

The fixture is a SQLite file with a table `main.orders` of 3 rows, registered as `orders` (engine `sqlite`, purpose `diagnostics`, `allowedObjects` [`main.orders`], `maxRows` 100). The worker is a SQLite worker fixture over data-probe's real `SqliteReadConnection`, approved with the file's path as its argument. The request is `SELECT id, status FROM orders WHERE id = ?` with one parameter. A case names only what it changes.

## Checks

### S1 - an owner runs one governed read-only probe · ~40 files · ~750 KB · ~190k

**C1** - Before the binding digest is read, the output carries a review naming `databaseId` `orders`, engine `sqlite`, the logical environment, classification, production flag, purpose `diagnostics`, the statement fingerprint, the object `main.orders`, the four bounds, the worker's extension id and launch digest, and the binding digest; and the runtime store then holds one run of kind `probe` in `AWAITING_EXECUTION_APPROVAL` (AC 1)
Proof: `node --test --test-name-pattern "the review names the run's binding before the digest is typed" tests/contract/probe-run-command.test.mjs`

**C2** - The parameter value `PARAM-7f3a-SENTINEL` appears in none of stdout, stderr or the JSON envelope, on a completed run and on a refused one (AC 2)
Proof: `node --test --test-name-pattern "the request's parameters never reach the output" tests/contract/probe-run-command.test.mjs`

**C3** - With the digest typed back, `probe run` exits 0 and prints `runId`, `approvalId`, `grantId` and `result`. The `result` has `status` `complete`, `rowCount` 1, `databaseId` `orders`, and `grantRef` equal to `grantId`. The authority store holds an approval with action `probe-execution` bound to `runId`, and a grant with capability `database-read` under `runId` whose `expiresAt` is 600,000 ms after its `issuedAt` (AC 3)
Proof: `node --test --test-name-pattern "a confirmed probe run records its approval and grant and prints the envelope" tests/contract/probe-run-command.test.mjs`

**C4** - After the completed run of C3, the run's state is `COMPLETED` and its kind `probe` (AC 4)
Proof: `node --test --test-name-pattern "a completed probe run ends COMPLETED" tests/contract/probe-run-command.test.mjs`

**C5** - The grant carries a revocation once the run ends, both after a completed run and after a run the worker refused (C6) (AC 5)
Proof: `node --test --test-name-pattern "the grant is revoked when the run ends" tests/contract/probe-run-command.test.mjs`

**C6** - A worker approved with `PROBE_FIXTURE_MODE=leak` echoes the protected parameters. `probe run` exits 5 with `VES_PROBE_SECRET_LEAK` and the run ends `FAILED` (AC 6)
Proof: `node --test --test-name-pattern "a refusal after the grant fails the run" tests/contract/probe-run-command.test.mjs`

**C7** - A mistyped digest, and a run with no terminal and no `--confirm-stdin`, each exit 5 with `VES_TASK_CONFIRMATION_REQUIRED`. Each leaves no approval and no grant in the authority store, spawns no process other than Git, and leaves the run `ABORTED` (AC 7)
Proof: `node --test --test-name-pattern "a run whose digest is not typed back is aborted" tests/contract/probe-run-command.test.mjs`

**C8** - An unregistered `--database` exits 5 with `VES_DATABASE_NOT_FOUND`, and a registration whose `maxRows` was edited after signing exits 5 with `VES_DATABASE_REGISTRATION_INVALID`. Neither creates a run (AC 8)
Proof: `node --test --test-name-pattern "a probe of an absent or invalid registration creates no run" tests/contract/probe-run-command.test.mjs`

**C9** - A valid `postgresql` registration exits 5 with `VES_PROBE_ENGINE_UNAVAILABLE` and creates no run (AC 9)
Proof: `node --test --test-name-pattern "a probe of an engine other than SQLite creates no run" tests/contract/probe-run-command.test.mjs`

**C10** - Each exits 5 and creates no run, table-driven over 3 statements:
- `DELETE FROM orders` -> `VES_SQLITE_WRITE_DENIED`
- `SELECT 1; SELECT 2` -> `VES_SQLITE_BATCH_DENIED`
- `PRAGMA user_version` -> `VES_SQLITE_PRAGMA_DENIED`

(AC 10)
Proof: `node --test --test-name-pattern "SQL the SQLite parser refuses creates no run" tests/contract/probe-run-command.test.mjs`

**C11** - Each exits 5 and creates no run, table-driven over 3 cases:
- purpose `export` -> `VES_PROBE_PURPOSE_DENIED`
- a statement reading `main.customers` -> `VES_PROBE_OBJECT_DENIED`
- `rowLimit` 101 -> `VES_PROBE_BOUNDS_DENIED`

(AC 11)
Proof: `node --test --test-name-pattern "a request outside the registration or its policy creates no run" tests/contract/probe-run-command.test.mjs`

**C12** - Each of 5 states exits 5 and creates no run: an approval reference with no approval, a revoked approval, an expired approval, an entry edited after approval, and an executable changed after approval. Each case's code equals the code of the first failing row `vestra extension check` reports for the same Workspace; the entry case is `VES_PROBE_HOST_ENTRY_DIGEST` and the executable case `VES_PROBE_HOST_LAUNCH_DIGEST` (AC 12)
Proof: `node --test --test-name-pattern "a worker approval that does not hold creates no run" tests/contract/probe-run-command.test.mjs`

**C13** - Each exits 2 with `VES_CLI_ARGUMENT_INVALID` naming `--request` and creates no run, table-driven over 7 cases: no `--request`, a missing file, 65,537 bytes, text that is not JSON, an extra key, no `bounds`, and `schemaVersion` 2. A valid request padded to 65,536 bytes passes the reader (AC 13, door 4)
Proof: `node --test --test-name-pattern "a request file that is not a request creates no run" tests/contract/probe-run-command.test.mjs`

**C14** - With no signing passphrase bound, a valid run exits 5 with `VES_TASK_NOT_CONFIGURED` and `requirement` `evidence-signing-passphrase`, and creates no run (AC 14)
Proof: `node --test --test-name-pattern "a probe run without the signing passphrase creates no run" tests/contract/probe-run-command.test.mjs`

**C15** - With platform `win32`, a run naming a request file that does not exist exits 5 with `VES_PROBE_HOST_PLATFORM_UNSUPPORTED`, not 2. It reads no credential and creates no run. This case injects the platform, so it runs on every OS (AC 15)
Proof: `node --test --test-name-pattern "Windows refuses a probe run before reading anything" tests/contract/probe-run-command.test.mjs`

**C16** - A supervisor admitted with grant `grant-a` refuses a plan whose `grantRef` is `grant-b` with `VES_PROBE_WORKSPACE_TRUST_GRANT`, and starts no worker. A plan whose `grantRef` is `grant-a` proceeds (AC 16)
Proof: `node --test --test-name-pattern "the supervisor refuses a plan whose grant is not the admitted one" tests/unit/probe-supervisor-grant.test.mjs`

**C17** - During a completed run:
- the credential store is asked for exactly one name, `evidence-signing-passphrase`;
- a worker approved with `PROBE_FIXTURE_MODE=report-environment` reports an environment whose keys are exactly its approved launch environment's.

(AC 17)
Proof: `node --test --test-name-pattern "the worker gets only its approved launch environment" tests/contract/probe-run-command.test.mjs`

**C18** - No module under `apps/vestra-cli/src/probe/` imports `SecretBroker`, `withSecret` or an OS credential backend, or reads `logicalCredentialName` into anything but the plan (AC 17)
Proof: `node --test --test-name-pattern "the probe family reads no credential but the signing passphrase" tests/architecture/probe-command-composition.test.mjs`

**C19** - `vestra task status`, `task resume`, `task cancel` and `task review` each refuse with exit 5 when given the completed probe run's id, and the run's state and version stay unchanged (AC 18)
Proof: `node --test --test-name-pattern "task commands refuse a probe run" tests/contract/probe-run-command.test.mjs`

**C20** - Table-driven:
- `COMPLETE_PROBE` is accepted for a `probe` run in `EXECUTION_AUTHORIZED`;
- it is refused for a `feature` and a `recovery` run in `EXECUTION_AUTHORIZED`, and for a `probe` run in `AWAITING_EXECUTION_APPROVAL`;
- each of `START_IMPLEMENTATION`, `START_VERIFICATION`, `REQUEST_REPAIR`, `PASS_VERIFICATION`, `APPROVE_HUMAN_REVIEW`, `PREPARE_HANDOFF` and `COMPLETE_RECOVERY` is refused for a `probe` run.

(AC 19, door 1)
Proof: `node --test --test-name-pattern "the workflow completes a probe run only through COMPLETE_PROBE" tests/unit/probe-run-workflow.test.mjs`

**C21** - Migration `013_probe_runs` runs on a store at `012` that holds a feature run with an approval, a grant and state events, and a recovery run. Afterwards:
- every row of every table is equal to before;
- `PRAGMA foreign_key_check` returns no row;
- inserting a run of kind `probe` succeeds;
- inserting kind `other` is refused by the CHECK.

(AC 20, door 1)
Proof: `node --test --test-name-pattern "migration 013 keeps every row and admits the probe kind" tests/integration/runtime-probe-run-migration.test.mjs`

**C22** - `DEFAULT_RUNTIME_MIGRATIONS` has 13 entries, the last `013_probe_runs`, and a store opened with the first 12 refuses a store migrated by 13 with `VES_RUNTIME_MIGRATION_INCOMPATIBLE` (door 1)
Proof: `node --test --test-name-pattern "migration 013 is the last migration and older binaries refuse it" tests/integration/runtime-probe-run-migration.test.mjs`

**C31** - A migration the runner marks a table rebuild runs with foreign keys off. If it leaves a row whose reference has no parent, the runner rolls it back and refuses with `VES_RUNTIME_MIGRATION_FOREIGN_KEY`, the store's tables and migration ledger are unchanged, and `PRAGMA foreign_keys` reads 1 afterwards. After a rebuild that succeeds, `PRAGMA foreign_keys` also reads 1 and a dangling insert is refused (door 1, amended 2026-10-29)
Proof: `node --test --test-name-pattern "a rebuild migration runs with foreign keys off and commits only without violations" tests/integration/runtime-probe-run-migration.test.mjs`

**C23** - The probe approval request's binding has:
- action `probe-execution`;
- `packageDigest` equal to the statement fingerprint, and `sourceStateDigest` equal to the registration digest;
- `policyDigest` equal to the probe policy view's digest, and the three context digests equal to the digest of the canonical `{}`;
- the review lists exactly as door 2 writes them: `capabilities` [`database-read`], `scope` [`database:orders`], `dataAccess` [`main.orders`], and [`not-applicable`] for each list door 2 gives no value.

(door 2)
Proof: `node --test --test-name-pattern "the probe approval binds the run as door 2 writes it" tests/unit/probe-run-authority.test.mjs`

**C24** - The grant request has principal `Vestra::Actor`, action `Vestra::Action::"database-read"`, resource `Vestra::Database::"orders"` and capability `database-read`, with constraints exactly `databaseId`, `registrationDigest`, `statementFingerprint`, `extensionId` and `launchDigest`. The probe policy view's only policy is the door's `permit`. The mapped `WorkspaceProbeWorkerGrant` has:
- `grantRef` equal to the grant id;
- `approvalRef` equal to the extension approval reference;
- `isolationProfile` `process-contained` and `risk` `approved-workspace-executable`.

(door 3)
Proof: `node --test --test-name-pattern "the probe grant and its admission grant are shaped as door 3 writes them" tests/unit/probe-run-authority.test.mjs`

**C25** - An approval verifier that expects action `execution` refuses a `probe-execution` approval for the same run, and a task grant request cannot use a probe approval (door 2)
Proof: `node --test --test-name-pattern "a probe approval satisfies no task check" tests/unit/probe-run-authority.test.mjs`

**C26** - The run capsule validator accepts a capsule of run kind `probe` and still refuses an unknown kind (Impact, evidence)
Proof: `node --test --test-name-pattern "the run capsule accepts a probe run" tests/unit/probe-run-workflow.test.mjs`

**C32** - A probe run needs no terminal capsule. The workflow's decision for `COMPLETE_PROBE`, `FAIL` and `ABORT` of a `probe` run carries `terminalCapsuleRequired` false, while `FAIL` of a `feature` run still carries true. An ended probe run is not listed by the runtime store's unsealed terminal runs (Impact, evidence; added after batch A, which left every terminal transition requiring one)
Proof: `node --test --test-name-pattern "a probe run needs no terminal capsule" tests/unit/probe-run-workflow.test.mjs`

**C27** - The release command manifest declares `probe run` with exactly `database`, `approval-ref`, `request`, `confirm-stdin` and `keychain`, `mutating` true and `supportsJson` true (door 5, Surface)
Proof: `node --test --test-name-pattern "the probe slice takes the options its Surface names" tests/contract/cli-surface.test.mjs`

**C28** - The pinned `--help` snapshot lists `probe run` with its summary, and `SEALED_COMMANDS` and the sealed launcher's health report list it (lesson L-019)
Proof: `node --test --test-name-pattern "emits the exact canonical release output for --help" tests/e2e/cli-launchers-e2e.test.mjs`
Proof: `node --test --test-name-pattern "honest observations of the staged closure" tests/build/sealed-launcher-closure.test.mjs`

**C29** - Slice 1's guard admits `FramedProbeWorker`, `ProbeWorkerSupervisor` and `SpawnedProbeWorker` only from the probe family's run module, and still flags them anywhere else. Slice 2a's guard admits the probe family to data-probe and still flags any other family (Impact, package boundary)
Proof: `node --test --test-name-pattern "only the extension commands reach admission|the walk flags spawning imports and other modules" tests/architecture/extension-host-composition.test.mjs`
Proof: `node --test --test-name-pattern "only the database family loads data-probe" tests/architecture/database-command-composition.test.mjs`

**C30** - Through the real launcher on Linux, in a disposable Workspace, the plan's independent test passes:
- `database add`, `extension add` and `extension approve` set up the worker;
- `probe run` with the digest typed back exits 0 with `rowCount` 1, the run is `COMPLETED`, and its grant is revoked;
- `task status` refuses the run;
- a second run with a mistyped digest exits 5 and leaves that run `ABORTED` with no grant.

(the plan's independent test)
Proof: `node --test --test-name-pattern "the plan's independent test" tests/e2e/probe-cli-e2e.test.mjs`

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| `vestra probe run` statuses (3) | exit 0 C3, C30 · exit 2 C13 · exit 5 C6-C12, C14, C15 | - |
| run endings (3) | `COMPLETED` C4 · `FAILED` C6 · `ABORTED` C7 | - |
| refusals before any run (8 kinds) | registration C8 · engine C9 · SQL C10 · policy C11 · worker approval C12 · request file C13 · passphrase C14 · platform C15 | - |
| SQLite parser refusals (3) | write C10 · batch C10 · PRAGMA C10, table-driven | - |
| planner refusals (3) | purpose C11 · object C11 · bounds C11, table-driven | - |
| worker approval states (5) | absent C12 · revoked C12 · expired C12 · entry edited C12 · executable changed C12, table-driven | - |
| request-file refusals (7) | no flag C13 · missing C13 · over 64 KiB C13 · not JSON C13 · extra key C13 · no `bounds` C13 · `schemaVersion` 2 C13 | - |
| task commands that read a run (4) | `status` C19 · `resume` C19 · `cancel` C19 · `review` C19 | - |
| workflow events for a probe run (8) | `COMPLETE_PROBE` C20 · `START_IMPLEMENTATION` C20 · `START_VERIFICATION` C20 · `REQUEST_REPAIR` C20 · `PASS_VERIFICATION` C20 · `APPROVE_HUMAN_REVIEW` C20 · `PREPARE_HANDOFF` C20 · `COMPLETE_RECOVERY` C20 | - |
| run kinds (3) | `feature` C20, C21, C32 · `recovery` C20, C21 · `probe` C20, C21, C26, C32 | - |
| one-way doors (5) | door 1 C20, C21, C22, C31 · door 2 C23, C25 · door 3 C24, C5 · door 4 C13 · door 5 C27, C28 | - |
| entities (5) | `ProbeRun` C4, C21 · `ProbeApproval` C3, C23 · `DatabaseReadGrant` C3, C5, C24 · `DatabaseRegistration` C8, C23 · `ExtensionApproval` C12, C24 | - |
| pinned command lists (L-019) (4) | release manifest C27 · `cli-surface` C27 · `--help` snapshot C28 · `SEALED_COMMANDS` C28 | - |
| startup config: the CLI command dispatch (2 assemblies) | `main.ts` routing C3, C30 · release command manifest C27 | - |
| platforms (2) | POSIX (Linux CI, WSL) C3, C30 · win32 C15 | - |

- Claims naming an exit code or envelope field (C3, C6-C15, C19, C30): each proof runs the command, in process through `executeProbeCommand` or `main()`, or through the launcher for C30, and reads its exit code and envelope.
- C16, C20-C26, C31 and C32 are proven at their own layer. The command cases pass through that code again but are not its proof.
- macOS: the nightly platform matrix runs `test:contract` there after merge. No darwin run is claimed before merge.

## Swept

- validation: C8-C13, C15
- failure modes: C6 (after the grant: run `FAILED`, grant revoked), C7 (at the confirmation: run `ABORTED`), C8-C15 (before any run: nothing created)
- idempotency: n/a - each `probe run` is a new run with a new request id; a repeated statement is a second governed run (plan, Out of scope)
- authorization: C7 (the typed-back digest, AD-040), C3 and C24 (the broker's approval-bound grant under the probe policy view), C16 (the supervisor binds the plan to the admitted grant), C25 (a probe approval satisfies no task check)
- concurrency: existing - the runtime store applies each transition with compare-and-set on the run's version (`applyWorkflow`, `task-workflow.ts`); the supervisor's concurrency limit holds within one process (plan, Out of scope)
- data lifecycle: C5 (the grant is revoked when its run ends), C3 (it expires 10 minutes after issue); result rows are dropped (plan, Out of scope)
- dependency failure: C31 (a rebuild that would break a reference is rolled back), C14 (credential store without the passphrase), C6 (worker failure), C15 (platform)
- state transitions: C32 (an ended probe run needs no capsule), C1 (`AWAITING_EXECUTION_APPROVAL`), C4 (-> `COMPLETED`), C6 (-> `FAILED`), C7 (-> `ABORTED`), C20 (the probe run's allowed events)
- observability: n/a - the command envelope and the authority store's run, approval and grant records are the record; this slice adds no logging requirement

## Handoff

- S1 = ~190k: about 554 KB of files it modifies or mirrors, plus about 200 KB of new sources, tests and the worker fixture, divided by four. The files it modifies or mirrors:
  - the runtime store and its migrations, the workflow machine, the run capsule and the authority module;
  - the probe host's supervisor, admission, framed protocol and spawned transport;
  - data-probe's index and SQLite adapter;
  - the task, extension and database families;
  - the guards and the pinned lists.

  This is over the 150k budget. The proposed cut is where the surface changes:
  - **A**, the foundations, ~75k: C16, C20-C22, C26, C31 (migration 013 and the runner's rebuild flag, the run kind's unions, `COMPLETE_PROBE`, the approval action, the supervisor's `grantRef` check, the run capsule).
  - **B**, the command, ~115k: C1-C15, C17-C19, C23-C25, C27-C30, C32 (the probe family, its authority glue and policy view, the worker fixture, the guards and the pinned lists). B starts only after A is green.
- Mechanism: handoff in two batches, A then B (owner, 2026-10-29)
- **Boundary:** batch A (C16, C20-C22, C26, C31) closed at 053c7c07
- **Settled mid-build:**
  - A probe run takes only `REQUEST_EXECUTION_APPROVAL`, `GRANT_EXECUTION_APPROVAL`, `COMPLETE_PROBE`, `FAIL`, `ABORT` and `INTERRUPT`, an allow-list in `runKindGuard` (`workflow-machine.ts`). Any other event, `INVALIDATE_EXECUTION_APPROVAL` included, is refused with `VES_WORKFLOW_RUN_KIND_MISMATCH`, and so is `COMPLETE_PROBE` for a feature or recovery run. `COMPLETE_PROBE` names actor `controller` and evidence `probe-result`.
  - The probe edge lives in the one `WORKFLOW_DEFINITION`. The `human-review-bypass` rule admits exactly the two edges into `COMPLETED`. `tests/unit/workflow-machine.test.mjs` moved its pins with the code: the command list gains `COMPLETE_PROBE`; the edges into `COMPLETED` are two, renamed "...but a probe run's COMPLETE_PROBE", and the test now also asserts the refusal for feature and recovery runs; the per-edge cases run the probe edge as a probe run; the evidence list gains `probe-result`. No feature or recovery assertion was removed or relaxed.
  - The rebuild flag is `RuntimeMigration.tableRebuild`. The runner is `applyRuntimeMigration` in `packages/platform-node/src/runtime-store/runtime-migration-runner.ts`, exported from the module, not the package index. C31 also calls it on a connection the test holds, the only place `PRAGMA foreign_keys` can be read after a refused open. A checksum stays the digest of `up`; the twelve checksums of 001-012 were verified identical to 55e2b7ea. `013_probe_runs` copies every row with its rowid.
  - `VES_RUNTIME_MIGRATION_FOREIGN_KEY` is registered in `RUNTIME_PUBLIC_ERROR_DEFINITIONS` (catalog pin 19 -> 20). The canonical JSON census classifies the runner as `raw-byte-digest`.
  - `runtime-checkpoint-store.test.mjs` pins `012_execution_checkpoints` at index 11, the "twelfth" of its title, rather than as the last entry.
  - `VES_PROBE_WORKSPACE_TRUST_GRANT` joins the `VES_PROBE_WORKSPACE_TRUST_*` codes, which have no public registry or document; each is a `ProbeProtocolError`. The check runs in the supervisor's constructor. The spawned-worker fixture's controller grant now names the fixture plan's `grantRef`.
  - `handoff/normalize.ts` and `verification/verification.ts` keep their `feature`/`recovery` literal: they read inputs of flows a probe run never enters, so they refuse a probe run at the input, as C20 refuses its events. The capsule's `COMPLETED` rule (verification and Human Review, from `HUMAN_REVIEW`) is unchanged: a `FAILED` or `ABORTED` probe capsule is valid, a `COMPLETED` one is not, which matches "a probe run needs no terminal capsule".
  - For batch B: every terminal transition still sets `terminalCapsuleRequired`, so an ended probe run is listed by `listUnsealedTerminalRuns`. Nothing in the product consumes that list (`RunCapsuleRecoveryCoordinator` is wired only in tests). `SpawnedProbeWorker.launch` spawns at once, before the supervisor that checks the grant can be built, so the command should plan with `grantRef` = the grant id and admit with the same grant.
- **Abandoned:** a separate probe workflow definition. It would have left `workflow-machine.test.mjs` unchanged except its command list, but it would put the probe edge into `COMPLETED` outside `validateWorkflowDefinition`'s `human-review-bypass` rule.
- **Boundary:** batch B (C1-C15, C17-C19, C23-C25, C27-C30, C32) closed at a5c5310e
- **Settled mid-build:**
  - The fixture statement as this file writes it, `SELECT id, status FROM orders WHERE id = ?`, is refused by SQLite's parser with `VES_SQLITE_OBJECT_INVALID` (objects must be `main`-qualified, `sqlite-adapter.ts` `sqliteObject`). The proofs run `SELECT id, status FROM main.orders WHERE id = ?` (`tests/helpers/probe-run-fixture.mjs`); no claim was edited. Needs the owner's acceptance.
  - C6 could not pass as built: the supervisor refused a leak only when a row held the protected bytes as they are, and a probe's protected request is JSON, so the reference worker's `leak` echo (a string value, its quotes escaped) completed. The supervisor now also refuses the JSON-escaped form (3c760f44, `tests/unit/probe-supervisor-leak.test.mjs`); a plain secret is refused as before. A change to `packages/extension-host` beyond the plan's Impact row; needs the owner's acceptance.
  - C7's "spawns no process other than Git" cannot hold literally on Linux and macOS: the signing passphrase is read before the run exists (AC 14 and the plan's assumption), and the OS credential store's read runs its tool (`secret-tool`/`dbus-send`, `security`). The proof admits exactly Git and that tool over the whole command, and asserts that nothing at all starts once the review is shown. Needs the owner's acceptance.
  - Order before any run: platform, request file, registration (evaluated once: absent, invalid, engine), statement (SQLite's parser), plan under a placeholder `grantRef` (`pending-grant`), worker (`inspectExtension`, the rows `vestra extension check` reports; the first failing row's code is the refusal), passphrase. Planning before the worker lets C8-C11 need no approved worker.
  - The request file has no parameter classification (door 4), so each parameter is classified as the registration is; the kind is always `select` (catalog introspection is out).
  - The SQLite engine adapter (`probe-statement.ts`) admits only the operation SQLite's parser reads from the statement, every object in `main`. Consequence: a statement with two binds of one class is refused at plan time with `VES_PROBE_ENGINE_POLICY_DENIED`, because the planner keeps each classification once and data-probe's `SqliteProbeAdapter.execute` re-reads the statement with the plan's classifications, so it would fail in the worker after the grant. A data-probe limitation for a later change.
  - The planner reads the registration through slice 2a's `WorkspaceDatabaseRegistrationStore` (its door 2); the plan the worker runs must equal the approved plan but for `grantRef` and `planDigest`, or the run fails with the new `VES_PROBE_PLAN_CHANGED`.
  - The approval request expires 10 minutes after the review is shown, as the grant does after issue; the grant is issued under a `FixedClock`, so `expiresAt - issuedAt` is 600,000 ms exactly.
  - A refusal at the confirmation aborts the run; any refusal after it (the approval record, the grant, the plan guard, admission, launch, supervisor) fails it, and a grant once issued is revoked in `finally`.
  - Errors: the probe family's registry (component `probe`) holds the parser, planner, supervisor, protocol and host codes; a code the database or extension family owns keeps that family's envelope (`VES_DATABASE_NOT_FOUND`, `VES_DATABASE_REGISTRATION_INVALID`, `VES_PROBE_HOST_PLATFORM_UNSUPPORTED`, `VES_PROBE_HOST_ENTRY_DIGEST`, ...), a `VES_SKILL_*` code becomes `VES_EXTENSION_LOCK_REFUSED`, and anything else `VES_PROBE_FAILED` with its reason.
  - The SQLite worker fixture (`tests/fixtures/probe-workers/sqlite-worker.mjs`) takes the database path from its approved argument `--title=<path>`: node reads every argument before its script as an option of its own, and `--title` only names the process; the worker reads it back from `process.execArgv`. A Workspace's entry is a one-line module that imports the fixture by URL.
  - C17 observes the reference worker's report row by wrapping `MemoryProbeResultSink.prototype.append` in the test, since the command keeps no row; the keys compared are the host's base launch environment plus the approved extras, less the two runtime-added names the security suite already excludes.
  - On Windows, C1-C12, C14, C17 and C19 assert the platform refusal: a POSIX platform injected on Windows resolves another state root, so a verified registration or an approved worker cannot be read there. C13 (under an injected POSIX platform) and C15 run everywhere.
  - The task commands already refuse a run without a plan record (`VES_TASK_RUN_NOT_FOUND`, before the runtime store is opened); C19 needed no new refusal.
  - Guards: slice 1's admits three edges, extension check -> admission, probe run -> admission, probe run -> the host index for the supervisor, the framed worker and the in-memory broker and sink, plus `SpawnedProbeWorker` from platform-node in the probe run module only; slice 2a's admits the probe family to data-probe for `DatabaseRegistry`, `ProbePlanner`, `SqliteProbeError` and `parseSqliteReadOperation` only, and its proof title gained ", and the probe family plans with it".
  - C32 (b58e145d): the terminal decisions of a probe run require no capsule and emit no `TERMINAL_CAPSULE_REQUESTED`, so `listUnsealedTerminalRuns` no longer lists an ended probe run; feature and recovery runs are unchanged.
  - Shared, not copied (bc4cff94): `cli-options.ts`, `inspectExtension`, `approvalSealing`/`approvalVerification`/`policyAuthorization`, `unlockedSigner`, `cedarEngine`, `registrationOptions`.
- **Abandoned:**
  - A one-registration memory store seeded with the evaluated registration (one read per run), for slice 2a's door 2 store plus the approved-plan guard.
  - Passing the database path to the worker in its approved environment instead of an argument.
