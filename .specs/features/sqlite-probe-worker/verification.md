# SQLite probe worker verification

**Verdict**: PASS
**Profile**: light
**Diff range**: 5eb3197b..1f31e259
**Round**: 1 - full
**Verifier**: independent sub-agent (author != verifier)

Every check in `checks.md`, C1 to C21, has a proof that ran and passed at
`1f31e25980735e76544d016269375a895dfc2772`. Each check also has a located
assertion that targets the value the check names. The proofs ran on Linux
(WSL2, the real-worker platform) and on Windows. Required scopes and gates
passed on both, with 0 failed and 0 skipped. Three checks have imprecise
wording and the handoff cites commits that are not on the branch. These are
listed under Findings. None of them is a check the code fails.

Profile `light`: step 1 (binding sources), the `Coverage` recompute and fault
injection do not run. `plan.md` marks no source binding. `checks.md` carries
no `Test policy` section.

## Proof runs

Each scope ran as one invocation at HEAD, with one `--test-name-pattern` per
named test (`node --test --test-reporter=spec ...`). Every named test appears
individually as passed in each log. On Windows, the build batch ran with
`GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=core.excludesFile` and
`GIT_CONFIG_VALUE_0=<scratch file holding .claude/>`, set for that process
only.

| Batch | Files | Linux (WSL2) | Windows |
| --- | --- | --- | --- |
| P-contract | `tests/contract/probe-worker-command.test.mjs`, `tests/contract/cli-surface.test.mjs`, `tests/contract/probe-quick-start-doc.test.mjs` | exit 0 - 10 pass, 0 fail, 0 skipped | exit 0 - 10 pass, 0 fail, 0 skipped |
| P-build | `tests/build/sqlite-probe-worker-bundle.test.mjs`, `tests/build/reproducible-target-build.test.mjs`, `tests/build/sealed-launcher-closure.test.mjs` | exit 0 - 5 pass, 0 fail, 0 skipped | exit 0 - 5 pass, 0 fail, 0 skipped |
| P-integration | `tests/integration/sqlite-probe-worker.test.mjs` | exit 0 - 3 pass, 0 fail, 0 skipped | exit 0 - 3 pass, 0 fail, 0 skipped |
| P-e2e | `tests/e2e/probe-worker-e2e.test.mjs`, `tests/e2e/cli-launchers-e2e.test.mjs` | exit 0 - 4 pass, 0 fail, 0 skipped | exit 0 - 4 pass, 0 fail, 0 skipped |
| P-architecture | `tests/architecture/extension-host-composition.test.mjs`, `tests/architecture/database-command-composition.test.mjs` | exit 0 - 2 pass, 0 fail, 0 skipped | exit 0 - 2 pass, 0 fail, 0 skipped |

Every named test exists. `rg -n '^test\("<name>'` found each one at the line the
Evidence column cites. One exception: the C17 `--help` case is generated at
`tests/e2e/cli-launchers-e2e.test.mjs:60`
(`` `${name} emits the exact canonical release output for ${args.join(" ")}` ``)
from the row at `:44`, so its name is `vestra emits the exact canonical
release output for --help`. The C18 data-probe proof's full name is `only the
database family loads data-probe, and the probe family plans with it`
(`tests/architecture/database-command-composition.test.mjs:220`), and the
pattern matches it. No filter matched nothing.

Every proof exercises this diff. Each named test is new in `5eb3197b..HEAD`, or
its body or its pinned data changed there. Two cases are worth naming. The
sealed `--help` case's body is unchanged, but its `SEALED_COMMANDS` gained
`"probe worker"` (`tests/build/sealed-launcher-closure.test.mjs:110`). The
`--help` snapshot gained the `probe worker` line
(`tests/e2e/cli-launchers-e2e.test.mjs:45`).

C10 runs the real bundle with `node` on both platforms. C11 and C12 spawn the
real worker against a real SQLite file on Linux only. On Windows they assert
`VES_PROBE_HOST_PLATFORM_UNSUPPORTED`, which is the Windows half, not the
real-worker proof. The same split applies to C13 through C15 through the real
launcher. macOS ran nothing here. `checks.md` declares that macOS is proven only
in the nightly matrix after merge.

## Checks

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | `probe worker --engine sqlite --entry probe/sqlite-worker.mjs` writes the bundle's exact bytes, exits 0, and prints path, engine, digest and `written: true` | P-contract, Linux + Windows, passed | `tests/contract/probe-worker-command.test.mjs:136` - `assert.deepEqual(data, { path: ENTRY, engine: "sqlite", digest: sha256(bundle), written: true })`; `:138` - `assert.ok(written.equals(bundle), ...)`; `:139` - `assert.equal(data.digest, sha256(written))`; exit 0 at `:102` - `assert.equal(result.exitCode, 0, ...)` | PASS |
| C2 | Run again, it exits 0 with `written: false`, the same digest, and unchanged bytes | P-contract, Linux + Windows, passed | `tests/contract/probe-worker-command.test.mjs:148` - `assert.deepEqual(again, { path: ENTRY, engine: "sqlite", digest: first.digest, written: false })`; `:149` - `assert.ok((await readFile(entryPath(fixture))).equals(bytes), ...)` | PASS |
| C3 | Other bytes at `--entry`: exit 5 `VES_PROBE_WORKER_TARGET_CONFLICT`, bytes unchanged | P-contract, Linux + Windows, passed | `tests/contract/probe-worker-command.test.mjs:158` - `refused(await writeWorker(fixture), "VES_PROBE_WORKER_TARGET_CONFLICT", 5, "other bytes")` (code `:110`, exit `:108`); `:159` - `assert.ok((await readFile(entryPath(fixture))).equals(other), ...)` | PASS |
| C4 | `../outside.mjs`, a path through a directory link, and an existing directory each exit 5 with `VES_PROBE_WORKER_TARGET_INVALID`, and nothing is written in or outside the Workspace | P-contract, Linux (symlink) + Windows (junction: dir symlink is EPERM on this host), passed | `tests/contract/probe-worker-command.test.mjs:183` - `refused(await writeWorker(fixture, entry), "VES_PROBE_WORKER_TARGET_INVALID", 5, label)` over `:176` `"../outside.mjs"`, `:178` `"linked/sqlite-worker.mjs"`, `:180` `"probe/worker.mjs"`; `:184` - `assert.deepEqual(await tree(fixture.root), before, ...)`; `:186` - `assert.deepEqual(await readdir(outside), [], ...)` | PASS |
| C5 | `--engine postgresql` exits 5 with `VES_PROBE_WORKER_ENGINE_UNSUPPORTED` and writes nothing; a missing `--engine` or `--entry` exits 2 with `VES_CLI_ARGUMENT_INVALID` | P-contract, Linux + Windows, passed | `tests/contract/probe-worker-command.test.mjs:192` - `refused(..., "VES_PROBE_WORKER_ENGINE_UNSUPPORTED", 5, "--engine postgresql")`; `:198` - `assert.deepEqual(await tree(fixture.root), before, "nothing is written")`; `:203` - `refused(..., "VES_CLI_ARGUMENT_INVALID", 2, label)`; `:204` - `assert.equal(error.safeDetails.argument, argument, label)` | PASS |
| C6 | Source layout without the bundle: exit 5 `VES_PROBE_WORKER_UNAVAILABLE`, names `corepack pnpm build:probe-worker`, writes nothing | P-contract, Linux + Windows, passed | `tests/contract/probe-worker-command.test.mjs:216` - `assert.equal(missing, join(checkout, "apps", "vestra-cli", "dist", "sqlite-probe-worker.mjs"))`; `:218` - `refused(..., "VES_PROBE_WORKER_UNAVAILABLE", 5, "no bundle")`; `:224` - `assert.ok(error.recovery.includes(BUILD_COMMAND), error.recovery)`; `:225` - `assert.deepEqual(await tree(fixture.root), before, "nothing is written")` (see Finding 3) | PASS |
| C7 | Every static and dynamic import the bundle makes names a `node:` module | P-build, Linux + Windows, passed | `tests/build/sqlite-probe-worker-bundle.test.mjs:32` - `assert.deepEqual(imports.filter((entry) => !entry.path.startsWith("node:")), [], ...)`; `:38` - kinds limited to `import-statement`, `dynamic-import`, `require-call`; `:31` - `assert.ok(imports.length > 0, ...)` | PASS |
| C8 | Two runs of `scripts/build-probe-worker.mjs` write byte-identical bundles | P-build, Linux + Windows, passed | `tests/build/sqlite-probe-worker-bundle.test.mjs:52` - `assert.ok(first.equals(second), "two builds on one revision write byte-identical bundles")`; `:53` - `assert.ok((await bundleProbeWorker()).bytes.equals(first), ...)` | PASS |
| C9 | The builder seals `probe:sqlite-worker` at `bin/sqlite-probe-worker.mjs` as `core-code`; the sealed `probe worker` writes that layout's bytes | P-build, Linux + Windows, both tests passed | `tests/build/reproducible-target-build.test.mjs:213` - `assert.equal(workers.length, 1)`; `:215` - `assert.equal(worker.kind, "core-code")`; `:216` - `assert.equal(worker.logicalPath, "bin/sqlite-probe-worker.mjs")`; `:208` - `SEALED_CHILD_ENTRIES["probe:sqlite-worker"]` is the closure entry; `tests/build/sealed-launcher-closure.test.mjs:667` - `assert.ok(written.equals(await readFile(stagedWorker)), "the written worker is the release's own bytes")` (see Finding 1) | PASS |
| C10 | The worker run with `node`, with either variable missing or empty or a relative path, exits 5 and writes no stdout byte | P-integration, Linux + Windows (real bundle on both), passed | `tests/integration/sqlite-probe-worker.test.mjs:89` - `assert.equal(result.status, 5, ...)`; `:90` - `assert.equal(result.stdout.length, 0, ...)` over the cases at `:81`-`:86`; control `:77` - `assert.equal(control.status, 0, ...)` | PASS |
| C11 | Through the spawned, framed and supervised worker on a real SQLite file: `complete`, `rowCount` 1, handshake id and digest, file unchanged; Windows refuses for the platform | P-integration, Linux real worker passed; Windows refusal passed | `tests/integration/sqlite-probe-worker.test.mjs:196` - `assert.equal(outcome.value.status, "complete")`; `:197` - `assert.equal(outcome.value.rowCount, 1)`; `:201` - `assert.deepEqual(framed.handshakes[0].component, { id: COMPONENT, digest: sha256(readFileSync(BUNDLE)) })`; `:202` - `assert.equal(sha256(readFileSync(database)), before, ...)`; Windows `:181` - `assert.rejects(launchWorker(...), { code: "VES_PROBE_HOST_PLATFORM_UNSUPPORTED" })` | PASS |
| C12 | Another `PROBE_COMPONENT_ID`: supervisor refuses `VES_PROBE_HANDSHAKE_COMPONENT`, commits nothing; Windows refuses for the platform | P-integration, Linux real worker passed; Windows refusal passed | `tests/integration/sqlite-probe-worker.test.mjs:213` - `assert.equal(outcome.error?.code, "VES_PROBE_HANDSHAKE_COMPONENT", ...)`; `:215` - `assert.equal(results.commits, 0, "no result is committed")`; Windows `:181` | PASS |
| C13 | Through the real launcher: write, commit, `extension add`, `approve`, `database add`, `probe run` exits 0 with `complete`, `rowCount` 1, run `COMPLETED`; Windows `probe run` refuses for the platform | P-e2e, Linux real launcher passed; Windows refusal passed | `tests/e2e/probe-worker-e2e.test.mjs:246` - `assert.equal(data.result.status, "complete")`; `:247` - `assert.equal(data.result.rowCount, 1)`; `:249` - `assert.deepEqual(runsOf(fixture)...,[{ runId: data.runId, state: "COMPLETED", runKind: "probe" }])`; exit 0 at `:55`; Windows `:230` - `refused(..., "VES_PROBE_HOST_PLATFORM_UNSUPPORTED", 5, "probe run on win32")` | PASS |
| C14 | A reference approved without `PROBE_SQLITE_PATH`: `probe run` exits 5 with a code the probe registry declares; the run is `FAILED` and its grant revoked | P-e2e, Linux passed (diagnostic: `refused with VES_PROBE_WORKER_EXITED`) | `tests/e2e/probe-worker-e2e.test.mjs:260` - `refused(await probeRun(fixture, worker, requestPath), undefined, 5, ...)` (exit `:61`); `:262` - `assert.ok(probePublicErrorRegistry.codes.includes(error.code), ...)`; `:211` - `{ state: "FAILED", runKind: "probe" }`; `:218` - `assert.ok(Number.isFinite(Date.parse(grants[0].revokedAt)), "the grant carries a revocation")` | PASS |
| C15 | A reference approved with another extension's id: `probe run` exits 5 `VES_PROBE_HANDSHAKE_COMPONENT`; the run is `FAILED` and its grant revoked | P-e2e, Linux passed | `tests/e2e/probe-worker-e2e.test.mjs:276` - `refused(await probeRun(fixture, worker, requestPath), "VES_PROBE_HANDSHAKE_COMPONENT", 5, "another component")`; `:277` - `failedRun(fixture)` (`:211`, `:218`) (see Finding 4) | PASS |
| C16 | The manifest declares `probe worker` with exactly `--engine` and `--entry` | P-contract, Linux + Windows, passed | `tests/contract/cli-surface.test.mjs:322` - `assert.deepEqual(probe.map(...), [..., ["probe worker", true, true, [["engine", "string", false], ["entry", "string", false]]]])` (row at `:344`-`:349`) | PASS |
| C17 | Source `--help` prints the `probe worker` line in the exact snapshot; sealed `--help` names every sealed command, `probe worker` included | P-e2e and P-build, Linux + Windows, passed | `tests/e2e/cli-launchers-e2e.test.mjs:64` - `assert.equal(result.stdout, expectedStdout)` against the snapshot at `:45`; `tests/build/sealed-launcher-closure.test.mjs:341` - `for (const command of SEALED_COMMANDS) assert.match(help.stdout, new RegExp(...))` with `"probe worker"` at `:110` (see Finding 2) | PASS |
| C18 | The guards admit the worker's frame-codec and SQLite-adapter imports by name, and no other new edge | P-architecture, Linux + Windows, passed | `tests/architecture/extension-host-composition.test.mjs:199` - `assert.deepEqual([...edges].sort(), [...].sort(), "the composition edges are the only ones")`, whose fourth and only new edge is the worker's import of `@verchestra/extension-host` (`:205`), names held to `CODEC_NAMES` `:47`; `tests/architecture/database-command-composition.test.mjs:223` - `assert.deepEqual(compositionFindings(files, MAIN, families(FAMILY, PROBE_FAMILY, WORKER)), [], ...)`, names held to `WORKER_DATA_PROBE_VALUES` `:44` | PASS |
| C19 | The guide names the journey in order, `approve` with both variables, and the three statements | P-contract, Linux + Windows, passed | `tests/contract/probe-quick-start-doc.test.mjs:96` - `assert.ok(positions[index] >= 0, ...)`; `:97` - `assert.deepEqual([...positions].sort(...), positions, ...)`; `:104` - `assert.deepEqual(environment.sort(), ["PROBE_COMPONENT_ID", "PROBE_SQLITE_PATH"])`; `:115` - `assert.ok(text.includes(statement), ...)` | PASS |
| C20 | Every `vestra` line in the guide's `bash` blocks is a declared command with only its own options or `--output` | P-contract, Linux + Windows, passed | `tests/contract/probe-quick-start-doc.test.mjs:129` - `assert.equal(parsed.mode, "command", ...)`; `:133` - `assert.ok(...)` that each `--` option is `output` or one of `declared.options`; the negative controls at `:145` - `assert.throws(...)` | PASS |
| C21 | Both site pages link the guide's GitHub URL | P-contract, Linux + Windows, passed | `tests/contract/probe-quick-start-doc.test.mjs:159` - ``assert.ok(markdown.includes(`](${GUIDE_URL})`), ...)`` | PASS |

## Level and sampling

- C1-C6 run in-process through `runCli` with the probe family as the command
  bus. That is the same function `main()` returns its exit code from
  (`apps/vestra-cli/src/main.ts:147`-`170`). The real launcher writes the
  worker with exit 0 in C13 (`tests/e2e/probe-worker-e2e.test.mjs:133`), and
  the sealed launcher does the same in C9. No exit-code claim sits below its
  boundary.
- C6 simulates the unbuilt checkout. It passes the product resolver
  `resolveSqliteProbeWorker`, aimed at an empty checkout's
  `release-layout.ts` URL, through `executeProbeCommand`'s optional resolver.
  `main.ts:144` never passes that resolver. The resolution and the refusal are
  still the product's own code (`apps/vestra-cli/src/release-layout.ts:126`,
  `apps/vestra-cli/src/probe/probe-worker.ts:39`).
- C10-C15 run the real bundle. C11 and C12 add the real spawned transport and
  supervisor. C13-C15 add the real `vestra` launcher, admission and the
  runtime store.

## Swept existing

| Swept row | Cited constraint | Located in code |
| --- | --- | --- |
| authorization | `extension add` pins the entry digest | `apps/vestra-cli/src/extension/extension-add.ts:91` (`resolveEntry`), `:110` and `:125` (`entryDigest: entry.digest`) |
| authorization | `extension approve` pins the launch with a typed-back digest | `apps/vestra-cli/src/extension/extension-approve.ts:73` (`measure`), `:78` (`confirmDigest(io, launchDigest, ...)`) |
| authorization | `probe run` types back its binding digest, and its grant serves one run | `apps/vestra-cli/src/probe/probe-run.ts:340` (`confirmDigest(io, request.bindingDigest, ...)`), `:283` (`authority.revoke(grant.grantId, "probe-run-ended")` in `finally`) |

The constraints the row cites are present. The `concurrency: n/a` row is
approved policy.

## Findings

None of these fails a check. Each is recorded for the owner's review.

1. **Precision gap - C9.** "The release builder's sealed child entries map
   `probe:sqlite-worker` to `bin/sqlite-probe-worker.mjs`" is ambiguous.
   - If the phrase means the `SEALED_CHILD_ENTRIES` constant, the claim is
     false as worded. The constant maps the id to the tracked entry
     `apps/vestra-cli/closure/sqlite-probe-worker-entry.ts`, as it does for
     every member (`scripts/t76-build-candidate.mjs:296`-`310`), and the test
     asserts that value (`reproducible-target-build.test.mjs:208`).
   - The builder maps the id to `bin/sqlite-probe-worker.mjs` in its host
     descriptor (`scripts/t76-build-candidate.mjs:515`-`522`), and the sealed
     output carries it there (`:216`). That meets AC 11 exactly.

   I judged the claim met under that reading. The check should name the
   descriptor, not the entry map.
2. **Precision gap - C17.** "Between `probe run`'s neighbours" does not fix a
   position. `probe run` was the last command line, and the exact snapshot puts
   `probe worker` immediately after it as the new last line
   (`cli-launchers-e2e.test.mjs:45`). The exact-snapshot assertion settles the
   output. The wording does not.
3. **C6 wording.** The check says "its message names" the build command. A
   public error envelope has no message field
   (`packages/domain/src/errors/public-error.ts:32`-`43`); its public text is
   `recovery`. The test asserts on `recovery`, which is the right target. The
   private exception message names the command as well
   (`apps/vestra-cli/src/probe/probe-worker.ts:45`).
4. **C15 wording.** The check says "a third reference". Each e2e case builds its
   own journey, so the C15 fixture holds two references, not three. What the
   check is about is still asserted: a reference approved with an id other than
   its own extension's (`probe-worker-e2e.test.mjs:272`-`276`).
5. **Platform note - C4.** `linkDirectory` tries a directory symlink first and
   falls back to a junction only on `EPERM` (`tests/helpers/windows-links.mjs:9`-`15`).
   This host refuses directory symlinks, so the Windows run tested a junction,
   as C4 names. On a Windows host with symlink privilege, the case would test a
   symlink instead.
6. **Undeclared worker status.** The worker exits 4 (`PROTOCOL_REFUSED`,
   `apps/vestra-cli/src/probe/sqlite-probe-worker.ts:25`) on a frame it cannot
   read or a message it does not answer. That status is not in the plan's
   Surface set for the worker process. The `checks.md` Handoff discloses it,
   and `tests/unit/sqlite-probe-worker.test.mjs:236`-`243` covers it, which
   passed in `gate:quick`. No check names it. The light profile does not
   recompute Coverage, so this is reported here instead.
7. **Handoff traceability.** `checks.md` `## Handoff` ("closed at `751677ad`")
   and `handoff.md` cite `610c9d41`, `7baae2f2`, `01712335`, `5eb5bef4` and
   `751677ad`. These are pre-rebase commits and are not ancestors of HEAD:
   `git merge-base --is-ancestor` fails for each. A clean clone will not
   resolve them. `handoff.md`'s `lastGate` also reports runs at `751677ad`,
   not HEAD. This report's runs are at HEAD. The current branch commits are
   `69fc8a12`, `84d6a704`, `ff225bbb`, `d4623a77` and `64c3c761`.

## Gate

Windows 11 Pro, Node v24.14.0, HEAD `1f31e259`:

- `corepack pnpm gate:quick` - PASS. format:check, lint, complexity:check and
  typecheck passed. test:unit 3672 passed, 0 failed. test:agent-readiness 466
  passed, 0 failed. test:census 14 passed, 0 failed. 0 skipped.
- `corepack pnpm test:architecture` - 149 passed, 0 failed, 0 skipped.
- Named proofs P-contract 10/0, P-build 5/0 (with the `.claude/` exclude),
  P-integration 3/0, P-e2e 4/0, P-architecture 2/0 (passed/failed). 0
  skipped.
- Not run on Windows, as briefed: `test:integration`, because of the known
  symlink-permission failures that predate this feature, and
  `test:qualification`.

Linux, WSL2 6.6.87.2 x86_64, Node v24.14.0, clone at HEAD `1f31e259`:

- `corepack pnpm gate:quick` - PASS. format:check, lint, complexity:check and
  typecheck passed. test:unit 3672 passed, 0 failed. test:agent-readiness 466
  passed, 0 failed. test:census 14 passed, 0 failed. 0 skipped.
- `corepack pnpm test:contract` - 1040 passed, 0 failed, 0 skipped.
- `corepack pnpm test:architecture` - 149 passed, 0 failed, 0 skipped.
- `corepack pnpm test:build` - 190 passed, 0 failed, 0 skipped.
- `corepack pnpm test:integration` - 1289 passed, 0 failed, 0 skipped.
- `corepack pnpm test:e2e` - 366 passed, 0 failed, 0 skipped.
- Named proofs P-contract 10/0, P-build 5/0, P-integration 3/0, P-e2e 4/0,
  P-architecture 2/0 (passed/failed), each under a private `TMPDIR` that was
  left empty.
- Not run: `test:qualification`, as briefed.

Tree state after the runs: Windows `git status --porcelain` shows only
`?? .claude/`, plus this report once written. The WSL clone's porcelain is
empty.
