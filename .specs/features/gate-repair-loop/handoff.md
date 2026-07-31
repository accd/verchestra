---
schema: verchestra-feature-handoff/v1
feature: gate-repair-loop
issue: 53
status: complete
branch: feat/t68c-gate-repair-loop
baseRevision: f228e4ac331e843e340ff770141e768091b7bc7c
lastCompletedTask: T4
nextTask: Independent verification and human review of the T68c pull request
lastGate: pnpm gate:security
updatedAt: 2026-07-30T00:54:14Z
---

# Scope

Declarative gate repair loop: `onGateFailure` in the Execution Package,
per-attempt Run Capsules, bounded redacted driver feedback, and
human-escalation semantics (review item R3). Roadmap task T68c.

# Completed Evidence

Specification, design, and tasks written from verified code reading:
`gate-commit.ts:519-528` records `gate-failed` with no follow-up semantics;
`task-executor.ts` checkpoints at `awaiting-gate` (:475) and already owns
the driver re-dispatch path.

T1-T4 implemented in one pull request: the declared policy, the loop, feedback
bounding, and escalation are one convergence concern.

T1: the Execution Package gains optional onGateFailure - maxAttempts within
[1, 5], feedbackToDriver, escalateAfter within [1, maxAttempts] - validated in
the hand-written package validator (D2 precedent: only four generated schemas
exist, and the package is not one of them). Absent policy means today's exact
semantics.

T2-T4: runGateRepairLoop in packages/application/src/execution/gate-repair.ts
is a ports-driven coordinator above executor and gate-commit. Attempt counts
and the capsule chain are durable state, so a crash between attempts resumes
without double-running; each attempt seals a capsule chained through
previousAttemptDigest; feedback is bounded to 16,384 bytes and fails closed
when the builder exceeds it; withheld feedback is recorded as a decision.
Escalation wins over retries at the declared point, and exhausting a declared
policy escalates rather than silently failing - declaring a repair loop is
opting into a human deciding what happens when repair does not converge.

Evidence: 14 loop integration tests, 9 package policy tests. Discrimination
sensor 5/5 KILLED: escalation removed, byte budget unenforced, recovered state
ignored, default-policy escalation, and package accepting escalateAfter past
maxAttempts. gate:full PASS, gate:security PASS.

# Next Exact Action

Independent verification and human review of the T68c pull request; then the
completion pull request with docs/qualification/t68c-validation.md under the
report contract.

# Blockers

None.

# Decisions

- Packages without a repair policy keep byte-identical single-attempt
  behavior.
- Escalation is terminal until a human decision; no autonomous retry past
  `escalateAfter`.
- Repair never rewrites sealed gates; it re-runs the same gate on new work.

# Files Intentionally Left Unchanged

- All product code and tests (specification-only so far).
- Cross-task scheduling (deferred review item R7).
