# T22 Workspace Reconciliation Validation

## Scope

- Task: T22 — Implement sync and Workspace reconciliation
- Requirements: VES-WSP-006, VES-BST-004…005, VES-INT-004…005, and VES-MEM-003
- Commit target: `feat(workspace): implement sync and reconcile`
- Focused evidence: 38 cases — 35 integration and 3 e2e
- Spec deviations: none

T22 introduces an application-level, backend-neutral reconciliation service. Canonical Project registrations carry stable identity and explicit lineage; the service never derives identity from a path. SQLite migration `004_sync_state` stores the local generation snapshot, Project registry, projection mappings, ingestion-manifest references, and rebuild source policy. Concrete scanner, placement, effect, and Connector implementations remain behind their existing boundaries.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/integration/workspace-reconcile.test.mjs tests/e2e/workspace-reconcile-e2e.test.mjs` | PASS — 38 passed, 0 failed/skipped |
| `node scripts/gate.mjs full` | PASS — canonical `gate:full` implementation; format, lint, typecheck, 1,208 unit, 41 contract, 135 integration, 10 e2e, and 32 fault cases |
| `node --test tests/architecture/*.test.mjs` | PASS — 10 passed, 0 failed/skipped |

## Check A — sufficient, spec-anchored coverage

| Criterion / requirement | Exact assertion evidence | Spec-defined outcome | Covered |
| --- | --- | --- | --- |
| VES-BST-004: repeated unchanged sync converges | `tests/integration/workspace-reconcile.test.mjs:33`; `tests/e2e/workspace-reconcile-e2e.test.mjs:22` | Same state digest, zero operations/effects/rebuilds/writes, including after SQLite restart | Yes |
| VES-BST-005: incompatibility fails before mutation | `tests/integration/workspace-reconcile.test.mjs:58` | Unsupported schema or minimum CLI reports the minimum compatible release before load or save | Yes |
| VES-WSP-006: move preserves stable identity | `tests/integration/workspace-reconcile.test.mjs:83`, `:99` | Same Project ID, explicit old/new paths, no persistence until `accept` | Yes |
| VES-WSP-006: missing and retired Projects are destructive | `tests/integration/workspace-reconcile.test.mjs:108`, `:116`, `:130`, `:139` | Both require direction; accepted retirement retains the registry identity | Yes |
| VES-WSP-006: split and merge require declared lineage | `tests/integration/workspace-reconcile.test.mjs:146`, `:161`, `:174`, `:183` | Split/merge are recognized only from predecessor IDs and preserve that lineage | Yes |
| Multiple unresolved changes are all-or-nothing | `tests/integration/workspace-reconcile.test.mjs:288` | No partial canonical persistence while any destructive direction is missing | Yes |
| VES-INT-004: managed remote projection drift is explicit | `tests/integration/workspace-reconcile.test.mjs:212`, `:227` | No effect without direction; exact canonical-to-remote or remote-to-canonical effect after direction | Yes |
| VES-INT-005: acknowledgement loss reconciles before retry | `tests/integration/workspace-reconcile.test.mjs:241`; `tests/e2e/workspace-reconcile-e2e.test.mjs:64` | Recovery effect carries Connector, correlation marker, input digest, and `retryProhibited: true` | Yes |
| VES-MEM-003: local state is rebuildable | `tests/integration/workspace-reconcile.test.mjs:24`, `:268`, `:277` | Generation/manifest/topology changes produce a canonical-source-and-ingestion-manifest rebuild requirement, never a tracked SQLite/vector file | Yes |
| Persistence is restart-safe and atomic | `tests/e2e/workspace-reconcile-e2e.test.mjs:22`, `:39`, `:62` | Normalized SQLite records survive restart; authorized multi-change reconciliation commits atomically | Yes |
| Stored-state integrity fails closed | `tests/integration/workspace-reconcile.test.mjs:304` | Content not matching its recorded digest is rejected before reconciliation | Yes |
| Minimum test floor | Focused runner: 38 passed | At least 30 integration/e2e cases | Yes |

No T22-owned precision gap remains. The service emits effect descriptions but does not bypass the T15/T16 Effect Broker; later CLI composition must durably plan those effects before dispatch.

## Check B — non-shallow litmus

- Identity tests change paths while asserting the exact stable Project ID; a path-derived identity implementation fails.
- Split and merge tests use explicit predecessor IDs and include a single-successor counterexample that must not be guessed as a split.
- Direction tests assert the prior store write count and digest, so an implementation that mutates and later reports a warning fails.
- Restart tests close and reopen the real SQLite database and compare both semantic and runtime digests.
- Projection tests distinguish two opposite authorized directions and verify the expected remote version.
- A tampered persisted snapshot is rejected by recomputing its content digest, not merely trusting the database column.

## Check C — necessary reverse mapping

| Test evidence | Requirement / criterion | Keep |
| --- | --- | --- |
| `workspace-reconcile.test.mjs:24,33,268,277` | VES-BST-004 and VES-MEM-003 generation/rebuild convergence | Yes |
| `workspace-reconcile.test.mjs:58,304` | VES-BST-005 compatibility and local-state integrity | Yes |
| `workspace-reconcile.test.mjs:83,99,108,116,130,139` | VES-WSP-006 move/missing/retired identity and direction | Yes |
| `workspace-reconcile.test.mjs:146,161,174,183` | VES-WSP-006 explicit split/merge lineage | Yes |
| `workspace-reconcile.test.mjs:212,227` | VES-INT-004 projection drift direction | Yes |
| `workspace-reconcile.test.mjs:241` | VES-INT-005 reconciliation before retry | Yes |
| `workspace-reconcile-e2e.test.mjs:22,39,64` | Persistent no-op, atomic topology, and restart-safe integration effects | Yes |

All 38 cases map to a named requirement or T22 done-when criterion. No speculative test remains.

## Check D — guideline conformance

- Followed `.specs/features/verchestra-1.0/tasks.md`: integration and e2e layers exceed the mandated floor and `gate:full` passes.
- Followed AD-013/026: reconciliation and ports live in `application`; Node digest and SQLite implementations live in `platform-node`; architecture remains green.
- Followed AD-032: uncertain remote outcomes produce reconciliation work with stable marker/input digest and prohibit blind retry.
- Followed AD-034/035: Project identity is stable and independent from scanner paths; reconciliation does not perform filesystem placement or writes.
- Followed AD-037: compatibility is checked before local persistence and local machine state remains outside canonical Git.

## Adequacy verdict

PASS. Every T22-owned criterion has discriminating assertion evidence, all 38 focused cases are necessary and traceable, the complete full gate is green, and the adapter boundaries remain intact.
