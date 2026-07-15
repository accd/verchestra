# T60 Independent Verification and Human Review Validation

## Scope

- Task: T60 — Implement independent Verifier, discrimination sensor, and Human Review
- Requirements: VES-VFY-003…006 and VES-SPC-001/003
- Commit target: `feat(verification): add independent verifier and review`
- Focused evidence: 33 cases (13 end-to-end, 12 unit including three table-driven inspection cases, and 8 mutation-sensor cases)
- Required minimum: 30 unit/end-to-end/mutation cases
- Spec deviations: none

T60 introduces a runtime-validated application boundary for verification and final review. The Verifier identity must differ from both the implementation actor and commit author. Expected outcomes are independently derived per acceptance criterion; a claim counts only after exact commit, expected-outcome, file/line, assertion, and evidence inspection. Every criterion also requires a declared behavior mutation executed through a scratch-isolation sensor whose before/after/final active-state digests must remain unchanged.

A verification gap produces a signed report, grounded reusable lesson, and `REQUEST_REPAIR`. The canonical workflow permits three repair cycles and sends the next unresolved result to `HUMAN_RESOLUTION_REQUIRED`. A clean report alone advances only to `HUMAN_REVIEW`. Completion additionally requires an authenticated stored PASS report, an unchanged review surface, a human identity, an exact authority decision, and a persisted review record. Rejection is durable but never emits the completion transition.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/unit/independent-verification.test.mjs tests/mutation/verification-sensor.test.mjs tests/e2e/verification-human-review.test.mjs` | PASS — 33 passed, 0 failed/skipped |
| `pnpm gate:full` | PASS — format, lint, typecheck, all unit/property/contract/integration/E2E/fault suites |

## Spec-anchored adequacy matrix

| Done-when criterion / requirement | Exact assertion evidence | Spec-defined outcome | Result |
| --- | --- | --- | --- |
| Independent author and Verifier | `tests/unit/independent-verification.test.mjs:21` | The commit author or implementation actor cannot verify the same work; rejection occurs before any port call | PASS |
| AC evidence-or-zero | `tests/unit/independent-verification.test.mjs:29`; `tests/unit/independent-verification.test.mjs:46` | Missing evidence is `UNCOVERED`; foreign-criterion evidence fails before inspection | PASS |
| Spec-anchored expected outcome | `tests/unit/independent-verification.test.mjs:54`; table cases following line 62 | The Verifier derives the expected outcome independently and refuses guessed, stale, invalid, or mismatched assertion evidence | PASS |
| Discrimination sensor | `tests/mutation/verification-sensor.test.mjs:6`; `tests/mutation/verification-sensor.test.mjs:51`; `tests/mutation/verification-sensor.test.mjs:75` | Only expected failure in verified scratch state is `KILLED`; survival, wrong failure, invalid isolation, unbounded evidence, or active-state drift cannot pass | PASS |
| Every AC has a mutation | `tests/unit/independent-verification.test.mjs:87`; `tests/mutation/verification-sensor.test.mjs:67` | Missing or foreign-criterion mutations are gaps and cannot create PASS | PASS |
| Grounded lessons only | `tests/unit/independent-verification.test.mjs:96`; `tests/unit/independent-verification.test.mjs:115` | A surviving mutant creates a reusable grounded lesson; a clean PASS creates none | PASS |
| Bounded repair loop | `tests/e2e/verification-human-review.test.mjs:20`; `tests/e2e/verification-human-review.test.mjs:33` | Cycles one through three retain Approval and return to repair; the fourth unresolved gap requires human resolution | PASS |
| Verification cannot self-complete | `tests/e2e/verification-human-review.test.mjs:12` | PASS advances to `HUMAN_REVIEW`, never directly to `COMPLETED` | PASS |
| Human Review is authenticated and current | `tests/e2e/verification-human-review.test.mjs:62`; `tests/e2e/verification-human-review.test.mjs:70`; `tests/e2e/verification-human-review.test.mjs:78`; `tests/e2e/verification-human-review.test.mjs:85`; `tests/e2e/verification-human-review.test.mjs:98` | Model actors, stale surfaces, non-PASS/forged reports, and denied authority create no completion record or transition | PASS |
| Accepted versus rejected Human Review | `tests/e2e/verification-human-review.test.mjs:43`; `tests/e2e/verification-human-review.test.mjs:51`; `tests/e2e/verification-human-review.test.mjs:107` | Accepted authorized review is the sole service path to completion; rejected review is persisted without completion; records bind report, commit, surface, and authority | PASS |

## Independent discrimination sensor

The TLC validation ran in a detached disposable Git worktree. Changed implementation and focused tests were copied into that scratch tree; the active implementation worktree was never mutated. Each production mutation was restored before the next attempt, and the scratch worktree was removed after validation.

| Mutation | Behavior fault | Focused suite | Result |
| --- | --- | --- | --- |
| M1 | Bypass author/Verifier separation | unit | KILLED |
| M2 | Promote invalid inspected evidence to covered | unit | KILLED |
| M3 | Invert killed-mutant classification | mutation | KILLED |
| M4 | Invert aggregate PASS/FAIL verdict | unit + E2E | KILLED |
| M5 | Invert accepted/rejected Human Review behavior | E2E | KILLED |

Sensor depth is P0/full manual fault injection for this workflow-integrity boundary: 5/5 mutations killed, 0 survived. The final clean focused run passed 33/33 in the active worktree.

## Non-shallow checks

- All external values use closed-field runtime validation. TypeScript shape is never an authority boundary.
- The verifier report binds Workspace, run, Execution Package, commit, gate evidence, author, Verifier passport, every requirement, every criterion outcome, and every mutation result.
- Evidence inspection is independently ported and exact: a true-looking caller claim is insufficient without commit/outcome/assertion proof.
- Sensor success requires verified scratch isolation, expected test failure, bounded evidence reference, and identical active-state digests before, after, and after the complete run.
- Report persistence precedes workflow transition. Every failure gap is converted to a content-linked lesson; clean PASS emits no lesson noise.
- Human Review re-authenticates the stored report instead of trusting the caller's `PASS` field.
- Review authority is checked before persistence. A rejected review persists its exact finding set but never invokes the workflow completion command.
- The workflow machine remains the single owner of repair-cycle counting, fourth-loop escalation, Human Review entry, and terminal capsule request.
- No transcript, model session, credential, raw test output, shell command, or machine path enters a verification or review artifact.
- Standalone evidence review was used because this execution environment prohibits agent delegation. Product author-not-equal-verifier enforcement is implemented and tested independently of that tooling constraint.

## Code quality

| Check | Result |
| --- | --- |
| Scope limited to T60 | PASS |
| Closed, bounded inputs and outputs | PASS |
| Existing workflow authority reused | PASS |
| No unrelated files changed | PASS |
| Exact AC-to-test mapping | PASS |
| Spec-anchored outcomes, not shallow assertions | PASS |
| Full gate and P0 discrimination sensor | PASS |
| Project guidelines: TLC 3.2 and existing application patterns | PASS |

## Verdict

PASS for T60. Uncovered, vague, stale, mismatched, same-author, missing-mutation, surviving-mutant, invalid-sensor, fourth-loop, forged-report, stale-review, non-human, denied-authority, and rejected-review paths cannot complete a run. Verification is now an independently evidenced gate, while final completion remains a distinct authenticated Human Review decision.
