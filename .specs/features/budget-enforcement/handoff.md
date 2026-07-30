---
schema: verchestra-feature-handoff/v1
feature: budget-enforcement
issue: 52
status: verification
branch: feat/t68b-budget-enforcement
baseRevision: f228e4ac331e843e340ff770141e768091b7bc7c
lastCompletedTask: T5
nextTask: Independent verification and human review of the T68b pull request
lastGate: pnpm gate:security
updatedAt: 2026-07-30T00:39:24Z
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

T1-T5 implemented in one pull request, since the meter, price table, executor
integration, and capsule evidence are one enforcement concern.

T1/T2: `createBudgetMeter` in `packages/application/src/execution/
budget-meter.ts` accumulates cost and tokens from usage events, evaluates the
90% threshold against all three declared ceilings, and retains the first stop
reason. Codes: `VES_BUDGET_MODEL_UNKNOWN`, `VES_BUDGET_USAGE_INVALID`,
`VES_BUDGET_INVALID`. Codes are pattern-validated public errors; no generated
schema exists for them (decision D2 of the codeql-alert-remediation feature),
so the tasks-file line about the schema generator did not survive contact with
the repository - only four generated schemas exist and error codes are not
one of them.

T3: `model-price-table.ts` is tracked, versioned data reviewed like code,
seeded from provider list prices and flagged HUMAN REVIEW REQUIRED. An
unpriced model fails closed rather than running at silent zero cost.

T4: the executor accepts optional declared `budgets` in its input, hands
drivers a `reportUsage` callback, enforces duration with its own timer so a
silent driver cannot outrun its deadline, checkpoints stage `budget-exceeded`
with the meter snapshot, cancels the driver, and makes the budget outcome win
over the driver's own cancellation report (`VES_EXECUTOR_BUDGET_EXCEEDED`).

T5: the Run Capsule gains optional `budgetEvidence` - declared versus
consumed, the sealed price-table version, and the stop reason - extending the
hand-written validator with strict numeric checks.

Evidence: 17 meter unit tests, 9 executor fault-injection tests (usage flood,
unknown model, silent driver, precedence, no-budget compatibility, malformed
budgets), 9 capsule evidence tests. Discrimination sensor 5/5 KILLED: silent
zero-cost for unknown models, threshold off-by-one, budget-losing-to-cancelled,
duration timer removal, and negative-cost capsule evidence. The silent-driver
fixture self-limits so the timer mutation fails fast instead of hanging the
runner - the #88 lesson applied. `pnpm gate:full` PASS, `pnpm gate:security`
PASS.

# Next Exact Action

Independent verification and human review of the T68b pull request; then the
completion pull request with `docs/qualification/t68b-validation.md` under the
report contract, which requires the reviewed-in pull request URL and an
implementation revision reachable from main.

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
