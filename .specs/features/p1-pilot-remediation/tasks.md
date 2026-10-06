# P1 pilot remediation tasks

## Execution plan

Each task that changes code is one pull request: focused tests, the three
mutations named for it, `pnpm gate:quick`, `test:architecture`, `agent:check`,
the platform matrix on the five targets, and SonarCloud. The tasks that need
the owner are marked.

| Task | Deliverable | Requirements | Depends on | Owner needed |
| --- | --- | --- | --- | --- |
| T1 | This specification, the task list, the handoff, the validation record | all | none | no |
| T2 | Frente C: the cause of a failure reaches `status` (AD-083) | PPR-01..05 | T1 | review |
| T3 | Frente B: the model's availability is checked before the allowance is spent | PPR-08 | T2 | review |
| T4 | Frente A: subscription-only models in the price table | PPR-06, PPR-07 | T1 | confirm the new AD |
| T5 | Frente D: the pilot's record and requests, the coordinated examples | PPR-09 | T2, T3, T4 | review |
| T6 | Frente E: the `.8` candidate, its TUF publication, and the pilot round | PPR-10 | T2..T5 | `npm publish` with 2FA; extra usage off |

## Order

T2 first: it has no dependency, and its driver change is what T3 builds on.
T4 is independent of T2 and T3. T5 records what T2..T4 made true. T6 is the
owner's: the publication needs a 2FA code and the coordinated pilots need the
extra usage of both accounts switched off, which the owner confirms.

## Gate commands

| Level | Command |
| --- | --- |
| Focused | `node --test <file>` for the files `validation.md` names |
| Quick | `pnpm gate:quick` |
| Architecture | `pnpm test:architecture` |
| Agent | `pnpm agent:check` |
| Matrix | the `platform-matrix` workflow: full, build, and security on the five targets |

## Test coverage matrix (T2)

| Requirement | Test | Layer |
| --- | --- | --- |
| PPR-01 | `tests/integration/provider-child-run.test.mjs`: a conversation that rejects with its own stable code, another provider's, an unstable one, a runtime's, and a value | integration |
| PPR-02 | `tests/contract/codex-driver.test.mjs`: a model absent from the App Server catalog | contract |
| PPR-03 | `tests/integration/codex-verifier-session.test.mjs`: the model the account does not offer, in v1 and v2, on a subscription and on an API key; the usage limit; `tests/integration/codex-identity.test.mjs`: a login that is no ChatGPT one | integration |
| PPR-04 | `tests/integration/driver-execution-adapter.test.mjs`; `tests/security/task-executor-security.test.mjs`; `tests/unit/coordinated-driver.test.mjs` | integration, security, unit |
| PPR-05 | `tests/unit/task-run-coordinator.test.mjs`; `tests/integration/task-run-usage.test.mjs`; `tests/e2e/task-failure-cause-e2e.test.mjs`; `tests/e2e/task-cli-e2e.test.mjs` | unit, integration, e2e |

## Test coverage matrix (T4)

| Requirement | Test | Layer |
| --- | --- | --- |
| PPR-06 | `tests/unit/model-price-table.test.mjs`: the version, the eight Codex models, the listing rules (once, by one driver, never priced), every listed name admitted by a request; `tests/contract/task-request.test.mjs` and `tests/contract/task-request-v2.test.mjs`: a subscription-only model admitted for the implementer, the verifier, and a node, an unlisted name refused | unit, contract |
| PPR-07 | `tests/integration/task-run-prerequisites.test.mjs`: `start` and `resume` refuse a subscription-only model on an API key before the machine is asked, a credential is read, or a worktree is made, and go on for the same models on subscriptions and for priced models on API keys | integration |

## Test coverage matrix (T3)

| Requirement | Test | Layer |
| --- | --- | --- |
| PPR-08, the driver | `tests/contract/codex-driver-structured.test.mjs`: the check reports the asked names the list lacks and nothing else, sends no account, thread, or turn method, keeps the T04 floor alone and the 0.159.3 floor with the account, refuses eleven malformed requests before spawn, and fails as a protocol failure on a list that is no list | contract |
| PPR-08, the session | `tests/integration/codex-verifier-session.test.mjs`: the combined session answers plan type and models with no thread; the models-only session reads no account and starts on a Codex below the account floor, on a login that is no ChatGPT one; a list Codex cannot give is `codex-model-list`, or `codex-account` with the account | integration |
| PPR-08, the run | `tests/e2e/task-model-availability-e2e.test.mjs`: a verifier's model, a Codex node's model alone, and a resumed run's verifier model are refused with the run as it was; `tests/e2e/task-cli-e2e.test.mjs`: a v1 run is refused before the implementer, and a v1 run on a Codex below the account floor still starts | e2e |
| PPR-05 (carried) | `tests/e2e/task-failure-cause-e2e.test.mjs`: the verifier and the Codex node cases now fail at a thread the App Server refuses, since a missing model is refused earlier | e2e |

## Test coverage matrix (T5)

| Requirement | Evidence | Layer |
| --- | --- | --- |
| PPR-09, the record | `.specs/features/live-task-pilot/validation.md`: the two P1 attempts in the results table, the stop rule section (what worked, what stopped it, the diagnostic gap), the deviations, and the seven requests' digests, each checked by a script against the file's own SHA-256 and, before, against `git show HEAD` | documentation |
| PPR-09, the requests | the seven requests normalize with `normalizeTaskRequest` (S3b refused `VES_TASK_REQUEST_TASK_INVALID`, as intended) and match the Task Request v1 schema's verifier pattern | check run for this change |
| PPR-09, the examples | `tests/e2e/task-request-examples-e2e.test.mjs`: each of the three examples still plans in a dry run with its declared topology, now on `codex:gpt-5.5` | e2e |
