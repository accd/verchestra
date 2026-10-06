---
schema: verchestra-feature-handoff/v1
feature: p1-pilot-remediation
issue: 406
status: in_progress
branch: feat/subscription-only-models
baseRevision: 8056d41b5ab615ce7dc536db400e09f136565c61
lastCompletedTask: T4
nextTask: "T3, Frente B: check the account's model list for the verifier and every Codex node in prepare, before the worktree and before the implementer's allowance."
lastGate: "T4: gate:quick, contract, integration, security, architecture, e2e, fault, mutation, and agent:check PASS under Node 24.14.0; five mutants killed (validation.md)"
updatedAt: 2026-10-06T23:00:00Z
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

# Blockers

None for T3 to T5. T6 needs the owner: the `npm publish --tag latest --access
public` of the `.8` candidate with a 2FA code, the extra usage of the Claude and
ChatGPT accounts switched off before the coordinated pilots, and the earlier
delegated approvals (D1, D1b, D10, the amendments, D11, and D8).

# Next Action

T3, Frente B, as `tasks.md` states it. The driver's code
`VES_CODEX_MODEL_UNAVAILABLE` and the verifier's reason it produces are in
place; B moves the check before the worktree and turns the end-to-end case of
`tests/e2e/task-failure-cause-e2e.test.mjs` for the verifier and the Codex node
into a refusal at `start`.

# Files Intentionally Left Unchanged

The pilot's pre-registration (`live-task-pilot/`) is not changed until T5,
which records the P1 stop and amends the requests as a dated amendment. The
runtime check of a model's availability (the account-only session) is T3's.

# Known Risks Declared in Advance

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
