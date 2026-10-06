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

## T4: subscription-only models in the price table (PPR-06, PPR-07)

### Gates

Node 24.14.0, macOS arm64, on `feat/subscription-only-models` stacked on T2.

| Gate | Result |
| --- | --- |
| `gate:quick` | PASS: unit 3009, agent-readiness 357, census 13 |
| `test:contract` | PASS: 963 |
| `test:integration` | PASS: 1264 |
| `test:security` | PASS: 1355 |
| `test:architecture` | PASS: 132 |
| `test:e2e` | PASS: 305 |
| `test:fault` | PASS: 310 |
| `test:mutation` | PASS: 8 |
| `agent:check` | PASS |
| `platform-matrix`, SonarCloud | recorded on the pull request |

### Acceptance evidence

| Requirement | Evidence |
| --- | --- |
| PPR-06 | `tests/unit/model-price-table.test.mjs` (6 cases): the table is `2026.10.0`; the eight Codex models are subscription-only and have no price, and `gpt-reserve` and `codex-auto-review` are no task's model; a model is listed once, by one driver, and is never priced; every listed name passes a request's binding; a Claude name is refused as a verifier and a Codex name as an implementer. `tests/contract/task-request.test.mjs` and `task-request-v2.test.mjs`: the implementer, the verifier, and a node may name one; an unlisted name is still `VES_TASK_REQUEST_MODEL_UNPRICED`. |
| PPR-07 | `tests/integration/task-run-prerequisites.test.mjs`, ten cases over `start` and `resume`: a subscription-only verifier or implementer model on an API key is `VES_TASK_NOT_CONFIGURED` (`model-unpriced-for-api-key`) with the machine never asked, no worktree, and no active file; the same models on subscriptions, a subscription-only model on the provider that is on a subscription, and priced models on API keys reach the first credential read. |

### Mutations

| Mutant | File | Killed by |
| --- | --- | --- |
| MA1: intake admits only priced models | `packages/application/src/execution/task-request.ts` | 4 tests: the three admit cases and the node case |
| MA2: `start` and `resume` do not check the models | `apps/vestra-cli/src/task/task-run.ts` | 4 tests: the four refusal cases |
| MA3: the check ignores the provider's mode | `apps/vestra-cli/src/task/task-run.ts` | 4 tests: the cases on subscriptions |
| MA4: a subscription-only model is read for any driver | `packages/application/src/execution/model-price-table.ts` | 1 test: the listing rules |
| MA5: a priced model is listed as subscription-only too | `packages/application/src/execution/model-price-table.ts` | 1 test: the listing rules |

### Pinned expectations that moved

Two fixture strings in `tests/integration/run-capsule-budget-evidence.test.mjs`
named the table's version `2026.7.0`. They are fixtures of what a capsule
seals, not the table itself; they now name `2026.10.0`, the version the table
seals. No assertion changed.

### Decisions the reviewer confirms

1. **AD-084**: a model can be subscription-only, with no price. The table's
   "HUMAN REVIEW REQUIRED" header applies.
2. **The Claude Code names** are listed without a call to the owner's account
   (`handoff.md`, known risks). A name the account refuses is now reported with
   its cause (AD-083).
3. **The refusal is at `start` and `resume`, not at `plan`**, as the plan says;
   the credential mode is a machine-local setting that can change in between.

## T3: the model's availability is checked before the allowance is spent (PPR-08)

### Gates

Node 24.14.0, macOS arm64, on `feat/codex-model-availability` stacked on T4.

| Gate | Result |
| --- | --- |
| `gate:quick` | PASS: unit 3009, agent-readiness 357, census 13 (complexity within the target after two helpers were extracted) |
| `test:contract` | PASS: 968 |
| `test:integration` | PASS: 1267 |
| `test:security` | PASS: 1355 |
| `test:architecture` | PASS: 132 |
| `test:e2e` | PASS: 310 |
| `test:fault` | PASS: 310 |
| `test:mutation` | PASS: 8 |
| `agent:check` | PASS |
| `platform-matrix`, SonarCloud | recorded on the pull request |

### Acceptance evidence

| Requirement | Evidence |
| --- | --- |
| PPR-08, the driver | `tests/contract/codex-driver-structured.test.mjs`: the check sends `initialize`, `initialized`, `model/list` and nothing else, reports `["gpt-6-sol", "gpt-5.5"]` for a list that holds neither and only `gpt-5.5-codex`, frozen, with the session closing `completed` and no event but its close; with `accountOnly` it sends `account/read` first; alone it runs on 0.115.0 and with the account it is refused before spawn on 0.159.2; eleven malformed requests (none, seventeen, a repeat, a space, a leading dash, 65 characters, a number, a string, `null`, with a subscription-only turn, with a structured answer) are refused as `VES_CODEX_MODEL_CHECK_INVALID` with no spawn; a list that is no list, or has none, is `VES_CODEX_PROTOCOL_FAILED`, never every model unavailable. |
| PPR-08, the session | `tests/integration/codex-verifier-session.test.mjs`: the combined session returns `{planType: "plus", unavailableModels: ["gpt-6-sol", "gpt-5.5"]}` with no thread, no turn, and no session root left; the models-only session answers on `codex-0.159.2` and on an API-key login while the combined one is `codex-version`; a failing `model/list` is `codex-model-list` alone and `codex-account` with the account. |
| PPR-08, the run | `tests/e2e/task-model-availability-e2e.test.mjs`: through the real binary, a verifier model, a Codex node model alone (the offered verifier's name is not on the terminal), and a resumed run's verifier model are each `VES_TASK_NOT_CONFIGURED` with requirement `codex-model-unavailable`, the models named on the terminal, the run still `EXECUTION_AUTHORIZED` (or `VERIFYING` and `SUSPENDED` for the resume), no implementer started, no verifier turn, and no worktree beside the repository's own; the same run starts once the account offers the model. `tests/e2e/task-cli-e2e.test.mjs`: a v1 run is refused before the implementer, and a v1 run on a Codex below 0.159.3 still reaches `HUMAN_REVIEW`. |

### Mutations

| Mutant | File | Killed by |
| --- | --- | --- |
| MB1: the unavailable models do not refuse the run | `apps/vestra-cli/src/task/task-run.ts` | 3 e2e tests: the verifier, the node, the resume |
| MB2: a v1 run reads the account too, raising its floor | `apps/vestra-cli/src/task/task-run.ts` | 1 e2e test: the v1 run on a Codex below the floor |
| MB3: only the verifier's model is checked | `apps/vestra-cli/src/task/task-run.ts` | 1 e2e test: the node's model |
| MB4: the check reports no model as unavailable | `packages/drivers/src/codex-driver.ts` | 4 tests: the driver and the session cases |
| MB5: a list that is no list counts as an empty one | `packages/drivers/src/codex-driver.ts` | 1 test: the list with no `data` (the first mutant version survived on `data: "not-a-list"`, which a string's missing `find` already failed, so the case was added) |
| MB6: a check that asks for a turn is not refused | `packages/drivers/src/codex-driver.ts` | 1 test: the malformed requests |
| MB7: the terminal does not name the models | `apps/vestra-cli/src/task/task-run.ts` | 2 e2e tests: the verifier and the node |
| MB8: the session sends no model check | `apps/vestra-cli/src/task/task-codex.ts` | 2 tests: the session cases |

### Changes to what C's tests expect

The two end-to-end cases of `tests/e2e/task-failure-cause-e2e.test.mjs` that
used a model the account does not offer now use a thread the App Server
refuses (`codex-thread-refused`, `VES_CODEX_RPC_FAILED`), because the missing
model is refused at `start` before the run can fail. The cause still reaches
`status.lastReason` for a verifier and for a Codex node. The missing model at
run time stays covered where it can still happen, by
`tests/integration/codex-verifier-session.test.mjs` and the driver's contract
test.

### Decisions the reviewer confirms

1. **AD-085**: every `start` and `resume` on a Codex subscription launches one
   more short Codex process, a v1 run included. It spends nothing of the
   allowance and a v1 run keeps its T04 floor.
2. **The model's name is on the terminal, not in the public error**, which
   carries `requirement: codex-model-unavailable` alone. The plan asked for it in
   the safe details; `VES_TASK_NOT_CONFIGURED` declares one detail, so that
   would extend a public schema.
3. **A verifier on an API key and Claude Code are not checked.** The first has
   no ChatGPT login to ask; for the second, the `init` event names the one model
   a session runs and lists none, and the session that emits it is the
   implementer's. Both are reported by their session with its cause (AD-083).
4. **Two requirements are new**: `codex-model-unavailable` and
   `codex-model-list`, both in the quick-start's table.
