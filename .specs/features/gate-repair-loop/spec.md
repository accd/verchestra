# Gate Repair Loop Specification

## Problem Statement

When a gate fails, `gate-commit.ts:519-528` saves a `gate-failed` state with
the failed gate id and a `GATE_FAILED` driver result — and the semantics end
there. Nothing declares what happens next: no retry budget, no channel for
feeding the gate failure back to the driver, no escalation condition for a
human. This is the difference between a harness (executes and reports) and
an orchestrator (converges). The repair policy must be declared in the
Execution Package so the evidence shows the path, not just the destination.

## Goals

- A declarative per-gate repair policy in the Execution Package:
  `onGateFailure: { maxAttempts, feedbackToDriver, escalateAfter }`.
- Every repair attempt recorded as its own Run Capsule, so the evidence
  trail shows each iteration.
- Deterministic escalation to human review when attempts are exhausted.
- Fail-closed defaults: a package without a repair policy attempts once,
  exactly as today.

## Out of Scope

| Exclusion | Reason |
| --- | --- |
| Automatic gate redefinition or self-modifying packages | The package is sealed; repair never rewrites declared gates. |
| Model-driven diagnosis of gate failures | Feedback passes gate output verbatim and bounded; interpretation is the driver's existing job. |
| Cross-task repair orchestration | Per-task repair first; the dependency-graph scheduler is deferred (R7). |
| Weakening any gate to make repair "succeed" | Forbidden by root instructions; repair re-runs the same gate against new work. |

## Acceptance Criteria

1. **REP-01** — WHEN an Execution Package declares `onGateFailure` for a
   gate THEN schema validation SHALL bound `maxAttempts >= 1`,
   `feedbackToDriver` as a boolean, and `escalateAfter` within
   `[1, maxAttempts]`, generated through the schema generator.
2. **REP-02** — WHEN a gate fails and attempts remain THEN the executor
   SHALL re-dispatch the task to the driver with the failed gate's bounded
   output appended as feedback, and each attempt SHALL produce a distinct
   Run Capsule linked to the previous attempt by digest.
3. **REP-03** — WHEN a gate fails and `feedbackToDriver` is false THEN the
   executor SHALL retry without feedback, and the capsule SHALL record that
   feedback was withheld by policy.
4. **REP-04** — WHEN attempts reach `escalateAfter` THEN the run SHALL stop
   in a recoverable `escalated` state requiring human review, with the full
   attempt chain available as evidence, and SHALL NOT retry further without
   a new human decision.
5. **REP-05** — WHEN a package declares no `onGateFailure` THEN behavior
   SHALL be exactly one attempt followed by the existing `gate-failed`
   terminal state, preserving current semantics and tests.
6. **REP-06** — WHEN feedback is constructed THEN it SHALL pass through the
   existing egress and redaction boundaries, and feedback content SHALL be
   bounded in size with a recorded digest.

## Design Constraints

- Repair state lives in checkpoints (`task-executor.ts:377,475`), so an
  interrupted repair loop resumes idempotently.
- Attempt capsules form a digest-linked chain; no attempt mutates or
  replaces a previous capsule.
- Escalation is a workflow state requiring human acceptance, consistent
  with the repository safety principle that accountability changes need
  human review.

## Requirement Traceability

| Requirement | Task | Status |
| --- | --- | --- |
| REP-01 | T1 | Pending |
| REP-02, REP-03, REP-06 | T2, T3 | Pending |
| REP-04 | T4 | Pending |
| REP-05 | T2 | Pending |

## Success Criteria

- A failing-then-passing gate converges within the declared attempts, with
  one capsule per attempt.
- A permanently failing gate escalates exactly at `escalateAfter` and stops.
- Existing single-attempt behavior is byte-identical for packages without
  a repair policy.
