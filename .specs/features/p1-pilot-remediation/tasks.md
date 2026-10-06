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
