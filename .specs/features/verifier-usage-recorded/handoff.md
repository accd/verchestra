---
schema: verchestra-feature-handoff/v1
feature: verifier-usage-recorded
issue: null
status: verification
branch: fix/run-usage-complete
baseRevision: d9dc5d5b32405bfa2fbc2675be4d81a175152f80
lastCompletedTask: T4
nextTask: "Independent verification and human review of the second pull request (T2, T3, T4); the platform matrix before merge, because the new suites have run on macOS only; the decision is numbered at merge; the owner amends the live pilot's recording template."
lastGate: "Node 24.14.0 macOS arm64 on the tree of the T4 commit: gate:quick PASS (unit 2504, agent-readiness 323, census 13); test:architecture 93; gate:build PASS (contract 782, integration 1056, e2e 261, build 146, qualification 329); gate:security PASS (security 1339, fault 310); task journeys 46; task composition and security 15; agent:check PASS; site:check PASS; 0 failed, 0 skipped, 0 todo; no provider called"
updatedAt: 2026-10-02T22:27:09Z
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

Submit the range `d9dc5d5..` the tip of `fix/run-usage-complete` for
independent verification and human review. The decision is AD-056 in `.specs/STATE.md`. Run the platform matrix before it merges. The owner amends
`.specs/features/live-task-pilot/spec.md`: `validation.md` lists the four
statements with their lines.

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
