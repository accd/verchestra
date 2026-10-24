---
schema: verchestra-feature-handoff/v1
feature: p1-pilot-remediation
issue: 406
status: in_progress
branch: docs/publish-qualification-8
baseRevision: d83fc139a84604de18e8acee416e4b48c237e539
lastCompletedTask: T5
nextTask: "T6, Front E, continues: .8 is built, signed, uploaded, verified live, published to npm as latest, and recorded as ledger sequence 8. Next the owner dispatches live-activation-matrix with base 0.0.0-qualification.7 and update 0.0.0-qualification.8 on five targets; then the pilot's spec.md §2 moves to .8, and P1 attempt 3, P2, P3, S1 to S3, and the coordinated pilots run on .8."
lastGate: "T6 publication record, on Windows x64 without symlink privilege under Node 24.14.0: tuf-publication-ledger 21 of 21 and agent:check PASS; gate:quick stages format, lint, complexity, typecheck, agent-readiness (357 of 357) and census PASS, and test:unit fails one case this change does not touch, task-billing.test.mjs:192, because the host refuses to create a symlink (EPERM). T5: gate:quick, contract, integration, security, architecture, e2e, fault, mutation, and agent:check PASS (validation.md)"
updatedAt: 2026-10-24T12:00:00Z
---

# Scope

Fix what the live pilot P1 (#406) revealed so that the pilots can run to human
review on a `.8` candidate: the model table, the model's availability, the
cause of a failure, and the pilot's own record. See `spec.md`.

# Completed Evidence

T1: `spec.md`, `tasks.md`, this handoff, and `validation.md`.

T2 (Front C): a conversation refused with a provider's own stable code ends
the run with it (`provider-child-run.ts`); the Codex driver names a missing
model `VES_CODEX_MODEL_UNAVAILABLE`; the verifier, the executor, and the
coordinated nodes hand on the first stable code the driver reported; a failed
run records it as its reason, and `status.lastReason` shows it. AD-083
(`.specs/STATE.md`). Evidence and mutations: `validation.md`.

T4 (Front A, stacked on T2): the price table lists subscription-only models by
driver with no price (version `2026.10.0`); a request admits a priced or a
subscription-only model; `start` and `resume` refuse a subscription-only model
on a provider set to an API key. AD-084 (`.specs/STATE.md`), `docs/quick-start.md`,
`validation.md`.

T3 (Front B, stacked on T4): the Codex driver checks models (`modelsToCheck`),
and `prepare` runs one such session on the verifier's subscription login before
the lease, a transition, or the worktree: account and models for a v2 run,
models alone for a v1 run. AD-085 (`.specs/STATE.md`), `docs/quick-start.md`,
`validation.md`.

T5 (Front D, stacked on T3): P1 attempts 1 and 2 recorded in
`live-task-pilot/validation.md` with the stop rule, the deviations, and the
diagnostic gap; `spec.md` amended (§3, §4, §6) and the seven requests moved to
the `gpt-5.5` verifier with their new digests; the three coordinated examples
and `coordinated-run-pilots.md` name `gpt-5.5`.

T6 (Front E), the publication only: the `.8` candidate (run `40022535213` at
`d83fc13`) carries A to D. It was signed by run `40075964146` (metadata version
7, rollback bound to `.7`), uploaded under `v8/`, verified live, published to
npm as `latest` on 2026-10-24, and recorded as ledger sequence 8. Evidence:
`live-activation-matrix/validation.md`, "TUF publication of
`0.0.0-qualification.8`". The live update from `.7` and the pilot round remain,
so PPR-10 is not met yet.

# Blockers

None for the publication. The rest of T6 needs the owner: the dispatch of
`live-activation-matrix` from `.7` to `.8`, the extra usage of the Claude and
ChatGPT accounts switched off before the coordinated pilots, and the earlier
delegated approvals (D1, D1b, D10, the amendments, D11, and D8).

# Next Action

The owner dispatches `.github/workflows/live-activation-matrix.yml` from `main`
with `base_version=0.0.0-qualification.7` and
`update_version=0.0.0-qualification.8`, and its five-target result is recorded
in `live-activation-matrix/validation.md`, as for `.6` to `.7`. Then the
pilot's `spec.md` §2, which names `.7`, is amended to `.8`, and the pilots run
on `.8` as the `nextTask` states it.

# Files Intentionally Left Unchanged

The pilot's `spec.md` §2 (the candidate) and §8 (the steps): the candidate they
name changes with the publication, and the steps do not. The pilot's probes, its
target, its revision, its tasks, and its limits.

# Known Risks Declared in Advance

- The public error of `codex-model-unavailable` carries the requirement alone;
  the model's name is on the terminal, as the plan type's is. The plan asked
  for it in the safe details, and `VES_TASK_NOT_CONFIGURED` declares one detail,
  `requirement`, so naming a model there extends a public schema (AD-085).
- The Claude Code subscription-only names (`claude-fable-5-1`, `claude-opus-5-5`,
  `claude-sonnet-5-5`) come from the model identifiers of the Claude Code
  environment; `claude --help` confirms only the aliases and the name
  `claude-fable-5`. No provider was called to confirm that the owner's account
  accepts them. The Codex names are the account's own `model/list` of the pilot.
- A v1 verifier whose session fails on a usage limit now records
  `VES_CODEX_EXECUTION_FAILED`, where it recorded `VES_TASK_VERIFIER_FAILED`.
  SSI-83 still holds (the run fails, it does not suspend); only the recorded
  reason is the driver's. One pinned expectation moved for this.
- A run whose verifier fails with the generic `VES_TASK_VERIFIER_FAILED` now
  records that code as its reason, where it recorded `VES_TASK_FAILED`
  (AD-056 declined to publish it as a new outcome reason; AD-083 supersedes
  that for the verifier because the owner asked every `status` to say why).
