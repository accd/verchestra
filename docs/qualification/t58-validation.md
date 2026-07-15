# T58 Authorized Task Executor Validation

## Scope

- Task: T58 — Implement isolated task executor and worktree lifecycle
- Requirements: VES-VFY-001/002, VES-EXE-001…006, and VES-SPC-003
- Commit target: `feat(execution): add authorized task executor`
- Focused evidence: 53 cases (4 end-to-end, 16 integration, 22 security, and 11 fault injection)
- Required minimum: 35 integration/end-to-end/fault cases
- Spec deviations: none

T58 introduces a closed, runtime-validated atomic-task contract and an application coordinator that orders current Execution Approval, one-writer coordination, exact-revision detached worktree creation, Context compilation, Driver execution, and mediated Tool effects. Authority is reevaluated immediately before every Tool effect. The Driver receives only logical references and has no commit API. A completed edit set is independently inspected and stops at `AWAITING_GATE`; T59 owns command gates and the first permitted atomic commit. Failure and cancellation preserve a checkpoint, cancel the Driver, remove the isolated worktree, and release writer ownership while retaining the primary failure.

The production Node adapter creates idempotent detached Git worktrees from complete object IDs. Its opaque handle is cryptographically bound to the base commit, derives a contained hexadecimal directory, rejects symbolic roots/targets, never follows changed-file symlinks while hashing, detects Driver-created commits, and cleans up only Git-registered worktrees.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/e2e/task-executor-e2e.test.mjs tests/integration/task-executor.test.mjs tests/integration/git-worktree-adapter.test.mjs tests/security/task-executor-security.test.mjs tests/fault-injection/task-executor-faults.test.mjs` | PASS — 53 passed, 0 failed/skipped |
| `pnpm gate:security` | PASS — format, lint, typecheck/build, unit/property, architecture, qualification, 757 security, and 140 fault cases |

## Adequacy matrix

| Done-when criterion / spec AC | Exact assertion evidence | Spec-defined outcome | Result |
| --- | --- | --- | --- |
| No writer starts before a current Execution Approval | `tests/integration/task-executor.test.mjs:15`; `tests/security/task-executor-security.test.mjs:6` | Approval precedes coordination and worktree mutation; denial produces zero writer/worktree effects | PASS |
| Approval is current at each Tool effect | `tests/security/task-executor-security.test.mjs:15`; `tests/e2e/task-executor-e2e.test.mjs:114` | Stale binding blocks the Tool, removes the real worktree, and releases ownership | PASS |
| Personal and Team modes both enforce one writer | `tests/integration/task-executor.test.mjs:15-25` | Coordination is acquired before worktree creation in both modes and retained only for the gate successor | PASS |
| Worktree is isolated and pinned to the authorized source | `tests/integration/git-worktree-adapter.test.mjs:50-64`; `tests/e2e/task-executor-e2e.test.mjs:104` | A detached worktree is created from the exact full object ID and identical retries return the same handle | PASS |
| Context and Driver remain machine-portable | `tests/integration/task-executor.test.mjs:27-73` | Driver receives logical worktree/Context refs, task authority, capability refs, and a resumable checkpoint, never a machine path | PASS |
| Tool requests remain task, capability, and scope exact | `tests/integration/task-executor.test.mjs:118`; `tests/security/task-executor-security.test.mjs:32-112` | Cross-task, undeclared grant, traversal, absolute, sibling-prefix, out-of-scope, and protected-path requests fail before invocation | PASS |
| Authority remains evidence-backed across the Driver loop | `tests/integration/task-executor.test.mjs:75-98` | Checkpoints sequence durably and Tool receipts plus bounded output refs survive into execution evidence | PASS |
| Driver cannot create the task commit | `tests/integration/git-worktree-adapter.test.mjs:80`; `tests/security/task-executor-security.test.mjs:114` | Any commit after the pinned base is observed and fails before `AWAITING_GATE` | PASS |
| Direct Driver bypass is independently detected | `tests/e2e/task-executor-e2e.test.mjs:140`; `tests/security/task-executor-security.test.mjs:148` | Post-execution Git inspection rechecks every changed path and rolls back out-of-scope/protected changes | PASS |
| Cancellation/failure leaves a durable diagnostic and clean ownership | `tests/fault-injection/task-executor-faults.test.mjs:58-109`; `tests/e2e/task-executor-e2e.test.mjs:130` | Phase faults, Tool faults, checkpoint faults, and cancellation clean the worktree and release coordination after recording failure state | PASS |
| Cleanup/release failures do not rewrite the primary cause | `tests/fault-injection/task-executor-faults.test.mjs:111-139` | Compensating-operation faults remain reconcilable without hiding the execution failure | PASS |
| Worktree handles and content digests are safe and deterministic | `tests/integration/git-worktree-adapter.test.mjs:66-107`; `tests/security/task-executor-security.test.mjs:124-146` | Changed paths/digest are stable; unknown revisions, malformed outputs, and impossible inspection values fail closed | PASS |
| Atomic tasks cannot weaken their own proof obligations | `tests/security/task-executor-security.test.mjs:166` | Empty requirement, command, criterion, scope, or protected-path lists are rejected before authority/effects | PASS |

## Necessary-test reverse map

| Test group | Maps to | Keep |
| --- | --- | --- |
| Full real-worktree E2E | Approval/Tool ordering, isolated mutation, cancellation, stale authority, bypass detection | Yes |
| Coordinator integration | Closed task contract, logical Driver boundary, checkpoints, evidence, `AWAITING_GATE` | Yes |
| Real Git adapter integration | Exact revision, detached/idempotent creation, deterministic inspection, commit detection, safe cleanup | Yes |
| Security corpus | Scope/protected paths, capability/task binding, stale Approval, malformed provider output, self-weakening denial | Yes |
| Fault matrix | Every phase boundary, cancellation, Tool/checkpoint faults, cleanup/release compensation | Yes |

## Non-shallow checks

- Input normalization is runtime enforcement, not TypeScript trust. Unknown fields, malformed digests/object IDs, duplicate or empty obligations, unsafe paths, arbitrary Driver outputs, and invalid inspection values fail before semantic use.
- The source binding has two distinct values: `sourceStateDigest` binds the Execution Package state, while `sourceRevision` is the exact full Git commit used to create the detached worktree. Both participate in the idempotent worktree identity.
- Approval is checked before writer coordination and again immediately before each Tool call. A valid start decision cannot authorize a later effect after policy or Approval drift.
- The coordinator passes an opaque worktree reference rather than an OS path. Concrete path resolution stays in Node adapters and mediated tools.
- Scope checks are segment-aware. `packages/application/src/executionish` cannot inherit authority from `packages/application/src/execution` merely by sharing a text prefix.
- Tool mediation is not the only containment layer. The final Git inspection revalidates every actual changed path, so a compromised Driver that bypasses the Tool contract still cannot advance to the gate.
- T58 deliberately exposes no commit operation to the Driver. Zero or more valid changes stop at `AWAITING_GATE`, with the worktree and coordination reference retained for T59's gate/atomic-commit transaction.
- The Git adapter derives a contained hexadecimal directory from Workspace/run/task/source/scope bindings and refuses unregistered targets. Its opaque reference repeats the base object ID, preventing a caller from substituting another base during inspection or cleanup.
- Changed symlinks are hashed as link metadata; the adapter does not follow them and read files outside the worktree while building evidence.
- Failure compensation is best effort but never changes the primary error. Durable checkpoints make incomplete cleanup or lease release explicitly reconcilable on the next recovery pass.
- Focused verification was performed as a standalone evidence review in the primary agent because this execution environment prohibited agent delegation. T60 remains the product task that implements and proves author-not-equal-verifier enforcement for Verchestra runs.

## Verdict

PASS for T58. A mutable task now starts only under current human execution authority, owns one isolated exact-revision worktree, exposes every effect through task/capability/scope mediation, and produces durable checkpoint and receipt evidence. Driver commits, stale authority, scope escapes, protected paths, malformed provider results, direct filesystem bypass, cancellation, and injected failures cannot advance to the gate. Successful work stops at `AWAITING_GATE`; atomic verification and commit authority remain intentionally reserved for T59.
