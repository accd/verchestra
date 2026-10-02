# Validation — candidate C2 (ADP-2, Run record)

Branch `refactor/task-run-record`, three commits, one per task row (T2a, T2b,
T2c), on base revision `0158e48` (`origin/main` with subscription provider
authentication, C1 and C5 merged). Each section maps the requirement to the
assertions that prove it. Sources are named by symbol, because their lines
move between the three commits; assertions are cited by test file and line.
Every gate result was measured on the commit it describes.

## C2-1 (T2a) — one module for the Run directory

Owning module: `apps/vestra-cli/src/task/task-run-record.ts` (`openRunRecord`,
`RunRecord`). Consumers: `task-plan.ts`, `task-approve.ts`, `task-run.ts`,
`task-status.ts`, `task-review.ts`, `task-surface.ts`, `task-verifier.ts`. The
module reuses the seal and atomic write of `task-files.ts`, `TaskEvidenceStore`,
`FileExecutionPackageStore`, and `FileRunCapsuleStore`. No bytes, path, or
seal changes; one refusal is new (below).

### What the subscription work added to the Run directory

Nothing. `task-codex-identity.ts` keeps the Codex identity under
`<workspaceState>/codex-identity` and its status probe under
`<workspaceState>/sessions`; `task-provider-auth.ts` reads
`<workspaceState>/task-providers.json`; `task-budget.ts` writes no file. None
of them is under `tasks/<runId>/`, so none moved into the module.

### Requirement evidence

`U` is `tests/unit/task-run-record.test.mjs`, `S` is
`tests/integration/task-review-surface.test.mjs`, `L` is
`tests/architecture/task-run-record-locality.test.mjs`.

| ADP-2 clause | Definition (symbol) | Assertion evidence |
| --- | --- | --- |
| One module owns the layout | `LAYOUT`, `RunRecord`, `openRunRecord` | All fifteen artifacts written through the interface land at the recorded paths: `U:203-219`. No other task source names a file of the Run directory `L:55`, joins a path into one of its directories or passes a Run directory around `L:60-61`. The scan is not vacuous and the owner spells out every name: `L:49-51` |
| One module owns the seal | `RunRecord#save*`, `#seal*`; `writeSealedRecord`, `readSealedRecord` in `task-files.ts` | Only the module (with the seal's definition and the gate evidence store it opens) reads or writes a sealed record or opens a Run store: `L:65-71`. The digest a sealed write returns is the seal in the file: `U:135`, `U:168` |
| One module owns the validation | `validatedPlan`, `validatedCommit`, `RunRecord#loadContextManifest`, `#approvedPackage`, `#verifiedCommit` | Rows below, one per error code |
| The sideways imports are gone | — | `task-status` imports neither `task-run` nor `task-verifier`; `task-surface` and `task-review` do not import `task-verifier`: `L:88-93` |
| Lazy: nothing before the first write | `RunRecord` constructor, every reader | Every reader of a run that was never planned returns or refuses and the state root stays empty `U:278-291`; the first write creates exactly its file `U:293-294`; an invalid run ID names no directory `U:300-305`; a refused plan writes nothing `U:429` |
| Bytes and paths unchanged | — | Golden values, next section |

### Error codes: coverage before and after

"Before" is the base revision. Every case below runs in a temporary directory
on every platform, except the two sub-cases marked POSIX.

| Code | Before | Now (assertion) |
| --- | --- | --- |
| `VES_TASK_STATE_UNREADABLE` | none | A directory in place of the file, a file over 4 MiB, a link (POSIX), and a file in place of the Run directory (POSIX), for each of nine readers (plan, commit, report, review, gate evidence, grant, worktree, outcome, context manifest): `U:339`, `U:343`, `U:350`, `U:355` |
| `VES_TASK_STATE_MISMATCH` | none | A plan of another run, another Workspace, or another schema version `U:407`; a validly sealed plan moved under another run ID or into another Workspace `U:416`, `U:419`; filing a plan under another run or Workspace `U:424-428` |
| `VES_TASK_CONTEXT_MISSING` | none | Absent, `null`, a string, a number: `U:455-467`; a run never planned `U:288` |
| `VES_TASK_CONTEXT_TAMPERED` | none | Another expected digest `U:474`; edited token count, fragment, added member, replaced `manifestId` `U:485-489`; an array `U:493`. The key ID and signature are outside the identity `U:499` |
| `VES_TASK_EVIDENCE_MISMATCH` | none | A wrong digest, the gates in another order, a subset of the gates: `U:561-571` |
| `VES_TASK_EVIDENCE_MISSING` | 2 cases (`tests/integration/task-commit-recovery.test.mjs:151-156`, `:164-168`) | Kept, plus: an absent gate, another change, no evidence at all, only a failing verdict `U:576-596` |
| `VES_TASK_PACKAGE_INVALID` | none | Missing `U:510`; payload not the one the plan bound `U:519`; an ID that is not an artifact ID `U:524`; unreadable `U:533`; swapped for another package `U:535`; the bound package is returned `U:516-517`, `U:537` |
| `VES_TASK_REVIEW_UNAVAILABLE` | none | Commit record without report, report without commit record, neither: `U:609`, `U:613`, `U:289`; before any git call `S:123-125`; a damaged report is tampered, not unavailable `U:622` |
| `VES_TASK_STATE_MALFORMED` | commit record only (`task-commit-recovery.test.mjs:188-189`) | Kept, plus: not JSON for nine readers `U:361`; outside the seal envelope for five sealed readers `U:379`; a marker that is not an object `U:398`; a sealed plan with an invalid field, eight cases `U:448`; a commit record with an invalid field `U:682` |
| `VES_TASK_STATE_TAMPERED` | macOS end-to-end only (`tests/e2e/task-cli-e2e.test.mjs:591`) | Kept, plus on every platform: an edited record and a replaced digest for five sealed readers `U:387`, `U:389`; a plan whose request no longer matches `requestDigest` `U:448` |
| `VES_TASK_RUN_NOT_FOUND` | end-to-end only | `U:278` |
| `VES_TASK_RUN_ACTIVE` (claim) | macOS end-to-end only | A live process `U:629`; a process this user may not signal (POSIX) `U:646-648`; a marker that names no live process is no claim `U:635`, `U:639` |

`VES_TASK_TRUST_ANCHOR_*` is raised for `keys/task-evidence-trust.json`, which
is not in the Run directory and is outside this task.

### Golden values (bytes did not move)

Recorded by running the task sources of the base revision `0158e48`, exported
unchanged into an ignored scratch directory, on the fixed inputs of
`tests/helpers/task-run-record-fixture.mjs`; the recording was run twice with
identical output. Where the base exported a function (`saveCommit`,
`loadCommit`, `savePlanRecord`, `saveContextManifest`, `loadContextManifest`,
`TaskEvidenceStore`, `reviewSurface`, the path helpers) the value came from
that function. Where the base had only a call site (the attempt record in
`TaskRunComposition#attempt`, the grant, outcome, active and cancel markers,
the review record, the lesson, the package and capsule stores) the call site
was reproduced verbatim. The same inputs through the new interface give the
same values.

| Golden | Value | Assertion |
| --- | --- | --- |
| Seal format | the exact text `{"digest":…,"record":…}\n` of `commit.json`; file SHA-256 `32e4a622…ca90a2` | `U:85-94` |
| Grant marker | the exact text of `grant.json`; file SHA-256 `ec76ee9d…9ec820`; the digest a Run Capsule binds for it, `383c2a3c…9d0473` | `U:103-107` |
| Attempt digests | failed attempt `f88c73d0…8fb27a`, passing attempt chained to it `0c78c773…fe90a8`; file SHA-256 of both | `U:119-133`; an undefined member is absent `U:136` |
| Context manifest identity | `manifestId` `08335bec…1e5440`; file SHA-256 `cb0c9f05…4d7c1e` | `U:150-156` |
| Review surface | SHA-1 repository `291be5ea…e78aa2`, SHA-256 repository `3b457278…7090d0`, with the whole surface object | `S:69-82`; the digest is the canonical digest of the surface `S:83` |
| Layout | the fifteen relative paths | `U:203-219` |
| Other sealed bytes | `plan.json` `e6c97cd7…d0272f`, `verification/report.json` `cdc63776…b3a808`, gate evidence, review record and worktree marker text | `U:162-173`, `U:220-234` |

The review surface golden uses a repository whose two commits have fixed
content, identity, and dates, so their object IDs are the same on every
machine (`S:66-67` fail first if they are not), and product git runs with an
empty configuration home so a user's global git settings cannot change the
diff text.

### One new refusal

`RunRecord#savePlan` refuses a plan whose `runId` or `workspaceId` is not the
record's (`VES_TASK_STATE_MISMATCH`, `U:424-429`). At the base the plan's path
was derived from the plan, so the two could not disagree; the path now comes
from the Run record. `task plan` always files a plan under its own run, so no
journey changes.

### Behaviour kept on purpose

- A marker reader returns the object the file holds. `status` prints the
  stored `grantId`, and the Run Capsule digests the grant marker as it was
  read, exactly as before.
- An active marker that cannot be read names no live process.
- `review` reads the Execution Package with the store's own errors;
  `approve` reads it through `approvedPackage`. The two call sites raised
  different public errors at the base and still do.
- `FileExecutionPackageStore` creates its root when it reads. This is the one
  reader that is not free of effects; every caller has read the plan first.

### Tests replaced

No case was deleted. Two suites had their setup moved to the module's
interface, with every assertion and case name unchanged and the cited lines
of `validation-c1.md` still in place:

| Suite | Setup before | Setup now |
| --- | --- | --- |
| `tests/integration/task-commit-recovery.test.mjs` (15 cases) | `new TaskEvidenceStore(directory)`, `saveCommit(directory, …)`, `loadCommit(directory)`, `recovery.directory`, `recovery.evidence` | `openRunRecord(…)`, `runRecord.gateEvidence`, `runRecord.saveCommit(…)`, `runRecord.loadCommit()`, `recovery.runRecord` |
| `tests/integration/task-idle-cancel.test.mjs` (13 cases) | `writeJsonAtomic(worktreePath(directory), …)`, `saveCommit(directory, …)`, `removeIdleWorktree(workspace, directory)` | `runRecord.saveWorktreeRef(…)`, `runRecord.saveCommit(…)`, `removeIdleWorktree(workspace, runRecord)` |

### Discrimination (disposable copy)

A copy of `apps/vestra-cli` and `tests` in an ignored scratch directory was
mutated one change at a time and rebuilt from the tracked sources before each
run; the tracked sources were never mutated. Unmutated copy: 64 pass, 0 fail
(`U` 54, `S` 5, `L` 5).

| Mutation in the copy | Failing cases |
| --- | --- |
| M1 — the commit record moves to another file name | 7: the layout and seal goldens, the owner-spells-the-layout scan, the four commit record reader cases |
| M2 — the seal digests `JSON.stringify` instead of the canonical form | 14, including the seal, attempt, plan and report goldens and both review surface goldens |
| M3 — the grant marker gains a member | 1: the grant marker golden |
| M4 — an attempt is sealed without the JSON round trip | 1: the attempt golden |
| M5 — the context manifest identity is compared, not recomputed | 1: "a context manifest that is not the one the approval bound is tampered" |
| M6 — a plan is filed without checking whose it is | 1: "a plan is never filed under another run or Workspace" |
| M7 — a loaded plan is not matched to its run and Workspace | 1: "a plan record of another run, Workspace, or schema version is a mismatch" |
| M8 — the approved package is not compared with the plan's digest | 1: "the Execution Package the plan bound is returned, and any other is invalid" |
| M9 — a commit record alone makes a run reviewable | 2: the `U` and the `S` review-unavailable cases |
| M10 — a state file need not be a regular file | 9: every "not a bounded regular file" case |
| M11 — opening a Run record creates its directory | 12, including "opening a Run record and reading a run that was never planned creates nothing" |
| M12 — claiming a run keeps the stale cancel request | 1 |
| M13 — recovered gate evidence is not compared with the commit's digest | 1: the `VES_TASK_EVIDENCE_MISMATCH` case |
| M14 — a process that may not be signalled counts as dead | 1 |
| M15 — a sealed record is trusted without recomputing its digest | 6: the five tampered cases and the damaged-report case |
| M16 — the review surface gains a member | 2: both review surface goldens |
| M17 — the verification report moves out of its directory | 7 |
| M18 — `task-status` names a Run file and imports `task-run` again | 2 in `L` |
| M19 — `task-review` opens the capsule store itself | 2 in `L` |
| M20 — a commit record is returned without validating its fields | 1 |

The locality scan was also run over the base revision's task sources. All
five cases fail: seven sources name a Run file, five join a path into a Run
directory, four open a store or read a sealed record, and `task-status`,
`task-surface` and `task-review` import another command's module.

### Guardrails

- Complexity: no baseline entry changed; no new function is above 10
  (`pnpm complexity:check`: 178 baselined keys, nothing unaccounted).
- Census: `apps/vestra-cli/src/task/task-run.ts` left the inventory (it lost
  its one `JSON.stringify`); `apps/vestra-cli/src/task/task-run-record.ts`
  entered it as `migrated-v2` (canonicalizer 2, serialization 1);
  `task-context.ts` canonicalizer 3 → 2. The inventory still has 115 entries.
- Citations fixed: `.specs/features/live-task-pilot/validation.md`
  (`task-run.ts`, `task-status.ts`, `task-verifier.ts` lines),
  `.specs/features/architecture-deepening/validation-c5.md`
  (`task-verifier.ts`, `task-review.ts` lines) and `validation-c6.md`
  (`task-run.ts` line). They were already stale at the base, which moved the
  same files.
- Digest-bound qualification reports untouched; migration count (12) and
  runtime error catalog count (19) unchanged; the task error catalog stays at
  10 codes.
- `.specs/features/governed-task-cli/design.md` (section E7) now lists the
  module and says which files of the Run directory are sealed and which are
  plain markers.

### Gates (Node 24.14.0, macOS arm64, git 2.50.1)

| Command | Result |
| --- | --- |
| `node --test tests/unit/task-run-record.test.mjs tests/integration/task-review-surface.test.mjs tests/architecture/task-run-record-locality.test.mjs tests/integration/task-commit-recovery.test.mjs tests/integration/task-idle-cancel.test.mjs` | PASS — 92 passed |
| `node --test tests/e2e/task-cli-e2e.test.mjs tests/e2e/mediated-task-execution-e2e.test.mjs` | PASS — 21 passed |
| `node --test tests/unit/task-cli-composition.test.mjs tests/security/task-cli-security.test.mjs` | PASS — 15 passed |
| `pnpm gate:quick` | PASS — unit 2449, agent-readiness 323, census 13 |
| `pnpm test:architecture` | PASS — 74 |
| `pnpm agent:check` | PASS |

## C2-2 (T2b) — typed projections of the checkpoint rows

The Run's executor, gate, and repair checkpoints live in the runtime store,
which returns them as records with no declared shape. Three sources read
them with casts: `task-run.ts` (`resumable`, `verify`, and the gate record in
`recoverCommittedTask`), `task-status.ts` (`checkpointStages`, `stageOf`) and
`task-review.ts` (`toolReceipts`, `budgetEvidence`). `task-budget.ts` cast the
ledger twice more. They now read `RunCheckpoints`, returned by
`RunRecord#checkpoints(runtime, taskId)`: three typed projections
(`executor()`, `gate()`, `repair()`) and the store's own three ports bound to
the Run and task. The ledger a repair checkpoint carries is read once, by
`storedBudgetLedger` in `task-budget.ts`.

### Requirement evidence

`K` is `tests/integration/task-run-checkpoints.test.mjs`, which writes rows
through the store's ports into a real runtime store and reads them back.

| ADP-2 clause | Definition (symbol) | Assertion evidence |
| --- | --- | --- |
| Typed checkpoint projections in the one module | `RunCheckpoints#executor`, `#gate`, `#repair` | No checkpoint, no projection `K:60-62`; the latest executor checkpoint with its stage, ref, change digest and receipt refs `K:68-88`; every gate stage, with a commit ID only once committed, in both object ID lengths `K:123-143`; the repair stage and ledger `K:150-164` |
| A member of the wrong type is absent, not trusted | `text`, `looseRow`, the receipt filter | Executor data that is `null`, text, an array, or carries a number or a mixed list: `K:107-109` |
| The projections add nothing and hide nothing | `executorPort`, `gatePort`, `repairPort` | The ports are the store's own `K:165-169`, `K:278`; a row the store finds corrupt stays `VES_RUNTIME_CHECKPOINT_CORRUPT` `K:269-270`; a projection reads only its own run and task `K:252-254` |
| The stored ledger is checked, then reported as before | `storedBudgetLedger`, `budgetStatus`, `capsuleBudgetConsumption` | A ledger that is not one is refused, eleven cases `K:239`. The status and Run Capsule reports for a billed, a billed-only, a mixed and a subscription ledger equal the values recorded from the base revision's functions: `K:185-219` |
| No command opens the checkpoint store or casts a row | — | `tests/architecture/task-run-record-locality.test.mjs:102-106` |
| A committed checkpoint is typed where recovery reads it | `recoverCommittedTask`, `GateCheckpoint` | A committed checkpoint with no commit ID or no change digest is refused before any git call: `tests/integration/task-commit-recovery.test.mjs:203-210` |

### Behaviour changes and their bounds

The runtime store never writes either state below; both were reachable only
by a row edited behind the store with its digest recomputed.

- A stored budget ledger that is not a ledger is refused with
  `VES_TASK_STATE_INVALID`, reason `VES_TASK_STATE_MALFORMED`, by `status`,
  `review`, and the verifier's meter on `resume`. Before, `status` printed it,
  `review` sealed its members into the Run Capsule, and `resume` failed later
  with `VES_BUDGET_INVALID`. The check mirrors the budget meter's resume
  check (non-negative finite amounts, non-negative whole counts, a known stop
  reason, unbilled tokens no greater than the consumed total) and also
  refuses a missing `stopReason`, which the meter always writes. The meter
  still applies its own check when it resumes.
- A committed gate checkpoint that names no commit or no change is refused
  with the same reason. Before, the text `undefined` reached `git rev-parse`.
- A receipt ref that is not text is left out of the count `status` prints and
  of the refs `review` seals. The executor writes only text.

For every row the store does write, the outputs are unchanged: `K:185-219`
for the ledger reports, and the end-to-end journeys below for `status`,
`resume` and the sealed Run Capsule.

### Tests replaced

No case was deleted. `tests/integration/task-commit-recovery.test.mjs` passes
the gate checkpoint in the typed shape (`{ stage, commitId, changeDigest }`
instead of `{ stage, record: { … } }`, and `gate` instead of `inspectGate`);
its fifteen cases keep their names, assertions and lines, and one case was
added at the end.

### Discrimination (disposable copy)

Unmutated copy: 32 pass, 0 fail (`K` 10, the recovery suite 16, the locality
scan 6).

| Mutation in the copy | Failing cases |
| --- | --- |
| N1 — receipt refs are taken without narrowing to text | 1: "executor data of any other shape yields no change digest and only text receipt refs" |
| N2 — the change digest is cast instead of narrowed | 1: the same case |
| N3 — the gate projection reports a commit ID for every stage | 1: "the gate projection reports every stage, and a commit ID only once the gate committed" |
| N4 — the stored ledger is cast instead of checked | 1: "a stored ledger that is not a ledger is refused, never reported or resumed" |
| N5 — the ledger check ignores the unbilled token count | 1: the same case |
| N6 — a committed checkpoint without a commit ID is passed on to git | 1: "a committed checkpoint that names no commit or no change is refused before any git call" |
| N7 — status prints a dollar figure for subscription usage | 1: "status and the Run Capsule report a stored ledger as they did before" |
| N8 — the capsule carries a cost for subscription usage | 1: the same case |
| N9 — the projections are bound to the Workspace instead of the run | 5 |
| N10 — `task-status` reads and casts a checkpoint row again | 1: the locality case for checkpoint rows |
| N11 — the repair projection hides a row the store refuses | 1: "a row the store finds corrupt stays the store's refusal" |
| N12 — the ledger check accepts any stop reason | 1 |
| N14 — unbilled tokens may exceed the consumed total | 1: the same case |
| N13 — the repair projection drops the ledger | 3 |

The checkpoint case of the locality scan, run over the base revision's task
sources, names exactly the three sources: `task-review.ts`, `task-run.ts`,
`task-status.ts`.

### Guardrails

- Complexity: no baseline entry changed; no new function is above 10.
- Census: no file gained or lost `JSON.stringify` or `createHash`.
- Citations fixed: the same three files as in C2-1, for the lines this commit
  moved in `task-run.ts`, `task-status.ts` and `task-review.ts`.
- Migration count (12), runtime error catalog count (19) and task error
  catalog count (10) unchanged.

### Gates (Node 24.14.0, macOS arm64, git 2.50.1)

| Command | Result |
| --- | --- |
| `node --test tests/integration/task-run-checkpoints.test.mjs tests/integration/task-commit-recovery.test.mjs tests/architecture/task-run-record-locality.test.mjs` | PASS — 32 passed |
| `node --test tests/unit/task-run-record.test.mjs tests/integration/task-review-surface.test.mjs tests/integration/task-idle-cancel.test.mjs` | PASS — 72 passed |
| `node --test tests/e2e/task-cli-e2e.test.mjs tests/e2e/mediated-task-execution-e2e.test.mjs` | PASS — 21 passed |
| `node --test tests/unit/task-cli-composition.test.mjs tests/security/task-cli-security.test.mjs` | PASS — 15 passed |
| `pnpm gate:quick` | PASS — unit 2449, agent-readiness 323, census 13 |
| `pnpm test:architecture` | PASS — 75 |
| `pnpm agent:check` | PASS |
