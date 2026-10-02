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
