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
