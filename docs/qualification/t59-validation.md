# T59 Gate Runner and Atomic Commit Validation

## Scope

- Task: T59 — Implement gate runner and atomic task commits
- Requirements: VES-VFY-001/002, VES-SPC-003, and VES-EXE-006
- Commit target: `feat(execution): add gates and atomic commits`
- Focused evidence: 39 cases (23 end-to-end and 16 integration)
- Required minimum: 30 integration/end-to-end cases
- Spec deviations: none

T59 consumes T58's retained authorized worktree and writer coordination. It validates a content-addressed closed gate plan, requires exact coverage of every task verification command and requirement, revalidates Approval and writer ownership before each command and immediately before commit, records bounded structured evidence for every command, rejects any failed/skipped/weakened/decreased or internally inconsistent test result, and proves the Git diff is unchanged before and after gates. Only then may the Git adapter stage the exact authorized paths and create one commit whose parent, task/run/requirements, gate plan, gate evidence, change digest, and idempotency key are bound in trailers.

The process adapter resolves only a locally allowlisted command reference, uses argv with `shell: false`, starts in a Git-registered exact-base worktree, supplies a minimized environment, enforces time/output bounds, terminates the process tree, hashes output without returning raw logs, and parses a structured Node test summary. The Git adapter independently re-inspects before and after staging, bypasses repository hooks at the already-approved commit boundary, rejects drift, verifies a clean post-commit worktree, and reconciles an acknowledgement-lost retry by exact parent and trailer identity rather than creating a second commit.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/integration/gate-commit.test.mjs tests/e2e/gate-commit-negative.test.mjs tests/integration/gate-commit-adapters.test.mjs` | PASS — 39 passed, 0 failed/skipped |
| `pnpm gate:full` | PASS — format, lint, typecheck/build, all unit/property/contract/integration/E2E/architecture/qualification/security/fault suites |

## Adequacy matrix

| Done-when criterion / spec AC | Exact assertion evidence | Spec-defined outcome | Result |
| --- | --- | --- | --- |
| Passing declared gates create at most one atomic commit | `tests/integration/gate-commit.test.mjs:6-40`; `tests/integration/gate-commit-adapters.test.mjs:190` | Evidence and stable post-gate diff precede one real commit; cleanup/release follow the durable commit checkpoint | PASS |
| Every task obligation is gate-covered | `tests/integration/gate-commit.test.mjs:42-58`; `tests/e2e/gate-commit-negative.test.mjs:162-185` | Exact verification commands and requirements bind the plan; missing, duplicate, extra-authority, uncovered, or digest-drifted plans fail before effects | PASS |
| Gates are portable and do not invoke a shell | `tests/integration/gate-commit.test.mjs:60-73`; `tests/integration/gate-commit-adapters.test.mjs:79` | Shared plan names a command capability and argv; the local machine resolves the executable and returns bounded structured evidence | PASS |
| Failed or non-zero gate cannot create completion | `tests/e2e/gate-commit-negative.test.mjs:47-63` | Non-zero exit records requirement/command evidence, checkpoints `gate-failed`, and retains worktree/coordination for repair | PASS |
| Timeout and output overflow cannot create completion | `tests/e2e/gate-commit-negative.test.mjs:47-63`; `tests/integration/gate-commit-adapters.test.mjs:94-132` | Real process trees are terminated, raw output is not returned, failure evidence remains bounded, and no commit is requested | PASS |
| Skip, todo, cancelled, failed, decreased, and inconsistent tests fail closed | `tests/e2e/gate-commit-negative.test.mjs:47-63` | A test gate passes only with zero non-pass outcomes, internally exact totals, and passed count at least the immutable baseline | PASS |
| Protected/out-of-scope/stale diffs cannot be committed | `tests/e2e/gate-commit-negative.test.mjs:65-117`; `tests/integration/gate-commit-adapters.test.mjs:163` | Pre/post-gate path and content identities must equal T58 evidence; staging repeats the check against exact paths | PASS |
| Approval and writer claim remain current at effects | `tests/e2e/gate-commit-negative.test.mjs:132-160` | Stale Approval or expired coordination blocks before gate execution/commit, not merely at T58 start | PASS |
| Driver or prior process cannot pre-create the commit | `tests/e2e/gate-commit-negative.test.mjs:119` | Any commit since the authorized base blocks gates and completion | PASS |
| Commit acknowledgement loss does not duplicate commits | `tests/integration/gate-commit.test.mjs:75-111`; `tests/integration/gate-commit-adapters.test.mjs:134-161` | Durable gates-passed/uncertain checkpoints plus exact trailer reconciliation converge to the original commit | PASS |
| Invalid Git receipt cannot mark complete | `tests/e2e/gate-commit-negative.test.mjs:127`; `tests/integration/gate-commit-adapters.test.mjs:134-161` | Parent, commit ID, change/gate digests, and idempotency key must all match the authorized request | PASS |
| Zero-change task cannot manufacture a commit | `tests/integration/gate-commit.test.mjs:113` | Completion requires a non-empty authorized diff and real Git object | PASS |

## Non-shallow checks

- The plan digest is calculated over normalized command objects, not trusted from caller data. Commands are ordered, bounded, closed-field objects with exact protocol, timeout, output, test baseline, cwd, requirement, capability, and argv semantics.
- Task verification commands and plan commands form an exact set. A caller cannot omit an expensive gate, add an unreviewed gate, lower the baseline without changing the approved digest, or leave a task requirement without command evidence.
- Test success is structured data, not inferred from a model summary. Totals must equal the sum of pass/fail/skip/cancel/todo; every non-pass category must be zero; passed tests must meet the immutable minimum.
- Raw stdout/stderr are not returned through the application contract. Evidence carries digests, byte counts, a content-addressed protected output reference, timeout/overflow flags, exit code, and structured test counts.
- Gate commands are executable capability references resolved per machine. This preserves handoff portability between Claude/Codex/OpenCode environments while preventing a shared artifact from selecting an arbitrary machine executable.
- Approval and writer coordination are rechecked before every gate process and immediately before Git commit. Long-running tests cannot silently outlive their authority.
- Git inspection occurs before and after gates. The commit adapter repeats inspection before staging, stages only the exact authorized path set after `--`, and rechecks content after staging.
- Repository hooks are bypassed only at the commit effect because their behavior was not part of the approved declarative gate plan and could add unbounded side effects after evidence passed.
- The commit message has one reviewed subject plus stable Verchestra trailers for task, run, requirements, gate plan, gate evidence, change digest, and idempotency. Retry reconciliation demands exact message and single-parent identity.
- A gate failure intentionally retains the worktree and writer coordination so an in-scope repair can continue under VES-EXE-006. Scope expansion still changes the T58/T59 bindings and requires new Execution Approval.
- Focused verification used a standalone evidence review because delegation was prohibited in this environment. Product author-not-equal-verifier enforcement remains the next task, T60.

## Verdict

PASS for T59. Task gates are now immutable, portable, bounded, requirement-linked proof obligations rather than arbitrary shell strings. Failure, skip, timeout, overflow, weakened coverage, decreased tests, stale authority, expired writer ownership, protected/drifted diffs, prior commits, malformed receipts, and acknowledgement loss cannot create duplicate or falsely complete commits. A passing stable diff creates exactly one real trailer-bound commit and then releases its isolated worktree ownership.
