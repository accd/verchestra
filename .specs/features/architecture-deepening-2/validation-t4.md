# Validation T4 — one worktree resolution, the scratch checkout in the worktree module, one gate verdict (ADR2-4)

Task T4 of the second architecture deepening round, requirement ADR2-4: the
worktree handle SHALL be resolved in one place; the scratch checkout of the
verifier SHALL be owned by the worktree module; the gate verdict SHALL be
decided once. Source: the architecture review of `main` at `9eb2881`, card 5.
Branch `refactor/worktree-resolution-and-child-run`, based on `main` at
`2651fa0`. The decision is the entry "AD-066 — One
resolution of a worktree handle, the scratch checkout in the worktree module,
and one gate verdict (ADR2-4)" in `.specs/STATE.md`.

## 1. The friction, verified at the base

The card predates #486 (the task-path rule moved to
`packages/domain/src/primitives/task-path.ts`, AD-058), which did not touch
these lines. At `2651fa0`:

- **Two resolutions.** The worktree adapter resolved a handle in
  `git-worktree-adapter.ts:302-325` (`#resolveHandle`, `#targetFromRef`) on
  roots qualified at `:316-347` and a target checked at `:361-368`. The gate
  and commit adapters resolved it again in `gate-commit-adapters.ts:41-68`
  (`targetFromRef`, called at `:137`, `:261`, `:273`).
- **Containment that differed.** `git-worktree-adapter.ts:55-58` refused the
  root itself; `gate-commit-adapters.ts:36-39` admitted it. The gate copy
  never qualified the repository root (realpath, non-bare) or compared the
  worktrees root with it, and only the gate runner asked Git whether the
  directory was registered (`:139-143`); the commit adapter's `reconcile` ran
  `git rev-parse HEAD` in whatever directory the handle named.
- **The scratch checkout in the composition root.** `task-git.ts:21-30`
  added and removed verification's checkouts, with the Git removal and the
  prune swallowed (`:22`, `:24`). The mutation sensor derived the checkout's
  directory name itself (`task-verifier.ts:93-96`) and passed that name as a
  handle ID (`:143`, `scratchWorktreeHandle`, `git-worktree-adapter.ts:81`).
  The sensor was a private class (`:82-148`) that only an end-to-end journey
  could exercise.
- **Two verdicts.** `gate-commit.ts:433-445` (the gate) required a summary
  whose parts add up to its total and no cancelled or todo test;
  `task-verifier.ts:71-75` (the mutation sensor) did not, and passed a
  test-summary gate that returned no summary.

## 2. What each caller does now

| Caller | Before | Now |
| --- | --- | --- |
| Worktree adapter `inspect`, `resolvePath`, `cleanup` | its own `#resolveHandle`/`#targetFromRef` and root qualification | `resolveWorktreeHandle` (`task-worktree.ts:322`); refusals answered with its codes (`git-worktree-adapter.ts:65`, `:72`); `cleanup` treats `unregistered` as already clean (`:233-248`) |
| Worktree adapter `create`, `cleanupAtCommit` | its own root qualification and target check | `qualifiedWorktreeRoots` (`task-worktree.ts:268`), `worktreeDirectory` (`:254`), `assertWorktreeDirectory` (`:263`) |
| Gate runner `run` | `targetFromRef`, then its own registration listing | `resolveWorktreeHandle`; refusals answered with `VES_GATE_ADAPTER_*` (`gate-commit-adapters.ts:42`, `:51`); keeps one rule of its own: HEAD at the handle's commit (`:138`); the working-directory check uses the module's `isWithinDirectory` (`:143`) |
| Commit adapter `reconcile`, `commitAtomic` | `targetFromRef`, no registration check | `resolveWorktreeHandle` bound to the request's base (`:316`), through its own Git runner so a Git failure keeps `VES_GATE_GIT_COMMAND_FAILED` |
| Mutation sensor | `addDetachedWorktree`/`removeWorktree`, its own directory name, `scratchWorktreeHandle`, its own verdict | `task-mutation-sensor.ts:33`: `scratchCheckouts` (`:44`), `withScratchCheckout` with a stable name (`:47-54`), the checkout's handle, `taskGateVerdict` (`:90`) |
| Verifier review checkout | `addDetachedWorktree`/`removeWorktree` around the whole verification | `withScratchCheckout` around the Codex session only (`task-verifier.ts:194-223`) |
| Gate coordinator | private `gatePassed` | `taskGateVerdict` (`gate-commit.ts:448`, used at `:491`) |

The worktree module's one resolution, in order: the handle is read and bound
to a base before any effect (`task-worktree.ts:327-329`); the roots are
qualified (`:235-250`); the directory is joined below the canonical root and
is never the root (`:254-259`); Git must list it (`:300-303`); it must be a
real directory contained in its root (`:263-275`). The refusals are named
once (`:199`).

### Refusal → public code

| Refusal | Worktree adapter | Gate runner and commit adapter | Before (gate and commit) |
| --- | --- | --- | --- |
| `handle` | `VES_GIT_WORKTREE_INPUT_INVALID` | `VES_GATE_ADAPTER_HANDLE_INVALID` | same |
| `repository` (missing, bare) | `VES_GIT_WORKTREE_INPUT_INVALID` | `VES_GATE_ADAPTER_INPUT_INVALID` | not checked |
| `root` (link, not a directory, the repository) | `VES_GIT_WORKTREE_ESCAPE` | `VES_GATE_ADAPTER_PATH_ESCAPE` | same (link, not a directory) |
| `escape` | `VES_GIT_WORKTREE_ESCAPE` | `VES_GATE_ADAPTER_PATH_ESCAPE` | same |
| `unregistered` | `VES_GIT_WORKTREE_NOT_FOUND` (`cleanup`: nothing to do) | `VES_GATE_ADAPTER_HANDLE_INVALID` | runner: same; commit adapter: not checked |
| `missing` | `VES_GIT_WORKTREE_NOT_FOUND` (`inspect` and `resolvePath`: was `ENOENT`) | `VES_GATE_ADAPTER_HANDLE_INVALID` | `ENOENT` |

Each adapter keeps its existing codes; none is added or retired. The
messages are the module's; three gate-adapter messages read as the worktree
adapter's did ("Worktree reference is invalid", "... escaped its protected
root"). No message is public: the run records the code only
(`packages/application/src/execution/task-run.ts:125-128`).

## 3. ADR2-4, clause by clause

| Clause | Where it holds | Assertion evidence |
| --- | --- | --- |
| The handle is resolved in one place | `task-worktree.ts:322-339`, called by all three adapters | `tests/integration/task-worktree-resolution.test.mjs:58` (both object formats: canonical directory, HEAD, bound base), `:72` (not a handle or another base, refused before the worktrees root exists), `:84` (missing or bare repository), `:97` (linked root, root equal to the repository, with the message), `:117` (roots through a canonicalizing link), `:129` (unregistered, missing), `:140` (a registered directory replaced by a link) |
| One containment test | `isWithinDirectory`, `task-worktree.ts:251` | the gate adapters define none of their own (`gate-commit-adapters.ts` has no `relative`); the resolution cases above and the gate cwd check (`gate-commit-adapters.ts:143`) |
| Each adapter keeps its public code by mapping the refusal | `git-worktree-adapter.ts:65-85`, `gate-commit-adapters.ts:42-62` | `task-worktree-resolution.test.mjs:247` (six rows, each asking the worktree adapter, the gate runner and the commit adapter); `:253` (the gate runner's own rule) |
| The scratch checkout is owned by the worktree module | `git-worktree-adapter.ts:301-319` | `tests/integration/task-worktree-operations.test.mjs:141` (both formats: below the root, at the commit, registered during use, accepted by the gate runner, gone after), `:192` (a failing use: its error is reported and the checkout removed), `:207` (a leftover under the same name is replaced, not reused), `:252` (a commit that is not a complete object ID is refused before any effect) |
| A removal failure is reported, not swallowed | `git-worktree-adapter.ts:325-341` | `task-worktree-operations.test.mjs:223` (a locked checkout Git keeps registered: `VES_GIT_WORKTREE_COMMAND_FAILED`, "Scratch checkout is still registered after its removal"); `:235` (a link in the checkout's place: `VES_GIT_WORKTREE_ESCAPE`, nothing behind it deleted) |
| The mutation sensor is testable in a temporary repository | `task-mutation-sensor.ts` | `tests/integration/task-mutation-sensor.test.mjs:123` (four mutants: a reverted file its gate reads, a removed created file, a file no gate of its requirement reads, a todo test; killed or not, user checkout unmoved, no checkout or registration left), `:138` (a target outside the scope is refused and its checkout removed) |
| Nothing but the worktree adapter adds or removes a worktree | — | `tests/architecture/task-worktree-locality.test.mjs:75` |
| The gate verdict is decided once | `gate-commit.ts:433-455` | `tests/unit/task-gate-verdict.test.mjs:16`, `:27`, `:31`, `:48` (seven failing summaries), `:53`; the sensor uses it: `task-mutation-sensor.test.mjs:123` (the todo row) |
| Gate evidence digests unchanged | the coordinator's entry | `task-gate-verdict.test.mjs:77`: the passing run's gate evidence digest and idempotency key and four recorded entry digests, taken from the coordinator on `main` at `2651fa0` (script in the ignored `.tmp/`, run against the base files and the changed ones: identical) |

## 4. Behaviour changes, recorded

All are on paths a run meets only after a hand edit or a Git failure:

1. A scratch checkout Git keeps registered after its removal fails the run
   with `VES_GIT_WORKTREE_COMMAND_FAILED`; before, the removal's Git failures
   were swallowed and the checkout stayed registered in silence. When the
   use failed too, the removal's error is the one reported (a `finally`, as
   the base's `rm` failure already was).
2. A link at a scratch checkout's own entry is `VES_GIT_WORKTREE_ESCAPE`; it
   was `VES_STATE_ROOT_ESCAPE`. A link at or above the run's scratch root is
   still `VES_STATE_ROOT_ESCAPE` (`tests/integration/task-run-containment.test.mjs`
   and the e2e "a linked verification scratch root fails the run" pass
   unchanged).
3. A registered worktree whose directory is gone: `VES_GIT_WORKTREE_NOT_FOUND`
   from `inspect` and `resolvePath`, `VES_GATE_ADAPTER_HANDLE_INVALID` from the
   gate and commit adapters; it was a bare `ENOENT`, which the run recorded as
   `VES_TASK_RUN_FAILED`.
4. The gate and commit adapters refuse a missing or bare repository root, and
   the commit adapter a directory Git does not list.
5. A mutant whose gates end with a cancelled or todo test, a summary that
   does not add up, or no summary is killed; the gate refused to commit each.
6. The review checkout is below `verification/<run>/review/` and exists only
   during the verifier session. Nothing records its path.

## 5. Unchanged

- Error codes: none added or retired; the runtime error catalog stays at 19
  and the migrations at 12.
- Gate evidence: the entry's members, order and values are unchanged
  (section 3, last row). The mutation scratch directory is the one the
  sensor named before: `sha256("<mutationId>:<run>")`, first 32 hex digits.
- Complexity: `gate-commit-adapters.ts :: Async function 'targetFromRef'` (11)
  is gone; `gate-commit-adapters.ts :: Async method 'run'` went from 12 to 11
  and is ratcheted; no key is added.
- Census: `apps/vestra-cli/src/task/task-verifier.ts` no longer hashes and
  leaves the inventory; `packages/platform-node/src/git-worktree-adapter.ts`
  gains one digest signal (5 to 6, the scratch name). `pnpm census:refresh`
  and `pnpm test:census` pass.
- Citations fixed: `.specs/features/platform-qualification-matrix/matrix.md`
  (the two target-level checks are one, `task-worktree.ts:306`) and
  `.specs/features/architecture-deepening/validation-c1.md` (the 64-digit
  case moved to `:271-276`; the scratch handle row points at its
  replacement). Not rewritten: `docs/qualification/t59-validation.md`, a
  point-in-time qualification record whose cited lines are above the cases
  removed here; AD-043 item 3 in `.specs/STATE.md`, which the new entry
  supersedes for the scratch checkout.

## 6. Tests

Deleted case → replacement:

| Deleted | Replacement |
| --- | --- |
| `gate-commit-adapters.test.mjs` "the gate runner operates through a worktrees root reached by a canonicalizing link" | `task-worktree-resolution.test.mjs:117` (the gate runner's root handling is the module's); every gate case on macOS runs through `/var` → `/private/var` |
| `gate-commit-adapters.test.mjs` "the gate runner still refuses a worktrees root whose own entry is a link" | `task-worktree-resolution.test.mjs:97` (with the message) and `:247` `root` row (`VES_GATE_ADAPTER_PATH_ESCAPE` from the gate runner) |
| `task-worktree-operations.test.mjs` "a scratch checkout of a … commit gets a handle the gate runner accepts" (×2) | `task-worktree-operations.test.mjs:141` (×2) |
| `task-worktree-operations.test.mjs` "a scratch checkout whose directory name or commit cannot form a handle is refused" | `:252`; the name can no longer be wrong, the module derives the directory |

Edited, following the moved code (not weakened): `tests/architecture/task-path-locality.test.mjs`
now requires `isWithinTaskScope` of `task-mutation-sensor.ts`, where the
scope check moved; `tests/architecture/task-run-record-locality.test.mjs:135`
now requires the checked scratch path in `task-workspace.ts` and refuses
`.verificationRoot` in any other task source (the old form allowed two
mentions in the verifier). Added: `task-worktree-resolution.test.mjs` (15),
`task-gate-verdict.test.mjs` (12), `task-mutation-sensor.test.mjs` (5), five
scratch checkout cases, one architecture case.

Not deleted: the coordinator's verdict matrix in
`tests/e2e/gate-commit-negative.test.mjs:18-63` is a journey through the
coordinator (normalization, evidence, checkpoint, no commit) for each
variant; the verifier's verdict had no test of its own.

## 7. Discrimination

Each mutation was applied alone to the file in this worktree, the focused
suite run, and the file restored from Git (`.tmp/discriminate.py`).

| Mutation | Result |
| --- | --- |
| D1 the resolution skips the registration check | killed: 2 cases of `task-worktree-resolution` |
| D2 both escape tests of `assertWorktreeDirectory` removed | killed: 2 |
| D2' only the link test removed | survived: the realpath test refuses the same link (defense in depth) |
| D2'' only the realpath test removed | survived: the link test comes first, and a real directory below a canonical root cannot resolve elsewhere without a race; both tests were in both copies at the base |
| D3 the roots are qualified before the handle is read | killed: the refused-before-any-effect case |
| D4 the gate adapters answer `missing` as a path escape | killed: the `missing` row |
| D5 the gate runner drops its at-the-handle's-commit rule | killed: `:253` |
| D6 the verdict admits a todo test | killed: the unit todo row and the sensor's todo mutant |
| D7 the verdict passes a summary-less test gate | killed: the unit "no summary" row |
| D8 the sensor keeps a laxer verdict | killed: the sensor's todo mutant |
| D9 the removal stops judging its outcome | killed: the locked checkout case |
| D10 the checkout reuses a leftover | killed: the replaced-not-reused case |
| D11 the removal follows a link in the checkout's place | killed: the link case |
| D12 a checkout is not removed after its use | killed: 11 cases across the operations and sensor suites |
| D13 the CLI removes a worktree itself again | killed: `task-worktree-locality.test.mjs:75` |

## 8. Windows

The worktree adapter and the gate runner run there; `vestra task` itself is
refused (AD-049 item 7), but the integration suites run on the matrix.

- The resolution compares the same paths the worktree adapter already
  compared on every platform (T75 F3/F5): canonical roots from `realpath`,
  which resolves 8.3 short names, against Git's porcelain listing through
  `resolve`, which turns its forward slashes into backslashes. The gate runner
  made the same comparison at the base (`gate-commit-adapters.ts:142`).
- `lstat` reports a junction as a symbolic link, so a junction root or
  checkout is refused as on POSIX; every link in the new tests is created as
  a junction, which needs no privilege.
- `relative` across drives returns an absolute path, which
  `isWithinDirectory` refuses, as both copies did.
- The scratch removal keeps the base's order and its `rm` retries (3): a
  `git worktree remove` that fails because a gate's process still holds a
  file is recovered by the delete and the prune, and only a checkout Git
  still lists afterwards is reported. `git worktree lock` and `git init
  --bare` behave the same on Windows.

Confidence: high for the resolution and the verdict (no new platform
branch); medium for the removal's report under a Windows file lock that
outlasts `rm`'s retries, which failed the same way at the base (the `rm`
error was thrown then, too). The platform matrix decides.

## 9. Gates

Node 24.14.0, macOS arm64.
Per commit, the focused suites, `pnpm gate:quick` and `pnpm test:architecture`;
at the end of the range, on `5b6801e`:

| Command | Result |
| --- | --- |
| focused: `task-worktree-resolution`, `task-worktree-operations`, `task-mutation-sensor`, `task-gate-verdict`, `gate-commit-adapters`, `git-worktree-adapter`, `task-branch-anchoring`, `worktree-tool-adapter`, `task-worktree-git-environment`, `task-idle-cancel`, `task-run-containment`, `gate-commit`, `gate-commit-negative`, `task-path-case-variant-e2e` | PASS |
| `pnpm gate:quick` | PASS: unit 2637, agent-readiness 331, census 13 |
| `pnpm test:architecture` | PASS, 114 |
| `pnpm gate:build` | PASS: unit 2637, contract 797, integration 1118, e2e 275, architecture 114, build 172, qualification 337 |
| `pnpm gate:security` | PASS: unit 2637, contract 797, e2e 275, architecture 114, qualification 337, security 1324, fault 310 |
| `pnpm test:fault` | PASS, 310 |
| `pnpm test:build` | PASS, 172 |
| `node --test tests/e2e/task-cli-e2e.test.mjs tests/e2e/mediated-task-execution-e2e.test.mjs` | PASS, 46 |
| `pnpm agent:check` | PASS |

No test was skipped. The change touches the task path, so the platform
matrix runs on the branch before merge.
