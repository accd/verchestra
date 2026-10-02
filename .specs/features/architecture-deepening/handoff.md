---
schema: verchestra-feature-handoff/v1
feature: architecture-deepening
issue: null
status: in_progress
branch: docs/architecture-deepening-spec
baseRevision: d58a25f3d80a720000bbdd4cbbc8650cdc8c9686
lastCompletedTask: null
nextTask: "TA1 — gather evidence for isolating Claude Code without --bare; then TA2. T5, T6a, T7a and T8 can run beside it."
lastGate: pnpm agent:check
updatedAt: 2026-10-02T09:00:00Z
---

# Scope

Deepen eight areas found by the 2026-10-01 architecture review, and let the
governed task path authenticate providers through subscriptions.

# Completed Evidence

The review and its eight candidates are summarized in `spec.md`. The owner
approved the plan on 2026-10-02, including the two behaviour fixes (SHA-256
idle cancel and process-tree termination).

# Next Exact Action

Start TA1. Each task records evidence in `validation-<id>.md` and proves itself
on the platform matrix before merge where the task path, the drivers or the
runtime store change.

# Blockers

None.
