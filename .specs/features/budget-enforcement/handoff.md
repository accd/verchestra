---
schema: verchestra-feature-handoff/v1
feature: budget-enforcement
issue: 52
status: verification
branch: fix/run-scoped-budget-enforcement
baseRevision: e534c497d91e29cf95ed1dc5ad335bc2ecc2a0e3
lastCompletedTask: T6
nextTask: Independent verification and human review of the run-scoped budget pull request
lastGate: pnpm gate:security
updatedAt: 2026-07-30T10:42:00Z
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

T6 (issue #124): the declared budget is now a run budget rather than a
per-executor-call budget. `createBudgetMeter` accepts a `resume` ledger and
backdates its start clock, so cost, tokens, and elapsed time all continue across
attempts and across a crash; a resumed ledger is validated like any other
persisted input, because winding consumption backwards buys a fresh ceiling.
The executor accepts a supplied meter through `options.budgetMeter` - options,
not input, since input is normalized and deep-frozen and a meter is a live
object - arms its duration timer from `remainingDurationMs()` instead of a fresh
90% share, and refuses to start a driver at all when the meter arrives already
exhausted. `runGateRepairLoop` builds one meter for the run through an optional
`budget.create(resume)` port, hands it to every attempt, persists the ledger in
repair state, and terminates with a distinct `BUDGET_EXCEEDED` outcome. That
outcome deliberately wins over `ESCALATED`: escalation invites a human to
approve further attempts, and there is nothing left to spend on them.

Evidence for T6: 21 run-scoped integration tests plus 3 executor
fault-injection tests. Discrimination sensor 9/9 KILLED - meter created per
attempt, both budget checks removed, ledger not persisted, resume ignoring
elapsed time, resume accepting negative values, executor ignoring the supplied
meter, timer using a fresh threshold, and budget losing to escalation.
`pnpm gate:full` PASS, `pnpm gate:security` PASS, `pnpm agent:check` PASS.

# Next Exact Action

Independent verification and human review of the T68b pull request; then the
completion pull request with `docs/qualification/t68b-validation.md` under the
report contract, which requires the reviewed-in pull request URL and an
implementation revision reachable from main.

# Blockers

Merging. Every open pull request is authored by the sole code owner, and the
ruleset requires an approving code-owner review, so no branch can satisfy it -
issue #126. This branch is complete and gated; it cannot land until that is
decided.

#124 is fixed here, so the earlier note that it belonged to #64 no longer
applies. The port seam turned out to be enough: the loop owns the meter's
lifetime through `budget.create`, and the caller keeps the pricing knowledge, so
no composition root was required to make the ceiling hold. What #64 still owns is
wiring a real `budget.create` from a parsed Execution Package, and sealing the
run-aggregate ledger into `budgetEvidence` alongside per-attempt consumption -
the loop persists the ledger in repair state today, but nothing seals it yet.

# Decisions

- Unknown model fails closed; silent zero-cost is a security fault.
- Threshold default 90%, package-configurable; stop is recoverable, never
  a process kill.
- Provider usage figures are recorded as claims, not verified billing facts.
- The declared ceiling is a run ceiling. A repair loop spends from one budget,
  never one per attempt (#124).
- `BUDGET_EXCEEDED` is a distinct outcome from `GATE_FAILED` and `ESCALATED`. A
  run that ran out of money did not fail its gate; it never finished.
- A resumed ledger is untrusted input. Negative, fractional, or infinite
  consumption fails closed rather than granting a fresh ceiling.

# Files Intentionally Left Unchanged

- `run-capsule.ts`: `budgetEvidence` still seals one snapshot. Distinguishing
  run-aggregate from per-attempt consumption in sealed evidence belongs with the
  wiring in #64, and inventing the shape before there is a producer would be
  guessing.
- Context priority budgets (`maximumTokens`), owned by the
  context-tokenizers decision.
