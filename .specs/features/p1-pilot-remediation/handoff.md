---
schema: verchestra-feature-handoff/v1
feature: p1-pilot-remediation
issue: 406
status: in_progress
branch: feat/codex-model-availability
baseRevision: 8056d41b5ab615ce7dc536db400e09f136565c61
lastCompletedTask: T3
nextTask: "T5, Frente D: record the P1 stop, the deviation, and the diagnostic gap in live-task-pilot/validation.md, amend spec.md section 6 and the seven requests to the gpt-5.5 verifier with their new digests, and move the coordinated examples to models the account offers."
lastGate: "T3: gate:quick, contract, integration, security, architecture, e2e, fault, mutation, and agent:check PASS under Node 24.14.0; eight mutants killed (validation.md)"
updatedAt: 2026-10-07T00:00:00Z
---

# Scope

Fix what the live pilot P1 (#406) revealed so that the pilots can run to human
review on a `.8` candidate: the model table, the model's availability, the
cause of a failure, and the pilot's own record. See `spec.md`.

# Completed Evidence

T1: `spec.md`, `tasks.md`, this handoff, and `validation.md`.

T2 (Frente C): a conversation refused with a provider's own stable code ends
the run with it (`provider-child-run.ts`); the Codex driver names a missing
model `VES_CODEX_MODEL_UNAVAILABLE`; the verifier, the executor, and the
coordinated nodes hand on the first stable code the driver reported; a failed
run records it as its reason, and `status.lastReason` shows it. AD-083
(`.specs/STATE.md`). Evidence and mutations: `validation.md`.

T4 (Frente A, stacked on T2): the price table lists subscription-only models by
driver with no price (version `2026.10.0`); a request admits a priced or a
subscription-only model; `start` and `resume` refuse a subscription-only model
on a provider set to an API key. AD-084 (`.specs/STATE.md`), `docs/quick-start.md`,
`validation.md`.

T3 (Frente B, stacked on T4): the Codex driver checks models (`modelsToCheck`),
and `prepare` runs one such session on the verifier's subscription login before
the lease, a transition, or the worktree: account and models for a v2 run,
models alone for a v1 run. AD-085 (`.specs/STATE.md`), `docs/quick-start.md`,
`validation.md`.

# Blockers

None for T5. T6 needs the owner: the `npm publish --tag latest --access
public` of the `.8` candidate with a 2FA code, the extra usage of the Claude and
ChatGPT accounts switched off before the coordinated pilots, and the earlier
delegated approvals (D1, D1b, D10, the amendments, D11, and D8).

# Next Action

T5, Frente D, as the `nextTask` states it. The models it names are the ones the
table lists (T4) and the account offers (T3 refuses the others at `start`).

# Files Intentionally Left Unchanged

The pilot's pre-registration (`live-task-pilot/`) is not changed until T5,
which records the P1 stop and amends the requests as a dated amendment.

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
