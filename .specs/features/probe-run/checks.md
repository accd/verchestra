# Probe run, slice 2b checks

Profile: light
Plan: `.specs/features/probe-run/plan.md`

30 checks in 1 slice · 5 one-way doors · 0 open, of which 0 block

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
| run kinds (3) | `feature` C20, C21 · `recovery` C20, C21 · `probe` C20, C21, C26 | - |
| one-way doors (5) | door 1 C20, C21, C22 · door 2 C23, C25 · door 3 C24, C5 · door 4 C13 · door 5 C27, C28 | - |
| entities (5) | `ProbeRun` C4, C21 · `ProbeApproval` C3, C23 · `DatabaseReadGrant` C3, C5, C24 · `DatabaseRegistration` C8, C23 · `ExtensionApproval` C12, C24 | - |
| pinned command lists (L-019) (4) | release manifest C27 · `cli-surface` C27 · `--help` snapshot C28 · `SEALED_COMMANDS` C28 | - |
| startup config: the CLI command dispatch (2 assemblies) | `main.ts` routing C3, C30 · release command manifest C27 | - |
| platforms (2) | POSIX (Linux CI, WSL) C3, C30 · win32 C15 | - |

- Claims naming an exit code or envelope field (C3, C6-C15, C19, C30): each proof runs the command, in process through `executeProbeCommand` or `main()`, or through the launcher for C30, and reads its exit code and envelope.
- C16, C20-C26 are proven at their own layer. The command cases pass through that code again but are not its proof.
- macOS: the nightly platform matrix runs `test:contract` there after merge. No darwin run is claimed before merge.

## Swept

- validation: C8-C13, C15
- failure modes: C6 (after the grant: run `FAILED`, grant revoked), C7 (at the confirmation: run `ABORTED`), C8-C15 (before any run: nothing created)
- idempotency: n/a - each `probe run` is a new run with a new request id; a repeated statement is a second governed run (plan, Out of scope)
- authorization: C7 (the typed-back digest, AD-040), C3 and C24 (the broker's approval-bound grant under the probe policy view), C16 (the supervisor binds the plan to the admitted grant), C25 (a probe approval satisfies no task check)
- concurrency: existing - the runtime store applies each transition with compare-and-set on the run's version (`applyWorkflow`, `task-workflow.ts`); the supervisor's concurrency limit holds within one process (plan, Out of scope)
- data lifecycle: C5 (the grant is revoked when its run ends), C3 (it expires 10 minutes after issue); result rows are dropped (plan, Out of scope)
- dependency failure: C14 (credential store without the passphrase), C6 (worker failure), C15 (platform)
- state transitions: C1 (`AWAITING_EXECUTION_APPROVAL`), C4 (-> `COMPLETED`), C6 (-> `FAILED`), C7 (-> `ABORTED`), C20 (the probe run's allowed events)
- observability: n/a - the command envelope and the authority store's run, approval and grant records are the record; this slice adds no logging requirement

## Handoff

- S1 = ~190k: about 554 KB of files it modifies or mirrors, plus about 200 KB of new sources, tests and the worker fixture, divided by four. The files it modifies or mirrors:
  - the runtime store and its migrations, the workflow machine, the run capsule and the authority module;
  - the probe host's supervisor, admission, framed protocol and spawned transport;
  - data-probe's index and SQLite adapter;
  - the task, extension and database families;
  - the guards and the pinned lists.

  This is over the 150k budget. The proposed cut is where the surface changes:
  - **A**, the foundations, ~75k: C16, C20-C22, C26 (migration 013, the run kind's unions, `COMPLETE_PROBE`, the approval action, the supervisor's `grantRef` check, the run capsule).
  - **B**, the command, ~115k: C1-C15, C17-C19, C23-C25, C27-C30 (the probe family, its authority glue and policy view, the worker fixture, the guards and the pinned lists). B starts only after A is green.
- Mechanism: handoff in two batches, A then B (owner, 2026-10-29)
