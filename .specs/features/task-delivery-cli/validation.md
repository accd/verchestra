# #405 prerequisite validation

Base revision: `951e25fd8f0887a2fb9e2d959d9b2d0ca4210114`.
Branch: `feat/405-codex-execution-context`.
This is implementation evidence, not independent qualification or issue closure.

## Requirements and assertions

| Requirement | Evidence |
| --- | --- |
| TDC-01 | `tests/integration/codex-process-context.test.mjs` runs a synthetic controller and real child processes; probe/start reports must be in the selected worktree, absent from the controller directory; the helper asserts thread/start cwd and unchanged controller cwd. |
| TDC-02 | `tests/helpers/codex-context-observer.mjs` asserts exact HOME/USERPROFILE/CODEX_HOME, disabled PATH, and absent session/turn keys in both child phases. The report asserts zero inherited synthetic controller identities. |
| TDC-03 | Integration cases reject malformed context/environment, missing identity directories, relative executable, invalid overlays and Windows case collisions. Context/command mutation after construction cannot redirect the successful run; returned maps cannot mutate the stored base. |
| TDC-04 | Existing `tests/contract/codex-driver.test.mjs` and `tests/integration/codex-driver-lifecycle.test.mjs` retain their assertions and pass. |

The discrimination control runs the same observer with processContext omitted;
the controller must exit unsuccessfully. Removing the new boundary therefore
cannot satisfy the positive observer. This is a behavioral negative control,
not an independent mutation campaign.

## Initial results (superseded by pinned-runtime follow-up below)

- Focused command: `node --test tests/integration/codex-process-context.test.mjs tests/contract/codex-driver.test.mjs tests/integration/codex-driver-lifecycle.test.mjs` — **40 passed**, zero failures/skips/todo, including the discrimination control.
- `corepack pnpm gate:quick` — **PASS**, including the final recheck after adding the negative-control assertion and handoff updates.
- `corepack pnpm test:security` — **1179 passed**, zero failures/skips/todo.
- `corepack pnpm gate:build` — **FAIL**, integration stage: 674/678 passed, four EBUSY cleanup failures in unchanged `self-test-git-fixtures.test.mjs` and `self-test-workspace-scenario.test.mjs`. Focused recheck of those files reproduced EBUSY in three cleanup cases. This was not independently reproduced on a pristine baseline, so it is reported as failure in unchanged fixtures, not asserted to be a proven pre-existing defect.
- `corepack pnpm gate:security` — **FAIL**, qualification stage: exact runtime assertions in `spikes/node-runtime/test/bundle.test.mjs` and `spikes/sqlite/test/sqlite-memory-stack.test.mjs` observe Node 24.18.0 instead of required 24.14.0. Separate security-suite success does not replace this gate.
- `node scripts/agent-check.mjs` and `git diff --check` — **PASS**, rechecked with the feature handoff present. Disposable test directories left by EBUSY were removed after validating their paths stayed inside the workspace.

No runtime dependency or version pin was changed, no test was skipped or weakened,
and no live provider/session was used. Existing untracked review/workpackage
artifacts were preserved. Full gates, independent review and human acceptance
were still required at that stage. No merge, release or issue closure is claimed.

## Design corrections discovered by tests

Passing only an env object does not suppress all Windows inheritance: libuv adds
missing required variables. The first observer exposed USERPROFILE/PATH fallback.
The implementation now requires explicit identity directories and supplies empty
defaults for identity/search/temp variables. Platform loader roots remain native:
blank SYSTEMROOT makes Node CSPRNG initialization abort. The observer was tightened
to assert exact selected directories and disabled PATH, in addition to testing
absence of controller identities; no existing suite assertion was changed.

Reference: https://github.com/libuv/libuv/blob/v1.x/src/win/process.c (`required_vars`).
This feature is explicit process configuration, not an OS sandbox. Future CLI
composition must provision approved configuration/temp directories and authority.

## Pinned-runtime follow-up

Node 24.14.0 was downloaded from the official distribution and its archive SHA256
verified against the official checksum list. The runtime is disposable and ignored;
no dependency or version pin changed. The first pinned focused run still reproduced
three EBUSY cleanup failures (52/55 passed), ruling out the runtime patch mismatch
as a sufficient explanation for cleanup failure.

The two self-test fixtures now use the repository's existing bounded cleanup
pattern: `maxRetries: 10, retryDelay: 100`. Cleanup still rejects after exhaustion;
no behavioral assertion or test is removed, skipped, or weakened. The subsequent
focused run, including all Codex context, contract, lifecycle and both self-test
fixture files, passed **55/55**, with zero skips or todo.

- `corepack pnpm gate:build` on Node 24.14.0 — **PASS**, including 678/678 integration tests.
- `corepack pnpm gate:security` on Node 24.14.0 — **PASS**, including qualification, security and fault stages.
- `corepack pnpm gate:quick` on Node 24.14.0 — **PASS**, including 2166 unit and 252 agent-readiness tests.
- `node scripts/agent-check.mjs` and `git diff --check` — **PASS** on the final evidence update.
- The cleanup-only change is a separate commit, `915fc6c`, for review.

## Exact next action

Obtain independent evidence verification and human PR review
of this driver prerequisite, then implement #405's public input/authority contract,
mediated execution, durable state, gates and human-review path. The #406 live pilot
remains separate and requires operator authorization.
