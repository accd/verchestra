# Budget Enforcement Design

## Components

```text
BudgetMeterPort (application layer, per run)
  ├── recordUsage(model, inputTokens, outputTokens)
  ├── projectedCost() / accumulatedCost()
  ├── shouldStop() → { stop: boolean, reason? }
  └── snapshot() → durable meter state (checkpointed)

ModelPriceTable (tracked, versioned data)
  └── { version, models: { [model]: { inputPerMToken, outputPerMToken } } }
```

## Integration Points (verified)

- **Event source**: driver `usage.updated` events with
  `inputTokens`/`outputTokens` — already emitted by
  `packages/drivers/src/claude-code-driver.ts`, `codex-driver.ts`,
  `opencode-driver.ts`, `pi-driver.ts` and covered by
  `tests/contract/*-driver.test.mjs`.
- **Consumption point**: `packages/application/src/execution/task-executor.ts`
  wraps `driver.execute` (line 423) and already handles cancellation
  (`driver.cancel`, line 499) and checkpoints (`saveCheckpoint`, line 377).
  The meter subscribes to the driver event stream inside `execute()`;
  `shouldStop()` is evaluated on every usage event and on a duration timer.
- **Declared budgets**: parsed and bounded in
  `packages/evidence/src/execution-package/execution-package.ts:550-594`;
  the executor already receives the package, so ceilings need no new
  plumbing.
- **Evidence sink**: Run Capsule (`packages/evidence/src/run-capsule/`)
  gains usage/cost fields via the schema generator in `schemas/` — never
  by editing generated output.

## Stop Semantics

Threshold reached → `driver.cancel(worktree.worktreeRef)` → checkpoint
saved with stage `budget-exceeded` carrying the meter snapshot → run state
recoverable by the existing resume path. The threshold percentage is
package-configurable, default 90%, so a human can approve continuation
with a fresh package before the hard ceiling.

## Unknown Model — Fail Closed

A usage event naming a model absent from the price table stops the run with
`VES_BUDGET_MODEL_UNKNOWN` (new public error code). Silent zero-cost is a
budget bypass and is treated as a security fault, covered in
`tests/security/`.

## Price Table Governance

- Tracked JSON data with a semver version; changes are reviewed like code.
- The version and the exact rates used are sealed into the capsule (BUD-05),
  so historical runs remain auditable even after price updates.

## Test Strategy

- Unit: accumulator math, threshold edges (exactly at, one token below/above),
  unknown model, zero-usage runs.
- Contract: each driver's `usage.updated` shape feeds the meter.
- Fault injection: synthetic driver floods usage events; run stops at the
  threshold with a valid checkpoint; resume works.
- E2E: tiny ceiling package executes a mock driver and stops with
  `budget-exceeded`; capsule shows declared versus consumed.
