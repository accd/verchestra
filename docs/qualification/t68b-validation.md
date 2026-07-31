---
schema: verchestra-qualification-report/v1
task: T68b
revision: 46d22d830efaf4ffe75553517476594c9ae15eda
gates: pnpm gate:quick, pnpm gate:security
gateResults: pass, pass
gateRevision: 46d22d830efaf4ffe75553517476594c9ae15eda
criteriaEvidence: 6 of 6 acceptance criteria proven
skipped: 0
todo: 0
discriminationSensor: 7 killed, 0 survived
reviewedIn: https://github.com/accd/verchestra/pull/143
---

# T68b Budget Enforcement Validation

## Scope

T68b turns `budgets.maximumCostUsd`, `budgets.maximumTokens`, and
`budgets.maximumDurationMs` from fields that were parsed, bounded, digested and
then ignored into an enforced control. A per-run meter accumulates the
`usage.updated` events every qualified driver already emits, prices them through
a versioned table, and stops the run through the executor's existing
cancel-and-checkpoint path at a configured share of the declared ceiling.
Consumed spend is sealed into the Run Capsule beside the declared ceiling.

59 cases across four suites, against a declared minimum of 18.

| Suite | Cases |
| --- | --- |
| `tests/unit/budget-meter.test.mjs` | 17 |
| `tests/integration/run-scoped-budget.test.mjs` | 21 |
| `tests/integration/run-capsule-budget-evidence.test.mjs` | 9 |
| `tests/fault-injection/budget-enforcement-faults.test.mjs` | 12 |

## Deterministic gates

Both gates ran on a clean checkout detached at the implementation revision,
dispatched through `full-validation.yml` rather than on a developer machine. The
uploaded artifact of each run records the revision and the profile it ran.

| Command | Result |
| --- | --- |
| `pnpm gate:quick` | PASS — [run 30670820650](https://github.com/accd/verchestra/actions/runs/30670820650) |
| `pnpm gate:security` | PASS — [run 30670822421](https://github.com/accd/verchestra/actions/runs/30670822421) |

No profile is a superset of another, so each is listed with what it ran:

| Profile | Stages |
| --- | --- |
| `gate:quick` | `format:check`, `lint`, `typecheck`, `test:unit`, `test:agent-readiness` |
| `gate:security` | `format:check`, `lint`, `typecheck`, `build`, `test:unit`, `test:architecture`, `test:qualification`, `test:security`, `test:fault` |

External attestation matters here for a reason this task discovered. An earlier
`gate:security` run of a different task passed on a developer machine and failed
on a clean runner, because that machine happened to have the qualified driver
binaries installed. Evidence that depends on whose machine produced it is not
portable evidence.

## Adequacy matrix

Anchored in `.specs/features/budget-enforcement/spec.md`.

| Criterion | Requirement | Assertion |
| --- | --- | --- |
| BUD-01 | Usage events accumulate per run; no events means zero | `budget-meter.test.mjs` — accumulation across events, and a meter with no events reporting zero cost and zero tokens |
| BUD-02 | Price-table version recorded; unknown model fails closed | `budget-meter.test.mjs` — `VES_BUDGET_MODEL_UNKNOWN`; `run-capsule-budget-evidence.test.mjs` seals `priceTableVersion` |
| BUD-03 | Cost threshold stops through cancel plus checkpoint, recoverable | `budget-enforcement-faults.test.mjs` — a usage flood stops at the threshold with a `budget-exceeded` checkpoint carrying the meter snapshot, the driver cancelled, the worktree cleaned and coordination released |
| BUD-04 | Duration threshold stops with the same semantics | `budget-enforcement-faults.test.mjs` — a silent driver is stopped by the executor's own timer, armed from the run's remaining duration |
| BUD-05 | Capsule carries declared versus consumed and the price-table version | `run-capsule-budget-evidence.test.mjs` — declared-versus-consumed seals and survives verification; a capsule without budget evidence still seals, so older runs stay valid |
| BUD-06 | Thresholds outside `(0, 100]` and non-positive ceilings rejected | `budget-meter.test.mjs` — `VES_BUDGET_INVALID` on out-of-range thresholds and non-positive ceilings; negative and fractional usage counts rejected as `VES_BUDGET_USAGE_INVALID` |

## Discrimination sensor

Each mutation was applied to the implementation, the four suites re-run, and the
source restored.

| Mutation | Criterion | Result |
| --- | --- | --- |
| An unpriced model returns instead of failing, so an unknown model runs free | BUD-02 | KILLED |
| The threshold compares against the raw ceiling rather than its configured share | BUD-03 | KILLED |
| Accumulation drops input tokens and counts only output | BUD-01 | KILLED |
| The duration branch of the threshold evaluation is removed | BUD-04 | KILLED |
| The budget outcome stops winning over the driver's own cancellation report | BUD-03 | KILLED |
| The capsule accepts a negative consumed amount | BUD-05 | KILLED |
| The repair loop rebuilds the meter per attempt instead of resuming it | BUD-03 | KILLED |

The last one is the defect this task shipped and then corrected. The meter was
originally constructed inside a single `execute()` call while the gate repair
loop calls the executor up to five times, so every attempt received a fresh
threshold and a declared run ceiling could be spent once per attempt. Neither
T68b nor T68c could have caught it alone: one has no loop, the other has no
meter. It was filed as #124 and fixed in the revision this report names, which
is why `46d22d8` and not the original `43050df` is the implementation revision.

## Non-shallow checks

- A stop is recoverable, never a process kill: the executor cancels the driver
  and checkpoints stage `budget-exceeded` with the meter snapshot, and the
  worktree and coordination lease are released on that path.
- An unpriced model fails closed rather than running at silent zero cost, which
  is the difference between a budget and a suggestion.
- A resumed ledger is validated as untrusted input. Winding consumption
  backwards on resume would buy a fresh ceiling, so negative, fractional, and
  infinite values are rejected.
- Provider usage figures are recorded as claims, not as verified billing facts.
  Reconciliation against a billing API is explicitly out of scope in the
  specification, and this report does not imply it.

## Verdict

T68b is complete for its declared scope. Six of six acceptance criteria have
file-and-assertion evidence, both declared gates pass on the implementation
revision through external runs, and every mutation in the sensor was killed.

What this report does not assert: independent verification, or recorded human
acceptance. `docs/qualification/REPORT-CONTRACT.md` is explicit that neither is
a field here, and this repository has one collaborator, so independence for the
maintainer's own work is not obtainable by configuration - a limitation
`docs/merge-governance.md` states rather than implies.
