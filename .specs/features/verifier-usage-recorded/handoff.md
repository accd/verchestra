---
schema: verchestra-feature-handoff/v1
feature: verifier-usage-recorded
issue: null
status: complete
branch: main
baseRevision: 150056e99c9442daf7905ed28cbabf290fdfacf2
lastCompletedTask: T4
nextTask: "No further action for this feature: T1 merged as #478 (AD-055) and T2-T4 as #479 (AD-056). The live pilot pre-registration still describes the old meaning of checkpoints.budget; it is amended in the pilot's own change before any run on a release that carries this feature."
lastGate: "Platform matrix PASS on five targets before each merge (#478: build 37067697399, security 37067700952; #479: build 37072700713, security 37072703814); required checks and SonarCloud PASS"
updatedAt: 2026-10-03T00:00:00Z
---

# Scope

A run has one account of usage. T1 (merged, AD-055) recorded the verifier's
usage on the run's ledger. T2, T3 and T4 close the three gaps T1 recorded: the
implementer's usage is recorded as it arrives, a budget stop names itself, and
a verifier does not start when the run's ceiling was already reached.
Requirements VUR-01..20 in `spec.md`; four tasks in two pull requests, in
`tasks.md`.

# Completed Evidence

T1 (merged): `RunCheckpoints#recordBudgetLedger`
(`apps/vestra-cli/src/task/task-run-record.ts`), `meterOnRunLedger`
(`apps/vestra-cli/src/task/task-budget.ts`), `TaskRunComposition#verify`
inside it (`apps/vestra-cli/src/task/task-run.ts`), and the repair state
without a promise (`packages/platform-node/src/checkpoint-store-adapter.ts`).

T2: `recordingMeter` in `task-budget.ts`, handed to the repair loop by
`TaskRunComposition#repair` and to verification by `meterOnRunLedger`; the
stage of a run without a repair state taken from its gate checkpoint
(`RunCheckpoints` in `task-run-record.ts`). Tests:
`tests/integration/task-run-usage.test.mjs` (a task run composed in process as
the composition composes it, killed at each point usage can arrive and
resumed), one case in `tests/integration/task-run-checkpoints.test.mjs`, the
locality case, and in `tests/e2e/task-cli-e2e.test.mjs` a run killed at its
gate, a run killed after its implementer reported usage, and the two
interrupted-provider journeys.

T3: `meterOnRunLedger` rethrows a task failure whose reason is the budget's
under that code. Tests: four cases in `task-run-usage.test.mjs`, the three
metered verifier sessions of `tests/integration/task-verifier-usage.test.mjs`,
and the reason `start` prints in the ceiling journey.

T4: `runCodexVerifier` (`apps/vestra-cli/src/task/task-codex.ts`) refuses
before anything of the session exists when the meter already says stop. Tests:
one case in `tests/integration/codex-verifier-session.test.mjs`, two in
`task-run-usage.test.mjs`, and a journey whose gate is held past its duration
ceiling. `docs/quick-start.md` and
`.specs/features/governed-task-cli/design.md` say what is recorded and what
cannot be.

Every requirement is mapped in `validation.md`.

# Next Exact Action

None for this feature. T1 merged as #478 (`d9dc5d5`, with one test variable
renamed so that CodeQL would not read it as a secret) and T2-T4 as #479
(`150056e`). Still open and recorded in `validation.md`: a converged attempt
whose duration ceiling passed during its gates is committed before
verification refuses.

The live pilot's `spec.md` (§5 S2 and §7) describes `checkpoints.budget` as
the implementer's usage. That is true of `0.0.0-qualification.5`, which
predates this feature, and false of any later release. The pilot's own change
amends it before a run on such a release.

# Blockers

None.

# Decisions

Two entries in `.specs/STATE.md`: AD-055 (T1, a run has one account of usage)
and `AD-056` (T2–T4, the account is complete). Open
points for the reviewer are at the end of `validation.md`.

# Files Intentionally Left Unchanged

`packages/application` (the meter, the repair loop, the executor and the task
run coordinator are as they were) and `packages/evidence` (the Run Capsule
keeps its shape and digest rules). `tests/unit/task-run-record.test.mjs` and
the hardening suites (the ADP-2 goldens pass unmodified).
`.specs/features/live-task-pilot/` (the coordinator owns its amendment) and
`.specs/features/subscription-provider-auth/validation.md`, which describe the
reported usage as it was. `.specs/features/architecture-deepening/spec.md`,
`tasks.md` and `handoff.md`. `complexity-baseline.json`. `CHANGELOG.md`.
