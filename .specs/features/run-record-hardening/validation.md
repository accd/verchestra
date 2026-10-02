# Validation — Run record hardening

Branch `fix/run-record-hardening`, one commit per task (T1, T2, T3), on base
revision `77c7b8e` (`origin/main`). Each section maps the requirements of its
task to the assertions that prove them. Sources are named by symbol, because
their lines move between the commits; assertions are cited by test file and
line.

Every gate result was measured on the tree of the commit it describes, on
base `a59ebc5`. The branch was then rebased onto `77c7b8e`, which adds one
commit that changes a single file of another feature's evidence
(`.specs/features/live-activation-matrix/validation.md`). After that rebase
`pnpm gate:quick`, `pnpm test:architecture` and `pnpm agent:check` were run
again on each of the three commits, and the whole set again at the tip; every
count is the one recorded below.

## T1 — review proves the Execution Package (RRH-01..03)

`reviewTask` in `apps/vestra-cli/src/task/task-review.ts` reads the Execution
Package through `RunRecord#approvedPackage` directly after the state check.
The package travels in the review context, and `capsuleInput` builds the Run
Capsule from it; the second, unchecked read is gone.

### Requirement evidence

`P` is `tests/integration/task-review-package.test.mjs`, `L` is
`tests/architecture/task-run-record-locality.test.mjs`, `E` is
`tests/e2e/task-cli-e2e.test.mjs`. `P` calls the command function on a real
Workspace (a repository, its identity file, a state root under a home that
belongs to the fixture) with a run in `HUMAN_REVIEW`. It needs no credential,
so it runs on every platform. With no task commit record, a review that gets
past the package stops at the review surface with
`VES_TASK_REVIEW_UNAVAILABLE`; that code is the proof that the package was
accepted.

| Requirement | Definition (symbol) | Assertion evidence |
| --- | --- | --- |
| RRH-01 the checked reader, the one `approve` uses | `reviewTask`, `ReviewContext#pkg`, `capsuleInput` | The bound package is accepted and the review goes on `P:45`; `task-approve.ts` and `task-review.ts` both call `approvedPackage(plan)` `L:126-127`. Through the real binary the restored package completes the review and seals the capsule `E:938` |
| RRH-02 refused before the surface, the confirmation, a credential, the record, or a transition | `RunRecord#approvedPackage` | Swapped for another sealed package `P:54`, damaged `P:56`, missing `P:58`, intact but not the payload the plan bound `P:70`. The run stays in `HUMAN_REVIEW` `P:60`, `P:71`, and the Run directory is as it was `P:62`. The refusal precedes the review surface: the fixture has no task commit record, and the code is the package's, not `VES_TASK_REVIEW_UNAVAILABLE`. Through the real binary: the public code and reason `E:928-929`, the state `E:931`, no review recorded `E:932`, `E:934`, no capsule `E:933`, `E:935` |
| RRH-03 no command calls the unchecked reader | `RunRecord#loadPackage` | `L:125` |

### Behaviour change

| Case at `task review` | Before (`origin/main`) | Now |
| --- | --- | --- |
| Package replaced by another sealed package, damaged, or missing | `VES_TASK_FAILED`, reason `VES_EXECUTION_PACKAGE_STORAGE_INTEGRITY`, raised while the Run Capsule was built: the review was already recorded, the run was `COMPLETED` (or `ABORTED` for a rejection), and no capsule existed | `VES_TASK_STATE_INVALID`, reason `VES_TASK_PACKAGE_INVALID`, before anything is recorded; the run stays in `HUMAN_REVIEW` |
| Package ID that is not an artifact ID, or a linked package file | `VES_TASK_FAILED`, reason `VES_EXECUTION_PACKAGE_STORAGE_INVALID`, at the same late point | The same new refusal |
| Package intact, payload digest not the plan's `packageDigest` | No refusal; the capsule was sealed | The same new refusal |

The "before" row for a swapped package was observed, not inferred: the journey
`E:913` was run in a disposable copy whose `task-review.ts` had the base
revision's read (the store's reader, where the capsule is built). The command
exited 5 with `VES_TASK_FAILED` and reason
`VES_EXECUTION_PACKAGE_STORAGE_INTEGRITY`; `status` then showed `COMPLETED`,
`reviewOutcome: accepted`, `capsuleId: null`; `review.json` existed and
`capsules/` did not.

`docs/quick-start.md` (section 10) names the new refusal. It listed neither
of the old reasons.

### Tests replaced

No case was deleted and no existing case was changed. The journey and the
locality case were appended to their files, so no cited line of either moved.

### Discrimination (disposable copy)

A copy of `apps/vestra-cli` and `tests` in the ignored `.tmp/` directory was
mutated one change at a time and rebuilt from the tracked sources before each
run; the tracked sources were never mutated. Unmutated copy: `P` and `L`, 11
pass, 0 fail; the journey `E:913`, 1 pass.

| Mutation in the copy | Failing cases |
| --- | --- |
| D1 — `review` reads the package through the store's own reader, at the new place | 3: `P:48`, `P:68`, and the locality case `L:124`. The journey `E:913` fails too |
| D2 — the checked reader is called only where the capsule is built, after the review is recorded | 2: `P:48`, `P:68`. The journey `E:913` fails too |

### Guardrails

- Complexity: no baseline entry changed; no new function is above 10
  (`pnpm complexity:check` passes inside every gate).
- Census: no file gained or lost `JSON.stringify` or `createHash`.
- Citations: `.specs/features/architecture-deepening/validation-c5.md` cited
  `task-review.ts:258` for the line that composes the Human Review
  coordinator; it is now `:262`. `:172-198` did not move.
- No error code was added. Migration count (12), runtime error catalog count
  (19) and task error catalog count (10) unchanged.
- The ADP-2 suite `tests/unit/task-run-record.test.mjs` is not in the diff.

### Gates (Node 24.14.0, macOS arm64, git 2.50.1)

| Command | Result |
| --- | --- |
| `node --test tests/integration/task-review-package.test.mjs tests/architecture/task-run-record-locality.test.mjs tests/unit/task-run-record.test.mjs tests/integration/task-review-surface.test.mjs` | PASS — 70 passed |
| `pnpm gate:quick` | PASS — unit 2484, agent-readiness 323, census 13 |
| `pnpm test:architecture` | PASS — 87 |
| `pnpm gate:build` | PASS — unit 2484, contract 756, integration 950, e2e 246, architecture 87, build 146, qualification 302 |
| `pnpm gate:security` | PASS — unit 2484, contract 756, e2e 246, architecture 87, qualification 302, security 1339, fault 310 |
| `node --test tests/e2e/task-cli-e2e.test.mjs tests/e2e/mediated-task-execution-e2e.test.mjs` | PASS — 31 passed |
| `node --test tests/unit/task-cli-composition.test.mjs tests/security/task-cli-security.test.mjs` | PASS — 15 passed |
| `pnpm agent:check` | PASS |
| `pnpm site:check` | PASS — 50 (the `docs/quick-start.md` projection) |

No test was skipped in any stage.

## T2 — containment below a per-Run root (RRH-04..10)

`requireRealDirectories` in `apps/vestra-cli/src/task/task-workspace.ts` walks
the directories below a task state root with `lstat` and refuses the first
that is a link. The Run record reaches every path through `RunRecord##file`
and `RunRecord##directory`, which run it immediately before each read and
write; the verifier reaches each scratch checkout through `scratchDirectory`.
`writeJsonAtomic` in `task-files.ts` refuses to replace anything that is not a
regular file.

### The error codes, and why

| Position of the link | Code | Why |
| --- | --- | --- |
| The Run directory, a directory inside it, `verification/<runId>`, or a directory below it | `VES_STATE_ROOT_ESCAPE` (platform security catalog, no safe detail) | Everything below a linked directory is redirected, which is the escape the root check of ADP-2 refuses. The code is public already, and its recovery text is to remove the link, which is the action that helps. `VES_TASK_STATE_INVALID` tells the user to plan a new run. |
| The path of one artifact | `VES_TASK_STATE_INVALID`, reason `VES_TASK_STATE_UNREADABLE` | Nothing is read or written through it, so it is not an escape. A reader already refused it with this reason and the ADP-2 suite pins that for nine readers (`tests/unit/task-run-record.test.mjs:346-350`); a writer now gives the same reason instead of replacing the link. One position, one code. |

Below a root any link is refused, also one that resolves inside the Workspace
state root. The roots themselves keep the rule of ADP-2, which accepts such a
link.

### Requirement evidence

`C` is `tests/integration/task-run-containment.test.mjs`, `L` is
`tests/architecture/task-run-record-locality.test.mjs`, `E` is
`tests/e2e/task-cli-e2e.test.mjs`, `U` is the ADP-2 suite
`tests/unit/task-run-record.test.mjs`. Every link in `C` targets a directory
and is created as a junction, so each case asserts the same on Windows as on
POSIX; nothing in `C` is skipped on any platform. The link always leads to a
complete, valid Run directory (`C:248-253`), so a read that followed it would
succeed and the refusal can only come from the link.

`C` iterates fifteen artifact families (`FAMILIES`): the plan record, the
context manifest, the Execution Package, gate evidence, the task commit
record, attempt records, the verification report, lessons, the review record,
the Run Capsule, and the five markers. For each it calls every operation of
the Run record's interface that reads, writes, or removes that family.

| Requirement | Definition (symbol) | Assertion evidence |
| --- | --- | --- |
| RRH-04 a linked Run directory | `RunRecord##file`, `##directory` | Every operation of every family is refused `C:263`; the link's target is byte for byte as it was `C:264`; nothing was created beside the link `C:265`; the link was not replaced `C:266` (15 cases) |
| RRH-04 a linked directory inside the Run directory | the same | `packages`, `gate-evidence`, `attempts`, `verification` (for the report and for lessons), `verification/lessons`, `capsules`: `C:279-281` (7 cases). A linked `packages` is an escape, not a damaged package: the case for the Execution Package calls `approvedPackage` |
| RRH-04 the walk itself | `requireRealDirectories` | A link at the first, second and third directory `C:360`; a link whose target is gone `C:365`; a file in a directory's place is left to its reader `C:369`, as `U:352-355` requires |
| RRH-05 a link in the place of an artifact | `readJsonFile`, `requireReplaceable` in `task-files.ts` | A reader refuses it `C:295` (unchanged; also `U:346-350` for a link to a file on POSIX); a writer refuses it `C:297`; the link is still a link `C:298`, its target is unchanged `C:299`, and no temporary file is left `C:300` (12 cases). A link to a file, POSIX: `C:312-314`. A directory in the artifact's place `C:340-341`. The package and capsule stores keep their own refusal `C:331-334` |
| RRH-06 a cancel request that is present stands | `RunRecord#requestCancel` | With a link in the marker's place the request is reported `C:175` and `requestCancel` succeeds without writing `C:176`, `C:298` |
| RRH-06 a driver that cannot read its cancel state stops | `watchCancellation` in `task-run.ts`, `RunRecord#cancelRequested` | A run nobody cancelled runs on `C:457`; a request stops it `C:459`; a Run directory that became a link stops it `C:467`; a Run directory that cannot be searched (POSIX) makes the reader reject `C:477` and stops it `C:479` |
| RRH-07 verification's scratch root | `scratchDirectory` in `task-verifier.ts` | A link at `verification/<runId>` and at the checkout: refused `C:387-391`, and the files behind the link survive `C:392`. Through the real binary: the run fails with the code `E:1020-1021`, the directory behind the link is as it was `E:1022`, the verifier never started `E:1023` |
| RRH-08 the checks only read | `requireRealDirectories` | A path that does not exist passes and nothing is created `C:347`, `C:350`. The ADP-2 laziness cases pass unmodified (`U:275-295`), and so do the dry-run cases of `tests/integration/task-workspace-containment.test.mjs` and `E:676-687` |
| RRH-09 the six commands | `approveTask`, `runTask`, `statusTask`, `cancelTask`, `reviewTask` | In process, on every platform, with a valid plan behind the link: refused `C:422`, the run did not move `C:423`, nothing changed behind the link `C:424` (6 cases). Through the real binary on macOS and Linux: `E:982-983`; on Windows each command is refused for the platform `E:980-981` and nothing changes behind the junction `E:983`. A real planned run moved behind a link: refused `E:998`, untouched `E:999-1000`, and it runs once moved back `E:1003`. A link inside the Run directory fails the run with nothing written through it and no task commit `E:1039-1042` |
| RRH-10 one definition | `requireRealDirectories` | No other task source raises the code `L:136`; the Run record builds a path only in its two checked functions `L:137-143`; the verifier only in its one `L:145-150` |

### Behaviour changes

- A run whose directory under `tasks/` or `verification/`, or a directory
  inside it, is a link is refused with `VES_STATE_ROOT_ESCAPE` by every
  command that reaches it. Before, the link was followed. During a run the
  refusal becomes the run's failure reason.
- A link, or a directory, in the place of a state file a command writes is
  refused with `VES_TASK_STATE_INVALID` (`VES_TASK_STATE_UNREADABLE`). Before,
  a link was replaced by the atomic rename and a directory failed in the
  rename with `VES_TASK_FAILED` (`VES_TASK_INTERNAL`). This also covers the
  evidence trust anchor under `keys/`, which is written by the same function.
- `task cancel` no longer rewrites a cancel marker that is already present.
- A run stops when its driver cannot tell whether a cancel was requested.
  Before, any failure to inspect the marker counted as no request.
- `docs/quick-start.md` states the first two under the limits.

### Tests replaced

No case was deleted and no existing case was changed. The ADP-2 suite is not
in the diff. The journeys and the locality case were appended to their files;
one import line of `tests/e2e/task-cli-e2e.test.mjs` gained a name in place.
`tests/helpers/task-command-fixture.mjs` now installs the credential deny
guard: a command that got past the refusal a case expects would go on to read
a credential, and with the guard that attempt throws before the OS credential
tool is started.

### Discrimination (disposable copy)

Unmutated copy: `C`, `U`, `L` and the workspace containment suite, 132 pass, 0
fail; the four link journeys of `E`, 4 pass.

| Mutation in the copy | Failing cases |
| --- | --- |
| M1 — a link below a task state root is not refused | 31: every Run directory and inner directory case, the six commands, the walk, the verifier, the watcher. All four journeys of `E` fail too |
| M2 — only the Run directory is checked, not the directories inside it | 7: every inner directory case |
| M3 — a file of the Run directory is reached without the check | 21 |
| M4 — a store directory is reached without the check | 6: the package, capsule and gate evidence cases |
| M5 — a write replaces whatever is in the artifact's place | 13: the twelve link cases and the directory case |
| M6 — a write refuses only a link, not a directory | 1: `C:337` |
| M7 — a cancel request is written over a marker that is already there | 1: the cancel marker case |
| M8 — the driver ignores a cancel request it cannot read | 1: `C:453` |
| M9 — verification reaches its scratch root without the check | 2: `C:375` and the locality case. The scratch journey of `E` fails too |
| M10 — verification checks only the run's scratch root, not the checkout | 1: `C:375` |
| M11 — the link check creates the directories it inspects | 3: `C:344` and the two ADP-2 cases `U:178`, `U:275` |
| M12 — the link check follows links instead of inspecting them | 31 |
| M13 — a linked package directory is reported as a damaged package | 2: the two Execution Package cases |
| M14 — an active marker behind a link reads as no live process | 1 |
| M15 — a cancel request behind a link reads as no request | 2 |
| M16 — the verifier joins its scratch root by hand | 2 |
| M17 — the Run record raises the refusal itself | 1: the locality case |
| M18 — a cancel state that cannot be read counts as no request | 1: `C:453` |

### Guardrails

- Complexity: no baseline entry changed; no new function is above 10.
- Census: `pnpm census:refresh` left the inventory as it was (115 entries); no
  product source gained or lost `JSON.stringify` or `createHash`.
- Citations fixed for the lines this task moved:
  `.specs/features/live-task-pilot/validation.md` (`task-run.ts:553-554` is
  now `:558-559`, `:589-591` is now `:594-596`; `task-verifier.ts:60` is now
  `:66`), `.specs/features/architecture-deepening/validation-c5.md`
  (`task-verifier.ts:194-223` is now `:200-229`) and `validation-c6.md`
  (`task-run.ts:327`, which was already stale at the base, is now `:331`).
- No error code was added. Migration count (12), runtime error catalog count
  (19) and task error catalog count (10) unchanged.

### Gates (Node 24.14.0, macOS arm64, git 2.50.1)

| Command | Result |
| --- | --- |
| `node --test tests/integration/task-run-containment.test.mjs tests/unit/task-run-record.test.mjs tests/architecture/task-run-record-locality.test.mjs tests/integration/task-workspace-containment.test.mjs tests/integration/task-review-package.test.mjs tests/integration/task-review-surface.test.mjs tests/integration/task-run-checkpoints.test.mjs tests/integration/task-commit-recovery.test.mjs tests/integration/task-idle-cancel.test.mjs` | PASS — 179 passed |
| `pnpm gate:quick` | PASS — unit 2484, agent-readiness 323, census 13 |
| `pnpm test:architecture` | PASS — 88 |
| `pnpm gate:build` | PASS — unit 2484, contract 756, integration 998, e2e 250, architecture 88, build 146, qualification 302 |
| `pnpm gate:security` | PASS — unit 2484, contract 756, e2e 250, architecture 88, qualification 302, security 1339, fault 310 |
| `node --test tests/e2e/task-cli-e2e.test.mjs tests/e2e/mediated-task-execution-e2e.test.mjs` | PASS — 35 passed |
| `node --test tests/unit/task-cli-composition.test.mjs tests/security/task-cli-security.test.mjs` | PASS — 15 passed |
| `pnpm agent:check` | PASS |
| `pnpm site:check` | PASS — 50 (the `docs/quick-start.md` projection) |

No test was skipped in any stage.
