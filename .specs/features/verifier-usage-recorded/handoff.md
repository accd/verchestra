---
schema: verchestra-feature-handoff/v1
feature: verifier-usage-recorded
issue: null
status: verification
branch: fix/verifier-usage-recorded
baseRevision: bde8ad93730c412d66bd3b01dd3f3c9f6ed10897
lastCompletedTask: T1
nextTask: "Independent verification and human review of the one pull request; the platform matrix before merge, because the new suites have run on macOS only; the decision is numbered at merge."
lastGate: "Node 24.14.0 macOS arm64 on the tree of the T1 commit: gate:quick PASS (unit 2504, agent-readiness 323, census 13); test:architecture 91; gate:build PASS (contract 756, integration 1029, e2e 259, build 146, qualification 302); gate:security PASS (security 1339, fault 310); task journeys 44; task composition and security 15; agent:check PASS; site:check PASS; 0 failed, 0 skipped, 0 todo; no provider called"
updatedAt: 2026-10-02T21:33:00Z
---

# Scope

One defect in the governed task path: the verifier's usage was metered against
the run's ceilings and never recorded, so a run reported fewer tokens than it
spent. Requirements VUR-01..12 in `spec.md`; one task and one pull request, in
`tasks.md`.

# Completed Evidence

T1: a run has one account of usage, the ledger its latest repair state carries.
`RunCheckpoints#recordBudgetLedger` (`apps/vestra-cli/src/task/task-run-record.ts`)
records usage metered after the repair loop ended: it keeps the stage, attempt
count and attempt chain the loop left, moves only the ledger, and refuses a
ledger that does not continue the recorded one. `meterOnRunLedger`
(`apps/vestra-cli/src/task/task-budget.ts`) builds the meter from that ledger,
records it back when each usage event is metered and once more when the work
ends; `TaskRunComposition#verify` (`apps/vestra-cli/src/task/task-run.ts`)
verifies inside it. `RuntimeCheckpointStore#inspectRepair` and `#recordRepair`
(`packages/platform-node/src/checkpoint-store-adapter.ts`) are the repair state
without a promise, and the port calls them.

Tests: `tests/integration/task-verifier-usage.test.mjs` (the metered work on a
real runtime store, the production verifier session against the labeled fake
`codex`, a real process killed after the verifier's usage, the ceilings),
seven cases at the Run record's interface in
`tests/integration/task-run-checkpoints.test.mjs`, one at the adapter in
`tests/integration/runtime-checkpoint-store.test.mjs`, one locality case, and
in `tests/e2e/task-cli-e2e.test.mjs` the corrected totals of three journeys
and two new journeys (a run killed during verification and resumed; a ceiling
the two providers reach only together). `docs/quick-start.md` and
`.specs/features/governed-task-cli/design.md` say what the reported usage
covers.

Every requirement is mapped in `validation.md`.

# Next Exact Action

Submit the pull request for independent verification and human review. The decision is AD-055 in `.specs/STATE.md`. Run the platform matrix before
it merges: `validation.md` lists what has never run off macOS.

# Blockers

None.

# Decisions

One entry in `.specs/STATE.md`: `AD-055`, a run has
one account of usage. Six open points for the reviewer are at the end of
`validation.md`; the first (the implementer's usage during an attempt that
never ended) and the live pilot's recording template need the owner.

# Files Intentionally Left Unchanged

`tests/unit/task-run-record.test.mjs` and the hardening suites (the ADP-2
goldens pass unmodified; no stored shape of the Run directory changed).
`packages/evidence` (the Run Capsule keeps its shape and digest rules).
`packages/application` (the meter, the repair loop and the executor are as
they were). `.specs/features/live-task-pilot/spec.md` and
`.specs/features/subscription-provider-auth/validation.md`, which describe the
reported usage as it was (listed in `validation.md`).
`.specs/features/architecture-deepening/spec.md`, `tasks.md` and `handoff.md`
(the coordinator owns them). `complexity-baseline.json`. `CHANGELOG.md` (it
has not tracked task-path changes since #405).
