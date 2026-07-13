# T16 Validation — Durable Idempotent Effect Kernel

**Gate:** `corepack pnpm gate:full`  
**Result:** 1,108 unit, 41 contract, 37 integration, and 22 fault-injection cases passed; 0 failed, 0 skipped, 0 todo. Format, lint, strict TypeScript, and the full gate passed.  
**Additional checks:** 10 architecture cases passed; frozen offline install passed.  
**SPEC_DEVIATION:** none.

## Check A — Sufficient coverage

| Criterion | Assertion evidence | Spec outcome | Covered |
| --- | --- | --- | --- |
| Canonical idempotency identity | `effect-kernel.test.mjs` key-binding cases | Schema version, operation, workspace, target, canonical input digest, and semantic identity determine the SHA-256 key | Yes |
| Forgery and collision denial | Unit and integration forged/conflicting-key cases | A supplied key cannot bypass canonical identity; one key cannot bind different logical content | Yes |
| Durable intent and outbox | `effect-kernel.test.mjs` integration cases | Intent and outbox survive restart, participate in state digest, and enter verified backups | Yes |
| Deterministic dispatcher | Unit bounded-order case and durable restart dispatcher case | Oldest eligible intents dispatch first, stable key breaks ties, and the limit is constrained to 1–1,000 | Yes |
| Exclusive apply claim | Concurrent unit execution and SQLite compare-and-set claim | Only `planned` or `ready` can atomically become `applying`; competing execution cannot call the adapter | Yes |
| Receipt and inbox | Successful execution and receipt round-trip cases | Receipt, inbox, intent completion, and outbox completion commit atomically | Yes |
| Duplicate and reordered delivery | Completion retry, duplicate plan, concurrent two-connection plan | Repetition converges to one logical intent and one receipt | Yes |
| Crash before remote call | Fault-injection case using `afterEffectStart` | Durable `applying` state forces inspection before retry | Yes |
| Crash before receipt commit | Fault-injection case using `beforeEffectComplete` | Remote success is reconciled into one durable receipt without reapply | Yes |
| Acknowledgement loss | Fault-injection case using `afterEffectComplete` | A committed receipt is returned after retry without a second adapter call | Yes |
| Unknown and definite outcomes | Unit plus restart fault cases | Unknown remains `uncertain`; definite failure remains `failed`; neither is blindly retried | Yes |
| Reconciliation | Applied, not-applied, and unknown cases | Applied seals a receipt, not-applied returns to ready, unknown stays uncertain | Yes |
| Public error contract | Final unit catalog case | All eight effect failure codes validate against `public-error@1` | Yes |

## Check B — Non-shallow

The focused suite contains 26 unit, 11 integration, and 8 fault-injection cases: 45 total against the required minimum of 40. Integration and fault cases use the qualified Node SQLite runtime with real files, close/reopen boundaries, two independent database connections, transactional hooks, durable backups, and direct table assertions. The broker depends only on repository and adapter ports; the SQLite implementation remains in `platform-node`.

The effect key binds semantic identity rather than process-local IDs, grants, timestamps, or model choice. This preserves idempotency across handoff, restart, and different execution environments while preventing caller-supplied forged keys from skipping the binding check.

## Check C — Failure convergence

| Failure point | Durable state | Required next action | Blind retry |
| --- | --- | --- | --- |
| Before claim commit | `planned` or `ready` | Dispatch may claim | Allowed |
| After claim, before adapter | `applying` | Inspect and reconcile | Denied |
| Adapter reports definite failure | `failed` | Human/adapter correction and replan | Denied |
| Adapter outcome unknown | `uncertain` | Inspect and reconcile | Denied |
| Remote success, receipt commit lost | `applying` | Inspect and seal receipt | Denied |
| Receipt committed, acknowledgement lost | `completed` plus receipt/inbox | Return existing receipt | No reapply |

## Check D — Mutation sensitivity

Three real temporary source mutations were introduced one at a time and reverted immediately after the targeted test failed:

1. Removed `workspaceId` from the effective key identity — killed by the workspace-binding case.
2. Removed `applying` from the reconciliation guard — killed by the crash-after-claim case.
3. Changed unknown reconciliation from `uncertain` to `ready` — killed by the unknown-outcome case.

Mutation score: 3/3 killed (100%).

## Check E — Requirement mapping

| Requirement | Evidence |
| --- | --- |
| VES-BST-004 | SQLite migration, durable outbox/inbox/receipt state, backup and reopen cases |
| VES-HOF-005…006 | Stable semantic key and restart-safe handoff execution semantics |
| VES-INT-005 | Adapter port, mock adapter, durable broker repository, deterministic dispatcher |
| VES-TST-006 | Crash-before, crash-after, acknowledgement-loss, unknown-outcome, concurrency, and mutation evidence |

## Adequacy verdict

PASS — the kernel provides deterministic intent planning, durable outbox dispatch, atomic inbox receipts, explicit reconciliation, fail-closed unknown outcomes, and process-independent idempotency. All 45 focused cases, the complete repository gate, architecture rules, and offline frozen installation passed.
