---
schema: verchestra-qualification-report/v1
task: T68c
revision: 46d22d830efaf4ffe75553517476594c9ae15eda
gates: pnpm gate:quick, pnpm gate:security
gateResults: pass, pass
gateRevision: 46d22d830efaf4ffe75553517476594c9ae15eda
criteriaEvidence: 6 of 6 acceptance criteria proven
skipped: 0
todo: 0
discriminationSensor: 6 killed, 0 survived
reviewedIn: https://github.com/accd/verchestra/pull/144
---

# T68c Gate Repair Loop Validation

## Scope

T68c declares what happens after a gate fails. Before it, gate-commit saved a
`gate-failed` state and the semantics ended there. Now an Execution Package may
declare `onGateFailure` - bounded attempts, an escalation point, and whether the
driver receives feedback - and `runGateRepairLoop` executes that declaration:
each attempt seals a capsule chained to the previous one by digest, withheld
feedback is recorded as a decision rather than an omission, exhaustion of a
declared policy escalates to a human, and an absent policy preserves the old
single-attempt semantics exactly.

46 cases across three suites, against a declared minimum of 18.

| Suite | Cases |
| --- | --- |
| `tests/integration/gate-repair-loop.test.mjs` | 14 |
| `tests/unit/execution-package-repair-policy.test.mjs` | 11 |
| `tests/integration/run-scoped-budget.test.mjs` | 21 |

The third suite belongs to this task as much as to T68b: it proves the loop
spends from one run budget across attempts rather than granting each attempt a
fresh ceiling (#124), and that a budget stop terminates the loop with a
distinct `BUDGET_EXCEEDED` outcome instead of masquerading as a gate failure.

## Implementation revision

The loop merged at `162bbe8` and its file was last modified at `46d22d8`, which
made the declared budget span attempts. The report binds to the revision that
carries the file as it exists, not to the first merge of an earlier version:
`packages/application/src/execution/gate-repair.ts` is byte-identical between
`46d22d8` and current `main`.

## Deterministic gates

Both gates ran on a clean checkout detached at the implementation revision,
dispatched through `full-validation.yml`. Each run's artifact records the
revision and the profile. These are the same runs the T68b report cites,
because both reports bind to the same revision - a gate run attests a
revision, not a task.

| Command | Result |
| --- | --- |
| `pnpm gate:quick` | PASS — [run 30670820650](https://github.com/accd/verchestra/actions/runs/30670820650) |
| `pnpm gate:security` | PASS — [run 30670822421](https://github.com/accd/verchestra/actions/runs/30670822421) |

| Profile | Stages |
| --- | --- |
| `gate:quick` | `format:check`, `lint`, `typecheck`, `test:unit`, `test:agent-readiness` |
| `gate:security` | `format:check`, `lint`, `typecheck`, `build`, `test:unit`, `test:architecture`, `test:qualification`, `test:security`, `test:fault` |

## Adequacy matrix

Anchored in `.specs/features/gate-repair-loop/spec.md`.

| Criterion | Requirement | Assertion |
| --- | --- | --- |
| REP-01 | Declared policy bounds: `maxAttempts >= 1`, boolean feedback flag, `escalateAfter` within `[1, maxAttempts]` | `execution-package-repair-policy.test.mjs` - zero, six, and fractional attempts, escalation past the last attempt, stringly booleans, and unknown fields all rejected as `VES_EXECUTION_PACKAGE_INVALID`; `gate-repair-loop.test.mjs` rejects the same shapes at the loop with `VES_REPAIR_INPUT_INVALID` |
| REP-02 | Retry carries bounded feedback; every attempt seals a capsule chained by digest | `gate-repair-loop.test.mjs` - the second attempt carries feedback built from the first failure, and `previousAttemptDigest` chains `null → d1 → d2` |
| REP-03 | `feedbackToDriver: false` retries without feedback and records the withholding | `gate-repair-loop.test.mjs` - `feedbackWithheld` sealed as `[false, true]`, a decision the evidence shows rather than an omission |
| REP-04 | Escalation stops the run recoverably; no autonomous retry past the point | `gate-repair-loop.test.mjs` - escalation at exactly the declared point with attempts remaining, and exhaustion of a declared policy escalating rather than silently failing |
| REP-05 | No declared policy means exactly one attempt and terminal `gate-failed` | `gate-repair-loop.test.mjs` - one attempt, no feedback built, stages `["gate-failed"]`, preserving pre-T68c semantics |
| REP-06 | Feedback is bounded with a recorded digest, behind the egress boundary | `gate-repair-loop.test.mjs` - feedback above `FEEDBACK_BYTE_BUDGET` fails closed as `VES_REPAIR_FEEDBACK_INVALID`; construction happens behind the `buildFeedback` port where the existing egress boundary applies |

## Discrimination sensor

Each mutation was applied to the implementation, the three suites re-run, and
the source restored.

| Mutation | Criterion | Result |
| --- | --- | --- |
| The package validator accepts `maxAttempts` outside `[1, 5]` | REP-01 | KILLED |
| The capsule chain breaks: `previousAttemptDigest` is always null | REP-02 | KILLED |
| Withheld feedback stops being recorded | REP-03 | KILLED |
| The loop continues past the declared escalation point | REP-04 | KILLED |
| An absent policy defaults to two attempts instead of one | REP-05 | KILLED |
| The feedback byte budget stops being enforced | REP-06 | KILLED |

## Non-shallow checks

- Crash-resume is idempotent: a crash between attempts resumes with the correct
  attempt count and no duplicate capsule, and tampered recovered state fails
  closed as `VES_REPAIR_STATE_INVALID`.
- Escalation wins over further retries, and the budget outcome wins over
  escalation - `ESCALATED` invites a human to approve spending that no longer
  exists, so `BUDGET_EXCEEDED` reports first.
- The loop composes above the executor through its `attempt()` port rather than
  editing it, which is why the T68b rebase conflicted only in the export barrel.
- An unbounded feedback hint is an exfiltration channel, not a formatting nit;
  the byte budget is enforced at the coordinator, not trusted to the builder.

## Verdict

T68c is complete for its declared scope. Six of six acceptance criteria have
file-and-assertion evidence, both declared gates pass on the implementation
revision through external runs, and every mutation in the sensor was killed.

What this report does not assert: independent verification, or recorded human
acceptance - `docs/qualification/REPORT-CONTRACT.md` deliberately has no field
for either, and `docs/merge-governance.md` states why independence is not
obtainable by configuration in a single-collaborator repository.
