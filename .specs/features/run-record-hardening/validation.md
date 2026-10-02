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

## T3 — the five markers are sealed (RRH-11..19)

`task plan` writes `markerSeal: 1` into the plan record of a new run
(`MARKER_SEAL` in `task-plan-record.ts`, stamped in `task-plan.ts`). The Run
record reads the form from the stored plan record (`RunRecord##sealsMarkers`)
and writes and reads the five markers through `##writeMarker` and `##marker`,
with the seal of `task-files.ts` for a sealed Run and as plain canonical JSON
for a legacy one. `RunRecord#activeProcess` answers a process ID, `undefined`,
or `"unverified"`.

### The two markers a user's ability to stop a run depends on

| Marker | What a marker that does not verify means | Why this is fail-closed and still cancellable |
| --- | --- | --- |
| `active.json` (sealed Run) | A driver nobody can name. `start` and `resume`: `VES_TASK_RUN_ACTIVE`. `status`: driven, with `cancel` as the only action. `cancel`: writes the request, waits the minute it waits for a live driver, then clears the marker and ends the run as an idle one | "Nobody drives the run" is the fail-open answer: a second driver could start, and a cancel would remove the worktree under a live one. An error on every command is a run nobody can cancel. Counting it as a driver refuses the second driver and still leaves `cancel` a way to end the run. The wait gives a driver that is in fact alive the time to answer the request and release its marker; a marker that verifies and names a live process is never cleared |
| `cancel.json` (both forms) | A request to stop, whatever it holds | The marker can only say "stop". Honouring one that would not verify can only end a run; refusing it would let an edit keep a run going that its user asked to end. The record is sealed like the others, and no decision reads it |

A legacy Run keeps its own rule for `active.json` (a marker that cannot be
read names no live process), so a run in flight resumes and cancels as it did.

An idle `cancel` of a sealed Run whose **worktree** marker does not verify
still stops before the abort is recorded (`VES_TASK_STATE_INVALID`). That is
the rule an unreadable worktree marker already had, kept on purpose: the
command will not report a stop that left the worktree behind. Nothing is
running in that state.

### Requirement evidence

`K` is `tests/unit/task-run-markers.test.mjs`, `M` is
`tests/integration/task-marker-commands.test.mjs`, `L` is
`tests/architecture/task-run-record-locality.test.mjs`, `E` is
`tests/e2e/task-cli-e2e.test.mjs`, `U` is the ADP-2 suite
`tests/unit/task-run-record.test.mjs`. Every expected digest in `K` is
computed from the declared V2 canonical contract and SHA-256, never with the
module under test. `M` calls `statusTask`, `cancelTask` and `reviewTask` on a
real Workspace on every platform; the one-minute cancel wait is advanced with
the test runner's mock timers.

| Requirement | Definition (symbol) | Assertion evidence |
| --- | --- | --- |
| RRH-11 the plan record names the seal; a legacy plan keeps its bytes | `MARKER_SEAL`, `sealsMarkers`, `planTask` | A plan without the member keeps the ADP-2 golden `e6c97cd7…d0272f` `K:169-173` (and `U:162-165`, unmodified); a plan with it `34b00af7…137eca` `K:176-180`. A seal this build does not know (six values) is refused for the plan and for every marker `K:189-192`. `task plan` stamps it: `L:166`, and through the real binary `E:1057` |
| RRH-12 sealed writes for a sealed Run, plain for a legacy Run | `RunRecord##writeMarker` | Golden text and file digest of the grant and worktree markers, plain `K:84-91` and sealed `K:99-113`; the seal is the canonical digest of the canonical record `K:104`. Active, cancel and outcome: the envelope and its digest `K:146-147`, over the same members a legacy Run writes plain `K:156-163`. The form is read from the stored plan by a Run record that never loaded it `K:202-207`. Every marker write asks the form `L:168-171`. Through the real binary, on disk: `E:1093`, `E:1103`, `E:1140`, `E:1145` (checked by `E:1067-1072`) |
| RRH-13 a sealed Run refuses an edited marker and a plain one (no downgrade) | `RunRecord##marker`, `sealedRow` | One tamper case per read marker (grant, worktree, outcome): an edited record `K:246-247`, a replaced digest `K:249`, intact again `K:251`. One downgrade case per read marker: the exact plain file a legacy Run holds is refused `K:261-262`, and a legacy Run reads it `K:266-267`. A sealed record without the member its reader needs `K:273`. At the commands: `status` `M:146`, `M:148`, `M:154`; idle `cancel` `M:137-138`. Through the real binary: `status` and `review` refuse a grant marker replaced by its plain form `E:1182-1194` and accept it once restored `E:1196-1197` |
| RRH-14 a legacy Run reads and writes as before | the legacy branch of `##marker`, `##writeMarker`, `activeProcess` | The ADP-2 suite passes unmodified, including the plain goldens `U:98-108`, `U:232-234`, `U:253-273` and the active marker rule `U:625-649`. `K:266-267`, `K:312-314`, `M:122-129`, `M:158`. The journeys on a legacy fixture (the plan record this build wrote, without the member, sealed again): interrupted and resumed `E:1092-1110`, cancelled when idle `E:1119-1126`, cancelled while running `E:1139-1149`, each with its markers plain on disk |
| RRH-15 the Run Capsule binds the digest of the grant record | `RunRecord#loadGrant`, `capsuleInput` | The reader returns `{ grantId }` in both forms and its digest is the ADP-2 golden `383c2a3c…9d0473` `K:126-127`; in the sealed form that digest is the seal in the file `K:131`. The existing golden `U:103-107` passes unmodified. Through the real binary, the sealed capsule of a legacy and of a sealed Run carries `grant:<id>` with the canonical digest of `{ grantId }` `E:1108-1110` |
| RRH-16 an active marker that does not verify counts as a driver | `RunRecord#activeProcess`, `claimActive`, `cancelTask` | Tamper: an edit that names a dead process is `"unverified"` and a second driver is refused `K:288-290`. Downgrade: a plain marker is not believed, whatever process it names `K:307-308`. Unreadable, outside the envelope, or sealing no process ID `K:322`, `K:326`; a marker that verifies and names a dead process is nobody `K:330`. `status` shows the run as driven with only `cancel` `M:69-70`. `cancel` asks, waits, clears, aborts `M:78-82`, also for a plain replacement `M:89-91`. A live driver that has not stopped is never aborted or cleared, in both forms `M:103-106`; one that released its marker is reported stopped `M:117-118`. Through the real binary: `status` and `resume` under a downgraded active marker `E:1174-1176`, and the resume succeeds once it is restored `E:1179` |
| RRH-17 a cancel marker is a request in any form | `RunRecord#cancelRequested`, `requestCancel` | Tamper and downgrade for the cancel marker: edited, plain, not JSON, empty are all a request `K:348`, and the request stands `K:350`; claiming the run clears it `K:353`. The running driver is stopped by a sealed and by a plain request `E:1142-1149` |
| RRH-18 `review` reads the grant before it records anything | `reviewTask` | `M:172-176`; the read is before the review surface `L:178-180`; through the real binary `E:1188-1194` |
| RRH-19 the design and the threat model say what is true | — | `.specs/features/governed-task-cli/design.md` (the paragraph and table on the five markers), `threat-model.md` (two rows and two residual risks) |

### Behaviour changes a user of `vestra task` could notice

For a run planned by this build (a sealed Run):

- The five marker files hold `{"digest":…,"record":…}` instead of the bare
  record.
- `status` stops with `VES_TASK_STATE_INVALID` when the grant or outcome
  marker was edited or replaced by a plain one. Before, it printed what the
  file held.
- `review` stops with the same code, before anything is recorded, when the
  grant marker does not verify. This read also moved earlier for a legacy
  Run, whose unreadable grant marker used to fail the command after the
  review was recorded.
- A `start` or `resume` that reaches the implementer with a grant marker that
  does not verify fails the run with `VES_TASK_STATE_INVALID`. Before, a
  marker without a grant ID caused a second grant to be issued.
- An active marker that does not verify makes `status` show the run as
  active, makes `start` and `resume` report `VES_TASK_RUN_ACTIVE`, and makes
  `cancel` take up to a minute before it ends the run. Before, such a marker
  counted as no process.
- An idle `cancel` stops with `VES_TASK_STATE_INVALID` when the worktree
  marker was edited. Before, only a marker that could not be read did that.
- A build older than this one cannot drive a sealed Run: it would read the
  markers as plain and write plain ones back, which this build refuses.

For a run planned before this build (a legacy Run) nothing changes except the
earlier grant read in `review`.

### Tests replaced

No case was deleted and no existing case was changed. The ADP-2 suite is not
in the diff. The journeys and the locality cases were appended to their
files. `tests/helpers/task-cli-fixture.mjs` gained `planRecord`,
`asLegacyRun` and `recordDigest` on the fixture it returns.

### Discrimination (disposable copy)

Unmutated copy: `K`, `M`, `U`, `L` and the containment suite, 144 pass, 0
fail; the seven form journeys of `E`, 7 pass.

| Mutation in the copy | Failing cases |
| --- | --- |
| S1 — a sealed Run writes its markers plain | 14, including the sealed goldens `K:95`, `K:121`, `K:134`. Four of the form journeys fail too |
| S2 — a sealed Run believes a plain marker (the downgrade) | 12: the three downgrade cases `K:256`, the three tamper cases `K:241`, the three member cases, `M:133`, `M:141`, `M:164` |
| S3 — every run is read as a legacy Run | 23. Three form journeys fail too |
| S4 — every run is read as a sealed Run | 17, including the ADP-2 goldens `U:98`, `U:178`, `U:253` and `K:80`. The legacy resume and running-cancel journeys fail too |
| S5 — the grant reader returns the seal envelope | 8, including `K:121`. The sealed resume journey fails at the capsule's grant digest |
| S6 — a sealed active marker that does not verify reads as no process | 6: `K:281`, `K:303`, `K:317`, `M:64`, `M:73`, `M:85`. The downgrade journey fails too |
| S7 — a sealed active marker that seals no process ID reads as no process | 1: `K:317` |
| S8 — `cancel` ends such a run at once, without asking or waiting | 2: `M:73`, `M:85` |
| S9 — `cancel` never ends such a run | 2: `M:73`, `M:85` |
| S10 — `cancel` ends a run under a live driver that has not stopped | 2: `M:98` in both forms |
| S11 — `cancel` leaves the marker that did not verify in place | 2: `M:73`, `M:85` |
| S12 — a sealed Run honours only a cancel marker that verifies | 1: `K:336` |
| S13 — an unknown marker seal is read as a legacy Run | 1: `K:183` |
| S14 — `task plan` does not name the marker seal | 1: the locality case `L:156`. All seven form journeys fail |
| S15 — `review` reads the grant marker after the review is recorded | 2: `M:164` and the locality case `L:176` |
| S16 — a sealed record is returned without checking its member | 3: `K:270` for each marker |
| S17 — a legacy Run's unreadable active marker counts as a driver | 47, including the ADP-2 cases `U:275`, `U:625` |
| S18 — claiming a run keeps a cancel request | 2: `K:336`, `U:651` |
| S19 — the form is taken from the marker's own shape | 4: the three downgrade cases `K:256` and `M:141` |

### Guardrails

- Complexity: no baseline entry changed; no new function is above 10.
- Census: `pnpm census:refresh` left the inventory as it was (115 entries); no
  product source gained or lost `JSON.stringify` or `createHash`.
- Citations: `.specs/features/architecture-deepening/validation-c5.md` cites
  the line that composes the Human Review coordinator; it is now
  `task-review.ts:265`. `:172-198` did not move, and neither did the cited
  lines of `task-status.ts`.
- No error code was added. Migration count (12), runtime error catalog count
  (19) and task error catalog count (10) unchanged.
- Bytes and paths of every artifact that is not one of the five markers are
  unchanged: the ADP-2 suite, its goldens included, is not in the diff and
  passes.

### Gates (Node 24.14.0, macOS arm64, git 2.50.1)

| Command | Result |
| --- | --- |
| `node --test tests/unit/task-run-markers.test.mjs tests/integration/task-marker-commands.test.mjs tests/integration/task-run-containment.test.mjs tests/unit/task-run-record.test.mjs tests/architecture/task-run-record-locality.test.mjs tests/integration/task-workspace-containment.test.mjs tests/integration/task-review-package.test.mjs tests/integration/task-review-surface.test.mjs tests/integration/task-run-checkpoints.test.mjs tests/integration/task-commit-recovery.test.mjs tests/integration/task-idle-cancel.test.mjs` | PASS — 212 passed |
| `pnpm gate:quick` | PASS — unit 2504, agent-readiness 323, census 13 |
| `pnpm test:architecture` | PASS — 90 |
| `pnpm gate:build` | PASS — unit 2504, contract 756, integration 1009, e2e 257, architecture 90, build 146, qualification 302 |
| `pnpm gate:security` | PASS — unit 2504, contract 756, e2e 257, architecture 90, qualification 302, security 1339, fault 310 |
| `node --test tests/e2e/task-cli-e2e.test.mjs tests/e2e/mediated-task-execution-e2e.test.mjs` | PASS — 42 passed |
| `node --test tests/unit/task-cli-composition.test.mjs tests/security/task-cli-security.test.mjs` | PASS — 15 passed |
| `pnpm agent:check` | PASS |
| `pnpm site:check` | PASS — 50 (the `docs/quick-start.md` projection) |

No test was skipped in any stage.

## Open points for the reviewer

- **Platform matrix.** Every result here is from macOS arm64. The new suites
  run on every platform and have never run off macOS: the junction cases of
  `tests/integration/task-run-containment.test.mjs` on Windows, the mock-timer
  cases of `tests/integration/task-marker-commands.test.mjs` on Windows and
  Linux, and the first link journey of `tests/e2e/task-cli-e2e.test.mjs` on
  Linux and Windows. `platform-matrix.yml` must be green on each range before
  it merges.
- **The seal is not a signature.** See the residual risks in the governed
  task threat model.
- **A tampered plan record still stops `cancel`.** Every command reads the
  plan record first, `cancel` included, so a run whose plan record does not
  verify cannot be cancelled from another terminal; the terminal that runs it
  still stops it. That was so before this feature and is outside its three
  tasks.
- **An unverifiable active marker costs a minute.** `cancel` waits the full
  wait before it ends such a run. A shorter wait for that case is possible
  and was not chosen: a live driver in the middle of a gate needs the time.
