# Validation T9 — the Run record's readers return declared records (ADR2-9)

Task T9 of the second architecture deepening round, requirement ADR2-9: the
Run record's readers SHALL return typed records instead of rows read by member
name. Source: the architecture review of `main` at `9eb2881`, card 2 (Run
record, Reduced). Branch `refactor/typed-run-record-readers`, based on `main`
at `6fae651`. The decision is the entry AD-061 in
`.specs/STATE.md`.

## 1. The friction, verified at the base

The card's citations moved with the hardening (#473-#475) and the usage
account (#478, #479). At `6fae651`:

- Readers that returned an untyped row (`type Row = Readonly<Record<string,
  unknown>>`), in `apps/vestra-cli/src/task/task-run-record.ts`: `loadGrant`
  (`:437`), `loadOutcome` (`:523`), `loadReport` (`:552`), `loadReview`
  (`:575`), and `verifiedCommit` (`:563`), whose `report` was a row. The
  card's `:321, 373, 402, 425` are these four.
- Members read by name off them: `task-status.ts:57` (`grantId`), `:61`
  (`verdict`), `:62` (`outcome`), `:86` (`status`), `:87` (`reason`);
  `task-review.ts:109` (`grantId`), `:167-168` (`verdict`, `commitId`),
  `:209` (`verdict`); `task-surface.ts:42` (`verdict`, not in the card);
  `task-run.ts:292` (`grantId`).
- Validation differed by form. `#marker` (`:369-375`) checked one member of
  a sealed marker as text and none of a legacy one. So `start` issued a new
  writer capability over a legacy grant marker whose `grantId` was not text
  (`task-run.ts:292`), `status` printed whatever a marker held, and `review`
  bound it into the Run Capsule (`task-review.ts:109`).
- The card's `task-review.ts:66` is `:68` at the base. It reads the receipt
  `HumanReviewCoordinator.review` returns, not a Run record artifact (section
  4).

## 2. What changed

| Reader | Returns | Validated as it is read | Refused as |
| --- | --- | --- | --- |
| `loadGrant` (`task-run-record.ts:566`) | `GrantMarker` (`:178`) | `grantId` is text (`validatedGrant`, `:202`), both forms | `VES_TASK_STATE_MALFORMED` |
| `loadOutcome` (`:655`) | `OutcomeMarker` (`:182`), `TaskRunOutcome` plus `at` | `status` is one of the six `TaskRunOutcome` statuses; `at` and the text members that status carries (`OUTCOME_TEXT`, `:209`); a review outcome's `commit` is a commit record; an escalation's `failure` names a gate and its evidence (`validatedOutcome`, `:243`), both forms | `VES_TASK_STATE_MALFORMED` |
| `loadReport` (`:683`), and `verifiedCommit` (`:694`) | `VerificationReportRecord` (`:186`) | `verdict` is `PASS` or `FAIL`; `commitId` is an object ID (`validatedReport`, `:257`) | `VES_TASK_STATE_MALFORMED` |
| `loadReview` (`:706`) | `HumanReviewRecord` (`:191`) | `outcome` is `accepted` or `rejected` (`validatedReview`, `:265`) | `VES_TASK_STATE_MALFORMED` |
| `loadCommit` (`:663`) | `TaskRunCommit`, as before | `validatedCommit`, as before | unchanged |
| `loadWorktreeRef` (`:642`) | `string`, as before | sealed: text, as before; legacy: one that names nothing reads as none (`plainWorktreeRef`, `:273`), as before | unchanged |

Each reader returns the record as the file holds it, every member kept. The
declared type names the members the task path reads; the Run Capsule digests
the grant marker, and the review surface the report, exactly as read.

The readers share two private functions. `#marker` (`:452`) checks the form
and the seal as before (AD-052), then validates either form with the reader's
validator; a reader may give the legacy form its own rule, which only the
worktree marker does. `#sealed` (`:467`) reads a sealed record and validates
it. `loadCommit`, `loadReport` and `loadReview` go through it.

The callers read typed members: `task-status.ts:77`, `:81`, `:82`, `:175`;
`task-review.ts:109`, `:167-168`, `:209`; `task-surface.ts:42`;
`task-run.ts:292` (`if (stored !== undefined) return stored.grantId`).
`status` names a reason through `reasonOf` (`task-status.ts:280-283`): only a
failed or an aborted outcome carries one, which is what it printed for every
outcome the writer produces. The helper sits at the end of the file so that
the lines `live-task-pilot/validation.md` cites (`:13`, `:160`) do not move.

## 3. ADR2-9, clause by clause

| Clause | Where it holds | Assertion evidence |
| --- | --- | --- |
| Every reader that returned a row returns a declared type | section 2 | `tests/architecture/task-run-record-readers.test.mjs:23` "each reader of the Run record returns its declared record, never a row": the five signatures and `verifiedCommit`'s; no `load*`, `verifiedCommit` or `activeProcess` signature names `Row` |
| No caller reads a member by name off an untyped row | `task-status.ts`, `task-review.ts`, `task-surface.ts`, `task-run.ts` | `tests/architecture/task-run-record-readers.test.mjs:40` "no command reads a member of a Run record artifact by name": no `["grantId"]`, `["verdict"]`, `["outcome"]`, `["reason"]`, `["commitId"]` or `["worktreeRef"]` in the four sources |
| A valid record round-trips | each reader | `tests/unit/task-run-record-readers.test.mjs:93` (grant, both forms, with a member the type does not name, and its digest), `:123` (all six outcomes, both forms, with `at`), `:169` (report: `PASS`, `FAIL`, a SHA-256 commit ID), `:197` (review, both outcomes) |
| Each required member missing or of the wrong type is refused | each validator | `:110` (grant: absent, a number, empty, null, a list; both forms); `:160` with `MALFORMED_OUTCOMES` (`:134`, seventeen shapes, both forms); `:178` (report: verdict absent, lower case, boolean; commit ID absent, short, upper case, a number; also through `verifiedCommit`); `:205` (review: absent, upper case, boolean) |
| Legacy and sealed forms both read where both exist | grant and outcome markers | the round trips and refusals above run in both forms; `tests/integration/task-status-records.test.mjs:48` refuses a malformed grant and outcome marker through `task status` in both forms |
| Refused with the module's existing codes, never coerced | `VES_TASK_STATE_MALFORMED` | every refusal above asserts `VES_TASK_STATE_INVALID` with reason `VES_TASK_STATE_MALFORMED`; no code is added |
| Callers read the typed members | `task-status.ts:280-283` | `tests/integration/task-status-records.test.mjs:28`: a reason for `FAILED` and `ABORTED`, none for `ESCALATED`, `APPROVAL_INVALIDATED` or no outcome |

## 4. Not changed, and why

- **The gate evidence store's `load`** (`task-evidence.ts:46`) returns the
  gate entry as the gate coordinator emitted it. Its one caller outside the
  store, `task-review.ts:52`, digests the entry whole into the Run Capsule and
  reads no member. The store reads members only inside itself (`recover`,
  `feedback`). The ADP-2 suites pin entries of three members
  (`{ gateId, verdict, exitCode }`), and `recover` skips an entry whose verdict
  is not `PASS` instead of refusing it; a declared type here would either be
  a partial one that no caller reads or a change of `recover`'s refusal. It is
  left as it is and named here for the coordinator.
- **The review coordinator's receipt** (`task-review.ts:78`, `:275`, `:288`)
  is the row `HumanReviewCoordinator.review` returns in
  `packages/application`, not a Run record artifact. Typing it is a change
  of the verification module's interface.
- **The runtime store's rows**: the run journal's terminal event
  (`task-review.ts:95`), the capsule seal (`task-status.ts:181`) and the
  repair state `RunCheckpoints.recordBudgetLedger` carries forward
  (`task-run-record.ts:392-404`). They belong to ADR2-7 (T7), which declares
  the runtime store's records; this change does not touch those lines.
- `loadPlan`, `loadContextManifest`, `approvedPackage`, `activeProcess` and
  `cancelRequested` already returned declared types and are unchanged.

## 5. Behaviour

No record Verchestra writes changes, and no run it wrote reads differently.
What a hand edit can now meet:

- A legacy Run's grant or outcome marker of another shape is refused
  (`VES_TASK_STATE_MALFORMED`) by `start` and `resume` (grant), `status`
  (both) and `review` (grant). Before, it was read as whatever the file held;
  `start` issued a new grant over a grant marker without a text `grantId`. A
  sealed Run already refused a marker without its one member.
- A sealed Run's outcome marker is checked member by member, not only its
  `status`.
- A verification report whose verdict is not `PASS` or `FAIL` or whose commit
  ID is not an object ID, and a review record whose outcome is not
  `accepted` or `rejected`, are refused by `status`, the review surface and
  `review`. The verification module writes neither.

## 6. Unchanged

- Bytes, paths, seals, the marker-seal rule (AD-052), the legacy plain
  marker reading and the Run Capsule digests: the ADP-2 and hardening suites
  pass unmodified (`tests/unit/task-run-record.test.mjs`,
  `tests/unit/task-run-markers.test.mjs`,
  `tests/integration/task-marker-commands.test.mjs`,
  `tests/integration/task-run-containment.test.mjs`,
  `tests/integration/task-review-surface.test.mjs`,
  `tests/integration/task-review-package.test.mjs`,
  `tests/integration/task-commit-recovery.test.mjs`,
  `tests/integration/task-idle-cancel.test.mjs`,
  `tests/integration/task-run-checkpoints.test.mjs`,
  `tests/integration/task-workspace-containment.test.mjs`,
  `tests/architecture/task-run-record-locality.test.mjs`: 220 tests).
- No error code and no migration: the runtime catalog stays at 19 and the
  migrations at 12.
- Complexity: no hotspot key is added or changes; every new function is at or
  under the target of 10.
- Census: no file gains or loses `JSON.stringify` or `createHash`;
  `test:census` passes with the inventory unchanged.
- Line citations: the edits in `task-status.ts`, `task-review.ts`,
  `task-surface.ts` and `task-run.ts` replace lines in place, and the one
  added function is at the end of `task-status.ts`, so no `<file>.ts:<line>`
  citation in `docs` or `.specs` moved. No citation names a line of
  `task-run-record.ts`.

## 7. Tests: replaced and added

No test is deleted or edited. Added: `tests/unit/task-run-record-readers.test.mjs`
(8, the readers' interface), `tests/integration/task-status-records.test.mjs`
(2, `task status` through the command fixture, which denies the real
credential tool) and `tests/architecture/task-run-record-readers.test.mjs`
(2). None repeats a case of the pinned suites: those cover the seal, the
form, the layout and the goldens; these cover the shape.

## 8. Discrimination

Each mutation was applied alone to the file in this worktree, with the
original kept in the ignored `.tmp/`, the focused suites run (the three new
files, `task-run-record`, `task-run-markers`, `task-marker-commands`,
`task-run-containment`, `task-review-surface`), and the file restored.

| Mutation | Failing tests |
| --- | --- |
| `validatedGrant` does not check `grantId` | grant refusal (`:110`); the markers suite's "a sealed grant marker whose record lacks the member its reader needs is malformed"; `task-status-records.test.mjs:48` |
| `validatedOutcome` does not require `at` | outcome refusal (`:160`) |
| `validatedOutcome` does not require a status's text members | outcome refusal (`:160`); `task-status-records.test.mjs:48` |
| `validatedOutcome` takes any text as a status | outcome refusal (`:160`) |
| `validatedOutcome` does not check a review outcome's commit | outcome refusal (`:160`) |
| `validatedOutcome` does not check an escalation's failure | outcome refusal (`:160`) |
| `validatedReport` does not check `verdict` | report refusal (`:178`) |
| `validatedReport` does not check `commitId` | report refusal (`:178`) |
| `validatedReview` does not check `outcome` | review refusal (`:205`) |
| a legacy marker is returned unvalidated (`#marker`'s default) | grant refusal (`:110`); outcome refusal (`:160`); `task-status-records.test.mjs:48` |
| `validatedGrant` returns only `grantId` | grant round trip (`:93`) |
| `reasonOf` names a reason for every outcome | `task-status-records.test.mjs:28` |
| a caller reads `grant?.["grantId"]` | architecture `:40` |
| `loadReview` is declared to return `Row` | architecture `:23` |

## 9. Gates

Node 24.14.0, macOS arm64, on `refactor/typed-run-record-readers`.

| Command | Result |
| --- | --- |
| the three new files and the ADP-2 and hardening suites listed in section 6 | PASS, 232 (12 new, 220 pinned) |
| `pnpm gate:quick` | PASS: unit 2625, agent-readiness 331, census 13 |
| `pnpm test:architecture` | PASS, 113 |
| `pnpm gate:build` | PASS: unit 2625, contract 797, integration 1096, e2e 275, architecture 113, build 172, qualification 337 |
| `pnpm gate:security` | PASS: unit 2625, contract 797, e2e 275, architecture 113, qualification 337, security 1324, fault 310 |
| `node --test tests/e2e/task-cli-e2e.test.mjs tests/e2e/mediated-task-execution-e2e.test.mjs` | PASS, 46 |
| `node --test tests/unit/task-cli-composition.test.mjs tests/security/task-cli-security.test.mjs` | PASS, 15 |
| `pnpm agent:check` | PASS |

No test was skipped. The change touches the task path, so the platform
matrix runs on the branch before merge.
