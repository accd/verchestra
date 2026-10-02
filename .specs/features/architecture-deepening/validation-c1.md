# Validation — candidate C1 (ADP-1, task worktree)

Branch `refactor/task-worktree-module`, three commits, one per task row
(T1a, T1b, T1c). Each section maps the requirement to the assertions that prove
it. Sources are named by symbol, because their lines move between the three
commits; assertions are cited by test file and line. Every gate result below
was measured on the commit it describes, on base revision `d195400`.

## C1-1 (T1a) — one module for the handle, the branch name and the trailers

Owning module: `packages/platform-node/src/task-worktree.ts`. Consumers:
`git-worktree-adapter.ts`, `gate-commit-adapters.ts` and `git-context-source.ts`
in the same package. No behaviour changes in this commit.

| ADP-1 clause | Definition (symbol) | Assertion evidence |
| --- | --- | --- |
| Handle encoding defined in one module | `encodeWorktreeHandle`, `parseWorktreeHandle` | Round trip for a 40-digit and a 64-digit base: `tests/unit/task-worktree.test.mjs:55-57`. Rejection of a base one digit short or long: `:62-64`; not lowercase hexadecimal: `:70-71`; malformed ID, extra segment, prefix, trailing newline, opaque double text: `:77`, `:89`. A 64-digit base is never read as its last 40 digits: `:96-97` |
| Task branch name defined in one module | `taskBranchName`, `taskBranchRef`, `isTaskBranchComponent` | `tests/unit/task-worktree.test.mjs:101-103`, `:108`, `:110`; real refs in both object formats: `tests/integration/task-worktree-git.test.mjs:36-42` |
| Commit trailers defined in one module | `taskCommitMessage`, `parseTaskCommitTrailers` | Golden bytes, byte length 522 and SHA-256 of the message: `tests/unit/task-worktree.test.mjs:115-120`; writer and parser agree, with LF and CRLF: `:129`, `:135`; no trailers: `:144`; a subject cannot shadow the block: `:154`, `:156`; strict gate evidence digest: `:166` |
| One git runner | `runGit`, `runGitBytes` | `tests/integration/task-worktree-git.test.mjs:28`, `:30`, `:55-62` (failure and output bound), `:70-71` (argument vector, no shell) |
| Worktree registration read once | `registeredWorktrees` | `tests/unit/task-worktree.test.mjs:187-189`; real listing in both object formats: `tests/integration/task-worktree-git.test.mjs:49` |
| No second copy under `packages/` | — | `tests/architecture/task-worktree-locality.test.mjs:46-49` (the scan is not vacuous and the owner holds all three definitions), `:55` (no other source spells one out) |

### Invariants kept

- **Trailer block byte-identical.** The golden message in
  `tests/unit/task-worktree.test.mjs` was produced by evaluating the template
  literal of `NodeAtomicGitCommitAdapter#message` as it stands on `origin/main`
  (`d58a25f`) on the same input and comparing it with `taskCommitMessage`:
  identical, 522 bytes, SHA-256
  `ca613c03c63912a426d23db03ed4597f5abeeda39513f65b6b22d0e7dcd49882`. The
  requirement list is sorted by code unit, which is what the previous
  comparator-less sort did for strings.
- **Handle ID derivation unchanged.** `NodeGitWorktreeAdapter#create` still
  derives the ID from the same seven inputs in the same order; only the final
  concatenation moved into `encodeWorktreeHandle`.
- **Handle opaque at the port.** `ExecutionWorktreePort` is untouched; the
  parser returns `undefined` for the handle text of the test doubles
  (`tests/unit/task-worktree.test.mjs:89`, case `worktree:self-test`).
- **Error codes unchanged.** Each adapter maps an unparsable handle to its own
  code (`VES_GIT_WORKTREE_INPUT_INVALID`, `VES_GATE_ADAPTER_HANDLE_INVALID`); the
  existing integration suites pass unmodified (below).

### Tests replaced

None. No existing test was deleted or modified in this commit.

### Discrimination (disposable copy)

Run against a copy of the module and its unit suite in an ignored scratch
directory; the tracked sources were never mutated. Unmutated copy: 17 pass,
0 fail.

| Mutation | Result |
| --- | --- |
| Swap the `Verchestra-Task` and `Verchestra-Run` lines in the writer | 1 fail: "the task commit message is byte-identical to the recorded golden message" |
| Handle parser admits a 40-digit base only | 2 fail: "a handle with a sha256 base round-trips through encode and parse", "a 64-digit base is never read as its last 40 digits" |
| Writer stops sorting the requirement IDs | 1 fail: the golden message case |

The locality scan was also run over the `origin/main` version of each file in
the fact list; it flags all of them (`git-worktree-adapter.ts`: handle, branch,
trailer; `gate-commit-adapters.ts`: handle, trailer; `task-git.ts` and
`task-surface.ts`: branch; `task-run.ts`: handle, trailer; `task-status.ts` and
`task-verifier.ts`: handle).

### Guardrails

- Complexity baseline, ratcheted down, no key added or moved:
  `packages/platform-node/src/gate-commit-adapters.ts :: Async function 'targetFromRef'`
  12 → 11; `packages/platform-node/src/gate-commit-adapters.ts :: Async method 'run'`
  16 → 12.
- Census: no file gained or lost `JSON.stringify` or `createHash`
  (`pnpm test:census` passes inside `gate:quick`).
- Citations fixed: `.specs/features/platform-qualification-matrix/matrix.md`
  (the two `relative(...) !== ""` lines and the process-tree termination row).
- A git spawn site outside the seven in the task brief was found on the task
  path, `NodeGitContextSource#git` (used by `task plan`); it now calls
  `runGitBytes` as well.

### Gates (Node 24.14.0, macOS arm64)

| Command | Result |
| --- | --- |
| `node --test tests/unit/task-worktree.test.mjs tests/integration/task-worktree-git.test.mjs tests/architecture/task-worktree-locality.test.mjs` | PASS — 29 passed |
| `node --test tests/integration/git-worktree-adapter.test.mjs tests/integration/gate-commit-adapters.test.mjs tests/integration/task-branch-anchoring.test.mjs` | PASS — 23 passed, unmodified |
| `pnpm gate:quick` | PASS — unit 2359, agent-readiness 315, census 13 |
| `pnpm test:architecture` | PASS — 65 |
| `pnpm test:integration` | PASS — 778 |
| `pnpm test:e2e` | PASS — 229 |
| `pnpm agent:check` | PASS |

## C1-2 (T1b) — the CLI's handle operations move into the worktree module; SHA-256

The CLI no longer takes the handle apart. `NodeGitWorktreeAdapter` gains three
off-port operations (`cleanupHandle`, `cleanupAtCommit`, and the free function
`scratchWorktreeHandle`); `task-git.ts` loses `taskBranch` and `refTarget`;
`task-surface.ts` reuses `taskBranchName`, `taskBranchRef`, `refTarget` and
`isGitObjectId`; every CLI git call goes through `runGit` or `runGitBytes`.

### SHA-256 outcome: supported, not refused

Path taken: **full support**. The brief asked for a plan-time refusal only if a
signed evidence format admits a 40-digit object ID alone. None does:

- `schemas/task-request/1.schema.json` (`sourceRevision`) already admits 40 or
  64 digits, as does `normalizeTaskRequest`.
- The Execution Package carries no object ID; `expectedCommit` is the commit
  boundary text.
- The Run Capsule names the commit as the artifact reference `commit:<id>`
  (bounded printable text) and the verification report carries `commitId`
  under the pattern widened here.
- The runtime gate checkpoint store, the executor, the gate coordinator and
  the scheduler already use the 40-or-64 pattern.

The two 40-only sites were validation, not format: `loadCommit` in
`apps/vestra-cli/src/task/task-surface.ts` and `COMMIT` in
`packages/application/src/verification/verification.ts`. Both now admit the
adapters' pattern. `tests/e2e/task-cli-e2e.test.mjs:443-471` proves the result
end to end on macOS: a SHA-256 repository is planned, approved, cancelled while
idle, then implemented, gated, committed, verified through a scratch checkout,
accepted, and sealed into a Run Capsule. No public error code was added (the
task catalog stays at 10 codes; the runtime catalog stays at 19).

### Requirement evidence

| ADP-1 clause | Operation (symbol) | Assertion evidence |
| --- | --- | --- |
| An idle cancel removes the worktree in a SHA-256 repository | `removeIdleWorktree` (CLI) → `cleanupHandle` | Real git, both object formats, every platform: `tests/integration/task-idle-cancel.test.mjs:44-49` (worktree unregistered, directory gone, no branch, checkout clean). Full command on macOS: `tests/e2e/task-cli-e2e.test.mjs:453-456` |
| Cleanup from the handle alone | `NodeGitWorktreeAdapter#cleanupHandle` | `tests/integration/task-worktree-operations.test.mjs:38-42`; anchors a verified commit first `:49-52`; refuses text that is not a handle `:70-71`; the last 40 digits of a SHA-256 handle are not its base `:183-188` |
| The swallowed error narrows to "not found" | `worktreeAlreadyGone` (CLI), `#assertRegisteredTarget` | `VES_GIT_WORKTREE_CONFLICT` now surfaces and the worktree is kept: `tests/integration/task-idle-cancel.test.mjs:64-66`; `VES_GIT_WORKTREE_INPUT_INVALID` surfaces: `:72-75`; an unregistered worktree and a deleted directory still cancel: `:82`, `:87`; the adapter reports a deleted directory as `VES_GIT_WORKTREE_NOT_FOUND`: `tests/integration/task-worktree-operations.test.mjs:78-81` |
| Cleanup of the worktree whose HEAD is a given commit, with canonical roots | `NodeGitWorktreeAdapter#cleanupAtCommit` | `tests/integration/task-worktree-operations.test.mjs:88-93`; leaves other worktrees alone `:103-111`; through a linked state root `:134-138` |
| Crash-resume (`committed()`, formerly `#anchorAfterCrash`) | `recoverCommittedTask` (CLI) | Records, anchors, removes, releases: `tests/integration/task-commit-recovery.test.mjs:78-92`; crash after cleanup `:99-103`; linked state root `:121-122`; existing record returned without git `:134-135`; nothing to recover `:140-144`; evidence for another change refused `:151-156`; commit without a gate evidence trailer refused `:164-168` |
| A handle for a scratch checkout | `scratchWorktreeHandle` | The gate runner accepts it for a real checkout in both formats: `tests/integration/task-worktree-operations.test.mjs:163-164`; malformed name or commit refused `:174` |
| The two 40-only sites admit both formats | `loadCommit`; `COMMIT` in `verification.ts` | `tests/integration/task-commit-recovery.test.mjs:181`, `:188-189`; `tests/unit/verification-object-id.test.mjs:26-27`, `:35-36`, rejection `:45-46`, `:55-60` |
| No second copy in the CLI | — | `tests/architecture/task-worktree-locality.test.mjs:55` now scans `apps/` as well as `packages/` |
| One git runner on the task path | `runGit`, `runGitBytes` | `tests/architecture/task-worktree-locality.test.mjs:66-69`: no source under `packages/platform-node/src` or `apps/vestra-cli/src/task` spawns git except the owning module |
| SHA-256 fixture cannot pass silently | `objectFormatRepository`, `initializeRepository` | `tests/helpers/git-object-format-fixture.mjs` fails with a message naming the installed git when `git init --object-format` is refused, and asserts `rev-parse --show-object-format` and the 64-digit commit ID; `tests/helpers/task-cli-fixture.mjs` throws when the created repository is not in the requested format. Installed git here: 2.50.1 |

### Behaviour changes (owner-approved) and their bounds

- Idle cancel ignores only `VES_GIT_WORKTREE_NOT_FOUND`. Any other cleanup
  refusal stops the cancel before the lease is released and before the abort is
  recorded, and reaches the user as `VES_TASK_FAILED` with the adapter code as
  `reason`. `docs/quick-start.md` §9 states it.
- `cleanup` reports a worktree Git still lists but whose directory is gone as
  `VES_GIT_WORKTREE_NOT_FOUND` instead of a bare `ENOENT`.
- Crash recovery reads the gate evidence digest with the module's trailer
  parser. When a trailer name repeats, the last line wins, so a commit subject
  that imitates the trailer cannot shadow the trailer block; the previous
  regular expression took the first match.
- Crash recovery compares worktree paths against the canonical worktrees root.
  The previous comparison used the configured path, so a state root reached
  through a link recorded the commit and left it unanchored.

### Tests replaced

None deleted. The macOS-only end-to-end idle cancel case stays, and the
platform-neutral cases above now cover the same behaviour on every platform.

### Discrimination (disposable copy)

A copy of `apps`, `packages`, `tests` and `scripts` in an ignored scratch
directory was mutated one change at a time and restored from the tracked
sources after each run; the tracked sources were never mutated.

| Mutation in the copy | Failing cases |
| --- | --- |
| **D1 — reintroduce `cleanup({ worktreeRef, baseCommit: worktreeRef.slice(-40) }).catch(() => undefined)`** (the original defect) | 6 of 13 in `task-idle-cancel.test.mjs`, including **"idle cancel removes the uncommitted worktree of a sha256 repository"** and "idle cancel keeps a verified sha256 task commit on its task branch"; the SHA-1 removal case still passes, as it did before. The SHA-256 end-to-end journey fails too |
| D2 — use the handle but swallow every error | 4 fail: the conflict and the invalid-marker cases in both formats |
| D3 — swallow nothing | 2 fail: "idle cancel proceeds when the … worktree is already gone" in both formats |
| D4 — `cleanupAtCommit` compares the configured root instead of the canonical one | 10 fail across `task-commit-recovery.test.mjs` and `task-worktree-operations.test.mjs`, including both "linked state root" cases in both formats |
| D5 — the CLI commit record admits 40 digits only | 3 fail in `task-commit-recovery.test.mjs` (SHA-256 cases); the SHA-256 end-to-end journey fails |
| D6 — `verification.ts` admits a 40-digit commit only | 2 fail in `verification-object-id.test.mjs` (SHA-256 cases); the SHA-256 end-to-end journey fails |
| D7 — the scratch handle is cut to 40 digits | 2 fail in `task-worktree-operations.test.mjs`; the SHA-256 end-to-end journey fails |

### Guardrails

- Complexity: no baseline entry changed; no new function is above 10.
- Census: no file gained or lost `JSON.stringify` or `createHash`.
- Citations fixed: `.specs/features/live-task-pilot/validation.md`
  (`task-run.ts`, `task-status.ts`, `task-verifier.ts` lines) and
  `.specs/features/platform-qualification-matrix/matrix.md`
  (`git-worktree-adapter.ts` line).
- Migration count (12) and runtime error catalog count (19) unchanged.

### Gates (Node 24.14.0, macOS arm64, git 2.50.1)

| Command | Result |
| --- | --- |
| `node --test tests/integration/task-worktree-operations.test.mjs tests/integration/task-idle-cancel.test.mjs tests/integration/task-commit-recovery.test.mjs tests/unit/verification-object-id.test.mjs` | PASS — 54 passed |
| `node --test tests/integration/git-worktree-adapter.test.mjs tests/integration/gate-commit-adapters.test.mjs tests/integration/task-branch-anchoring.test.mjs` | PASS — 23 passed, unmodified |
| `pnpm gate:quick` | PASS — unit 2365, agent-readiness 315, census 13 |
| `pnpm test:architecture` | PASS — 66 |
| `pnpm test:integration` | PASS — 826 |
| `pnpm test:e2e` | PASS — 230 (includes the SHA-256 journey) |
| `pnpm test:contract` | PASS — 666 |
| `pnpm test:security` | PASS — 1333 |
| `pnpm test:fault` | PASS — 310 |
| `pnpm agent:check` | PASS |

## C1-3 (T1c) — scrubbed environment for git

The one git runner (`runGit`, `runGitBytes`) now passes `gitEnvironment()`:
`safeEnvironment()` (moved unchanged from `gate-commit-adapters.ts` to
`packages/platform-node/src/safe-environment.ts`, where the gate runner still
uses it) plus `XDG_CONFIG_HOME`, `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`,
`GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL`. This is a behaviour change:
before it, every git process inherited the whole process environment.

### Requirement evidence

All in `tests/integration/task-worktree-git-environment.test.mjs`. Each case
plants the hostile variables in the test process, runs only product code
inside that scope, and inspects the result with the fixture's git outside it.

| Clause | Assertion evidence |
| --- | --- |
| Only the admitted variables reach git | `:131` (every key is admitted), `:132` (none of 17 planted variables, including `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_COMMON_DIR`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `GIT_CONFIG_COUNT` with its key and value pairs, `GIT_CONFIG_PARAMETERS`, `GIT_EXEC_PATH`, `GIT_EDITOR`, `GIT_PAGER`, and an unrelated secret), `:133-135` (identity, `PATH` and `HOME` are kept) |
| A hostile `GIT_DIR`, work tree and index do not redirect the runner | `:147-151`: HEAD, top level, object format and blob all come from the working directory's repository |
| Hostile `GIT_CONFIG_*` inject no configuration | `:165-167`: `user.name`, `user.email` and `core.hooksPath` are not the injected values |
| A hostile `GIT_EXEC_PATH` and pager do not reach git | `:177-178` |
| A worktree operation is unaffected | Create, gate, atomic commit and cleanup with anchoring, in both object formats: `:210-223`; the gate child sees no `GIT_DIR`; the commit carries the repository's identity, not the injected one `:214`; the other repository is untouched after each step `:115-118` |
| Git still finds what it needs | The commit identity is taken from `~/.gitconfig` under `HOME`, from `$XDG_CONFIG_HOME/git/config`, and from the identity variables, with no identity in the repository: `:272-273` (three cases) |

Commit identity at `NodeAtomicGitCommitAdapter#commitAtomic`
(`git commit --no-verify --no-gpg-sign -m …`): the adapter never set an
identity and still does not. Git resolves it as before from repository,
global or system configuration, or from the four identity variables. `HOME`
passes through when it is set; when it is intentionally absent, git has no
global configuration, exactly as before this change.

### Discrimination (disposable copy)

Unmutated copy: 9 pass, 0 fail.

| Mutation in the copy | Failing cases |
| --- | --- |
| E1 — the runner passes no `env` (git inherits) | 5 fail: the `GIT_DIR`, `GIT_CONFIG_*` and `GIT_EXEC_PATH` cases and the hostile worktree case in both formats |
| E2 — `GIT_DIR` is added to the admitted variables | 4 fail: the allow-list case, the `GIT_DIR` case and the hostile worktree case in both formats |
| E3 — the identity variables are dropped | 2 fail: the allow-list case and "identity from the identity variables" |
| E4 — `XDG_CONFIG_HOME` is dropped | 2 fail: the allow-list case and "identity from the configuration under XDG_CONFIG_HOME" |
| E5 — `HOME` and `USERPROFILE` are dropped from `safeEnvironment` | 2 fail: the allow-list case and "identity from the configuration under HOME" |

### Tests replaced

None deleted. The existing gate-runner environment cases in
`tests/integration/gate-commit-adapters.test.mjs` pass unmodified against the
moved `safeEnvironment`.

### Guardrails

- Complexity: no baseline entry changed; `gitEnvironment` and
  `safeEnvironment` are below the target.
- Census: no file gained or lost `JSON.stringify` or `createHash`.
- Citations fixed: `.specs/features/platform-qualification-matrix/matrix.md`
  (`gate-commit-adapters.ts` lines moved by the extraction).
- `docs/quick-start.md` states the scrub under "What you need".

### Open points for the reviewer

- **Platform matrix.** The scrubbed environment was run on macOS arm64 with
  Apple Git 2.50.1 only. Linux and Windows are expected to behave the same
  (`PATH`, `PATHEXT`, `SystemRoot`, `WINDIR`, `TEMP`, `TMP`, `USERPROFILE` are
  kept), but that is unproven until the platform matrix runs.
- **Variables deliberately dropped.** `EMAIL` (git's fallback address),
  `GIT_SSH_COMMAND`, `GIT_ASKPASS`, `LANG` and `LC_*` no longer reach git. The
  task path runs no network git command and parses no localized output.
- `TaskRunComposition#release` still swallows every cleanup error. It was
  outside this task's brief and is unchanged.

### Gates at the tip of the branch (Node 24.14.0, macOS arm64, git 2.50.1)

| Command | Result |
| --- | --- |
| `node --test tests/integration/task-worktree-git-environment.test.mjs` | PASS — 9 passed |
| `pnpm gate:quick` | PASS — unit 2365, agent-readiness 315, census 13 |
| `pnpm test:architecture` | PASS — 66 |
| `pnpm gate:build` | PASS — unit 2365, contract 666, integration 835, e2e 230, architecture 66, build 140, qualification 272 |
| `pnpm gate:security` | PASS — unit 2365, contract 666, e2e 230, architecture 66, qualification 272, security 1333, fault 310 |
| `pnpm test:e2e` | PASS — 230 |
| `node --test tests/integration/git-worktree-adapter.test.mjs tests/integration/gate-commit-adapters.test.mjs tests/integration/task-branch-anchoring.test.mjs` | PASS — 23 passed, unmodified |
| `pnpm agent:check` | PASS |
| `pnpm site:check` | PASS — 50 (the `docs/quick-start.md` projection) |

No test was skipped in any stage. `pnpm site:test` built the site and passed
its built-site check (135 pages, links and metadata valid); its Playwright
stage did not start because another process on the machine held the preview
port, so it is not counted as a result here.
