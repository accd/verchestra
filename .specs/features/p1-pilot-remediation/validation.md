# P1 pilot remediation validation

Evidence is recorded per task. A claim names a file, a command, or a count; a
gate that was not run is listed as not run.

## T2: the cause of a failure reaches `status` (PPR-01 to PPR-05)

### Environment

Node 24.14.0 (`engines`), at `~/.cache/node-dist/node-v24.14.0-darwin-arm64`,
macOS arm64, dependencies from `pnpm install --frozen-lockfile` (no lockfile
change). The platform matrix and SonarCloud run on the pull request and are
recorded below once they have run.

### Gates

| Gate | Result |
| --- | --- |
| `gate:quick` (format, lint, complexity, typecheck, `test:unit`, `test:agent-readiness`, `test:census`) | PASS: unit 3003, agent-readiness 357, census 13 |
| `test:contract` | PASS: 959 |
| `test:integration` | PASS: 1254 |
| `test:security` | PASS: 1355 |
| `test:architecture` | PASS: 132 |
| `test:e2e` | PASS: 305 |
| `test:fault` | PASS: 310 |
| `test:mutation` | PASS: 8 |
| `agent:check` | PASS |
| `platform-matrix` (full, build, security on five targets) | recorded on the pull request |
| SonarCloud | recorded on the pull request |

### Acceptance evidence

| Requirement | Evidence |
| --- | --- |
| PPR-01 | `tests/integration/provider-child-run.test.mjs`: a conversation that rejects with its own stable code is reported as that code; with another provider's code, an unstable code, a runtime's `ERR_` code, or a value that is no error, as `VES_FAKE_PROTOCOL_FAILED`. `tests/contract/codex-driver.test.mjs`: an App Server that answers `thread/start` with an error reports `VES_CODEX_RPC_FAILED`; one that ends before it answers reports `VES_CODEX_PROTOCOL_FAILED`, as `docs/qualification/codex-driver-child-run.md` records. |
| PPR-02 | `tests/contract/codex-driver.test.mjs`: "blocks a model absent from the app-server catalog" asserts exactly one error, `VES_CODEX_MODEL_UNAVAILABLE`, and no `model.resolved`. |
| PPR-03 | `tests/integration/codex-verifier-session.test.mjs`: a verifier whose model the account does not offer fails with `{reason: VES_CODEX_MODEL_UNAVAILABLE}` in v1 and v2, on a subscription and on an API key, with no thread, no turn, and no session root left. |
| PPR-04 | `tests/integration/driver-execution-adapter.test.mjs` (a failed result names the first stable code, none for an unstable code or a silent session); `tests/security/task-executor-security.test.mjs` (the executor carries a stable reason, refuses a text, an unstable code, an empty string, and a number, and cleans up each); `tests/unit/coordinated-driver.test.mjs` (the node error carries the reason or none). |
| PPR-05 | `tests/unit/task-run-coordinator.test.mjs`: seven errors, each from the implementer and from the verifier, record the carried reason, the envelope's reason for `VES_TASK_FAILED` only, or their own code. `tests/e2e/task-failure-cause-e2e.test.mjs`: through the real binary, a verifier and a Codex node whose model the account does not offer, and a Claude Code node whose turn failed, end `FAILED` with the driver's code in `start`'s `reason` and in `status.lastReason`. `tests/e2e/task-cli-e2e.test.mjs`: the same for a v1 implementer. The error catalog is unchanged (`tests/unit` catalog tests pass). |

### Mutations

Each mutant was applied to the source, the focused tests were run, and the
source was restored (`git diff` unchanged). Every mutant was killed.

| Mutant | File | Killed by |
| --- | --- | --- |
| M1: the conversation's rejection is dropped (the empty `catch`) | `packages/drivers/src/provider-child-run.ts` | 4 tests: the module's stable-code case, the Codex model and `thread/start` cases, the verifier case |
| M2: the verifier ignores `finished.errorCodes` | `apps/vestra-cli/src/task/task-codex.ts` | 3 tests: the unavailable model, the usage limit, the login that is no ChatGPT one |
| M3: the run records the public code, not the reason | `packages/application/src/execution/task-run.ts` | 4 tests: the executor, node, and envelope cases and the usage test |
| M4: a failed session result names no cause | `packages/application/src/execution/task-executor.ts` | 5 tests: the adapter cases and the Codex and Claude Code node e2e cases |
| M5: the executor drops the driver's reason | `packages/application/src/execution/task-executor.ts` | 2 tests: the executor case and the v1 implementer e2e case |
| M6: the coordinated driver drops the node's reason | `packages/application/src/execution/coordinated-driver.ts` | 3 tests: the node case and the two node e2e cases |
| M7: the driver reports the identity code for a missing model | `packages/drivers/src/codex-driver.ts` | 2 tests: the contract case and the verifier case |

### Pinned expectations that moved

Five existing assertions pinned the old, less specific value. Each moved to the
specific one; none was weakened, deleted, or skipped.

| Assertion | Before | After | Why |
| --- | --- | --- | --- |
| `codex-driver.test.mjs`, model absent from the catalog | an error event `VES_CODEX_PROTOCOL_FAILED` (`some`) | exactly `["VES_CODEX_MODEL_UNAVAILABLE"]` | the cause now reaches the event (PPR-01, PPR-02) |
| `codex-verifier-session.test.mjs`, v1 usage limit (SSI-83) | `VES_TASK_VERIFIER_FAILED` | `VES_CODEX_EXECUTION_FAILED` | the run still fails and never suspends; the recorded reason is the driver's (AD-083) |
| `codex-identity.test.mjs`, a login that is no ChatGPT one | `VES_TASK_VERIFIER_FAILED` | `VES_CODEX_RPC_FAILED` | the App Server refused `thread/start`; fail-closed is unchanged |
| `driver-execution-adapter.test.mjs`, a structured result of a failed session | `{status, outputRefs}` | `{status, outputRefs, reason}` | the failed result names its cause (PPR-04) |
| `task-run-usage.test.mjs`, a verification failure that is not a budget stop | `VES_TASK_FAILED` | `VES_TASK_VERIFIER_FAILED` | the envelope's reason is what the run records (AD-083); the other three cases keep the code they had |

### Decisions the reviewer confirms

1. **AD-083 supersedes the last sentence of AD-056 item 5** for a task failure
   that names a stable reason. `VES_TASK_VERIFIER_FAILED` can now be a run's
   recorded reason, which AD-056 declined to publish, because the owner asked
   that every `status` say why. The public code and the catalog are unchanged.
2. **The v1 usage-limit expectation moved** from `VES_TASK_VERIFIER_FAILED` to
   `VES_CODEX_EXECUTION_FAILED` (the table above). The alternative was an
   exception for that one code, which AD-083 rejects as a rule nobody could
   derive.
3. **A Codex App Server that ends before it answers is still reported
   `VES_CODEX_PROTOCOL_FAILED`.** The driver's rejection for it carried
   `VES_CODEX_PROCESS_FAILED`, a code no report ever showed; carrying it would
   have changed what `docs/qualification/codex-driver-child-run.md` records, so
   the rejection now carries the code the record states.

### Not run

The live pilot, the platform matrix, and SonarCloud: they run on the pull
request. No provider was called by any test here.

### Environment note

A dependency tree installed before the Strands SDK and Zod were added made the
graph, swarm, and Strands tests fail with `ERR_MODULE_NOT_FOUND`, and Node 26
made the activation launcher and the runtime store tests fail. Neither is
related to this change: with `pnpm install --frozen-lockfile` and Node 24.14.0
every scope above passes.
