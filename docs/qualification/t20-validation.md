# T20 Safe Init Validation

## Scope

- Task: T20 — Implement idempotent init and managed `.gitignore`
- Requirements: VES-WSP-001…005/007 and the T20 portions of VES-TST-002/004
- Commit target: `feat(workspace): implement safe idempotent init`
- Focused evidence: 39 integration, end-to-end, and fault-injection cases
- Spec deviations: none

The Workspace adapter owns the filesystem transaction and exposes a content-addressed `planId`. The Effect Broker remains a sibling adapter, so it is composed with this operation at the CLI/application boundary rather than imported directly; importing it here would violate the approved adapter dependency rule.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/integration/managed-gitignore.test.mjs tests/integration/safe-init.test.mjs tests/integration/init-errors.test.mjs tests/fault-injection/safe-init-faults.test.mjs tests/e2e/safe-init-e2e.test.mjs` | PASS — 39 passed, 0 failed/skipped |
| `pnpm gate:full` | PASS — format, lint, typecheck, 1,208 unit, 41 contract, 76 integration, 4 e2e, and 32 fault cases |
| `pnpm test:architecture` | PASS — 10 passed |
| `pnpm install --offline --frozen-lockfile` | PASS — lockfile current, all 17 projects available offline |
| `git diff --check` | PASS |

## Check A — sufficient, spec-anchored coverage

| Criterion / requirement | Exact assertion evidence | Spec-defined outcome | Covered |
| --- | --- | --- | --- |
| VES-WSP-001: inspectable standalone dry-run, proposed artifacts/ignore, zero writes | `tests/integration/safe-init.test.mjs:31` — `assert.match(preview.planId, /^sha256:...$/)`; `:32-43` — exact create predicates; `:51` — `assert.deepEqual(await byteSnapshot(root), before)` | Content-addressed proposal includes canonical files and `.gitignore`; source bytes unchanged | Yes |
| VES-WSP-002: inventory boundaries before apply | `tests/e2e/safe-init-e2e.test.mjs:52` — `assert.deepEqual(await byteSnapshot(nested), before)`; scanner is invoked before planning at `packages/workspace/src/init/safe-init.ts:150` | Nested Git boundary is discovered before the root-only transaction; nested repository is unchanged | Yes, composed with T18 scanner evidence |
| VES-WSP-003: only authorized roots receive init files | `tests/e2e/safe-init-e2e.test.mjs:34-43` — exact Git-visible root target list | Init writes only control-root canonical targets; project placement remains T19-owned | Yes, composed with T19 placement evidence |
| VES-WSP-004 and VES-TST-002/004: centralized/ignored source tree receives zero metadata | `tests/e2e/safe-init-e2e.test.mjs:52` — `assert.deepEqual(await byteSnapshot(nested), before)` | Ignored nested source repository remains byte-identical | Yes |
| VES-WSP-005: absent file becomes minimal tracked block | `tests/integration/managed-gitignore.test.mjs:9` — exact deep equality; `tests/e2e/safe-init-e2e.test.mjs:34-43` — exact unignored tracked candidates | Minimal delimited block and `.gitignore` is visible to Git | Yes |
| VES-WSP-005: existing user rules/order/newlines persist | `tests/integration/managed-gitignore.test.mjs:18`, `:22`, `:27-28`, `:33`, `:38`, `:76`; `tests/integration/safe-init.test.mjs:81` | Only one managed block changes; user prefix/order and LF/CRLF style remain exact | Yes |
| VES-WSP-005: ambiguous managed content fails closed | `tests/integration/managed-gitignore.test.mjs:42`, `:46-48`, `:52-54`, `:80` | Stable ambiguity error; no guessed rewrite | Yes |
| VES-WSP-007: ignored canonical target fails before mutation | `tests/integration/safe-init.test.mjs:144-147` — exact `VES_INIT_TARGET_IGNORED` plus byte snapshot equality | No target write crosses an ignored ownership boundary | Yes |
| Ownership manifest closes every generated file and Git owner | `tests/integration/safe-init.test.mjs:111-137` — exact seven paths, owner digest, and self-excluded record | Every generated target is tracked by logical path, control Git owner, lifecycle, and digest rule | Yes |
| Repeated init converges and clone-independent plans match | `tests/integration/safe-init.test.mjs:72`; `tests/e2e/safe-init-e2e.test.mjs:62-63`, `:73-74`; `tests/fault-injection/safe-init-faults.test.mjs:87-88` | Second run has zero changes and no Git diff; equivalent clones share plan identity | Yes |
| Stale/authenticity conflicts preserve state | `tests/integration/safe-init.test.mjs:101-102`, `:166-167`; `tests/fault-injection/safe-init-faults.test.mjs:114-117` | Stale or foreign preview cannot overwrite bytes; concurrent value survives | Yes |
| Crash and permission boundaries roll back | `tests/fault-injection/safe-init-faults.test.mjs:35-38`, `:48-51`, `:61-64`, `:74-77`, `:100-103` | Before-stage, before-publish, and partial-publish failures preserve prior state | Yes |
| Hard process termination has durable, zero-blind-write recovery | `tests/fault-injection/safe-init-faults.test.mjs:128-141` — exit 77, unchanged dry-run snapshot, exact recovery receipt, prior snapshot, then no-op retry | Restart detects the durable journal without writing and explicit recovery restores the pre-transaction state | Yes |
| Post-crash concurrent change blocks recovery | `tests/fault-injection/safe-init-faults.test.mjs:149-158` — exact recovery conflict, concurrent bytes retained, recovery remains required | Recovery never overwrites a target whose post-crash state no longer matches the journal | Yes |
| Recovery is itself crash-idempotent | `tests/fault-injection/safe-init-faults.test.mjs:166-172` — real exits 77/78, exact resumed receipt, prior byte snapshot | A second hard crash between target removal and backup restoration resumes safely | Yes |
| Same-volume staging is cleaned on success/failure | `tests/integration/safe-init.test.mjs:155-158`; `tests/fault-injection/safe-init-faults.test.mjs:36-37` | No `.staging-*` or newly empty metadata root remains | Yes |
| Public failure surface is stable and schema-valid | `tests/integration/init-errors.test.mjs:8-22` | Exact ten-code catalog validates against `public-error@1` | Yes |
| Minimum case floor | Focused runner: 39 passed | At least 30 integration/e2e/fault cases | Yes |

No spec-precision gap was found for the T20-owned outcomes. VES-TST-002/004 are only partially owned here: this task supplies the disposable topology/init behavior, while the packaged `self-test` command is intentionally implemented in T68–T70.

## Check B — non-shallow litmus

- Every mutation claim is checked through filesystem bytes, exact file content, Git output, manifest fields, or exact error codes; no assertion uses call counts or `assert(true)`.
- Receipt fields (`planId`, `changed`) are asserted independently at `tests/integration/safe-init.test.mjs:60-61`.
- Manifest path, owner, content digest mode, and lifecycle fields are asserted independently at `tests/integration/safe-init.test.mjs:111-137`.
- Failure tests assert both the stable public error and resulting filesystem state.
- The hard-crash sensor exits a separate Node process after the first real publication; it does not simulate termination with a caught exception.
- A wrong implementation that writes during preview, broadens `.gitignore`, writes inside an ignored nested repository, skips rollback, replays a foreign preview, ignores concurrent drift, or emits an incomplete manifest fails at least one focused case.

## Check C — necessary reverse mapping

| Test evidence | Requirement / criterion | Keep |
| --- | --- | --- |
| `managed-gitignore.test.mjs:8,12` | VES-WSP-005 absent/empty minimal file | Yes |
| `managed-gitignore.test.mjs:16,21,25,31,36,73` | VES-WSP-005 preserve user bytes/order/style and replace one block | Yes |
| `managed-gitignore.test.mjs:41,45,51,79` | VES-WSP-005 ambiguous input fails closed | Yes |
| `managed-gitignore.test.mjs:57` | VES-BST-001/T20 ignore safety: canonical tracked artifacts are not broadly ignored | Yes |
| `safe-init.test.mjs:27,46,54` | VES-WSP-001 preview, zero write, reviewed apply | Yes |
| `safe-init.test.mjs:66,75` | T20 convergence and VES-WSP-005 preservation | Yes |
| `safe-init.test.mjs:84,94,140,161` | T20 conflict/ignore/stale/authenticity fail-closed behavior | Yes |
| `safe-init.test.mjs:105` | T20 ownership-manifest closure | Yes |
| `safe-init.test.mjs:150` | T20 staged-writer cleanup | Yes |
| `init-errors.test.mjs:7` | Stable observable failures required by T20 | Yes |
| `safe-init-e2e.test.mjs:30` | VES-WSP-001/005 canonical Git-visible artifacts | Yes |
| `safe-init-e2e.test.mjs:45` | VES-WSP-002/004/007 and VES-TST-004 topology isolation | Yes |
| `safe-init-e2e.test.mjs:55,66` | T20 repeated convergence and portable plan identity | Yes |
| `safe-init-faults.test.mjs:30,42,54,67,93` | T20 exception/permission/partial rollback preservation | Yes |
| `safe-init-faults.test.mjs:78` | T20 retry convergence after rollback | Yes |
| `safe-init-faults.test.mjs:106` | T20 conflict preservation at publication boundary | Yes |
| `safe-init-faults.test.mjs:122,144,161` | T20 hard-process crash recovery, conflict preservation, and crash-idempotent recovery | Yes |

All 39 tests reverse-map to a named requirement or T20 done-when criterion. No speculative test remains.

## Check D — guideline conformance

- Followed `.specs/features/verchestra-1.0/tasks.md`: tests live in the required integration, e2e, and fault layers; no test is skipped or deferred.
- Followed TLC test integrity: assertions were derived from acceptance outcomes, no existing assertion was weakened or deleted, and the full gate was rerun after the concurrency refinement.
- Followed AD-026 architecture boundaries: Workspace imports no sibling adapter; composition with Effects remains outside this package.

## Adequacy verdict

PASS. Every T20-owned criterion has exact assertion evidence, all asserted outcomes match the specification, the suite is discriminating and bounded, 39/39 focused cases pass, and the full/architecture/offline gates are green.
