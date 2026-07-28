---
schema: verchestra-feature-handoff/v1
feature: gate-repair-loop
issue: 53
status: planned
branch: main
baseRevision: 9029f3ee566d18fbf2c7ce5508cabe9459ade42f
lastCompletedTask: null
nextTask: T1
lastGate: null
updatedAt: 2026-07-28T23:41:40Z
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

# Next Exact Action

T1: add `onGateFailure` to the Execution Package schema in `schemas/` and
regenerate contract types; bound `maxAttempts`, `feedbackToDriver`,
`escalateAfter`.

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
