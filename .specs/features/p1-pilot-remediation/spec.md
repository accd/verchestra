# P1 pilot remediation: what the first live pilot revealed (#406)

## Status

In progress. This feature fixes what the live pilot P1 of `vestra task` (#406,
`verchestra@0.0.0-qualification.7`, a real subscription login) revealed, so
the pilots can run to their end on a `.8` candidate. It is a defect fix and a
diagnostic repair. It makes no release claim: the candidate stays
`0.0.0-qualification` and the signed reject of #18 stands.

## What P1 showed

The implementer, Claude Code with `claude-sonnet-5`, ran through the mediated
tools (two receipts), the gate passed, and the task commit was made on an
isolated branch. The usage, about 6 thousand tokens, was counted as not billed
(subscription). The verifier then asked for `gpt-5.2-codex`, a model the
ChatGPT account does not offer, and the run ended as `VES_TASK_FAILED` with no
cause. Two defects:

1. **The model table is out of date.** `model-price-table.ts` (table
   `2026.7.0`) knows one Codex model, and a request names only a model that
   has a price, even on a subscription that bills nothing.
2. **The cause of a failure is lost at four points.** The driver's own refusal
   is swallowed into a generic code, the verifier ignores the codes its
   session reported, the run records the public code and drops its `reason`,
   and the executor and the coordinated nodes drop the driver's code. Nothing
   checks that a model is offered before the implementer's allowance is spent.

## Requirements

Each requirement is verified by the tests named in `validation.md`.

| Id | Frente | Requirement |
| --- | --- | --- |
| PPR-01 | C | A provider conversation refused with one of the provider's own stable codes ends its run with that code. A rejection with no such code is a protocol failure, and no text or class of the error reaches the report. |
| PPR-02 | C | The Codex driver reports a model its App Server does not list as `VES_CODEX_MODEL_UNAVAILABLE`, not as an identity mismatch. |
| PPR-03 | C | The reason of a verifier that did not complete is, most specific first: the meter's refusal, a reached ceiling, the caller's cancel, the first stable code its session reported, then `VES_TASK_VERIFIER_FAILED`. |
| PPR-04 | C | A failed driver session hands on the first stable code it reported, for an implementer and for a coordinated node, and nothing else of it: no message, class, or unstable code. |
| PPR-05 | C | The reason a failed run records is the stable code its error carries: the driver's on an executor or node error, or the `reason` safe detail of `VES_TASK_FAILED`. The public code stays `VES_TASK_FAILED`, the catalog is not extended, and `status` shows the cause in `lastReason`. |
| PPR-06 | A | A model can be offered on a subscription with no price. A request accepts a priced model or a subscription-only one, and refuses any other name as `VES_TASK_REQUEST_MODEL_UNPRICED`. |
| PPR-07 | A | A run on an API key refuses a subscription-only model as `VES_TASK_NOT_CONFIGURED` (`model-unpriced-for-api-key`) before any effect. |
| PPR-08 | B | `start` and `resume` prove that the account offers the verifier's model and every Codex node's model before the worktree and before the implementer's allowance, and refuse one it does not offer as `VES_TASK_NOT_CONFIGURED` (`codex-model-unavailable`). |
| PPR-09 | D | The pilot's record states that P1-2 hit its stop rule, the deviation of the agent's approval, and the diagnostic gap; the seven requests and the coordinated examples name models the account offers. |
| PPR-10 | E | A `.8` candidate carries A to D and is published, updated live from `.7`, and the pilots run on it to human review. |

## Decisions

- **Subscription-only entries carry no price** (owner, 2026-10-06). The table
  lists the models an account offers beside the priced ones. No price is
  invented for a model whose price is not documented.
- **The verifier is `gpt-5.5`** (owner, 2026-10-06), the implementer stays
  `claude-sonnet-5`, because it worked.
- **The public code is not promoted.** The reason a run records is the only
  thing that becomes precise (AD-083).

## Out of scope

Release custody, the 1.0.0 decision, the budget meter's price rules, the
Claude model check (B names it only if a cheap equivalent exists), and any
change to what a gate or a verifier judges.
