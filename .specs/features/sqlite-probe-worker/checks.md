# SQLite probe worker checks

Profile: light
Plan: `.specs/features/sqlite-probe-worker/plan.md`

Every proof runs as `node --test --test-name-pattern "<name>" <file>`.

The fixture is a disposable Workspace, a Git repository with a non-local `origin` and a `HEAD` commit, and a SQLite file whose table `main.orders` holds the rows `(1, paid)`, `(2, pending)` and `(3, shipped)`. The worker bundle is the one `scripts/build-probe-worker.mjs` writes, the script that `corepack pnpm build:probe-worker` runs. A case names only what it changes.

21 checks in 6 slices · 4 one-way doors · 0 open

## Checks

### S1 - the worker command writes the worker · ~10 files · ~150 KB · ~38k

**C1** - `vestra probe worker --engine sqlite --entry probe/sqlite-worker.mjs` in a Workspace without that file exits 0 and prints `path` `probe/sqlite-worker.mjs`, `engine` `sqlite`, `digest` and `written` `true`; the file then holds exactly the bundle's bytes, and `digest` is `sha256:` of them (AC 1, door 1)
Proof: `node --test --test-name-pattern "the worker command writes the bundled worker" tests/contract/probe-worker-command.test.mjs`

**C2** - Run again on that file, the command exits 0 with `written` `false` and the same `digest`, and the file's bytes are unchanged (AC 2)
Proof: `node --test --test-name-pattern "a worker already written is left as it is" tests/contract/probe-worker-command.test.mjs`

**C3** - With other bytes already at `--entry`, the command exits 5 with `VES_PROBE_WORKER_TARGET_CONFLICT` and the file's bytes are unchanged (AC 3)
Proof: `node --test --test-name-pattern "a worker path holding other bytes is refused" tests/contract/probe-worker-command.test.mjs`

**C4** - `--entry ../outside.mjs` (outside the Git top level), a path through a directory link (a symlink on Linux and macOS, a junction on Windows), and a path naming an existing directory each exit 5 with `VES_PROBE_WORKER_TARGET_INVALID`, and nothing is written in or outside the Workspace (AC 4)
Proof: `node --test --test-name-pattern "a worker path outside the Workspace, through a link, or at a directory is refused" tests/contract/probe-worker-command.test.mjs`

**C5** - `--engine postgresql` exits 5 with `VES_PROBE_WORKER_ENGINE_UNSUPPORTED` and writes nothing; a missing `--engine` or `--entry` exits 2 with `VES_CLI_ARGUMENT_INVALID` (AC 5)
Proof: `node --test --test-name-pattern "a worker for another engine is refused" tests/contract/probe-worker-command.test.mjs`

**C6** - In the source layout without the bundle, the command exits 5 with `VES_PROBE_WORKER_UNAVAILABLE`, its message names `corepack pnpm build:probe-worker`, and nothing is written (AC 6, door 4)
Proof: `node --test --test-name-pattern "a worker command without a built bundle names the build" tests/contract/probe-worker-command.test.mjs`

### S2 - the bundle and the release · ~6 files · ~120 KB · ~30k

**C7** - Every static and dynamic import the bundle makes names a `node:` module (AC 7, door 3)
Proof: `node --test --test-name-pattern "the worker bundle imports only node modules" tests/build/sqlite-probe-worker-bundle.test.mjs`

**C8** - Two runs of `scripts/build-probe-worker.mjs` on one revision write byte-identical bundles to `apps/vestra-cli/dist/sqlite-probe-worker.mjs` (AC 12, door 4)
Proof: `node --test --test-name-pattern "the worker bundle is reproducible" tests/build/sqlite-probe-worker-bundle.test.mjs`

**C9** - The release builder's sealed child entries map `probe:sqlite-worker` to `bin/sqlite-probe-worker.mjs`, and its descriptor is `core-code`. In a staged sealed layout, `vestra probe worker --engine sqlite --entry probe/sqlite-worker.mjs` writes bytes equal to that layout's `bin/sqlite-probe-worker.mjs` (AC 11, door 3)
Proof: `node --test --test-name-pattern "the sealed release carries the SQLite worker as core code" tests/build/reproducible-target-build.test.mjs`
Proof: `node --test --test-name-pattern "the sealed worker command writes the sealed worker" tests/build/sealed-launcher-closure.test.mjs`

### S3 - the worker process · ~5 files · ~90 KB · ~23k

**C10** - Started directly with `node` and an environment that lacks `PROBE_SQLITE_PATH`, lacks `PROBE_COMPONENT_ID`, holds an empty value for either, or holds a relative `PROBE_SQLITE_PATH`, the worker exits with status 5 in each case and writes no byte to stdout (AC 9, door 2)
Proof: `node --test --test-name-pattern "the worker exits before the handshake without its configuration" tests/integration/sqlite-probe-worker.test.mjs`

**C11** - On Linux and macOS, through `SpawnedProbeWorker`, `FramedProbeWorker` and `ProbeWorkerSupervisor`, with both variables set, a plan for `SELECT id, status FROM main.orders WHERE id = ?` with [1] completes with `status` `complete` and `rowCount` 1; the handshake's component id is `PROBE_COMPONENT_ID` and its digest is the entry's `sha256:`; and the SQLite file's bytes are unchanged. On Windows the case asserts `VES_PROBE_HOST_PLATFORM_UNSUPPORTED` (AC 8, door 2)
Proof: `node --test --test-name-pattern "the bundled worker answers a probe over a real SQLite file" tests/integration/sqlite-probe-worker.test.mjs`

**C12** - On Linux and macOS, with `PROBE_COMPONENT_ID` set to an id other than the expected component's, the supervisor refuses with `VES_PROBE_HANDSHAKE_COMPONENT` and commits no result. On Windows the case asserts `VES_PROBE_HOST_PLATFORM_UNSUPPORTED` (AC 10)
Proof: `node --test --test-name-pattern "a worker that names another component is refused at the handshake" tests/integration/sqlite-probe-worker.test.mjs`

### S4 - the journey through the real launcher · ~4 files · ~70 KB · ~18k

**C13** - On Linux and macOS, in the fixture Workspace and through the real `vestra` launcher:
- `vestra probe worker` writes the worker, which is committed and registered with `vestra extension add`;
- `vestra extension approve` approves it with `process.execPath`, `PROBE_SQLITE_PATH` naming the fixture file, and `PROBE_COMPONENT_ID` naming the extension id;
- `vestra database add` registers the file.

`vestra probe run` with `SELECT id, status FROM main.orders WHERE id = ?` and [1], digest typed back, then exits 0 with `result.status` `complete` and `result.rowCount` 1, and the run is `COMPLETED`. On Windows the case asserts `VES_PROBE_HOST_PLATFORM_UNSUPPORTED` for `probe run` (AC 8, independent test)
Proof: `node --test --test-name-pattern "the plan's independent test" tests/e2e/probe-worker-e2e.test.mjs`

**C14** - On Linux and macOS, after C13's setup, a second reference approved without `PROBE_SQLITE_PATH` makes `vestra probe run` exit 5 with an error code the probe family's registry declares; the run ends `FAILED`, and its grant carries a revocation (AC 9)
Proof: `node --test --test-name-pattern "a worker approved without its database fails the run" tests/e2e/probe-worker-e2e.test.mjs`

**C15** - On Linux and macOS, a third reference approved with `PROBE_COMPONENT_ID` other than its extension id makes `vestra probe run` exit 5 with `VES_PROBE_HANDSHAKE_COMPONENT`; the run ends `FAILED`, and its grant carries a revocation (AC 10)
Proof: `node --test --test-name-pattern "a worker that names another component fails the run" tests/e2e/probe-worker-e2e.test.mjs`

### S5 - pinned lists and guards · ~8 files · ~140 KB · ~35k

**C16** - The release command manifest declares `probe worker` with exactly the options `--engine` and `--entry` (lesson L-019)
Proof: `node --test --test-name-pattern "the probe slice takes the options its Surface names" tests/contract/cli-surface.test.mjs`

**C17** - `vestra --help` from the source launcher prints the `probe worker` line between `probe run`'s neighbours, in the exact snapshot; and the sealed launcher's `--help` names every sealed command, `probe worker` included
Proof: `node --test --test-name-pattern "vestra emits the exact canonical release output for --help" tests/e2e/cli-launchers-e2e.test.mjs`
Proof: `node --test --test-name-pattern "the sealed launcher is the real CLI for every other argument vector" tests/build/sealed-launcher-closure.test.mjs`

**C18** - The architecture guards admit the worker module's imports of the probe protocol's frame codec and of data-probe's SQLite adapter, by name, and no other new edge
Proof: `node --test --test-name-pattern "only the extension commands reach admission" tests/architecture/extension-host-composition.test.mjs`
Proof: `node --test --test-name-pattern "only the database family loads data-probe" tests/architecture/database-command-composition.test.mjs`

### S6 - the guide · ~4 files · ~30 KB · ~8k

**C19** - `docs/probe-quick-start.md` names, in this order: `vestra init`, `vestra database add`, `vestra probe worker`, `git commit`, `vestra extension add`, `vestra extension approve` (with `PROBE_SQLITE_PATH` and `PROBE_COMPONENT_ID`), `vestra extension check`, `vestra probe run`. It contains the statements that `probe run` runs on Linux and macOS only, that SQLite is the only engine, and that Verchestra delivers no database credential (AC 13)
Proof: `node --test --test-name-pattern "the probe quick start walks the journey in order" tests/contract/probe-quick-start-doc.test.mjs`

**C20** - Every `vestra` command line in the guide's `bash` blocks names a command the release command manifest declares, and only options that command or the global `--output` declares (AC 14)
Proof: `node --test --test-name-pattern "every command in the probe quick start is one the release declares" tests/contract/probe-quick-start-doc.test.mjs`

**C21** - `apps/site/src/content/docs/docs/workflows/read-only-database-discovery.md` and `apps/site/src/content/docs/docs/integrations/sqlite.md` each link `https://github.com/accd/verchestra/blob/main/docs/probe-quick-start.md` (AC 15)
Proof: `node --test --test-name-pattern "the site links the probe quick start" tests/contract/probe-quick-start-doc.test.mjs`

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| `vestra probe worker` statuses (3) | exit 0 C1, C2 · exit 2 C5 · exit 5 C3, C4, C5, C6 | - |
| `vestra probe worker` refusals (4) | `VES_PROBE_WORKER_TARGET_CONFLICT` C3 · `VES_PROBE_WORKER_TARGET_INVALID` C4 · `VES_PROBE_WORKER_ENGINE_UNSUPPORTED` C5 · `VES_PROBE_WORKER_UNAVAILABLE` C6 | - |
| target paths refused (3) | outside the top level C4 · through a link C4 · a directory C4 | - |
| worker process statuses (2) | answers the host C11, C13 · exit 5 before the handshake C10, C14 | - |
| worker configuration faults (5) | `PROBE_SQLITE_PATH` missing C10, C14 · `PROBE_COMPONENT_ID` missing C10 · either empty C10 · relative path C10 · other component id C12, C15 | - |
| one-way doors (4) | 1. worker command C1-C6 · 2. worker configuration C10-C12 · 3. release layout C7, C9 · 4. source-checkout build C6, C8 | - |
| bundle layouts (2) | source `apps/vestra-cli/dist/` C1, C6, C8 · sealed `bin/` C9 | - |
| pinned command lists, lesson L-019 (4) | release manifest C16 · `cli-surface` C16 · `--help` snapshot C17 · `SEALED_COMMANDS` C17 | - |
| platforms run before merge (2) | Linux C10-C15 · Windows C1-C6, C10 and the platform refusal in C11-C13 | - |

- C11 crosses the real spawned transport and a real SQLite file; C13-C15 cross the real launcher.
- macOS is not proven before merge: the same proofs run there only in the nightly platform matrix, after merge.
- No other check claims more than the cases its proof exercises.

## Swept

- validation: C3, C4, C5 (the target path and engine), C10 (the worker's configuration)
- failure modes: C6 (no bundle), C10, C14 (the worker exits before the handshake), C15 (a wrong component id)
- idempotency: C2 (writing the same worker again changes nothing)
- authorization: existing - slice 1's `extension add` and `approve` pin the entry digest and the launch, and slice 2b's typed-back digest and single-use grant govern every run (`.specs/features/probe-run/checks.md`); C13 crosses them
- concurrency: n/a - the command writes one file once; two concurrent writes of the same bytes leave the same file, and a conflict is refused (C3)
- data lifecycle: C11 (the database file's bytes are unchanged after a probe)
- dependency failure: C6 (the bundle is missing), C14 (the worker cannot reach its database)
- state transitions: C13 (`COMPLETED`), C14 and C15 (`FAILED`, grant revoked)
- observability: C1 (the printed digest is what `extension add` pins)

## Handoff

- S1-S6 = ~152k by the per-slice figures, which count shared files once per slice. The distinct files the build reads or touches measure ~239 KB (~60k) plus ~60 KB of new files (~15k), so ~75-100k overall, under the 150k budget - one builder
