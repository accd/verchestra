---
schema: verchestra-feature-handoff/v1
feature: budget-enforcement
issue: 52
status: planned
branch: main
baseRevision: 9029f3ee566d18fbf2c7ce5508cabe9459ade42f
lastCompletedTask: null
nextTask: T1
lastGate: null
updatedAt: 2026-07-28T23:41:40Z
---

# Scope

Turn the dead `maximumCostUsd` / `maximumDurationMs` package fields into an
enforced control: per-run usage accumulator fed by driver `usage.updated`
events, versioned price table, threshold stop via the existing
cancel-plus-checkpoint path, and actual spend sealed into Run Capsules
(review item R2). Roadmap task T68b.

# Completed Evidence

Specification, design, and tasks written from verified code reading: budget
fields exist only in `execution-package.ts`; all four drivers emit
`usage.updated`; `task-executor.ts` already owns cancel and checkpoint
machinery at lines 377, 423, 499.

# Next Exact Action

T1: define `BudgetMeterPort` and the `VES_BUDGET_MODEL_UNKNOWN` /
threshold error codes through the schema generator.

# Blockers

None.

# Decisions

- Unknown model fails closed; silent zero-cost is a security fault.
- Threshold default 90%, package-configurable; stop is recoverable, never
  a process kill.
- Provider usage figures are recorded as claims, not verified billing facts.

# Files Intentionally Left Unchanged

- All product code and tests (specification-only so far).
- Context priority budgets (`maximumTokens`), owned by the
  context-tokenizers decision.
