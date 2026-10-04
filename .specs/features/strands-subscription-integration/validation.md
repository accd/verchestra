# Strands Subscription Integration Validation

**Verdict**: FAIL — independent verification (T9) at `c3223c6`, against
`spec.md`. 68 requirements PASS, 10 are PARTIAL, 6 FAIL (SSI-29, SSI-42,
SSI-46, SSI-47, SSI-49, SSI-52), and SSI-84 is pending the owner's pilots;
decision D3b is not met for the Codex verifier. The planned discrimination
list is killed in full (16 of 16 rows, 19 mutant runs); 3 of the verifier's 9
additional mutants survived. Every gate passes on all five platforms. See "Independent
Verification (T9)" at the end of this file. The T1–T8 sections below are the
authors' evidence, kept as written.

**Diff range for verification**: `7e274f237648251b972081471134623097122c16..c3223c6d3d8585a35f577136ce7f7d61ddb378cc`

## T1 and T2 Evidence

| Check | Command or source | Result |
| --- | --- | --- |
| Base revision | `git rev-parse HEAD` in the new worktree | `7e274f237648251b972081471134623097122c16`, equal to the plan's analysed remote HEAD |
| Install | `pnpm install --frozen-lockfile` (Node 24.14.0, pnpm 10.34.5) | PASS |
| Spec structure | `python3 <tlc-spec-driven>/scripts/validate_spec.py spec.md` | 0 errors, 0 warnings |
| Task structure | `python3 <tlc-spec-driven>/scripts/validate_tasks.py tasks.md` | 0 errors; 1 warning (T1 has no code layer, as the matrix says) |
| Skill copies | SHA-256 of the 39 installed files against the inventory | 39 of 39 match; no extra file |
| Readiness | `pnpm agent:check` | Recorded in `handoff.md` `lastGate` |
| Quick gate | `pnpm gate:quick` | Recorded in `handoff.md` `lastGate` |
| Probes | Scratch install, import, run, and bundle probes in the ignored `.tmp/` (`research.md` S5–S9) | No file outside `.tmp/` changed; `git status` clean apart from this feature's files |

## T3 Evidence

Author evidence for T3 (Task Request v2 contracts). The independent verifier
re-derives it after T8.

### v1 goldens, recorded before any T3 change

Recorded on `dc35c52` (the T3 base, `origin/main`) with a disposable probe: a
copy of `apps/vestra-cli/src/task/task-plan.ts` that only added `export` to
`packageInput` and `approvalIntent`, run against the fixed inputs of
`tests/helpers/task-run-record-fixture.mjs`, then deleted (`git status` clean).
Two runs printed identical values.

| Value | Golden | Asserted at |
| --- | --- | --- |
| `schemas/task-request/1.schema.json` bytes | `sha256:9bfc24cec02371649ef58c67370e9b631f6d8fbc563ab33363e505213d048d62` | `tests/contract/task-request-v1-golden.test.mjs:25` |
| `packages/contracts/src/generated.ts` before v2 | `sha256:341983f6ffe969ccff397457284597d7a36e54732115291414326be77ba38512` | `tests/contract/task-request-v1-golden.test.mjs:36` |
| Canonical normalized v1 request (with repair policy) | `sha256:e1040b2826bf1725293fa29b017a09694ae5c9919b08ababd25b58ea43496d68` | `tests/contract/task-request-v1-golden.test.mjs:43` |
| Canonical normalized v1 request (without repair policy) | `sha256:cd24f69dc148d13e8d85e811f8968cb5708b065f00b4152032e3160f59673464` | `tests/contract/task-request-v1-golden.test.mjs:49` |
| Execution-contract digest of the fixture request | `sha256:2b4dd994497595fb01d37ea747af6ca34bfe6dc85c01fc7b02c6da7ccdd1a196` | `tests/contract/task-request-v1-golden.test.mjs:55` |
| Sealed `plan.json` bytes of the fixture plan record | `sha256:e6c97cd79c6eb7a6ea93d954e9c098cc8205a4cece0318615b51b7eabed0272f` | `tests/contract/task-request-v1-golden.test.mjs:64` |
| Execution Package payload digest | `sha256:13f2bc46466cabfb74f678f3913e5838cd838ef20b1f2f5ceea1a06be93a11db` | `tests/contract/task-request-v1-golden.test.mjs:73` |
| Approval binding digest | `sha256:9a6d82f4cc3fe2109fea2ef033b2334eef11d6f09c92eb3f3a5df616dc0f87a5` | `tests/contract/task-request-v1-golden.test.mjs:77` |
| `task plan` surface of the fixture plan | `sha256:5056fc0cf5335975fbcda1a748b2aeeca4b4313f4418926cf87bbea0ad47ec83` | `tests/contract/task-request-v1-golden.test.mjs:85` |

### Commit 1 — schema, generator, generated type

- `schemas/task-request/2.schema.json`: closed at every level; shares
  `sourceRevision`, `task`, `gates`, `budgets`, `onGateFailure`, `verifier`,
  and `instructions` with v1 byte for byte as JSON values
  (`tests/contract/task-request-v2.test.mjs:35`); drops `driver` (`:36`); mode
  members by `if`/`then`/`else` (agent: one node, no `edges`, `start`,
  `handoffs`; graph: `edges`; swarm: `start` and `handoffs`, 2–16 nodes, no
  inputs). Handoff lists are bounded by the node ceiling (256) rather than the
  swarm ceiling, because json-schema-to-typescript expands an array bounded at
  20 or fewer into a union of tuples; the normalizer enforces the swarm limits.
- `scripts/generate-contract-types.mjs` reads every `<n>.schema.json` in
  ascending order (`schemaVersions`); the regenerated file only appends
  `TaskRequestV2` (212 added lines, 0 removed).
- `tests/contract/schema-registry.test.mjs:54` now lists `task-request@2`: the
  exact list assertion is kept and gains the declared version.
- Gates: focused contract tests 101/101; `pnpm gate:quick` PASS (unit 2666,
  agent-readiness 331, census 13; 0 fail, 0 skipped, 0 todo);
  `pnpm test:architecture` 122/122; `pnpm test:contract` 814/814.

### Commit 2 — normalizer and coordination plan

- `normalizeTaskRequest` dispatches on `schemaVersion`: only an object that
  declares `2` is read as v2; every other value goes through the unchanged v1
  path (`normalizeTaskRequestV1`, refactored only to share its five common
  members in the order v1 always checked them). The CLI calls
  `normalizeTaskRequestV1` explicitly in this commit, so `vestra task` behaves
  as before until commit 3 adopts v2.
- `packages/application/src/execution/coordination-plan.ts` holds the plan
  types, the defaults and ceilings of SSI-37 and SSI-38, and the rules no JSON
  Schema states (sizes against effective limits, scopes, writers, graph
  topology, swarm handoffs). It imports only `@verchestra/domain`
  (`isWithinTaskScope`, `taskPathsOverlap`, `namesGitMetadata`).
- Codes. A member outside the schema at any depth, a missing member, or a
  member of another mode is `VES_TASK_REQUEST_INVALID` (SSI-24), including
  inside the sections v2 shares with v1, where v1 keeps its section codes. A
  node driver other than `claude-code` or `codex`, or a model of the other
  driver's grammar, is the existing `VES_TASK_REQUEST_DRIVER_UNSUPPORTED`; an
  unpriced node model is the existing `VES_TASK_REQUEST_MODEL_UNPRICED`. Every
  other descriptor refusal is `VES_TASK_REQUEST_EXECUTION_INVALID`, the code
  SSI-25..27 name. It is an internal `TaskRequestErrorCode` that reaches the
  owner as the `reason` of the existing public `VES_TASK_REQUEST_REJECTED`
  (`apps/vestra-cli/src/task/task-plan.ts` `readRequest`), so no public code is
  added and the runtime catalog keeps 19.
- `task-executor.ts` exports `ATOMIC_EXECUTION_TASK_FIELDS`, the list
  `normalizeTask` already used, so the v2 closed-member check and the task
  normalizer share one list. The change is line-neutral: every line from 281 on
  is unchanged, so the `task-executor.ts:<line>` citations in `docs` and
  `.specs` still hold.
- Parity with the schema follows `tests/contract/task-request.test.mjs`: shape
  rules are refused by both (`tests/contract/task-request-v2.test.mjs:266-267`,
  `:423-424`, `:191-192`, `:227-228`); cross-field rules are admitted by the
  schema and refused by the normalizer (`:497-498`, `:504-505`, `:203-204`).
- Spec-precision notes. SSI-25's "a node unreachable from a source" can only
  happen behind a cycle in a finite directed graph, so one rule (Kahn's order)
  refuses both; the case at `:443` is a cycle that no source reaches. A write
  scope "covers" a protected path when either contains the other in any letter
  case (`taskPathsOverlap`), and Git metadata at any depth counts as protected
  (the task-path invariant). Handoff lists need at least one entry.
- Gates: focused tests 149/149 (v2 contract 96, v1 contract, goldens, request
  security); `pnpm gate:quick` PASS (unit 2666, agent-readiness 331, census
  13; 0 fail, 0 skipped, 0 todo); `pnpm test:architecture` 122/122;
  `pnpm test:contract` 906/906.

### Commit 3 — plan-time binding, presentation, and plan record load path

- `task plan` reads a request through the dispatching `normalizeTaskRequest`.
  The review's `selectedPassports` names one `<driver>:<model>` per node, in
  plan order, then the verifier; `destinations` stays both providers (a v2
  plan always has a writer, only a Claude Code node writes, and the verifier
  is Codex); `capabilities` stays `worktree-write`. The plan surface presents
  `execution` (the whole normalized descriptor, every limit explicit) where a
  v1 plan presents `implementer`; a v1 surface is byte-identical
  (`tests/contract/task-request-v1-golden.test.mjs:85`).
- `planApproval` (`apps/vestra-cli/src/task/task-plan.ts`) is the binding seam
  `planTask` now calls: package, intent, and approval request from a context,
  a manifest, a sealer, and a requester. The goldens and the per-element
  binding tests drive it with a fixed seed, instant, and ID source
  (`tests/helpers/task-plan-fixture.mjs`).
- The plan record keeps `schemaVersion: 1`; its `request` is a v1 or v2
  normalized request (`TaskPlanRecord<PlannedTaskRequest>`) and carries its own
  version. The loader re-normalizes it through the same dispatch, so a stored
  v2 descriptor the intake contract refuses fails closed
  (`tests/integration/task-coordinated-plan.test.mjs:69`) and a mismatched
  digest is tampered (`:75`). A build without v2 refuses a v2 record as
  `VES_TASK_STATE_MALFORMED`, because its v1 normalizer rejects
  `schemaVersion: 2`.
- Interim refusal until T5 composes coordinated runs: `singleSessionPlan`
  (`apps/vestra-cli/src/task/task-plan-record.ts`) refuses a v2 run at
  `start`, `resume`, and `review` with the existing public
  `VES_TASK_NOT_CONFIGURED` (`requirement: coordinated-run`) right after the
  plan loads, before any credential read, transition, worktree, or provider
  call (`tests/integration/task-coordinated-plan.test.mjs:102-105`, with the
  fixture's credential deny guard). `plan`, `approve`, `status`, and `cancel`
  accept a v2 run. T5 replaces this refusal with the coordinated composition.
- Citations. `task-plan.ts:293-297` in
  `.specs/features/architecture-deepening-2/validation-t8.md` now reads
  `task-plan.ts:317` (the requester ports moved into the `planApproval` call).
  The edits to `task-run.ts`, `task-review.ts`, `task-verifier.ts`, and
  `task-run-record.ts` replace lines in place, so every cited line of those
  files is unchanged (compared against `dc35c52`); `task-executor.ts` is
  line-neutral (commit 2).
- Gates at the tip: focused suites 337/337; `pnpm gate:quick` PASS (unit
  2689, agent-readiness 331, census 13); `pnpm test:architecture` 122/122;
  `pnpm gate:build` PASS (unit 2689, contract 907, integration 1149, e2e 277,
  architecture 122, build 172, qualification 348); `pnpm gate:security` PASS
  on its second run (unit 2689, contract 907, e2e 277, architecture 122,
  qualification 348, security 1324, fault 309) — the first run lost 11 e2e
  cases to `ENOSPC` from the shared temporary directory, with no failure of
  another kind, and a 64 MiB temporary write succeeded before the rerun;
  `node --test tests/e2e/task-cli-e2e.test.mjs` 45/45; `pnpm agent:check`
  PASS. Every run: 0 fail, 0 skipped, 0 todo. `docs/` is unchanged, so
  `pnpm site:check` does not apply.

### T3 discrimination sensor (author run)

Each mutant edited one source file in place, ran the five T3 suites
(`tests/contract/task-request-v2.test.mjs`, `task-request-v1-golden`,
`task-request`, `tests/unit/task-plan-binding.test.mjs`,
`tests/integration/task-coordinated-plan.test.mjs`; 174 tests, all passing
unmutated), and restored the file; a SHA-256 of the working tree matched
before and after. The first run left V1 alive: every cycle fixture also had an
input on a cycle node, so the input rule refused it first. The three cycle
cases now clear all inputs (`tests/contract/task-request-v2.test.mjs`
`withEdgeAndNoInputs`); the second run killed all 27.

| Mutant | Killed by (failing tests) |
| --- | --- |
| V1 ignore Kahn's result (accept a cycle) | 3: a cycle, an edge to itself, a node no source reaches |
| V2 accept an edge naming an unknown node | 1: an edge naming an unknown node |
| V3 accept an input that is not an ancestor | 4: unknown, self, descendant input, input on an agent |
| V4 accept unordered writers | 1: two writers not ordered by a path |
| V5 let a scope leave the change scope | 3: read scope, write scope, letter-case variant |
| V6 let a write scope cover a protected path | 3: contains, inside, case variant of a protected path |
| V7 let a Codex node write | 2: graph and swarm Codex write scope |
| V8 accept a plan in which no node writes | 3: agent, graph, swarm without a writer |
| V9 accept an unknown swarm start | 1 |
| V10 accept a forbidden handoff destination | 2: handoff to an unknown node, to itself |
| V11 accept a handoff source listed twice | 1 |
| V12 accept swarm node inputs | 1 |
| V13 drop the graph node limit | 1: topology above a default limit |
| V14 drop the graph edge limit | 1: topology above a default limit |
| V15 drop the swarm agent limit | 2: above the default, beyond the ceiling |
| V16 raise the maxNodes default by one | 7, including the descriptor, plan record, and presentation tests |
| V17 drop the limit ceilings | 1: each limit above its ceiling |
| V18 skip the closed shared sections (SSI-24) | 5: verifier, task, gate, budgets, repair policy members |
| V19 let a member of another mode through | 6: members of another mode, missing mode members |
| V20 skip every coordination rule | 33 |
| V21 let start, resume, and review drive a v2 run | 3: start, resume, review refusals |
| D1 drop node descriptions from the plan | 10, including the per-element binding test |
| D2 drop node instructions from the plan | 4, including the per-element binding test |
| D3 drop node inputs from the plan | 7, including the per-element binding test |
| D4 drop declared limits from the plan | 12, including the seven per-limit binding tests |
| D5+D6 digest only the task as the execution contract and as the package decision | 20: every descriptor element's binding test and the v1 binding golden |
| D7 one passport for the first node instead of one per node | 2: v2 review passports, v2 plan surface |

Digest coverage is redundant on purpose: the package binds the whole request
as `executionContractDigest` and as the `decision:task-request` digest, so the
per-element binding tests alone survive a mutant that narrows only one of the
two. That single mutant is killed by
`tests/unit/task-plan-binding.test.mjs:85` and the v1 binding golden (2
failures, separate run).

### Tests changed, none deleted

- `tests/contract/schema-registry.test.mjs:54`: the exact registry list gains
  `task-request@2`.
- `tests/contract/task-request-v2.test.mjs`: the cycle cases were strengthened
  after the sensor (above).
- No test was deleted, skipped, or weakened.

## T4 Evidence (driver structured results and quota signals)

Author's evidence, commit by commit, on branch `strands/t4-driver-results`
(base `origin/main` at `dc35c52`). The independent verifier re-derives it.

| Commit | Behaviour | Assertion (file:line) | Gate run |
| --- | --- | --- | --- |
| 1 | The closed table names ten types; `result.structured { value, bytes }` and `quota.exhausted { scope, resetsAt? }` have exactly these kinds | `tests/unit/driver-event.test.mjs:18` (type list), `:63-64` (rows) | `node --test tests/unit/driver-event.test.mjs`: 37 of 37 |
| 1 | The structured-result rule: canonical value and UTF-8 size; a copy, so the provider's object cannot change it; exactly at the bound passes, one byte over is `too-large`; bytes, not characters; a bound that is not a positive count refuses; non-canonical values (cycle, depth 1000, non-finite, function, lone surrogate) are `invalid` | `tests/unit/driver-event.test.mjs:128`, `:136`, `:143`, `:153`, `:158` | same |
| 1 | The quota rule: epoch seconds become a canonical UTC instant; an unspellable reset is dropped, never guessed; a scope outside `^[a-z][a-z0-9_]{0,63}$` is `unknown`, so no free provider text reaches the event | `tests/unit/driver-event.test.mjs:171`, `:186`, `:196` | same |
| 1 | The mock scripts the new types and refuses a structured result whose size is not its canonical size, a quota scope the rule would not keep, and a scripted optional field | `tests/contract/mock-driver.test.mjs:30-31`, `:95`, `:109` | `node --test tests/contract/mock-driver.test.mjs`: 20 of 20 |

| 2 | A structured invocation adds `--json-schema <canonical schema>` before `--model` and `StructuredOutput` to `--allowedTools`, nothing else, in both mediated profiles; the plain invocations are unchanged | `tests/contract/claude-code-driver-structured.test.mjs:47` | `node --test tests/contract/claude-code-driver-structured.test.mjs`: 9 of 9 |
| 2 | Success: one `result.structured` (canonical value, 53 bytes) after `usage.updated`; the `StructuredOutput` call is no `tool.requested`; listed or unlisted at init | `tests/contract/claude-code-driver-structured.test.mjs:68`; exact sequence `spikes/claude-code-driver/test/claude-driver-structured.test.mjs:51` | same; `node --test spikes/claude-code-driver/test/claude-driver-structured.test.mjs`: 5 of 5 |
| 2 | Success without `structured_output` and `error_max_structured_output_retries` fail with `VES_CLAUDE_STRUCTURED_OUTPUT_MISSING` (spec edge case) | `tests/contract/claude-code-driver-structured.test.mjs:88`; `spikes/claude-code-driver/test/claude-driver-structured.test.mjs:65` | same |
| 2 | An answer one byte over its bound (53 > 52) and an 8 KiB answer fail with `VES_CLAUDE_STRUCTURED_OUTPUT_LIMIT`; the answer text is in no event | `tests/contract/claude-code-driver-structured.test.mjs:119` | same |
| 2 | A session that asked for no schema refuses `StructuredOutput` at init (`VES_CLAUDE_TOOL_SURFACE_UNEXPECTED`) and keeps an unasked call a `tool.requested`, which the adapter refuses | `tests/contract/claude-code-driver-structured.test.mjs:136` | same |
| 2 | A request that is not exactly `{ schema, maxBytes }`, a schema that is not a canonical JSON object of at most 16 KiB, a bound outside 1..1 MiB, and a structured request on the T03 profile are refused with `VES_CLAUDE_OUTPUT_SCHEMA_INVALID` before spawn | `tests/contract/claude-code-driver-structured.test.mjs:149` | same |
| 2 | SSI-54: `apiKeySource` other than `none` in the subscription profile ends the session before `session.started`, with no tool effect; the bare profile is not refused for its key | `tests/contract/claude-code-driver-structured.test.mjs:172`; `spikes/claude-code-driver/test/claude-driver-structured.test.mjs:108` | same |
| 2 | SSI-58: `rate_limit_event` `rejected` emits one `quota.exhausted` with the window as scope and the reset when given (`five_hour`, `2026-09-21T14:13:20.000Z`; `seven_day` without reset); purchase, overage, and session fields are dropped | `tests/contract/claude-code-driver-structured.test.mjs:187`; `spikes/claude-code-driver/test/claude-driver-structured.test.mjs:92` | same |
| 2 | `allowed_warning` (twice) records one `VES_CLAUDE_QUOTA_WARNING` and the session completes with its write | `tests/contract/claude-code-driver-structured.test.mjs:214` | same |
| 2 | The installed Claude Code documents `--json-schema` (read-only `--help`; not configured when absent) | `spikes/claude-code-driver/test/claude-driver-structured.test.mjs:122` | same, against the installed 2.1.282 |
| 2 | Existing Claude sequences unchanged: the child-run, cancel-order, provider-ends, input-failure, mediated, subscription, and lifecycle suites pass with no edit | `spikes/claude-code-driver/test/*.test.mjs` (unchanged files), `tests/contract/driver-lifecycle-matrix.test.mjs` | 235 of 235 across the Claude, adapter, bridge, and e2e suites |

| 3 | SSI-57: the allowlist is exactly `initialize`, `initialized`, `account/read`, `account/rateLimits/read`, `model/list`, `thread/start`, `turn/start`, `turn/interrupt`; no credit, login, logout, or nudge method | `tests/contract/codex-driver-structured.test.mjs:73` | `node --test tests/contract/codex-driver-structured.test.mjs`: 14 of 14 |
| 3 | `codexWireFrame` refuses `account/rateLimitResetCredit/consume`, `account/sendAddCreditsNudgeEmail`, `account/login/*`, `account/logout`, and any unlisted or non-string method with `VES_CODEX_METHOD_DENIED`; a response frame passes | `tests/contract/codex-driver-structured.test.mjs:92` | same |
| 3 | Every message sent in five fake modes is on the allowlist; the driver writes only frames `codexWireFrame` made, names methods only by allowlisted literals, and no product source spells a denied method | `tests/contract/codex-driver-structured.test.mjs:107`; `tests/architecture/codex-client-methods.test.mjs:42`, `:49`, `:60` | same; `node --test tests/architecture/codex-client-methods.test.mjs`: 3 of 3 |
| 3 | A session that asks for neither keeps the T04 conversation: exactly `initialize`, `initialized`, `model/list`, `thread/start`, `turn/start`, and the T04 event types | `tests/contract/codex-driver-structured.test.mjs:121` | same |
| 3 | `turn/start` carries the canonical `outputSchema` only when asked; the last agent message (after commentary) is the 53-byte `result.structured`; without a schema the fake answers prose and no result is emitted | `tests/contract/codex-driver-structured.test.mjs:133`; exact sequence `spikes/codex-driver/test/codex-driver-structured.test.mjs:58` | same; `node --test spikes/codex-driver/test/codex-driver-structured.test.mjs`: 5 of 5 |
| 3 | No final message, a message that is not JSON, an 8 KiB answer, and 53 bytes against a bound of 52 fail with `_STRUCTURED_OUTPUT_MISSING`, `_INVALID`, `_LIMIT`; exactly 53 passes | `tests/contract/codex-driver-structured.test.mjs:157` | same |
| 3 | The floor 0.159.3 refuses a structured or subscription-only session on 0.159.2 before spawn; a plain session on 0.115.0 completes | `tests/contract/codex-driver-structured.test.mjs:177` | same |
| 3 | A malformed structured request or a `subscriptionOnly` other than `true` is refused before spawn | `tests/contract/codex-driver-structured.test.mjs:196` | same |
| 3 | SSI-55: a subscription-only session sends `account/read` (`refreshToken: false`) and `account/rateLimits/read` before `model/list`; an `apiKey`, `amazonBedrock`, or absent account fails with `VES_CODEX_AUTH_METHOD_MISMATCH` before `thread/start` | `tests/contract/codex-driver-structured.test.mjs:217`, `:232`; `spikes/codex-driver/test/codex-driver-structured.test.mjs:68` | same |
| 3 | SSI-56: `hasCredits`, `unlimited`, a non-zero balance, a malformed credits value, or credits on any `rateLimitsByLimitId` snapshot fail with `VES_CODEX_CREDITS_PRESENT` and no `turn/start`; zero, `0.00`, and absent credits pass | `tests/contract/codex-driver-structured.test.mjs:249` | same |
| 3 | SSI-58: `ordinaryUsageAllowed: false` emits `quota.exhausted` (`ordinary_usage_disallowed`, latest reset among full windows) and `VES_CODEX_QUOTA_EXHAUSTED` with no turn; `null` proceeds | `tests/contract/codex-driver-structured.test.mjs:283`; `spikes/codex-driver/test/codex-driver-structured.test.mjs:83` | same |
| 3 | SSI-58: `codexErrorInfo: "usageLimitExceeded"` emits one `quota.exhausted` (`usage_limit_exceeded`, no reset) before the existing failure; a usage-limit `rateLimitReachedType` emits one event with its reset, twice reported once; `rate_limit_reached` emits none | `tests/contract/codex-driver-structured.test.mjs:313`, `:329` | same |
| 3 | The installed `codex-cli 0.159.3` generates `outputSchema` on `turn/start`, every allowlisted request, the two denied credit methods, `chatgpt` accounts, `usageLimitExceeded`, `ordinaryUsageAllowed`, the credits snapshot, the four quota kinds, `account/rateLimits/updated`, and `agentMessage` items (read-only generation, disposable HOME and CODEX_HOME, nothing written to HOME) | `spikes/codex-driver/test/codex-driver-structured.test.mjs:145` | same, against the installed 0.159.3 |
| 3 | Existing Codex sequences unchanged: contract, lifecycle, integration, child-run, cancel-order, process-tree, provider-ends, identity, and T04 spike suites pass with no edit | unchanged files | 191 of 191 |

| 4 | SSI-48: a completed session's `result.structured` becomes `outputRefs: ["payload:sha256:<digest of the canonical bytes>"]`; the store returns exactly those bytes; the `driver-finished` checkpoint keeps its six fields and no answer text | `tests/integration/driver-execution-adapter.test.mjs:307` | `node --test tests/integration/driver-execution-adapter.test.mjs`: 15 of 15 |
| 4 | A structured result of a failed session is not handed on (`outputRefs: []`) | `tests/integration/driver-execution-adapter.test.mjs:325` | same |
| 4 | A second structured result, or one whose size is not its canonical size, stops the session with `VES_DRIVER_ADAPTER_INPUT_INVALID` and no `driver-finished` checkpoint | `tests/integration/driver-execution-adapter.test.mjs:335` | same |
| 4 | SSI-58/59 seam: the first `quota.exhausted` stops the session and surfaces as `VES_DRIVER_QUOTA_EXHAUSTED` with a frozen `{ scope, resetsAt? }`; later events are not handed on | `tests/integration/driver-execution-adapter.test.mjs:358` | same |
| 4 | SSI-49, SSI-81: Codex events and closes in five account and quota modes carry no e-mail, account identifier, upsell, provider prose, or thread, turn, or session identity, and the client echoes no account field; a structured Claude session through the adapter hands on only its canonical answer, and its checkpoints, result, payload, and quota refusal carry no token, session, purchase field, or temporary path | `tests/security/driver-structured-results-security.test.mjs:58`, `:162`, `:173` | `node --test tests/security/driver-structured-results-security.test.mjs`: 3 of 3 |

Changed assertions (no test deleted): `tests/unit/driver-event.test.mjs:18`
"the field table names the eight event types" became "ten event types" with the
two new rows inserted after `usage.updated`; the eight existing types keep
their order.

Guardrails: `complexity-baseline.json` lost the key
`packages/drivers/src/index.ts :: Function 'validateScriptEvent'` (15): the
scripted checks moved into a table, so the function fell below the target of
10. It also lost `packages/drivers/src/claude-code-driver.ts :: Arrow function`
(17): the stream translation dispatches by message type through a table, so no
arrow function of the file is above 10; `Async method 'start'` keeps 14. It lost
`packages/drivers/src/codex-driver.ts :: Arrow function` (26) the same way;
`Private method #validateExecution` keeps 14.
`docs/canonical-json-census.json` gained
`packages/domain/src/driver-event/driver-event.ts`,
`packages/drivers/src/driver-structured-output.ts`, and
`packages/agent-runtime/src/execution/driver-execution-adapter.ts` (all
`migrated-v2`, two `canonicalizeJsonV2` signals each).

Fixture fidelity: commit 2 also made the `vestra task` journey fake
(`tests/helpers/task-cli-fakes/fake-claude-task.mjs`) report `apiKeySource`
as 2.1.282 does (`ANTHROPIC_API_KEY` under `--bare`, `none` otherwise); without
it the new subscription check refuses the fake, as it would refuse a real
session that hid its source.

## T5 Evidence (coordinated driver, Strands engine, sealed build, composition)

Author's evidence, commit by commit, on branch `strands/t5-coordinated-driver`
(base `origin/main` at `a73650a`). The independent verifier re-derives it.

### Commit 1 — coordinated driver, native engine, node results

Modules (all in `packages/application/src/execution/`, importing only
`@verchestra/domain`): `node-result.ts` (closed draft-07 node-result and
handoff schemas and their validator), `coordination-engine.ts` (the engine
port and `NativeAgentEngine`, D5), `coordination-ledger.ts` (the node ledger
and its validated reader), `node-prompt.ts` (the node prompt), and
`coordinated-driver.ts` (`CoordinatedDriver`, the executor's driver port over a
coordination plan).

| Behaviour | Assertion (file:line) | Run |
| --- | --- | --- |
| SSI-43: a graph node's schema is the closed `outcome`/`summary` object; a swarm node's `next` enum lists only its declared targets and `<complete>` | `tests/unit/node-result.test.mjs:20`, `:32` | `node --test tests/unit/node-result.test.mjs`: 9 of 9 |
| SSI-44, SSI-46: 13 malformed results (extra or missing member, unknown outcome, unbounded summary or message, not JSON, not UTF-8, not canonical, missing destination) are `VES_COORDINATION_RESULT_INVALID`; an undeclared destination is `VES_COORDINATION_HANDOFF_UNDECLARED`; strings are bounded by characters as JSON Schema counts them | `tests/unit/node-result.test.mjs:53`, `:77`, `:86` | same |
| SSI-47: at the node and run limits a result passes, one byte over either is `VES_COORDINATION_RESULT_TOO_LARGE` | `tests/unit/node-result.test.mjs:93` | same |
| SSI-06, SSI-50: a node prompt is built from the approved node and task, its declared inputs' results, and the handoff, each delimited as untrusted data after the rules; a reader is told it never writes | `tests/unit/node-result.test.mjs:100`, `:128` | same |
| D5: mode `agent` runs on the native engine; the result is persisted by digest and the visit completed | `tests/unit/coordinated-driver.test.mjs:31` | `node --test tests/unit/coordinated-driver.test.mjs`: 24 of 24 |
| Order: a graph runs in dependency order and each node gets only its declared inputs' results | `tests/unit/coordinated-driver.test.mjs:54` | same |
| Dependency failure: a failed node fails the run with its code and nothing downstream starts | `tests/unit/coordinated-driver.test.mjs:71` | same |
| An engine that starts a node before its parent, twice, or outside the plan fails the run before any session | `tests/unit/coordinated-driver.test.mjs:83` | same |
| SSI-37/38 at run time: more nodes at once than the concurrency limit is `VES_COORDINATION_LIMIT` | `tests/unit/coordinated-driver.test.mjs:115` | same |
| SSI-40: two writers made ready at once by an engine never overlap | `tests/unit/coordinated-driver.test.mjs:129` | same |
| SSI-41: a write outside the node's write scope, and any write from a reader, is `VES_COORDINATION_SCOPE_DENIED` before the executor sees it | `tests/unit/coordinated-driver.test.mjs:148` | same |
| SSI-47: an oversized result and one past the run limit are refused before persistence | `tests/unit/coordinated-driver.test.mjs:194` | same |
| SSI-46: a malformed or missing result fails the node and persists nothing | `tests/unit/coordinated-driver.test.mjs:215` | same |
| A `blocked` outcome ends the run with `VES_COORDINATION_NODE_BLOCKED` (spec-precision note below) | `tests/unit/coordinated-driver.test.mjs:228` | same |
| Valid handoff: a swarm follows each declared handoff and hands on the message | `tests/unit/coordinated-driver.test.mjs:238` | same |
| SSI-43/44: a forbidden destination fails the swarm and persists nothing; an engine that routes elsewhere fails the run | `tests/unit/coordinated-driver.test.mjs:255`, `:263` | same |
| SSI-45: an endless handoff loop stops with `VES_COORDINATION_HANDOFF_LIMIT`; no visit past the limit starts | `tests/unit/coordinated-driver.test.mjs:276` | same |
| Explicit end: an engine that claims completion before the plan's end is `VES_COORDINATION_INCOMPLETE` | `tests/unit/coordinated-driver.test.mjs:288` | same |
| Resume replay (SSI-65 seam): a resumed round replays completed visits without a session, a resumed swarm continues from the pending destination | `tests/unit/coordinated-driver.test.mjs:301`, `:327` | same |
| SSI-66 seam: a visit that started and never ended is marked `uncertain` and nothing runs (`VES_TASK_NODE_UNCERTAIN`) | `tests/unit/coordinated-driver.test.mjs:351` | same |
| A finished round is followed by a new round for the next repair attempt, with the gate feedback | `tests/unit/coordinated-driver.test.mjs:369` | same |
| SSI-34: cancel reaches every running node, through its signal and its driver's `cancel`; the executor's signal does too | `tests/unit/coordinated-driver.test.mjs:386`, `:407` | same |
| SSI-59 seam: a quota failure starts no further node, even for an engine that keeps scheduling, and cancels the running ones | `tests/unit/coordinated-driver.test.mjs:424` | same |
| SSI-39: every node's usage reaches the executor's meter; checkpoints are filed under the node | `tests/unit/coordinated-driver.test.mjs:469` | same |
| SSI-49: the ledger holds identifiers, counts, instants, digests, and codes only | `tests/unit/coordinated-driver.test.mjs:493` | same |
| SSI-15: inside the real `TaskExecutionCoordinator`, a write outside the node scope is refused before the executor, a protected path inside it is refused by the executor, and the usage of both nodes is metered once (330 tokens) on the run's meter; one authority start, one worktree | `tests/integration/coordinated-executor.test.mjs:60` | `node --test tests/integration/coordinated-executor.test.mjs`: 2 of 2 |
| A node failure fails the executor run with the node's code and the worktree is cleaned up | `tests/integration/coordinated-executor.test.mjs:127` | same |

Spec-precision notes. (1) The spec defines the `outcome` enum but not what
`blocked` does; the driver persists the result as evidence and ends the run
with `VES_COORDINATION_NODE_BLOCKED`, so a node that says it cannot proceed
spends no further allowance. (2) Until T6 adds reconciliation, a resumed round
with any visit that is not completed fails closed with `VES_TASK_NODE_UNCERTAIN`
inside the executor; T6 moves the refusal before any transition. (3) A gate
repair attempt runs the plan again as a new ledger round; the per-run result
limit counts the results of every round.

Gates at this commit: `pnpm gate:quick` PASS (unit 2730, agent-readiness 354,
census 13); `pnpm test:architecture` 125/125; `pnpm agent:check` PASS; 0
failed, 0 skipped, 0 todo. `docs/canonical-json-census.json` gained
`packages/application/src/execution/node-result.ts` (`migrated-v2`, two
`canonicalizeJsonV2` signals). `complexity-baseline.json` is unchanged: no new
function is above 10.

Discrimination (author run, one source edit per mutant, restored after the
run; the three suites above, 35 tests, pass unmutated):

| Mutant | Result |
| --- | --- |
| C1 skip node write-scope narrowing | Killed |
| C2 remove the writer mutex | Killed |
| C3 drop the concurrency limit | Killed |
| C4 drop the handoff limit | Killed |
| C5 accept an undeclared destination in the validator | Killed |
| C6 follow any route the engine takes | Killed |
| C7 persist before the size check | Killed |
| C8 raise the node result limit by one byte | Killed |
| C9 drop the run result limit | Killed |
| C10 drop the explicit-end check | Killed |
| C11 drop the graph order check | Killed |
| C12 run a graph node twice | Killed |
| C13 never replay a completed visit | Killed |
| C14 re-run an uncertain visit | Killed |
| C15 let a `blocked` outcome pass | Killed |
| C16 treat any path as inside a node write scope | Killed |

The first run left three alive, each fixed before the commit: the order
check survived because every fixture node also declared its parent as an
input (the case at `:83` now declares only `plan`); the runtime handoff-limit
check and the reader clause of the scope check were redundant with the
settle-time refusal and the empty-scope rule, and were removed (equivalent
mutants). The concurrency case was also made to fail rather than wait when
the limit is removed.

### Commit 2 — node ledger and node results in the Run record

`apps/vestra-cli/src/task/task-run-record.ts` gains the sealed coordination
members (`coordination/ledger.json` and `coordination/results/<sha256>.json`),
their validated readers, and `RunRecord.coordination()`, the coordinated
driver's record port. The ledger is read through the application's
`normalizeCoordinationLedger`; a result is returned only as the canonical
bytes of the digest it is filed under.

| Behaviour | Assertion (file:line) | Run |
| --- | --- | --- |
| The ledger is sealed and reads back as it was | `tests/unit/task-run-coordination-record.test.mjs:72` | `node --test tests/unit/task-run-coordination-record.test.mjs`: 7 of 7 |
| An edited ledger is `VES_TASK_STATE_TAMPERED`; six ledgers of another shape (extra member, a prompt member, unknown state, completed without a result, a path as node, unknown mode) are `VES_TASK_STATE_MALFORMED`; an invalid ledger is refused before it is written | `tests/unit/task-run-coordination-record.test.mjs:80`, `:99` | same |
| A result is sealed in a file named by its digest and reads back byte for byte; one filed under another digest is tampered; a missing one, a traversal digest (checked before any read), and non-canonical bytes are malformed | `tests/unit/task-run-coordination-record.test.mjs:108`, `:117` | same |
| Resume replay through the Run record on disk: a completed node is replayed from its persisted result, the rest run | `tests/unit/task-run-coordination-record.test.mjs:135` | same |
| An agent run leaves exactly the ledger and one result | `tests/unit/task-run-coordination-record.test.mjs:159` | same |
| SSI-49, SSI-81: the persisted ledger and results hold no token, session, prompt, repository context, or path; every ledger value is an identifier, count, instant, digest, or code; the results are the nodes' own answers | `tests/security/coordination-record-security.test.mjs:27` | `node --test tests/security/coordination-record-security.test.mjs`: 1 of 1 |
| The Run record module still alone names the layout (`ledger.json`, `coordination`, `results` added to the pinned lists) and `loadCoordinationLedger` returns its declared record | `tests/architecture/task-run-record-locality.test.mjs:14-35`, `tests/architecture/task-run-record-readers.test.mjs:30` | `node --test` on both: 14 of 14 |

Citations. The import and layout additions move every later line of
`task-run-record.ts` by seven; the current-code citations in
`.specs/features/architecture-deepening-2/validation-t9.md` (section 2's
reader table and section 4's `recordBudgetLedger` range) are moved with them.
Section 1 of that file cites the base `6fae651` and is unchanged.
`docs/canonical-json-census.json`: `task-run-record.ts` has four
`canonicalizeJsonV2` signals instead of two (still `migrated-v2`).

Gates at this commit: typecheck, lint, format, and complexity PASS;
`pnpm test:architecture` 125/125; `pnpm test:census` 13/13; `pnpm agent:check`
PASS; the Run record suites (`tests/unit/task-run-record*.test.mjs`,
`tests/unit/task-run-markers.test.mjs`, `tests/integration/task-coordinated-plan.test.mjs`)
pass with the new ones, 111 of 111. The quick gate of this group ran at
commit 1.

Discrimination (author run): R1 return a result filed under another digest,
R2 write a ledger without validating it, R3 read a ledger without validating
it, R4 store bytes that are not canonical, R5 read a result outside the
results directory — all killed. R5 first survived, because the digest
comparison also refuses a traversal; the case at `:117` now plants a sealed
record where the traversal lands, so only the grammar check gives the
expected `VES_TASK_STATE_MALFORMED`.

### Commit 3 — the Strands SDK and Zod in agent-runtime (D1)

`packages/agent-runtime/package.json` pins exactly `@strands-agents/sdk`
1.19.0, `zod` 4.6.5, and the SDK's two required peers that D1 accepted,
`@modelcontextprotocol/sdk` 1.32.0 and `@opentelemetry/api` 1.9.1. The
lockfile was updated with `pnpm install` (Node 24.14.0, pnpm 10.34.5); a
`pnpm install --frozen-lockfile` afterwards reports it up to date.

Lockfile diff, reviewed entry by entry:

- 36 package versions added, 0 removed. Every one is reachable from the four
  pins and from nothing else (a reachability walk over the lockfile's
  snapshots): the SDK and the MCP SDK; the MCP SDK's Express 5 and Hono tree
  (`express`, `router`, `body-parser`, `raw-body`, `send`, `serve-static`,
  `finalhandler`, `accepts`, `negotiator`, `type-is`, `media-typer`,
  `mime-types`, `content-type`, `content-disposition`, `cookie-signature`,
  `fresh`, `is-promise`, `merge-descriptors`, `object-assign`,
  `path-to-regexp`, `iconv-lite`, `cors`, `hono`, `@hono/node-server`,
  `express-rate-limit`, `eventsource`, `eventsource-parser`, `pkce-challenge`,
  `ajv-formats`, `json-schema-typed`, `zod-to-json-schema`); and the two
  version moves D1 named, `@aws-sdk/client-bedrock-runtime` 3.1146.0 (beside
  Pi's 3.1127.0, with its `@aws-sdk/token-providers` 3.1146.0) and `yaml`
  2.9.1 (beside 2.9.0 and 2.8.3). `zod` 4.6.5, `uuid` 14.0.2, and
  `@opentelemetry/api` 1.9.1 were already locked.
- No existing package changed version. Eleven existing snapshots changed only
  in optional-peer resolution: `@google/genai` 2.21.0 (under Pi 0.99.1) now
  resolves its optional peer `@modelcontextprotocol/sdk` to the approved
  1.32.0, which renames the Pi snapshots; `vite`, `vitest`, `@vitest/mocker`,
  `vitefu`, `astro`, `@astrojs/mdx`, `@astrojs/starlight`, and
  `astro-expressive-code` resolve their optional peer `yaml` to 2.9.1, the
  approved `yaml` move.
- The SDK's optional peers already in the workspace (`@cedar-policy/cedar-wasm`
  4.12.0, `@google/genai` 2.21.0, `@opentelemetry/resources` and
  `sdk-trace-base` 2.10.0, `@smithy/types` 4.19.0) resolve to their locked
  versions; no optional provider SDK is added. `@cfworker/json-schema`, the
  MCP SDK's only optional peer, is not installed. No package of the new tree
  declares an install script, and `allowBuilds` is unchanged.

| Behaviour | Assertion (file:line) | Run |
| --- | --- | --- |
| SSI-01: agent-runtime declares exactly the four pins and its two workspace packages; no other manifest, the root included, declares any of the four | `tests/agent-readiness/dependency-policy.test.mjs:51` | `node --test tests/agent-readiness/dependency-policy.test.mjs`: 7 of 7 |
| SSI-01: the importer resolves each pin to exactly its version; one SDK and one MCP SDK version are locked; the SDK snapshot resolves the pinned peers | `tests/agent-readiness/dependency-policy.test.mjs:73` | same |
| The installed SDK is 1.19.0, Apache-2.0, with exactly the three required peers and no install hook | `tests/agent-readiness/dependency-policy.test.mjs:96` | same |

Discrimination: P1 a range (`^1.19.0`) instead of the exact SDK pin, P2 an
optional provider SDK (`@anthropic-ai/sdk`) added beside the pins — both
killed.

### Commit 4 — the Strands Graph and Swarm engine

`packages/agent-runtime/src/coordination/strands/` (`strands-engine.ts`,
`structural-agent.ts`, `handoff-schema.ts`, `index.ts`), exported only as
`@verchestra/agent-runtime/strands-coordination`. The engine builds a `Graph`
or `Swarm` of structural agents from the approved plan; each structural agent
asks the coordinated driver's runner to run its node. The application side
gains `type: "string"` on the schema enums (so the Zod projection is exact)
and a closed list of engine-reported codes in `coordinated-driver.ts`
(`VES_COORDINATION_INTERRUPTED`, `_LIMIT`, `_HANDOFF_LIMIT`; anything else is
`VES_COORDINATION_ENGINE_FAILED`).

| Behaviour | Assertion (file:line) | Run |
| --- | --- | --- |
| Order: a graph runs in dependency order through structural agents | `tests/integration/strands-coordination-engine.test.mjs:53` | `node --test tests/integration/strands-coordination-engine.test.mjs`: 16 of 16 |
| SSI-09 concurrency: independent nodes run together up to the limit and no further | `tests/integration/strands-coordination-engine.test.mjs:67` | same |
| Dependency failure: the node's code ends the run; nothing downstream starts | `tests/integration/strands-coordination-engine.test.mjs:90` | same |
| SDK logger: its line for a failed node names the node and the stable code only | `tests/integration/strands-coordination-engine.test.mjs:101` | same |
| Malformed output: `VES_COORDINATION_RESULT_INVALID`, nothing persisted | `tests/integration/strands-coordination-engine.test.mjs:115` | same |
| Valid handoff and explicit end; forbidden handoff fails the swarm with no repair cycle; handoff limit | `tests/integration/strands-coordination-engine.test.mjs:126`, `:141`, `:150` | same |
| Write conflict: two writers an SDK makes ready at once never overlap | `tests/integration/strands-coordination-engine.test.mjs:163` | same |
| SSI-34 cancellation: the SDK stops and every running node is cancelled | `tests/integration/strands-coordination-engine.test.mjs:184` | same |
| Resume replay: a resumed graph and swarm replay completed nodes through the SDK without a session | `tests/integration/strands-coordination-engine.test.mjs:215` | same |
| SSI-04, SSI-06, SSI-07: a structural agent has only `id`, `invoke`, `stream`, ignores the SDK's input, and answers with one text block naming the payload reference | `tests/integration/strands-coordination-engine.test.mjs:245` | same |
| SSI-08, SSI-43: a failure reaches the SDK as a stable code with no cause; an undeclared destination is refused before the SDK sees it | `tests/integration/strands-coordination-engine.test.mjs:269` | same |
| SSI-05, SSI-09: finite `maxConcurrency`, `maxSteps`, `timeout`, `nodeTimeout` from the plan and the remaining budget (plus a one-second grace so the executor's duration stop wins); repetitive-handoff detection off; `preserveContext` false on every node | `tests/integration/strands-coordination-engine.test.mjs:295` | same |
| SSI-10: `INTERRUPTED`, a `CANCELLED` the run did not ask for, and any unknown engine code become coordination failures with stable codes | `tests/integration/strands-coordination-engine.test.mjs:320` | same |
| D5: mode `agent` never reaches the SDK | `tests/integration/strands-coordination-engine.test.mjs:348` | same |
| SSI-79: in a child process with an empty environment, a scripted Graph and Swarm complete with no Bedrock client constructed, no credential-shaped variable read, no network, DNS, or child-process call, and no console output; the reads are exactly the eleven AWS-flag, OTEL, Langfuse, and Node-loader names of `research.md` S6 | `tests/integration/strands-empty-environment.test.mjs:50` | `node --test tests/integration/strands-empty-environment.test.mjs`: 2 of 2 |
| The probe's Bedrock counter is not vacuous: with one client constructed it reports 1 | `tests/integration/strands-empty-environment.test.mjs:69` | same |
| SSI-43: for all 8 nodes of the four fixture plans, the Zod schema's draft-7 projection equals the application's schema (apart from `$schema`); both accept and refuse the same 9 answers; the runtime destination enum is exactly the declared targets and `<complete>` | `tests/contract/strands-node-result-parity.test.mjs:31`, `:41`, `:67` | `node --test tests/contract/strands-node-result-parity.test.mjs`: 3 of 3 |
| SSI-02, SSI-12: only `packages/agent-runtime/src/coordination/strands/` imports the SDK or Zod, and the SDK only as `@strands-agents/sdk/multiagent`, in static, bare, dynamic, and `require` forms, across 264 product sources | `tests/architecture/strands-coordination-subpath.test.mjs:64`, `:69` | `node --test tests/architecture/strands-coordination-subpath.test.mjs`: 5 of 5 |
| SSI-03, SSI-05, TM-017: the adapter names no `Agent`, model, router, MCP client, session manager, `preserveContext`, sandbox, vended tool, telemetry or logging setup, A2A client, environment, process, or network | `tests/architecture/strands-coordination-subpath.test.mjs:87` | same |
| SSI-13: the package declares exactly the two entries; the main entry's import closure reaches neither the adapter nor the SDK nor Zod | `tests/architecture/strands-coordination-subpath.test.mjs:110`, `:136` | same |

Spec-precision notes. (1) The SDK's own `INTERRUPTED` cannot be produced by
structural agents, which never return interrupts; the mapping is tested on
the outcome function and through the coordinated driver. (2) When the
coordinated driver's first failure aborts the run, the SDK records the failing
node as cancelled and prints nothing; its warning line appears only when a
node fails without that abort, which `:101` drives directly. (3) The runtime
destination check in Zod leaves the message to the application validator,
which bounds it by characters as JSON Schema does; Zod would count UTF-16
units.

Gates at this commit: `pnpm gate:quick` PASS (unit 2737, agent-readiness 357,
census 13); `pnpm test:architecture` 130/130; `pnpm agent:check` PASS;
typecheck (which now checks the SDK's own declaration closure, since
`skipLibCheck` is off), lint, format, and complexity PASS; 0 failed, 0
skipped, 0 todo.

Discrimination (author run, the four suites above): S1 hand the SDK provider
text instead of the reference, S2 skip the adapter's destination check, S3
leave the SDK limits unbounded, S4 raise provider text to the SDK, S5 read
`INTERRUPTED` as completed, S6 construct a Strands `Agent` in the adapter, S7
import the SDK root entry, S8 wrap nodes with `preserveContext`, S9 let the
Zod schema drift from the application's, S10 open the swarm decision enum to
every node — all killed. S6 is killed by the probe on its own as well (5
Bedrock clients where 0 are allowed), not only by the architecture ban.

### Commit 5 — sealed self-containment from the bundle metafile (D2)

`scripts/t76-build-candidate.mjs`: `bundleSealedLauncherWithMetafile` runs the
unchanged option vector with `metafile: true` (the output bytes do not change)
and judges self-containment with `assertSelfContainedMetafile` over the
bundler's record of every import the output makes; `bundleSealedLauncher`
returns the same bytes as before. The fail-closed `require` guard is still
required at the head of every artifact.

Equal or stronger. The text scan it replaces read only static `import`
statements from the output text. Over four esbuild bundles of the same option
vector, the old scan flagged `fs` for a static import, nothing for a dynamic
`import("fs")` or a `require("fs")`, and `@strands-agents/sdk` for a string
literal shaped like an import; the metafile check flags all three real imports,
each with its kind, and nothing for the literal.

| Behaviour | Assertion (file:line) | Run |
| --- | --- | --- |
| `node:` built-ins pass in all three import kinds | `tests/build/sealed-self-containment.test.mjs:60` | `node --test tests/build/sealed-self-containment.test.mjs`: 7 of 7 |
| A static, dynamic, or `require` import of anything else, an unprefixed built-in included, fails with its path and kind | `tests/build/sealed-self-containment.test.mjs:73` | same |
| A record that does not describe exactly one output fails closed | `tests/build/sealed-self-containment.test.mjs:87` | same |
| Real esbuild bundles: each external kind is caught from the bundler's own record | `tests/build/sealed-self-containment.test.mjs:92` | same |
| F2: a bundled string shaped like an import is not an import | `tests/build/sealed-self-containment.test.mjs:105` | same |
| All four sealed artifacts of this tree bundle and import `node:` built-ins only | `tests/build/sealed-self-containment.test.mjs:115` | same |
| The bundler itself refuses an entry importing `fs` statically, dynamically, or by `require` | `tests/build/sealed-self-containment.test.mjs:137` | same |

Deleted case → replacement. `tests/build/sealed-launcher-closure.test.mjs:462`
("a sealed launcher bundle imports Node built-ins only") no longer scans the
bundle text with the old regular expression; the same case now asserts the
bundler's metafile record of each staged artifact (no import outside `node:`,
and `node:sqlite` never other than dynamic), and keeps its text check that no
static named import of `node:sqlite` exists. The static-import case the regex
covered is covered by `tests/build/sealed-self-containment.test.mjs:73`, `:92`,
and `:137`.

Sizes and cold start before the adapter enters the closure (this commit's
tree, Node 24.14.0, macOS arm64, a minimal staged layout with the native
placeholders, median of 11 runs): `launcher:vestra` 864,955 bytes and
`launcher:verchestra` 864,963 bytes (845 KiB each; 297 inputs, 168 `node:`
imports); `vestra --version` 65 ms; `vestra --activation-health` 64 ms and
`verchestra --activation-health` 61 ms, both exit 0 with empty stderr.

Not run here: `tests/build/sealed-launcher-closure.test.mjs` stages eleven
release layouts that each copy the 119 MB Node runtime, which this machine's
free disk (2.1 GB) cannot hold with a margin; it, `pnpm test:build`, and
`pnpm gate:build` are left to the platform matrix.

Citations. `scripts/t76-build-candidate.mjs:534` in
`.specs/features/architecture-deepening-2/validation-t2.md` now reads `:556`;
`:14` and `:198-210` did not move. The `:318-326` and `:333-379` citations in
this feature's `research.md`, `design.md`, and `threat-model.md` describe the
base revision the research was gathered at and are left as written.

Discrimination (author run, `tests/build/sealed-self-containment.test.mjs`):
B1 ignore dynamic imports, B2 ignore `require` calls, B3 accept unprefixed
built-ins, B4 the bundler skips the record check, B5 accept a record of
several outputs — all killed.

### Commit 6 — coordinated runs composed in the CLI

`apps/vestra-cli/src/task/task-coordination.ts` builds the coordinated
driver for a v2 run: the per-node driver factory (a Claude Code node is the
mediated session of `claudeSessionAdapter`, generalized from the implementer
port, narrowed to the node's read scope and asked for the node's closed
schema; a Codex node is a read-only Codex session with no tool, from the
Workspace's Codex identity, `subscriptionOnly`, asked for the same schema),
the node ledger port `RunRecord.coordination()`, the run's remaining duration,
and the per-node change digest. `coordinationEngine` returns the native engine
for `agent` and loads the Strands engine for `graph` and `swarm` through the
one literal dynamic import of `@verchestra/agent-runtime/strands-coordination`.
`task-run.ts` composes either driver behind the one executor; `task-verifier.ts`
and `task-review.ts` accept either plan (a v2 capsule binds
`selection:coordination`, the whole approved descriptor, where a v1 capsule
binds `selection:implementer`).

The T3 interim refusal is lifted for `start`, `resume`, and `review` where the
composition is complete, which is on subscriptions: a v2 run whose Claude Code
or Codex provider is set to an API key is refused `not configured`
(`coordinated-run-subscription`) before any credential read, transition, or
worktree. This is the first half of SSI-51; T6 adds the extra-usage
confirmation. The Windows platform refusal is unchanged.

| Behaviour | Assertion (file:line) | Run |
| --- | --- | --- |
| Agent journey: plan, approve, start on the native engine, verifier PASS, review accepted, COMPLETED with a capsule; one completed visit with its change digest and one receipt; one result file; the node asked Claude Code for its schema; 26 tokens on the run's ledger, not billed | `tests/e2e/task-coordinated-e2e.test.mjs:164` | `node --test tests/e2e/task-coordinated-e2e.test.mjs`: 4 of 4 |
| Graph journey through the pinned SDK in the real binary: `plan` (Codex), `build` (Claude Code), `review` (Codex) in order; both Codex nodes read-only with no tool, from the ChatGPT login, in the run's worktree, after their account and rate-limit reads; three Codex sessions (two nodes and the verifier); the verifier's prompt holds no node result (SSI-19); 42 tokens in 4 events on one ledger | `tests/e2e/task-coordinated-e2e.test.mjs:189` | same |
| Swarm journey: the writer hands to the reviewer, which ends the swarm; round completed; the change committed on the task branch | `tests/e2e/task-coordinated-e2e.test.mjs:241` | same |
| SSI-34: `vestra task cancel` on a run whose Codex node never answers stops that node's process, ends the run ABORTED, starts no later node, and removes the worktree | `tests/e2e/task-coordinated-e2e.test.mjs:252` | same |
| `start` and `resume` refuse a v2 run with either provider on an API key and leave it as it was; on subscriptions they go on to their credential read | `tests/integration/task-coordinated-plan.test.mjs:103`, `:114` | `node --test tests/integration/task-coordinated-plan.test.mjs`: 10 of 10 |
| D5, SSI-13, SSI-14 behaviourally: `vestra --version` and an agent engine load no SDK, Zod, or MCP SDK module; a graph or swarm engine loads exactly those three | `tests/integration/task-coordination-loading.test.mjs:40`, `:46`, `:52` | `node --test tests/integration/task-coordination-loading.test.mjs`: 3 of 3 |
| SSI-14: one product source imports the subpath, once, as a literal dynamic import after the agent branch; none statically; no computed specifier in the task composition or agent-runtime | `tests/architecture/strands-coordination-subpath.test.mjs:143` | `node --test tests/architecture/strands-coordination-subpath.test.mjs`: 6 of 6 |
| SSI-83: the single-session journeys are unchanged | `tests/e2e/task-cli-e2e.test.mjs`, `tests/e2e/mediated-task-execution-e2e.test.mjs` (no edit) | 48 of 48 |

Registries extended, assertions kept. `task-coordination.ts` is a new
consumer of a driver session and a new builder of a provider driver, so it
joins the exact lists of `tests/architecture/driver-session-runner-locality.test.mjs:17-23`
and `tests/architecture/provider-process-tree-termination.test.mjs:65`; both
suites hold it to every rule they hold the others to (its session runs through
`runDriverSession`; its Codex driver gets the provider session's tree
terminator and spawn observer, and the session is ended).

Gates at this commit: `pnpm gate:quick` PASS (unit 2737, agent-readiness 357,
census 13); `pnpm test:architecture` 131/131; `pnpm test:contract` 938/938;
`pnpm test:integration` 1179/1179; `pnpm agent:check` PASS; the coordinated
e2e journeys 4/4 and the single-session e2e suites 48/48; 0 failed, 0
skipped, 0 todo.

Deleted case → replacement. `tests/integration/task-coordinated-plan.test.mjs`
held three T3 cases, "start/resume/review refuses a v2 run as not configured
(`coordinated-run`)". Their purpose, that no v2 run is driven before its
composition exists, is now met by the composition itself: the start and
resume cases became the API-key refusal (`:99`, four cases) and the
subscription composition reaching its credential read (`:110`, two cases); the
review case is replaced by the journeys that review a v2 run to COMPLETED
(`tests/e2e/task-coordinated-e2e.test.mjs:164`, `:189`).

Fixture fidelity. The labelled fakes learned the structured protocol the
drivers already speak (T4): the Claude Code fake answers `structured_output`
when `--json-schema` is passed; the Codex fake reports 0.159.3, answers
`account/read` and `account/rateLimits/read` as a ChatGPT Plus login with no
credits, answers a turn that carries `outputSchema` with one JSON final
message, and records whether a node read its account and whether any node
result reached a verifier prompt. `tests/helpers/sealed-repository-fixture.mjs`
links `@strands-agents/sdk` and `zod` into the sealed replica so the build
suites can bundle the adapter; a replica bundled both launchers to the same
bytes as the tree, with no import outside `node:`.

Sizes and cold start with the adapter in the closure (same method as commit 5):
`launcher:vestra` 2,264,949 bytes and `launcher:verchestra` 2,264,957 bytes
(2,212 KiB each; +1,399,994 bytes, 1.34 MiB, each; 1,116 inputs, 218 `node:`
imports; largest additions Zod 474 KB, the SDK 274 KB, `@smithy/core` 185 KB,
the MCP SDK 77 KB, `@aws-sdk/core` 76 KB). `vestra --version` 98 ms (+33 ms);
`vestra --activation-health` 92 ms and `verchestra --activation-health` 91 ms
(+28 ms and +30 ms), exit 0, empty stderr, the same 3,005-byte report, against
the gate's 30-second budget. The SDK closure is inlined but evaluated only when
a graph or swarm run imports it.

Citations moved with the reshaped CLI files, for the lines that were current
at the base: `.specs/features/architecture-deepening-2/validation-t1.md`
(`task-run.ts:331` → `:378`, `task-codex.ts:43` → `:44`), `validation-t6.md`
(`task-codex.ts:171-172` → `:179-180`, `:258` → `:266`, in the current-code
tables), `validation-t7.md` (`task-review.ts:84-87` → `:94-97`, `:87` → `:97`;
`task-run.ts:230`, `:241`, `:248` → `:252`, `:263`, `:270`), `validation-t9.md`
(section 4: `task-review.ts:42` → `:52`, `:68`, `:268`, `:281` → `:78`,
`:275`, `:288`, `:85` → `:95`),
`.specs/features/architecture-deepening/validation-c5.md`
(`task-review.ts:174-200` → `:181-207`), `validation-c6.md` (`task-run.ts:329`
→ `:376`), and `.specs/features/live-task-pilot/validation.md`
(`task-run.ts:51`, `:563-564`, `:352`, `:599-601` → `:60`, `:610-611`, `:399`,
`:646-648`). Left as written: citations in sections pinned to an earlier
revision (validation-t9 section 1, validation-t6's friction table, validation-t1's
"before" column), records of an earlier move ("is now"), and citations that
were already stale at the base (`task-verifier.ts:206-235` in validation-c5,
`task-run.ts:327` and `task-review.ts:258` in run-record-hardening).
`docs/canonical-json-census.json` gained `task-coordination.ts` (`migrated-v2`,
two `canonicalizeJsonV2` signals).

Discrimination (author run): K1 drop the subscription guard, K2 run every mode
on the native engine, K3 load the SDK for every mode, K4 Codex nodes skip the
account checks, K5 Claude Code nodes ignore the node prompt, K6 a Codex node
ignores the run's signal, K7 visits record no change digest — all killed.

Not run here, for the platform matrix: `pnpm test:build` and `pnpm gate:build`
(including `tests/build/sealed-launcher-closure.test.mjs`, which runs the real
activation health gate from eleven staged layouts), `pnpm gate:security`
(never run locally), `pnpm gate:full`, and the Linux and Windows runs. Windows
keeps its platform refusal; the e2e journeys run on macOS only, as the
existing ones do.

### T5 discrimination summary (SSI-80)

43 mutants over the six commits, all killed (C1–C16, R1–R5, P1–P2, S1–S10,
B1–B5, K1–K7, listed per commit above). For the four checks SSI-80 names:
scope narrowing (C1, C16), the writer mutex (C2), a limit (C3 concurrency, C4
handoff, C8 node result, C9 run result, S3 the SDK's limits), and the
destination check (C5 the validator, C6 the runner, S2 and S10 the adapter).

## T6 Evidence (subscription preflight, suspension, resume, reconciliation)

Author's evidence, commit by commit, on branch `strands/t6-suspension` (base
`origin/main` at `cf387fe`). The independent verifier re-derives it.

### Commit 1 — subscription authentication and the extra-usage confirmation

`apps/vestra-cli/src/task/task-billing.ts` reads the owner's statement (D3)
from `task-billing.json` beside `task-providers.json` and holds the preflight
of a coordinated run, which folds in T5's interim `coordinated-run-subscription`
refusal (moved out of `task-coordination.ts`). `task-run.ts` runs it at `start`
and `resume` before any credential read, transition, or worktree.
`task-provider-auth.ts` gains `readMachineSetting`, the one bounded reader of
an owner-written machine-local setting, shared by both files.

How the owner provisions it: an explicit documented step, not a command
(SSI-31 adds no command; D3 mirrors the hand-written provider setting). The
refusal prints, on the terminal only, the file's path and the entry each
provider needs, and asks the owner to write it only after checking each
account. The user documentation of the step is T8's commit 3.

What the statement holds, per provider, and nothing else:
`{ "auth", "extraUsage": "disabled", "confirmedAt" }`, plus `"planType"` for
Codex. `auth` must be the method the run's sessions prove: `subscription` for
Claude Code (`apiKeySource: "none"`), `chatgpt` for Codex (`account/read`).
`confirmedAt` is a UTC instant, not in the future, and not before the
provider's pinned billing regime (`BILLING_REGIMES`: Claude Code
2026-06-16, Codex 2026-10-03), which is how D9 asks for re-confirmation: a
build that follows a regime change moves the instant. No expiry otherwise.

| Behaviour | Assertion (file:line) | Run |
| --- | --- | --- |
| The file name, the method per provider, and the pinned regimes | `tests/unit/task-billing.test.mjs:42` | `node --test tests/unit/task-billing.test.mjs`: 36 of 36 |
| A complete statement reads as exactly what it states, frozen | `tests/unit/task-billing.test.mjs:51` | same |
| A run uses every node's provider and the Codex verifier, in each mode | `tests/unit/task-billing.test.mjs:66` | same |
| SSI-52: 19 statements are `not configured` (`extra-usage-confirmation`): not an object, another version, extra member, unknown provider, a provider missing, Claude Code on an API key, Codex on `subscription` or `apiKey`, extra usage enabled or unstated, Codex without a plan type, a free-text plan type, a plan type on Claude Code, a local or impossible time, a future date, and each provider's statement made before its regime | `tests/unit/task-billing.test.mjs:74`, `:110` | same |
| SSI-53: a `token`, `accountId`, `email`, `name`, `path`, or `apiKey` member is refused inside an entry and beside the providers | `tests/unit/task-billing.test.mjs:116` | same |
| A statement at its regime's start is accepted | `tests/unit/task-billing.test.mjs:129` | same |
| The preflight passes silently with a complete statement; refuses an API-key provider as `coordinated-run-subscription` whatever the statement says; refuses no statement, non-JSON, or another method and prints the one step with the file's path; never follows a link or reads a directory | `tests/unit/task-billing.test.mjs:153`, `:163`, `:173`, `:183` | same |
| SSI-51, SSI-52 at the command: `start` and `resume` of a v2 run with no confirmation, one missing Claude Code, or one of another Codex method are `not configured` and leave the state, the state root, and the active marker as they were; with the confirmation they reach their credential read | `tests/integration/task-coordinated-plan.test.mjs:136`, `:149` | `node --test tests/integration/task-coordinated-plan.test.mjs`: 16 of 16 |
| Journey, missing confirmation: `start` is `not configured` with nothing started (no grant, no worktree, no provider, not even `codex login status`), the terminal names the step and no machine path reaches the public error; a statement for another method is refused the same way | `tests/e2e/task-subscription-e2e.test.mjs:55` | `node scripts/test-scope.mjs e2e tests/e2e/task-subscription-e2e.test.mjs tests/e2e/task-coordinated-e2e.test.mjs`: 6 of 6 |
| Journey, `api-key` provider: `start` is `not configured` (`coordinated-run-subscription`) with a confirmation present, nothing started | `tests/e2e/task-subscription-e2e.test.mjs:75` | same |

Tests changed, none deleted. `tests/integration/task-coordinated-plan.test.mjs`
"start/resume of a v2 run on subscriptions is composed" now writes the
confirmation first (it is the composed case); T5's citation `:110` of that
case is now `:145`. The coordinated e2e journeys of T5 write the confirmation
through the shared `tests/helpers/task-coordinated-fixture.mjs`, into which
their helpers moved unchanged, so the new journeys reuse them.

Discrimination (author run, one source edit per mutant, restored after the
run): B1 drop the preflight from `start` and `resume`, B2 skip the confirmation
read and keep the API-key check, B3 accept an absent statement, B4 accept any
method, B5 accept extra usage not disabled, B6 skip the regime check (D9), B7
accept a future date, B8 accept members outside the closed shape, B9 accept a
Codex statement without its plan type, B10 drop the API-key refusal, B11 forget
the verifier's provider — all killed.

Gates at this commit: `pnpm gate:quick` PASS (unit 2876, agent-readiness 357,
census 13); `pnpm test:architecture` 131/131; `pnpm agent:check` PASS;
typecheck, lint, format, and complexity PASS; 0 failed, 0 skipped, 0 todo.
`complexity-baseline.json` and the census are unchanged (no new function above
10; no file gained or lost `JSON.stringify` or `createHash`).

Citations moved with `task-run.ts` (one line more above `prepare`, seven below it):
`.specs/features/architecture-deepening-2/validation-t1.md` (`:378` → `:385`),
`.specs/features/architecture-deepening/validation-c6.md` (`:376` → `:383`),
`.specs/features/architecture-deepening-2/validation-t7.md` (`:252`, `:263`,
`:270` → `:259`, `:270`, `:277`), `.specs/features/live-task-pilot/validation.md`
(`:60`, `:610-611`, `:399`, `:646-648` → `:61`, `:617-618`, `:406`,
`:653-655`). `task-provider-auth.ts:29-32` did not move.

### Commit 2 — suspension on a quota signal, worktree kept

The executor's driver port gains a `suspended` result carrying the suspension
record (`ExecutionSuspension`: `reason`, `provider`, `at`, and `scope` and
`resetsAt` only when the provider reported them). On it the executor saves the
`suspended` checkpoint (`changeDigest`, `changedPaths`, `toolReceiptRefs`,
`suspension`), releases the writer coordination, skips its failure cleanup so
the worktree and every completed writer node's effects stay, and throws
`TaskExecutionSuspended` (`VES_EXECUTOR_SUSPENDED`). The repair loop ends with
`SUSPENDED`: the attempt is neither counted nor sealed, and the run's ledger is
saved with the repair state as it stands. `TaskRunCoordinator` reports outcome
`SUSPENDED`, applies no workflow command and calls no `release()`, so the run
stays `IMPLEMENTING`; the workflow machine is unchanged and `INTERRUPTED` stays
terminal (SSI-64: no file under `packages/domain/src/workflow/` changed). The
coordinated driver suspends on `VES_DRIVER_QUOTA_EXHAUSTED` and on
`VES_CODEX_CREDITS_PRESENT` (D3b), records the first signal, starts no further
node, waits for every node it started to end and be recorded `failed` or
`partial`, and keeps the round `running`. The CLI prints the suspension and
`vestra task resume` as the next action, exits 1, and reports Codex credits as
`not configured` (`codex-credits`); the Codex node raises the driver's
`VES_CODEX_CREDITS_PRESENT` instead of answering nothing.

Spec-precision notes. (1) Credits are seen where T4's driver checks them, at
each Codex session's start before its turn; a preflight probe would need an
account-only Codex session, a driver change outside T6 (open question). The run
is therefore suspended, not failed, so `not configured` loses nothing: the
owner removes the credits and resumes. (2) The suspension record also keeps the
provider's limit window (`scope`, a closed vocabulary from T4), which the task
asks status to show. (3) The executor checkpoint holds no node-ledger digest
(the design's `suspended` row): the ledger is sealed in the Run record and read
through its validated reader, and the application has no digest port.

| Behaviour | Assertion (file:line) | Run |
| --- | --- | --- |
| SSI-59: a quota signal suspends the run; an engine that keeps scheduling is refused; the node still running is aborted and recorded; the record is exactly the closed members; the round stays `running` | `tests/unit/coordinated-suspension.test.mjs:48` | `node --test tests/unit/coordinated-suspension.test.mjs tests/unit/coordinated-driver.test.mjs`: 31 of 31 |
| SSI-60: the driver returns only once every node it started has ended and been recorded, even under an engine that returns at once | `tests/unit/coordinated-suspension.test.mjs:107` | same |
| Edge case: two quota signals from concurrent readers suspend once, recording the first | `tests/unit/coordinated-suspension.test.mjs:140` | same |
| Edge case: a writer stopped after its write is `partial` with its receipt count; a reset the provider did not report is absent | `tests/unit/coordinated-suspension.test.mjs:166` | same |
| D3b, SSI-56: Codex credits suspend with `VES_CODEX_CREDITS_PRESENT`, the Codex provider, no window or reset; no later node starts | `tests/unit/coordinated-suspension.test.mjs:196` | same |
| Any other node failure still fails the run and closes its round | `tests/unit/coordinated-suspension.test.mjs:213` | same |
| SSI-61, SSI-81: provider text in the window, a reset that is not an instant, an e-mail address, a session, and purchase fields never reach the record or the ledger | `tests/unit/coordinated-suspension.test.mjs:228` | same |
| A cancel that comes first wins over a later quota signal | `tests/unit/coordinated-suspension.test.mjs:251` | same |
| SSI-59, SSI-60 inside the real executor: the second of three graph nodes signals quota; the error is `TaskExecutionSuspended` with the record; the worktree is not cleaned, the coordination is released, no driver cancel; the `suspended` checkpoint holds the change, paths, receipts, and record; the first node's result is persisted; the round stays `running` | `tests/integration/coordinated-executor.test.mjs:162` | `node --test tests/integration/coordinated-executor.test.mjs`: 9 of 9 |
| The executor refuses a record with provider text, with an account member, with a reason that is not a code, a suspended status without a record, and a record on a completed run, and cleans up as for any driver failure | `tests/integration/coordinated-executor.test.mjs:228`, `:273` | same |
| A caller's cancel wins over a driver's suspension | `tests/integration/coordinated-executor.test.mjs:286` | same |
| SSI-60, SSI-64: outcome `SUSPENDED`, state `IMPLEMENTING`, only `START_IMPLEMENTATION` applied, nothing released, committed, verified, or sealed; the repair state saved with its attempt count unchanged | `tests/unit/task-run-coordinator.test.mjs:274` | `node --test tests/unit/task-run-coordinator.test.mjs`: 17 of 17 |
| The suspension code without its record is a failure, not a suspension | `tests/unit/task-run-coordinator.test.mjs:297` | same |
| SSI-39, SSI-68 with a controllable clock: 2 s and 40 tokens before the suspension are saved; five hours pass; the resumed meter starts at 2 s, ends at 2.5 s and 65 tokens, all unbilled; the suspended attempt and its resumption are one attempt | `tests/unit/task-run-coordinator.test.mjs:312` | same |
| The `SUSPENDED` outcome marker round-trips in both forms; a marker without its record, a record that is not an object, without its provider, a reason that is not a code, a window of provider text, a reset that is not an instant, or an account member is refused | `tests/unit/task-run-record-readers.test.mjs:43`, `:133`, `:170`, `:194` | `node --test tests/unit/task-run-record-readers.test.mjs`: 8 of 8 |
| Journey, quota mid-graph: `start` exits 1 with `SUSPENDED` and the record (`five_hour`, reset `2026-09-21T14:13:20.000Z`), next `vestra task resume`; status `IMPLEMENTING`, executor checkpoint `suspended`, no active process; `plan` completed, `build` failed, `review` never started; the worktree kept; the signalling session's process gone; budget still `subscription`; no session, event identifier, purchase field, e-mail address, token, or machine path in the outcome marker, the ledger, the command output, or status | `tests/e2e/task-subscription-e2e.test.mjs:115` | `node scripts/test-scope.mjs e2e tests/e2e/task-subscription-e2e.test.mjs`: 4 of 4 |
| Journey, Codex credits present: `start` is `not configured` (`codex-credits`); the run is `IMPLEMENTING` with a `suspended` checkpoint and outcome; `plan` failed; Claude Code never started; the marker records `VES_CODEX_CREDITS_PRESENT` and `codex` only | `tests/e2e/task-subscription-e2e.test.mjs:151` | same |

Deleted case → replacement. `tests/unit/coordinated-driver.test.mjs` "a quota
signal from one node starts no further node and cancels the nodes still
running" (T5's SSI-59 seam, cited at `:424`, which expected the run to fail
with the quota code) → `tests/unit/coordinated-suspension.test.mjs:48`, the
same scenario and assertions with the run suspended instead of failed. Its
helper `twoIndependent` moved unchanged to
`tests/helpers/coordinated-driver-fixture.mjs`. Numbered at the base, the cases
of that file below the helper move up by 10 lines and those below the removed
case by 55 (usage and checkpoints `:473` → `:418`, the ledger's values `:497`
→ `:442`); T5's own citations into it were already four lines early at the base
and are left as written.

Gates at this commit: `pnpm gate:quick` PASS (unit 2886, agent-readiness 357,
census 13); `pnpm test:architecture` 131/131; `pnpm agent:check` PASS;
typecheck, lint, format, and complexity PASS; the executor, run, repair, and
coordination integration suites 175/175, `task-executor-faults` and
`budget-enforcement-faults` 23/23, `task-executor-security`,
`coordination-record-security`, and `task-cli-security` 28/28; the e2e suites
`task-cli-e2e`, `mediated-task-execution-e2e`, `task-coordinated-e2e`, and
`task-subscription-e2e` 56/56 (the single-session journeys pass unchanged
through the reshaped executor); 0 failed, 0 skipped, 0 todo. SSI-64: no file
under `packages/domain/src/workflow/` changed. `complexity-baseline.json`
ratchets down: `task-executor.ts :: Async method 'execute'` 53 → 40 (the
driver-result and inspection checks moved into `driverOutcome` and
`#inspected`, both below 10) and `gate-repair.ts :: Async function
'runGateRepairLoop'` 33 → 29 (the feedback check moved into
`assertFeedback`). The census is unchanged.

Discrimination (author run): S1 the executor cleans up a suspended worktree,
S2 the executor fails a suspended driver, S3 the executor keeps the writer
coordination, S4 the executor trusts the driver's record, S5 the coordinated
driver fails instead of suspending, S6 it suspends without waiting for the
running nodes, S7 a later signal overwrites the first, S8 provider text kept in
the window, S9 Codex credits fail the run, S10 the run coordinator fails a
suspended run, S11 it releases a suspended run, S12 the repair loop does not
save the spend at suspension, S13 the outcome marker accepts any suspension
member, S14 the Codex node hides credits, S15 credits reported as a plain
suspension — all killed. S7 first survived as `??=` in place of `=`, an
equivalent mutant (the early return on an aborted round already makes the first
failure final); the mutant that removes that early return is killed.

Citations moved with the reshaped files, for the lines that were current at
the base: `task-executor.ts` in `.specs/features/architecture-deepening-2/validation-t1.md`
(the "Now asks the module" column `:292-293`, `:380`, `:386-388`, `:665` →
`:324-325`, `:412`, `:418-420`, `:765`; separators `:381` → `:413`) and in
`.specs/features/live-task-pilot/validation.md` (`:386-388` → `:418-420`); the
application's `task-run.ts` in `validation-t4.md` (`:119-122` → `:125-128`) and
in the pilot's validation (`:117`, `:249` → `:122`, `:267`); the CLI's
`task-run.ts` in the pilot's validation (`:653-655` → `:656-658`);
`task-run-record.ts` in `validation-t9.md` section 2's reader table and section
4's `recordBudgetLedger` range (`:365-377` → `:392-404`). Left as written:
sections pinned to an earlier `origin/main` (validation-t1's "Before" column
and `:381-388`, `:385-397`), records of an earlier move ("is now", validation-t1
`:285`, validation-c4), and citations already stale at the base
(external-review-triage `:392`, gate-repair-loop `:377`, `:475`,
validation-t9's `#marker` `:452`). The design's citations describe the base the
research was gathered at.

Fixture fidelity. The fake Claude Code reports, under the `claude-quota` and
`claude-quota-after-write` flags, the `rate_limit_event` 2.1.282 declares
(`rejected`, `five_hour`, a reset in epoch seconds, with the overage and session
fields the driver must drop) and waits to be stopped; the fake Codex reports,
under `codex-credits`, a 25.00 credit balance on its rate-limit snapshot.

### Commit 3 — resume revalidation and reconciliation of uncertain nodes

`apps/vestra-cli/src/task/task-resumption.ts` holds what `task resume` proves
before any node starts, and the one computation of the visits a resume must
settle, which `status` shows. `task resume` gains `--reconcile <digest>` (an
option, not a command: SSI-31). Order: the workflow state; the subscription
preflight and the extra-usage confirmation (commit 1); the active marker;
then, for a run whose latest executor checkpoint is `suspended`, the approval
against the Workspace policy in force (`TaskAuthority.approval`, so a changed
policy, an expiry, or a revocation refuses) and the worktree it left (the
marked worktree's change digest equals the checkpoint's, no commit since its
base); then, for a coordinated run, every unsettled node. A refusal is
`VES_TASK_FAILED` with a stable reason (`VES_APPROVAL_EXPIRED`,
`VES_APPROVAL_STALE`, `VES_APPROVAL_REVOKED`, `VES_EXECUTOR_WORKTREE_DRIFT`,
`VES_TASK_NODE_UNCERTAIN`, `VES_TASK_RECONCILE_UNMATCHED`), and it changes
nothing: no transition, ledger entry, worktree change, or lease; the run stays
`IMPLEMENTING` for a corrected resume or `vestra task cancel`. No public code
is added; the runtime error catalog keeps 19.

In the application, `coordination-ledger.ts` gains `unsettledVisits` (for each
node and visit number of a running round, the latest entry that did not
complete, with its effect: `none` only for a `failed` visit with no receipt
whose change digest before is the worktree's now) and `uncertaintyRecord` (the
run and the visit's facts, without its state, so marking a visit with no
recorded end `uncertain` keeps its digest). A visit gains `rerunOf`, the digest
of the visit a re-run replaced. The coordinated driver, given the canonical
digest port and the owner's digest, runs again on its own a visit that left no
effect (SSI-67), runs again a visit that may have left one only when its digest
was typed back (D4), otherwise marks a visit with no recorded end `uncertain`,
keeps the round `running`, and refuses with `VES_TASK_NODE_UNCERTAIN`;
completed visits are replayed from the latest completion of each node and
visit (SSI-65). Status shows `suspension` (reason, provider, instant, window,
reset), the node of each plan node (state, visit count, result digest), every
uncertain node with its digest, and as next actions the reconcile command per
uncertain node in place of a plain resume that would be refused.

Spec-precision notes. (1) Drift and an approval that expired while suspended
are refusals that change nothing rather than a failed run: the user impact is
still `VES_TASK_FAILED` with the reason (design error table), and the owner
can restore the worktree, plan again, or cancel. (2) One `--reconcile` per
resume (the parser refuses a repeated option): two nodes that may both have
landed effects (only a crash under concurrency above 1 makes two) refuse each
other, which leaves `task cancel`, D4's alternative; open question. (3) A
suspension can outlast the writer grant (the run's duration plus one hour); a
resume of a suspended run that passed its revalidation renews a grant that
only expired, against the approval it just proved; a revoked grant is never
renewed. (4) SSI-62: nothing resumes a run on its own; `resetsAt` is shown,
never acted on, and a resumed node runs the sealed descriptor's driver and
model under the same subscription preflight. (5) The Codex node now writes the
worktree marker before it uses the worktree, as the Claude Code node does: a
run suspended (or cancelled idle) at its first Codex node otherwise named no
worktree, which the credits journey found.

| Behaviour | Assertion (file:line) | Run |
| --- | --- | --- |
| A visit's effect: only `failed`, no receipt, digest unchanged is `none`; a moved or unknown digest, a receipt, `partial`, `started`, and `uncertain` are `possible`; a round that is not running settles nothing | `tests/unit/coordinated-suspension.test.mjs:294` | `node --test tests/unit/coordinated-suspension.test.mjs`: 19 of 19 |
| A visit a re-run replaced is history; only the latest entry of a node and visit is settled | `tests/unit/coordinated-suspension.test.mjs:318` | same |
| The uncertainty record names the run and the visit's facts without its state; another run gives another digest | `tests/unit/coordinated-suspension.test.mjs:330` | same |
| SSI-65, SSI-67: the completed planner is replayed with its result handed on; the quota-stopped writer runs again, recorded with `rerunOf`; the round completes | `tests/unit/coordinated-suspension.test.mjs:362` | same |
| SSI-66: a failed node whose worktree moved is uncertain and nothing runs; the round stays open | `tests/unit/coordinated-suspension.test.mjs:379` | same |
| SSI-66, D4: a partial node is refused, a wrong digest too, and its typed-back digest runs that one node again | `tests/unit/coordinated-suspension.test.mjs:387` | same |
| A node with no recorded end is marked `uncertain`, keeps its digest, and runs again once reconciled | `tests/unit/coordinated-suspension.test.mjs:406` | same |
| Without a digest port nothing unsettled runs again | `tests/unit/coordinated-suspension.test.mjs:422` | same |
| A run suspended twice settles only its latest visit | `tests/unit/coordinated-suspension.test.mjs:429` | same |
| A resumed swarm replays the writer's handoff and runs again the reviewer the quota stopped | `tests/unit/coordinated-suspension.test.mjs:453` | same |
| A node already run again and completed is replayed from that completion, never run a third time | `tests/unit/coordinated-suspension.test.mjs:478` | same |
| SSI-33: a suspended run with a valid approval and its own worktree resumes; an expired, stale, or revoked approval is refused with its code; a changed, committed-to, or missing worktree is drift | `tests/unit/task-resumption.test.mjs:70`, `:82`, `:92` | `node --test tests/unit/task-resumption.test.mjs`: 16 of 16 |
| SSI-66, D4 at the resume: a node with no effect needs nothing; a partial node is refused and the terminal shows its reconcile command; its digest lets it through; a digest that names nothing is refused (also on a single-session run); reconciling one of two uncertain nodes still refuses the other; an interrupted run is settled against its marked worktree without asking the approval; a single-session run and a closed round resume as before, unasked | `tests/unit/task-resumption.test.mjs:97`, `:106`, `:114`, `:120`, `:130`, `:139`, `:153` | same |
| The reconcile value is a SHA-256 digest or `VES_CLI_ARGUMENT_INVALID`; the marked worktree is inspected at the plan's base, and one that cannot be read is absent | `tests/unit/task-resumption.test.mjs:164`, `:175` | same |
| SSI-32: status of a suspended run shows the suspension, each node's state, visit count, and result digest, the uncertain node with its digest, and its reconcile command as the next action; a single-session run shows neither | `tests/integration/task-coordinated-plan.test.mjs:206`, `:291` | `node --test tests/integration/task-coordinated-plan.test.mjs`: 19 of 19 |
| A reconcile value that is not a digest is refused before anything is read | `tests/integration/task-coordinated-plan.test.mjs:300` | same |
| The `task resume` option list is `run-id`, `reconcile`, `keychain` | `tests/contract/cli-surface.test.mjs:175` | `node --test tests/contract/cli-surface.test.mjs` |
| Journey, the spec's independent test: resume without the confirmation is `not configured` and leaves the ledger as it was; with it the planner is replayed with no session, the writer runs again (`rerunOf`), the reviewer runs, `HUMAN_REVIEW`; 42 tokens in 4 events on one ledger, not billed (SSI-39, SSI-68) | `tests/e2e/task-subscription-e2e.test.mjs:218` | `node scripts/test-scope.mjs e2e tests/e2e/task-subscription-e2e.test.mjs`: 9 of 9 |
| Journey, uncertain node refused then reconciled: a writer stopped after its write is `partial`; resume refuses (`VES_TASK_NODE_UNCERTAIN`), changes no ledger byte, keeps the worktree, and prints the reconcile command; status names the node, its digest, and that command; a digest naming nothing is `VES_TASK_RECONCILE_UNMATCHED`; the typed-back digest runs the writer again and the run reaches review | `tests/e2e/task-subscription-e2e.test.mjs:268` | same |
| Journeys, drift refused and approval expired while suspended: a changed worktree file is refused as drift and kept as written; with the clock eight days ahead the resume is `VES_APPROVAL_EXPIRED`; with it three hours ahead (past the writer grant, within the approval) the grant is renewed and the stopped writer's change lands on the task branch | `tests/e2e/task-subscription-e2e.test.mjs:322` | same |
| Journey, Codex credits: still present at resume is `not configured` again; once gone the run continues from the node they stopped and reaches review | `tests/e2e/task-subscription-e2e.test.mjs:349` | same |
| `vestra task cancel` of a suspended run removes its worktree and ends it `ABORTED`; status then shows no suspension | `tests/e2e/task-subscription-e2e.test.mjs:373` | same |
| Fault, crash mid-node: the driving process is killed while a Codex node runs; the visit is `started`; status names it uncertain; resume refuses and changes no ledger byte; the typed-back digest runs it again and the run reaches review | `tests/fault-injection/task-coordinated-crash-faults.test.mjs:34` | `node scripts/test-scope.mjs fault tests/fault-injection/task-coordinated-crash-faults.test.mjs`: 1 of 1 |
| SSI-53, SSI-81: a refused statement holding a token, an e-mail address, and a home path echoes none of them; a hostile quota signal (e-mail address, session, token, home path in its text, window, and reset) leaves none of them in the suspension, the executor checkpoints, or the ledger | `tests/security/task-suspension-security.test.mjs:35`, `:57` | `node scripts/test-scope.mjs security tests/security/task-suspension-security.test.mjs`: 2 of 2 |

Fixture fidelity. `tests/helpers/shifted-clock.mjs` is a preload that moves
the `vestra` child's `Date` ahead by an offset given in its URL; no product
code reads it, and the fakes read no time. The fake Codex also hangs under the
`codex-node-hang` flag, so the crash journey can lift it before the same node
runs again.

Gates at this commit: `pnpm gate:quick` PASS (unit 2913, agent-readiness 357,
census 13); `pnpm test:architecture` 131/131; `pnpm agent:check` PASS;
typecheck, lint, format, and complexity PASS (no new function above 10; the
baseline unchanged); the e2e suites `task-subscription-e2e`,
`task-coordinated-e2e`, `task-cli-e2e`, and `mediated-task-execution-e2e`
61/61; the fault suites `task-coordinated-crash-faults`, `task-executor-faults`,
and `budget-enforcement-faults` 24/24; the security suites
`task-suspension-security`, `coordination-record-security`,
`task-cli-security`, `task-executor-security`, and
`driver-structured-results-security` 33/33; the integration suites of the
task, executor, repair, and coordination paths 153/153; the contract suites
`cli-surface` and `task-command-platform` 47/47; 0 failed, 0 skipped, 0 todo.
The census is unchanged (no file gained or lost `JSON.stringify` or
`createHash`). Not run here, for the platform matrix: `pnpm gate:full`,
`pnpm gate:build`, `pnpm gate:security`, and the whole `test:e2e`,
`test:fault`, `test:integration`, and `test:contract` scopes.

Citations moved with the reshaped files, for the lines that were current at
the base: the CLI's `task-run.ts` in `validation-t1.md` (`:385` → `:418`, as
moved by commit 1), `validation-c6.md` (`:383` → `:416`), `validation-t7.md`
(`:259`, `:270`, `:277` → `:264`, `:275`, `:282`), and the pilot's validation
(over the three commits, `:60`, `:610-611`, `:399`, `:646-648` → `:62`,
`:650-651`, `:439`, `:689-691`); `task-status.ts` in `validation-t7.md`
(`:139` → `:236`, `:90` → `:181`), in `validation-t9.md` sections 2 to 4
(`:57`, `:61`, `:62`, `:86` → `:77`, `:81`, `:82`, `:175`; `reasonOf`
`:182-184` → `:280-283`; `:90` → `:181`), and in the pilot's validation (`:13`,
`:160` → `:21`, `:257`). Left as written: `validation-t9.md` section 1 (pinned
to its base) and its prose about what `reasonOf` printed then, the "is now"
records of `validation-t7.md`, and `release-manifest.ts:19`, which did not
move.

Discrimination (author run): R1 resume skips its revalidation, R2 the CLI lets
an uncertain node through, R3 no drift check (unit and journey), R4 no
approval check on a suspended resume (unit and journey), R5 a digest that names
nothing is ignored, R6 the driver re-runs a node that may have landed effects,
R7 the driver replays nothing, R8 the driver replays from the first entry of a
visit, R9 a re-run records nothing of what it replaced, R10 a failed node with
a receipt counts as no effect, R11 the change digest is not compared, R12 a
replaced entry is settled again, R13 the uncertainty digest covers the state,
R14 a lapsed grant is never renewed, R15 status offers the plain resume to an
uncertain run, R16 a Codex node leaves no worktree marker — all killed. R8
first had no killer; `tests/unit/coordinated-suspension.test.mjs:478` was
added for it.

## T7 Evidence (Windows bridge transport, commits 1 to 4)

Author: the T7 implementer. Commits 1 to 3 and their fix landed in #521; the
Windows leg of the platform matrix (run 37162941507) then passed the eight real
named-pipe cases, and commit 4 lifts the refusals (below).

### Commit 1: `refactor(agent-runtime): put the bridge channel behind a transport interface`

| Requirement | Evidence (file:line, assertion) | Result |
| --- | --- | --- |
| SSI-69 Unix channel and controls unchanged | The socket directory, `0700` mode, `lstat` checks, `VES_BRIDGE_CHANNEL_INSECURE`, `net.Server`, socket `0600`, and directory removal moved verbatim into `UnixSocketBridgeTransport.listen` (`packages/agent-runtime/src/execution/bridge-transport.ts:35-65`). Token, constant-time check, one authenticated connection, five-second timeout, frame bound, and dispatch stay in the controller (`mcp-tool-bridge.ts:144-206`). `git diff origin/main -- tests/integration/mcp-tool-bridge.test.mjs tests/security/mcp-tool-bridge-security.test.mjs tests/integration/driver-execution-adapter.test.mjs tests/e2e/mediated-task-execution-e2e.test.mjs tests/e2e/task-path-case-variant-e2e.test.mjs tests/contract/claude-code-driver-mediated.test.mjs tests/contract/claude-code-driver-subscription.test.mjs tests/helpers/mcp-bridge-fixture.mjs tests/helpers/mediation-platform.mjs` is empty; those suites pass unchanged (63 of 63 on the rebased base, which carries T4). | PASS (darwin) |
| SSI-70 controller takes its channel through a transport interface | `BridgeTransport` and `BridgeChannel` (`bridge-transport.ts:8-23`); `McpToolBridgeControllerOptions.transport` defaults to the Unix transport (`mcp-tool-bridge.ts:116-118`); `DriverExecutionAdapterOptions.bridgeTransport` reaches it (`driver-execution-adapter.ts:38`, `:175`). Seam cases with an in-memory transport, `tests/integration/bridge-transport-seam.test.mjs`: endpoint announced and channel closed once (`:74-81`); served only after authentication (`:88-100`); wrong token, frame beyond 8 MiB, and a call before authentication refused with no tool reached (`:111-117`); silence refused at exactly 5 000 ms (`:125-128`); a second connection refused (`:139-140`); the adapter hands the transport to the bridge and closes it (`:189-192`). Since commit 2 these cases run on every platform, Windows included. | PASS (darwin) |

Ordering note: `close()` now removes the channel (server close and directory
removal) before awaiting in-flight calls; before, the directory was removed
after them. In-flight calls touch the worktree, not the socket directory, and
every `close` result is unchanged.

Gates for commit 1, before the rebase onto T4: `pnpm gate:quick` PASS (unit
2666/2666, agent-readiness 331/331, census 13/13, 0 skipped, 0 todo);
`pnpm test:architecture` PASS (122/122); `pnpm test:integration` PASS
(1150/1150). After the rebase: `pnpm typecheck` PASS and the bridge, adapter,
seam, mediated e2e, and mediated contract suites 71/71.

### Commit 2: `feat(platform-node): add a Windows named-pipe bridge transport`

Modules: `packages/platform-node/src/windows-pipe-transport.ts` (the constant
helper, its launch, the status mapping, the per-run lifecycle) and
`packages/platform-node/src/windows-acl.ts` (owner-only proof). The composition
root hands the transport to the driver adapter on `win32` only
(`apps/vestra-cli/src/task/task-implementer.ts`, `implementerBridgeTransport`).

| Requirement | Evidence (file:line, assertion) | Result |
| --- | --- | --- |
| SSI-70 second adapter | `WindowsNamedPipeBridgeTransport` satisfies `BridgeTransport` by shape (checked by `pnpm typecheck` at `task-implementer.ts`, which returns it as `BridgeTransport`); agent-runtime never imports platform-node (`pnpm test:architecture` 125/125). `tests/unit/task-implementer-bridge-transport.test.mjs:10`: the composition hands the bridge the pipe transport on `win32` and nothing on `darwin`, `linux`, `freebsd`. | PASS (darwin) |
| SSI-71 fresh name, pinned PowerShell 7, `CurrentUserOnly`, first instance, one instance, byte relay | `tests/unit/windows-pipe-transport.test.mjs:34` (16 random bytes, 64 distinct names, endpoint `\\.\pipe\<name>`); `:121` (pinned `C:\Program Files\PowerShell\7\pwsh.exe`, exact argument vector); `:106` (`CurrentUserOnly`, `FirstPipeInstance`, `Asynchronous`, max instances `1`, stdin/stdout `CopyToAsync`, one `WaitForConnection`); `:258` (two listens, two endpoints); `:278` (bytes both ways). Windows only: `tests/security/windows-pipe-bridge-security.test.mjs:181` (relay end to end over the real pipe), `:251` (pre-created name refused with `VES_BRIDGE_CHANNEL_INSECURE`, directory removed), `:233` (second client never connects). | PASS (darwin); win32 cases pending the Windows leg |
| SSI-72 constant script, name as only argument, nothing interpolated | `tests/unit/windows-pipe-transport.test.mjs:71` (digest pinned, one `param(`, name re-validated with `PIPE_NAME`, no `$input`, no `Invoke-Expression`, `iex`, `ScriptBlock]::Create`, `Add-Type`, `Start-Process`, `EncodedCommand`, `.Invoke(`); `:48-69` (13 invalid names refused before argument building or endpoint); `:121` (no `-Command`, `-c`, `-EncodedCommand`, `-ec`); `:258` (the file PowerShell runs equals `PIPE_HELPER_SCRIPT`); `:139` (environment allowlist: no token, no API key, fixed PATH). | PASS (darwin) |
| SSI-73 PowerShell, logging, ACL parts | Missing PowerShell 7 → `VES_BRIDGE_NOT_CONFIGURED`/`powershell-7` before any directory (`tests/unit/windows-pipe-transport.test.mjs:200`); PowerShell older than 7.4 → `powershell-7` (`:218-233`); logging or transcription → `powershell-logging-off` (`:163-178`, `:218-233`); the guard is the credential manager's `LOGGING_POLICY_GUARD` verbatim plus a PowerShell 7 guard for the `PowerShellCore` policy keys and `powershell.config.json`, both before the pipe exists (`:90`); unprovable ACL → `owner-only-acl`, directory removed, nothing started (`:209`); the ACL is proven on the empty directory before the script is written (`:258`). ACL proof (as fixed after the first Windows leg, below): `tests/unit/windows-acl.test.mjs:96` (System32 paths), `:105` (SID from `whoami`, the runner's row included), `:113` (the BOM-less UTF-16LE restore file beside the directory and its `/restore` arguments), `:126` (Unicode read-back), `:133` (3 accepted and 13 refused DACLs), `:154-195` (SDDL aliases of the owner), `:226` (proof), `:238` (a planted restore file stops the proof), `:246-262` (8 failure steps, no file left). Windows only: `tests/security/windows-pipe-bridge-security.test.mjs:167` (real tools prove a real directory), `:269` (the live per-run directory is owner-only). The managed-policy part of SSI-73 is SSI-74, commit 3. | PASS (darwin); win32 cases pending |
| SSI-75 helper and Claude Code trees ended, directory removed | `tests/unit/windows-pipe-transport.test.mjs:310` (close terminates the tree once, closes the helper's input, removes the directory, twice-safe); `:295` (a refused connection ends the helper, the directory stays until close); `:224`, `:243` (refused or silent helpers terminated and cleaned). An exited helper's pid is never signalled (`:235`). Windows only: `tests/security/windows-pipe-bridge-security.test.mjs:269` (after close the directory is gone and nothing holds the pipe). The helper tree ends through `terminateProcessTree` (`taskkill /T /F` on Windows); Claude Code's tree, which holds the relay, already ends through the injected terminator (`apps/vestra-cli/src/task/task-process-tree.ts`, `tests/integration/process-tree-terminator.test.mjs`). | PASS (darwin); win32 cases pending |
| SSI-76 Unix codes for second client, failed authentication, timeout, oversized frame | Over the real transport and controller with a fake helper, on every platform: `tests/security/windows-pipe-bridge-security.test.mjs:72` (served after `hello`), `:90-102` (wrong token, frame beyond 8 MiB, call before authentication: `rejectedConnections` 1, nothing sent, the helper ended), `:104` (silence refused at exactly 5 000 ms). Windows only: `:194` (wrong-token relay exits 1 with `VES_BRIDGE_AUTH_REJECTED`, as on Unix), `:204` (silent client closed after at least 4.5 s, count 1), `:217` (oversized frame after `ready`, count 1), `:233` (second client). | PASS (darwin); win32 cases pending |
| SSI-77 refusals kept | `mcp-tool-bridge.ts:104-108` still throws `VES_BRIDGE_PLATFORM_UNSUPPORTED` on `win32` for every caller that brings no transport (the driver adapter, the e2e journey, `tests/helpers/mediation-platform.mjs`, all unchanged); `tests/integration/bridge-transport-seam.test.mjs:195` asserts it on `win32` and the Unix default elsewhere. `VES_CLAUDE_MEDIATION_UNSUPPORTED` (`packages/drivers/src/claude-code-driver.ts`) and the `vestra task` platform refusal (`apps/vestra-cli/src/task/task-command.ts`) are untouched, so the composition's pipe transport is unreachable until commit 4. | PASS |

Deviation, SSI-76 second client: the pipe has one instance, so on Windows the
kernel refuses a second client (`ERROR_PIPE_BUSY`) and it never reaches the
controller. The Unix socket accepts it and the controller closes it
(`rejectedConnections` 1, relay `VES_BRIDGE_AUTH_REJECTED`); on Windows the
count stays 0 and a second relay would end on its own five-second
`VES_BRIDGE_AUTH_TIMEOUT`. Both are refusals with Unix codes and neither client
reaches a tool; the Windows case asserts exactly what it observes
(`windows-pipe-bridge-security.test.mjs:233`).

Relaxed refusal: commit 2 lets `McpToolBridgeController.open` accept an
injected transport on `win32`; the default stays refused. Without that, the
Windows runner could not qualify the controller over the pipe.

Guardrails for commit 2: `pnpm complexity:check` PASS (no new hotspot; every
new function at or below 10). Census unchanged: no product file gained or lost
`JSON.stringify` or `createHash` (`pnpm test:census` 13/13).
`windows-credential-manager.ts` only exports `systemRoot` (same line count);
the digest-bound credential-store reports are untouched.

Author's discrimination run (each mutant applied in place, the named suites
run, then `git restore`): commit 1, the controller ignoring `transport`
(seam suite 8 failures) and the adapter dropping `bridgeTransport` (1);
commit 2, `FirstPipeInstance` dropped (2), the token passed to the helper (2),
the ACL proof skipped (1), a refused connection leaving the helper running
(5), a squatted name mapped to `VES_BRIDGE_CHANNEL_FAILED` (2), an unprotected
DACL accepted (1), the PowerShell 7 guard dropped (2). All killed, on darwin;
the independent verifier repeats the list at T9.

### Commit 3: `feat(drivers): check Claude Code managed policy sources on Windows`

| Requirement | Evidence (file:line, assertion) | Result |
| --- | --- | --- |
| SSI-74 directory, HKLM, HKCU | `documentedManagedPolicySources("win32")` is exactly `C:\Program Files\ClaudeCode` and the keys `HKLM\SOFTWARE\Policies\ClaudeCode`, `HKCU\SOFTWARE\Policies\ClaudeCode`, with `/etc/claude-code` no longer chosen for Windows; Linux and macOS sources unchanged (`tests/contract/claude-code-driver-managed-policy.test.mjs:60`). Presence: either key, both, or neither (`:76-90`); a reader that rejects, answers anything but `false`, or throws synchronously counts as present (`:92`); a populated directory is present before any key is read, an empty one is not (`:107`). Driver path (non-Windows hosts, where the mediated profile runs): a present key refuses with `VES_CLAUDE_MANAGED_POLICY_PRESENT` before any spawn (`:116`); without the composition's reader every key counts as present (`:133`); with the directory and both keys proven absent the session runs (`:144`); malformed keys and keys on the API-key profile are refused at construction, and the API-key profile never consults the reader (`:160`). Registry reader (`packages/platform-node/src/windows-registry.ts`): System32 `reg.exe`, `query <key> /reg:64` (`tests/unit/windows-registry.test.mjs:18`); seven malformed keys refused before anything runs (`:24-43`); exit 1 is absent, 0, 2, and no exit are present (`:45-59`); a query that cannot run is present (`:61`). Windows only: `:70` (an existing key present, a random missing key absent; elsewhere both present, since nothing can prove absence). The composition hands the driver the reader (`apps/vestra-cli/src/task/task-implementer.ts:200`). | PASS (darwin); win32 case pending the Windows leg |

The policy check stays unreachable on Windows until commit 4, because the
mediated profile still refuses `win32` at construction
(`VES_CLAUDE_MEDIATION_UNSUPPORTED`, unchanged). A present source surfaces as
the existing `VES_CLAUDE_MANAGED_POLICY_PRESENT`, as on macOS and Linux; mapping
it, and the transport's `VES_BRIDGE_NOT_CONFIGURED` with its `requirement`, to
the CLI's `VES_TASK_NOT_CONFIGURED` is left to commit 4, the first commit in
which either is reachable from `vestra task`.

Guardrails for commit 3: `pnpm complexity:check` PASS (the override check is
split out so no function exceeds 10; no baseline key moves). Census unchanged
(13/13). The registry reader runs through `runBoundedChild`; the driver still
starts no process itself (`pnpm test:architecture`).

Author's discrimination run for commit 3 (in place, then `git restore`):
Windows falling back to `/etc/claude-code` (1 failure), an answer other than
`false` read as absent (1), a missing reader proving absence (1), and only
exit 0 of `reg query` counting as present (3). All killed, on darwin.

Gates on the branch head (commits 1 to 3, darwin, Node 24.14.0): `pnpm
gate:quick` PASS (unit 2742/2742, agent-readiness 354/354, census 13/13, 0
skipped, 0 todo); `pnpm test:architecture` PASS (125/125); `pnpm typecheck`
PASS; `pnpm agent:check` PASS. The seven new T7 test files 101/101; the
unchanged bridge, adapter, mediated e2e, mediated and subscription contract,
Claude spike, and task-platform suites 141/141. `gate:full`, `gate:build`, and
`gate:security` run on the five-platform matrix, not locally (disk), and the
`win32:` cases above are evidence only from its Windows leg.
After a second rebase onto `a73650a` (T3 landed), on that head: `pnpm
typecheck`, `pnpm test:architecture` (125/125), `pnpm agent:check`,
`pnpm complexity:check`, `pnpm test:census` (13/13), and the format check
PASS, and the same focused suites pass 101/101 and 141/141; `gate:quick` was
not run a second time locally.

### Fix after the first Windows leg: `fix(platform-node): replace the per-run DACL wholesale and read SDDL aliases of the owner (T7)`

Platform matrix 37161526836 (`gate:security`), Windows leg: every real
named-pipe case failed at `VES_BRIDGE_NOT_CONFIGURED` (`owner-only-acl`),
step `verify`. On that runner `whoami` named the built-in local Administrator
(RID 500); `icacls <dir> /inheritance:r /grant:r *<SID>:(OI)(CI)F` exited 0,
yet the DACL read back as `D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;LA)`.
Two defects: the grant edits the DACL and left SYSTEM and Administrators as
explicit entries, and SDDL writes that RID-500 SID as the alias `LA`, which the
verifier did not read as the owner. The verifier was right to refuse.

| Change | Evidence (file:line, assertion) | Result |
| --- | --- | --- |
| The DACL is replaced whole: a BOM-less UTF-16LE file in the `/save` format (base name, then `D:PAI(A;OICI;FA;;;<SID>)`) is written beside the per-run directory with `wx` and applied with `icacls <parent> /restore <file>`, then removed in a `finally`; read-back and verification are unchanged | `tests/unit/windows-acl.test.mjs:113` (file name, place, contents, arguments, no byte-order mark, SID-shaped trustee only); `:207` (on the runner's exact outputs the proof passes with the single `LA` entry, the restore names `vpipe-1`, the file is gone, nothing is left in the directory); `:238` (a file already at that name stops the proof at `replace`; icacls never reads it); `:246-262` (`replace` failure step, no file left on any step) | PASS (darwin) |
| The old path fails on the same outputs | `:196` (the runner's grant leaves three entries and is refused at `verify`); `:246-262` row `verify` with the runner's three-entry DACL | PASS (darwin) |
| SDDL aliases of the owner | `:154-167` (`LA` for machine-relative RID 500, the runner's SID included; `LG` for RID 501; `SY`, `LS`, `NS` for S-1-5-18, -19, -20; each still refused unprotected or beside `BA`); `:169-195` (21 refused pairs: `LA` for RID 1001, 501, 5000, a four-sub-authority RID 500, and `S-1-5-32-500`; `LG` for RID 500; `SY`, `LS`, `NS` for the wrong SIDs; `BA`, `DA`, `DU`, `AU`, `BU`, `WD`, `CO`, `OW`, and a lower-case `la`) | PASS (darwin) |
| Real-host diagnosis kept | `tests/security/windows-pipe-bridge-security.test.mjs:139-165` now re-runs the restore instead of the grant and still reports the step, the whoami row, the listing, and the saved DACL | win32 only |

Author's discrimination run (in place, then `git restore`): dropping the alias
acceptance (7 failures), going back to `/inheritance:r /grant:r` (3), and
accepting `LA` for any SID ending in RID 500 (1). All killed, on darwin.

Not verifiable without Windows: that `icacls /restore` on the hosted runner
accepts the file as written (BOM-less UTF-16LE, CRLF lines, base name relative
to the parent), and that it yields exactly `D:PAI(A;OICI;FA;;;LA)` there. If it
does not, the diagnosis names the restore's own output. The fallback would be
PowerShell 7 (already required by D6) setting the descriptor from SDDL, which
costs a second PowerShell start per run.

Checks for the fix (darwin): `pnpm typecheck` PASS, `pnpm test:architecture`
125/125, `pnpm agent:check` PASS, `pnpm test:census` 13/13, `pnpm
complexity:check` PASS (no new hotspot), and the seven T7 test files 132/132.

### Commit 4: `feat(cli): enable the governed task path on Windows`

Branch `strands/t7b-windows-task-path`. AD-080 in `.specs/STATE.md` records the decision and supersedes AD-039's Windows clause
(D6). macOS and Linux keep every list, lookup, and assertion they had: each
Unix branch of a changed test is unchanged, and every new rule is selected by
`process.platform` or an explicit platform argument.

| Requirement | Evidence (file:line, assertion) | Result |
| --- | --- | --- |
| SSI-77 the three refusals lifted | `vestra task`: the `win32` refusal is gone from `apps/vestra-cli/src/task/task-command.ts:96-99`; `tests/contract/task-command-platform.test.mjs:56` runs every task command with `win32` and `darwin` and gets the same first check (request unreadable, Workspace missing), never `platform`, nothing written. Mediated profile: `VES_CLAUDE_MEDIATION_UNSUPPORTED` is gone; on Windows a profile is constructed only with an owner-only proof (`packages/drivers/src/claude-code-driver.ts:344-350`), `tests/contract/claude-code-driver-windows.test.mjs:48` (both kinds, every platform). Bridge: a caller without a transport is refused on Windows with `VES_BRIDGE_TRANSPORT_REQUIRED` before anything is created (`packages/agent-runtime/src/execution/mcp-tool-bridge.ts:101-108`); the adapter case `tests/integration/driver-execution-adapter.test.mjs:91`, the journey case `tests/e2e/mediated-task-execution-e2e.test.mjs:139`, and the shared helper `tests/helpers/mediation-platform.mjs:28` assert it on win32. | PASS (darwin; win32 branches also run with the platform forced to win32, see below) |
| Open question 1: `not configured` with the prerequisite named, before any state change or worktree | `prepare()` runs `requireWindowsPrerequisites` after the credentials and executables and before `claimActive` and the first transition (`apps/vestra-cli/src/task/task-run.ts:202-206`, `:752`). `apps/vestra-cli/src/task/task-windows.ts:46-56` opens and closes one pipe channel, proves a probe directory under the sessions root, and reads the policy sources for the subscription profile. `tests/unit/task-windows.test.mjs:94-95`: a transport's `VES_BRIDGE_NOT_CONFIGURED` with `powershell-7`, `powershell-logging-off`, or `owner-only-acl` becomes `VES_TASK_NOT_CONFIGURED` with that requirement, nothing else asked, no directory; `:159-168` the same through the real `WindowsNamedPipeBridgeTransport` over a fake helper host (PowerShell missing, older than 7.4, logging on, ACL unproven), its directory removed; `:107` any other transport refusal, or a requirement that is not an identifier, is reported as the transport's own; `:123-127` an unproven or failing sessions-root proof is `owner-only-acl`, the probe removed; `:139` a present policy source is `claude-managed-policy` for the subscription profile and is never read for the API-key profile; `:79` a machine with every prerequisite passes, the probe channel closed once and a connection to it refused; `:192` the probe helper is started once and ended; `:64` off Windows, or with no Claude Code session, nothing is asked. | PASS (darwin) |
| Open question 2: `SystemRoot` for the relay and the pass-through list | `apps/vestra-cli/src/task/task-implementer.ts:45` the Windows list is `PATH`, `SystemRoot`, `TEMP`, `TMP`, `TZ` (the Unix list unchanged at `:40`), chosen at `:79`; the relay's MCP-config environment gains `SYSTEMROOT` on Windows (`:129-135`, used at `:220`); the driver's allowlist is the host's own (`claude-code-driver.ts:45`, `:274`); the per-run home is named in `HOME` and, on Windows, `USERPROFILE` (`:379-381`). `tests/unit/task-implementer-windows.test.mjs:41` (exact Windows list, unsafe values dropped), `:52` (Unix list unchanged), `:61` (relay gets `SYSTEMROOT` on Windows only, upper-case names only), `tests/contract/claude-code-driver-windows.test.mjs:56` (Windows accepts `SystemRoot`, `TEMP`, `TMP` and refuses `TMPDIR` and the locale; elsewhere the reverse). Only a native `<name>.exe` is taken on Windows: `task-implementer.ts:52-57`, `tests/unit/task-implementer-windows.test.mjs:94` (`claude.exe` found, `codex.cmd`, `codex.ps1`, and a bare `codex` refused as `executable:codex`), `:101` (elsewhere the bare name, unchanged). | PASS (darwin) |
| Open question 3: the Claude config directory owner-only | Decision: yes. `config/mcp.json` holds the 256-bit bridge token (AD-039), and on Unix its directory is private by `0700`, which Windows ignores. The per-run isolation directory is proven owner-only by the same `proveOwnerOnlyDirectory` routine while it is still empty, before `home`, `config`, and `mcp.json` exist, so all three inherit the one owner entry (`claude-code-driver.ts:368-376`, called at `:894`; injected by the composition through `isolationProof`, `task-implementer.ts:141-147`, `:208`). `tests/contract/claude-code-driver-windows.test.mjs:71` (both kinds: one proof, on the empty isolation directory, before the token is written); `:95-100` (a refused, failing, or truthy-but-not-`true` proof is `VES_CLAUDE_ISOLATION_INSECURE`, nothing spawned, the directory removed); `tests/unit/task-implementer-windows.test.mjs:72` (only Windows hands the proof); `tests/unit/task-windows.test.mjs:212` (the node host's real proof: true on Windows, false elsewhere, nothing left). | PASS (darwin) |
| Windows-only cases (run on the Windows leg; elsewhere each asserts the platform path) | `tests/contract/claude-code-driver-windows.test.mjs:239` a mediated session through the production driver over the real pipe: read and write over the bridge, one executor request, the isolation directory proven owner-only and empty before the token, `HOME`/`USERPROFILE` the per-run home, `SystemRoot` present, the directory removed after (elsewhere: the pipe refuses to start, nothing created). `tests/e2e/task-windows-e2e.test.mjs:139` the journey through the real `vestra` binary: plan, approve, start, gate, verify, and accepted review; the implementer's relay aimed at the named pipe with `SYSTEMROOT` beside the bridge variables, its read and write over the pipe, its environment the Windows list and its subscription token alone; the verifier read-only from the Workspace identity; the branch holds only the change; the user's checkout unmoved; every credential read through `cmdkey` and the `Read` program only; the sessions root empty (elsewhere, `:89`: no pipe handed to the bridge, the pipe refuses to start, no prerequisite checked). `tests/unit/task-windows.test.mjs:212` the real ACL proof on Windows. | pending the Windows leg |
| Open question 4: the read tools over the real pipe (second commit, `test(security): ...`) | `tests/security/windows-pipe-bridge-security.test.mjs:311` (win32): through the relay over the named pipe, `read_file` serves `src/a.txt` whole and in part, `list_dir` lists only the scope's ancestors and entries (no `docs`, no `.git`, no `src/protected`), `search` finds only the in-scope matches, no executor request, five calls and no denial; `:336` (win32): sixteen refusals with their codes and no content leaked, the Unix ones (`..`, `.git`, out of scope, protected) and the spellings only Windows resolves (`.GIT`, `src/PROTECTED`, `SRC/a.txt`, backslashes, a drive, an alternate data stream, a trailing dot, for `read_file`, `list_dir`, and `search`), all counted as denied. Elsewhere each asserts the pipe refuses to start. The same tool calls over the Unix socket on darwin gave exactly these codes (`src/protected./key.txt` and the trailing-dot search: `VES_BRIDGE_PATH_MISSING`, which the Windows case accepts as any `VES_BRIDGE_` denial, since Windows is the host that could resolve a trailing dot). | pending the Windows leg |
| The journey's fakes on Windows | `tests/helpers/fake-windows-spawn.mjs` answers `cmdkey /list:` and the Windows PowerShell `Read` program from the fixture store and starts the labeled fakes for `claude.exe` and `codex.exe` placeholders, through `spawn` and `promisify(execFile)`; `tests/unit/fake-windows-spawn.test.mjs:35` proves it against the production Windows backend and the fakes, on every platform; `:106` the guard still refuses every other credential program. The deny guard lets exactly one PowerShell start through, the pipe helper with the pinned path, flags, constant script read back from its file, and a pipe name (`tests/helpers/deny-keychain-spawn.mjs:42`); `tests/architecture/no-keychain-spawn-in-tests.test.mjs:105` pins the exact invocation and refuses nine near misses before spawning. The fixture gives Windows its own home, local application data, and temporary directory, `core.autocrlf false` and `core.longpaths true` (`tests/helpers/task-cli-fixture.mjs:97`, `:236`); the fake logs only the relay's channel kind and variable names (`tests/helpers/task-cli-fakes/fake-claude-task.mjs:54-55`). | PASS (darwin); journey pending the Windows leg |

Pinned refusal tests updated (each win32 branch asserts the Windows path
instead of the old refusal; every Unix branch unchanged): the shared helper
`windowsMediationPath` (`tests/helpers/mediation-platform.mjs:28`: no transport
→ `VES_BRIDGE_TRANSPORT_REQUIRED`, no directory; each mediated kind refused
without a proof and constructed with one) replaces `mediationRefusedOnWin32` at
every call site (four contract suites, three Claude spike suites, the bridge,
bridge security, structured-results security, seam, and case-variant suites);
`adapterRefusedOnWin32` and `journeyRefusedOnWin32` expect
`VES_BRIDGE_TRANSPORT_REQUIRED`; `verifierRefusedOnWin32`
(`tests/helpers/codex-verifier-fixture.mjs:22`, also used by
`tests/integration/codex-identity.test.mjs:123`) now asserts that the fake's
POSIX wrapper is no provider the Windows task path starts
(`executable:codex`); `tests/e2e/task-cli-e2e.test.mjs:959` reports, on
Windows, the unbound signing credential of an empty Credential Manager
(`evidence-signing-passphrase`) instead of `platform`, and `:1176` expects the
Unix `VES_STATE_ROOT_ESCAPE` for a junction on Windows too; the four dry-run
journeys (`:780`, `:823`, `:867`, `:888`), which read no credential, now run
on Windows as well; `tests/build/sealed-launcher-closure.test.mjs:529`, `:596`
plans the sealed dry run on Windows like everywhere else, with the fixture's
home in `USERPROFILE`.

Forced-platform check (darwin, not committed): with `process.platform`
replaced by `win32` before any module loads, the shared helper, the verifier
helper, the driver adapter, seam, and bridge suites (29/29), and the four
platform rules of `claude-code-driver-windows.test.mjs` (6/6) pass.

Author's discrimination run (each mutant applied in place, the named suite
run, then the file restored; `[w]` marks a run with the platform forced to
win32): the transport's requirement not mapped (7 failures), the sessions ACL
probe skipped (4), the policy read for the API-key profile (1), the probe
channel never closed (4), a present policy reported as `owner-only-acl` (1),
the isolation proof skipped (4), a truthy proof accepted (1), a Windows
profile accepted without a proof [w] (6), the Unix allowlist on Windows [w]
(2), the Windows pass-through keeping `TMPDIR` and dropping `SystemRoot` (2),
the relay without `SYSTEMROOT` (1), the bare name taken on Windows (1), the
guard ignoring the helper script's content (1), the bridge opening without a
transport on Windows [w] (15), and `vestra task` refusing Windows again (1).
All killed.

Gates for commit 4 (darwin, Node 24.14.0): `pnpm typecheck` PASS;
`pnpm test:architecture` 132/132; `pnpm complexity:check` PASS (no new
hotspot, every new function at or below 10; no baseline key moved);
`pnpm test:census` 13/13 (no product file gained or lost `JSON.stringify` or
`createHash`); `pnpm agent:check` PASS; Prettier and ESLint clean on every
changed file. Focused suites: the bridge, adapter, seam, driver contract,
Claude spike, Codex identity and verifier, mediated and Windows e2e, pipe
security, and new unit suites 381/381; `tests/e2e/task-cli-e2e.test.mjs`
45/45 and `tests/security/task-cli-security.test.mjs` 9/9 with the fixture
changes; 0 skipped, 0 todo. `gate:quick`, `gate:full`, `gate:security`, and
the build and sealed suites run on the platform matrix, not locally (disk);
its Windows leg is the evidence for the `win32:` cases.

Not verifiable without Windows: the real journey's path lengths, PowerShell 7
start with the fixture's own local application data, and `cmdkey` and the
Credential Manager fake's answers as the backend parses them on that host. The
citations of `docs/quick-start.md` and `docs/qualification/claude-code-driver-*.md`
that describe the Windows refusal are left to the T8 documentation pass.

### Fix after the Windows leg of commit 4: `fix(tests): spell the Windows driver case's temporary directory as its fake reads it, and witness how a fake ends (T7)`

Platform matrix runs 37175161776 (`gate:build`) and 37175163153
(`gate:security`), head `43051b3`: on Windows every unit test (2936/2936) and
every other contract case passed, among them the four platform rules of
`claude-code-driver-windows.test.mjs`; its `win32:` case failed with
`[ 'VES_CLAUDE_PROCESS_FAILED' ]` and no other error, and the stages after
the contract stage did not run.

Cause, shown on darwin and by Node's documented semantics: the fake writes its
observation only inside its own temporary directory, and checks that with
`realpathSync`, which resolves links but keeps an 8.3 short name; the hosted
Windows runner's `TEMP` is `C:\Users\RUNNER~1\...`, while the case spelled
its layout with `fs.promises.realpath`, which, like `realpathSync.native`,
expands the short name. The observation directory therefore never lay inside
the fake's temporary directory as the fake spelled it, the fake threw at its
last step, before its result, and exited 1: after its read and its write
through the bridge, which is why the only error was the process failure.
Forcing the same mismatch on darwin (the fake's temporary directory elsewhere
than its observation directory) gives exactly `["VES_CLAUDE_PROCESS_FAILED"]`
with the write already invoked, and a matching temporary directory gives
`[]` and `completed`. The product path is unaffected: the driver, the bridge,
and the relay never compare a temporary directory's spelling.

| Change | Evidence | Result |
| --- | --- | --- |
| The case names the fake's `TEMP` and `TMP` (keys of the Windows pass-through list) as its observation directory, in the layout's spelling, as the Unix fixture names `TMPDIR`; nothing else of the session changes | `tests/contract/claude-code-driver-windows.test.mjs:181-224` (the temporary directory at `:206-210`) | PASS (darwin, platform rules; the case itself pending the next Windows leg) |
| Diagnosable from the log alone: the fake runs under the labeled provider witness (`tests/helpers/provider-witness.mjs`), which records its exit code or signal (or why it never started), the last 4 KiB of its standard error, the executable asked for, the script and arguments, the working directory, and the environment's names, never values; the case's assertions carry the witness, the fake's observation, the driver's error and tool events, and the owner-only proofs | `tests/contract/claude-code-driver-windows.test.mjs:229-237`, used at `:255-265` | PASS (darwin) |
| The Windows journey runs its fakes under the same witness (`<placeholder>.witness.log` in the fixture's log directory), and every failing step names each witness and fake log | `tests/helpers/fake-windows-spawn.mjs`; `tests/e2e/task-windows-e2e.test.mjs:41-66`; `tests/unit/fake-windows-spawn.test.mjs:35` (each placeholder ran its fake under the witness: placeholder, script, `--version`, exit 0, no standard error) | PASS (darwin); journey pending |

Other candidates examined and ruled out: the fake is started as
`node <fake>` (no placeholder is involved in this case); Node starts and
reaches the pipe with the Windows pass-through list (libuv adds the
variables Windows needs when absent, and the relay already connected:
the write reached the executor); the fake reads `config/mcp.json` under the
owner-only directory as its owner and writes nothing there; the relay's
arguments are an argument vector, never a command line. No provider
environment changed, so macOS and Linux are untouched.

Checks (darwin, Node 24.14.0): the driver contract suites, the preload, the
Windows prerequisites, the Windows journey's platform path, and the
spawn-guard architecture suite 61/61; the four platform rules with the
platform forced to win32 6/6; `pnpm typecheck`, `pnpm test:architecture`,
`pnpm agent:check`, and Prettier and ESLint on every changed file PASS.

Not provable without the next Windows leg: that the case then completes over
the real pipe, that the journey passes (its stages never ran on Windows), and
everything the integration, e2e, and security stages hold there.

### Second Windows leg of commit 4: the journey's start fails `VES_GIT_WORKTREE_COMMAND_FAILED`

Platform matrix runs 37176018443 (`gate:build`) and 37176020244
(`gate:security`), head `502de74`: on Windows unit 2948/2948, contract
954/954, integration 1205/1205, e2e 293/294. The driver fix above holds. The
one failure is the Windows journey (`tests/e2e/task-windows-e2e.test.mjs:139`):
`task start` ended `FAILED` with reason `VES_GIT_WORKTREE_COMMAND_FAILED`.
The provider witnesses show that the implementer ran over the named pipe, read
`src/value.txt`, and wrote it with a receipt, that the Codex login check
passed, and that the verifier never started. A Git command of the run's
worktree module failed between the implementer's write and the verifier:
the post-session inspection, the commit's inspection, the clean-up that
anchors the task branch and removes the worktree, or the review checkout.

Examined, without a shown cause:

- Short against long path spelling. The worktree module already
  canonicalises both roots with `fs.promises.realpath` before any comparison
  with Git's listing (`packages/platform-node/src/task-worktree.ts:261-283`),
  and the Windows integration suites of the adapter pass from 8.3 temporary
  roots. On macOS a letter-case variant of the temporary directory behaves as
  an 8.3 alias does (`realpathSync` keeps it, `fs.promises.realpath`
  canonicalises it); the darwin journey run with `TMPDIR` spelled that way
  passes (1/1, not committed). No product comparison mixes the two
  spellings: every `realpath` of the product is the native one.
- The Git child's environment on Windows (`safeEnvironment`) passes `PATH`,
  `PATHEXT`, `SystemRoot`, `WINDIR`, `TEMP`, `TMP`, `HOME`, and `USERPROFILE`,
  and libuv adds the other variables Windows needs; the integration suites
  run Git through the same runner. What differs in the journey is the
  fixture: `HOME` and `USERPROFILE` name the fixture's empty home, so no
  global Git configuration is read, and the repository carries a file link
  and a directory link pointing outside it.
- A failing gate is reported with a gate code, never this one.

| Change | Evidence | Result |
| --- | --- | --- |
| Every Git command of the task path that fails names itself in the fixture's log directory (`git-witness.log`: arguments, working directory, exit code, signal, the last 2 KiB of its standard error), through the preload's `promisify(execFile)`; the promise is returned unchanged, and a witness that cannot write is ignored. Test logs only: no product record gains a path or an output | `tests/helpers/fake-windows-spawn.mjs:132`; `tests/unit/fake-windows-spawn.test.mjs:35` (a failing Git command is named with its arguments, exit code 1, and Git's message, its failure still reaches the caller, and a successful one leaves nothing) | PASS (darwin) |
| A journey step that does not exit 0 fails with its own output, every witness and fake log, and, for `task start`, the run's `status --output json` (its reason and checkpoints, which name the stage) | `tests/e2e/task-windows-e2e.test.mjs:41-74`, used at `:157` | PASS (darwin, platform path); the Windows journey pending |

Not provable without the next Windows leg: which Git command fails and why.
The next leg's assertion message carries the failing command, its exit code,
Git's own message, and the run's stage.

### Third Windows leg of commit 4: Git's `$GIT_DIR` limit, and the fix

Platform matrix run 37177012372 (`gate:security`), head `c1d2999`: unit
2948/2948, contract 954/954, e2e 293/294. The Git witness named the failure:
`git worktree add --detach -- <review checkout> <commit>` exited 128 with
`fatal: '$GIT_DIR' too big`. Confirmed against Git's source: `git worktree add`
starts its checkout with `GIT_DIR=<path>/.git` (`builtin/worktree.c`,
`strbuf_addf(&sb_git, "%s/.git", path)`), and `setup.c` dies when
`PATH_MAX - 40 < strlen(gitdirenv)`; PATH_MAX is 260 for Git for Windows
(MinGW), 1024 on macOS, and 4096 on Linux. A worktree directory therefore
fits when its UTF-8 bytes plus `/.git` are at most 220 on Windows, that is a
directory of at most 215 bytes. `core.longpaths` does not lift this check.

Every worktree directory the task path asks Git to add, with `W` the Workspace
state root (`<state root>/workspaces/<workspace ID>`), measured on the real
path Git is given:

| Worktree | Layout | Length | Hosted runner (`W` = 138) | User (`W` = 98 + user name) |
| --- | --- | --- | --- | --- |
| the run's worktree (executor, every node) | `W/worktrees/<32 hex>` | `W` + 43 | 181 (fits) | fits up to a 74-byte name |
| review checkout, before | `W/verification/<run ID>/review/<32 hex>` | `W` + 94 | 232 (Git dies) | fits up to a 23-byte name |
| mutation checkout, before | `W/verification/<run ID>/mutations/<32 hex>` | `W` + 97 | 235 (Git dies) | fits up to a 20-byte name |
| review and mutation checkouts, now | `W/verification/<16 hex>/r` or `/m/<32 hex>` | `W` + 65 | 203 (fits, 12 to spare) | fits up to a 52-byte name |

No other worktree is added: coordinated nodes use the run's worktree, and
status, resumption, and reconciliation only list or remove. The run's worktree
keeps its layout, because its 32-digit ID is part of the worktree handle the
Run record keeps; the scratch checkouts move, because nothing persisted names
them. A scratch checkout's handle and directory are used only inside one
`withScratchCheckout` call: the review checkout is the verifier's working
directory for one session, a mutation checkout the gate runner's for one
mutant, both removed whatever happens; gate results and mutation evidence
carry digests, never a handle or a path, and no sealed record changes. The
layout changes on every platform, so one layout is exercised by every
platform's journeys. On an upgraded macOS or Linux Workspace, an empty
`verification/<run ID>/review` directory is no longer used, and a checkout a
verification killed under the earlier build left registered is not replaced
by the next one; `git worktree remove` clears it.

| Change | Evidence (file:line, assertion) | Result |
| --- | --- | --- |
| The worktree module owns Git's limit: `worktreeDirectoryFits` (UTF-8 bytes plus `/.git` within PATH_MAX - 40, per platform) and `worktreeRootFits` (a root and one 32-digit ID) | `packages/platform-node/src/task-worktree.ts:15`, `:166-176`; `tests/unit/task-worktree-path-budget.test.mjs:19-31` (215, 979, and 4051 bytes fit, one more does not, one less does, per platform), `:33` (a two-byte character counts twice), `:42` (a 182-character root fits on Windows, 183 does not) | PASS (darwin) |
| The adapter refuses a worktree or scratch checkout past the limit with `VES_GIT_WORKTREE_PATH_TOO_LONG` before it asks Git to add or remove anything, and adds one exactly at the limit | `packages/platform-node/src/git-worktree-adapter.ts:100-103`, `:195`, `:310`; `tests/integration/git-worktree-path-budget.test.mjs:75` (one byte past the host's limit: refused, no `worktree add` or `worktree remove`), `:93` (exactly at it: added) | PASS (darwin) |
| Scratch checkouts below `verification/<16 hex of the run ID's digest>/<r or m>`, derived, so a killed checkout is still found and replaced | `apps/vestra-cli/src/task/task-workspace.ts:150-156`, `:184-189`; `tests/unit/task-scratch-layout.test.mjs:25` (16 hex digits, one letter per purpose, the same each time, another run another segment); the link refusals at the new segments, unchanged in what they assert: `tests/integration/task-run-containment.test.mjs:375`, `tests/e2e/task-cli-e2e.test.mjs:1216`; the mutation sensor's checkouts gone afterwards at the new root, `tests/integration/task-mutation-sensor.test.mjs:123`; `tests/architecture/task-run-record-locality.test.mjs` (the checked function names the derived segments) | PASS (darwin) |
| `not configured` (`state-path-length`) before the run's first transition when the state root is too deep for any worktree of the run, measured on the real path | `apps/vestra-cli/src/task/task-workspace.ts:163-180`, called by `runTask` before the run is read (`apps/vestra-cli/src/task/task-run.ts:745`, after the fourth Windows leg below); `tests/unit/task-scratch-layout.test.mjs:57` (the hosted runner's Workspace root, 138 characters, fits on Windows, nothing created), `:63` (a 150-character root fits and a 151-character one is refused on Windows, nothing created; both fit macOS and Linux) | PASS (darwin) |
| Decision on `core.longpaths`: on. Every Git command of the task path runs with `-c core.longpaths=true` on Windows, never in the user's configuration. A worktree sits deeper than the user's own checkout by construction, so a repository whose files check out in place could not be checked out in a worktree without it; the paths past 260 characters exist only inside Verchestra's worktrees and scratch checkouts, Node reaches them through namespaced paths, and a gate whose tool cannot open one fails as a gate. It does not lift the `$GIT_DIR` limit, which the budget above handles. macOS and Linux run Git with the same arguments as before | `packages/platform-node/src/task-worktree.ts:160-162`, used by `runGit` and `runGitBytes` (`:185`, `:194`); `tests/unit/task-worktree-path-budget.test.mjs:49`; the Windows journey's fixture no longer sets it, and its repository carries a 145-character path that passes 260 characters in the run's worktree and in both scratch checkouts (`tests/helpers/task-cli-fixture.mjs:106-120`, asserted in the task branch at `tests/e2e/task-windows-e2e.test.mjs:191`) | PASS (darwin); the journey pending the Windows leg |

Author's discrimination run (in place, then restored): the long scratch layout
restored (3 failures), a 32-digit run segment (3), the adapter adding past the
limit (1) and the scratch checkout adding past it (1), characters counted
instead of bytes (1), no `core.longpaths` on Windows (1), the `/.git` suffix
ignored (6), and the scratch roots left out of the check (1). All killed.
Where the check runs is pinned on every platform after the fourth Windows leg
below.

Checks (darwin, Node 24.14.0): the worktree, gate, commit, mutation,
containment, cancel, anchoring, and resolution suites, the two locality
architecture suites, the new unit and integration suites, and the Windows
journey's platform path 191/191; `tests/e2e/task-cli-e2e.test.mjs`, `task-coordinated-e2e`, and
`task-subscription-e2e` 58/58 on the new layout; `pnpm typecheck`,
`pnpm test:architecture` 132/132, `pnpm complexity:check`, `pnpm test:census`
13/13, `pnpm agent:check`, `format:check`, and `lint` PASS.

Not provable without the next Windows leg: the Windows journey end to end on
the runner's deep root (its review and mutation checkouts now at 203
characters, and the 145-character file checked out past 260 with
`core.longpaths`), and the security and fault stages there.

### Fourth Windows leg of commit 4: two test fixtures, and the order of the checks

Platform matrix runs 37178524213 (`gate:security`) and 37178522867
(`gate:build`), head `5c458dc`: on Windows unit 2957/2957 and contract
954/954; the Windows journey got past `start` (implemented over the pipe,
gated, committed, the 145-character file checked out with `core.longpaths`).
Two failures remained, both of tests.

- The journey's own check of the deep file, `git show <branch>:<path>`,
  died with `failed to stat '...': Filename too long`. Git's revision parser
  stats an argument that has no `--` after it as a working-tree file, to tell
  a revision from a path (`check_filename` in `setup.c` dies on any error but
  ENOENT and ENOTDIR), and the whole argument, branch name included, passes
  260 characters in the user's checkout. The check now reads the object with
  `git cat-file blob <branch>:<path>`, which names an object and never looks
  at the working tree, so the fixture's Git calls keep behaving as the user's
  own Git would (`tests/e2e/task-windows-e2e.test.mjs:189-195`). Giving the
  fixture's Git `core.longpaths` would also have hidden the stat; it was not
  needed.
- Twelve cases of `tests/integration/task-coordinated-plan.test.mjs` got
  `state-path-length` where they expect the billing refusals: the in-process
  task fixture's Workspace state root was 170 bytes on the runner
  (`C:\Users\runneradmin\AppData\Local\Temp\vts-XXXXXX\verchestra-git-sha1-XXXXXX\home\AppData\Local\Verchestra\state\workspaces\workspace_<36>`),
  past the 150 bytes allowed. The fixtures now fit: the repository prefix is
  `vg-<format>-` (`tests/helpers/git-object-format-fixture.mjs:41-44`) and the
  fixture names a short `LOCALAPPDATA`, which only Windows reads
  (`tests/helpers/task-command-fixture.mjs:64-68`), so the root is 142 bytes
  there. The check is neither skippable nor weakened.

Decision on the order: the state-path check moves out of `prepare()` to
`runTask`, right after the Workspace is opened and before the run, its
plan, its billing, its credentials, or its prerequisites are read
(`apps/vestra-cli/src/task/task-run.ts:741-745`). Neither check has an
effect: this one reads a real path, the billing preflight reads two files.
From the owner's side the state root's location comes first, because every
Workspace file the later checks read (provider settings, the billing
statement, the gate allowlist, the Codex login) lives below it and moves with
it: confirming billing in a state root that then has to move would have to be
done again.

| Change | Evidence | Result |
| --- | --- | --- |
| The order is pinned on every platform: a v2 run whose Codex provider is on an API key, planned below a home made deep on purpose (its state root just past PATH_MAX - 110 bytes: 151 on Windows, 915 on macOS, 3987 on Linux), is refused `state-path-length` by `start` and `resume`, nothing written; from any root that fits the same run is refused `coordinated-run-subscription` (the cases above it) | `tests/integration/task-coordinated-plan.test.mjs:189`; mutants: the check removed (1 failure), the check after the billing preflight (1) | PASS (darwin) |
| One helper builds a directory of an exact length for the three budget suites | `tests/helpers/deep-directory.mjs` | PASS (darwin) |

Checks (darwin): `task-coordinated-plan` 21/21; every suite built on the
task command, run record, object-format, and deep-directory fixtures, with
the path budget and the Windows journey's platform path, 376/376; `typecheck`, `test:architecture`,
`agent:check`, `format:check`, `lint`, and `complexity:check` PASS.

Not provable without the next Windows leg: the journey to the accepted review,
and the twelve coordinated cases with the shortened roots.

### Fifth Windows leg of commit 4: the sealed dry run's state root

Platform matrix runs 37179380827 (`gate:security`, Windows SUCCESS, the
Windows journey end to end) and 37179379351 (`gate:build`, head `4dfdd96`):
on Windows unit 2957, contract 954, integration 1208, e2e 294, architecture
132, and build 177 of 178. The one failure was the sealed launcher's
`task plan --dry-run` (`tests/build/sealed-launcher-closure.test.mjs:497`),
which before commit 4 only asserted the platform refusal on Windows: exit 5,
`not configured`.

Cause: the case starts the sealed CLI with `{ ...process.env, HOME, USERPROFILE }`,
so on Windows the child inherited the runner's own `LOCALAPPDATA` and put the
state root in the runner's profile, while the case wrote the gate allowlist
where `resolveStateRoot` puts it without one (`<home>\AppData\Local`); the
dry run found no allowlist (`gate-allowlist`). The CLI does not need
`LOCALAPPDATA`: without one it falls back to `<home>\AppData\Local`, pinned by
`tests/unit/state-root.test.mjs:21` and `:28`. The case now gives the child a
`LOCALAPPDATA` below the fixture's home, as every Windows session has one, and
computes the state root from the same environment, so `init` no longer writes
into the runner's profile either. A short one keeps the Workspace state root
at 142 of the 150 bytes on the runner (`D:\a\verchestra\verchestra\.tmp-sealed-command-layout\home-XXXXXX\l\...`),
which a dry run does not need but a started run would. Its assertions now
carry the command's bounded standard output, where the JSON error names the
code and the requirement (`tests/build/sealed-launcher-closure.test.mjs:523-530`,
`:537`, `:596`).

Sibling sweep: every other test that runs the task path through a child
`vestra` uses the task CLI fixture, whose environment is explicit, not
inherited, and names its own `HOME`, `USERPROFILE`, `LOCALAPPDATA`, `TEMP`, and
`TMP` on Windows; the in-process suites pass `env` and `homeDirectory` in the
command's IO. One sibling still skipped Windows with the stale "the task path
is refused on Windows": the example Task Requests' dry runs
(`tests/e2e/task-request-examples-e2e.test.mjs:62`), which read no credential
and now run there too. On Linux, `XDG_STATE_HOME` in the invoking
environment would be inherited the same way by the sealed case; the hosted
runners do not set it.

Checks (darwin): the sealed task case 1/1, the example dry runs 3/3,
`format:check`, `lint`, `typecheck`, and `agent:check` PASS. Not provable
without the next Windows leg: the sealed dry run and the example dry runs
on the runner.

## T8 Evidence (CLI surface, examples, and user documentation)

Author's evidence, commit by commit, on branch `strands/t8-surface` (base
`origin/main` at `d641415`, which carries T3 to T6 and T7 commits 1 to 3). The
independent verifier re-derives it.

### Commit 1 — coordinated runs presented in plan and status

`apps/vestra-cli/src/task/task-coordination-surface.ts` computes, once, what
the task commands show of a coordinated run. `plan` presents, beside the
descriptor the approval binds (`execution`, unchanged), its `coordination`
topology: the mode, a swarm's start, and one entry per node in plan order with
its passport (`<driver>:<model>`), its role under the coordination plan's own
writer rule (`isWriterNode`, now exported by `coordination-plan.ts`, so the
CLI holds no second copy of the rule), and where its work goes next (`to`: a
graph node's edge targets, a swarm node's declared handoff destinations). It
also presents `subscription`, the preconditions `start` will check (SSI-30):
the method each provider of the run must prove and its statement must name,
`extraUsage: "disabled"`, the statement's file name (never its path), and
`preflight`, which is `ready` or the requirement `start` would refuse now
(`coordinated-run-subscription` or `extra-usage-confirmation`). It is
informational and machine-local, as `providerAuth` already is: `plan` refuses
nothing and prints nothing on the terminal for it, and `start` and `resume`
run the preflight again. `task-billing.ts` splits its preflight into the two
checks both paths share; `requireSubscriptionPreflight` behaves as before
(the API-key refusal still explains nothing, a confirmation refusal still
prints the one step).

`status` shows the same topology entry for each node with its state, visit
count, and result digest (SSI-32); the suspension (reason, provider, instant,
the provider's window and reset when it reported them) and the uncertain nodes
were already shown by T6. `start` and `resume` of a coordinated run now carry
the same `coordination` member as `status`, from the same records, so the
result of a run that just stopped names each node's state and every uncertain
node. Their `next` for a suspended run is the one `status` offers instead of a
plain resume that would be refused.

Spec-precision note (D4, T6's open question 2). A resume takes one
`--reconcile` and refuses while another node that may have landed effects
stays unsettled, so with two or more such nodes no resume can pass. The next
actions now say so: one uncertain node gives its reconcile command; several
give none, and `vestra task cancel` is the only action (`status` still lists
each node with its digest). Before this commit `status` offered one reconcile
command per node, each of which the resume would refuse. Allowing several
digests in one resume stays an open owner question.

Text and JSON. The CLI prints a result as text by rendering the same data the
`--output json` envelope carries (one `member: value` line per member, a nested
value as compact JSON). The journeys read the text form back and compare it
member by member, by value, with the JSON form of the same command
(`tests/helpers/cli-text-fixture.mjs`).

| Behaviour | Assertion (file:line) | Run |
| --- | --- | --- |
| SSI-30: a graph's topology names each node's passport, role, and edge targets in plan order; a swarm names its start and each node's handoff destinations; an agent is its one node; a Claude Code node with no write scope is a reader | `tests/unit/task-coordination-surface.test.mjs:22`, `:33`, `:44`, `:53` | `node --test tests/unit/task-coordination-surface.test.mjs`: 7 of 7 |
| D4: no uncertain node gives a plain resume, one gives its reconcile command, several give none | `tests/unit/task-coordination-surface.test.mjs:62`, `:66`, `:72` | same |
| SSI-30: `plan` shows each provider's method, the statement file, and `ready` with a complete statement; with no statement, text that is not JSON, a statement older than its regime, or an API-key provider it shows the requirement `start` would refuse, and says nothing on the terminal | `tests/unit/task-billing.test.mjs:212`, `:236` | `node --test tests/unit/task-billing.test.mjs`: 41 of 41 |
| SSI-30: the plan surface of a v2 request carries the descriptor, the topology, and the preconditions it is given | `tests/unit/task-plan-binding.test.mjs:114` | `node --test tests/unit/task-plan-binding.test.mjs`: 23 of 23 |
| SSI-32: status of a suspended run shows the suspension, each node with its passport, role, destinations, state, visit count, and result digest, the uncertain node with its digest, and its reconcile command | `tests/integration/task-coordinated-plan.test.mjs:271` | `node --test tests/integration/task-coordinated-plan.test.mjs`: 20 of 20 |
| D4: status of a run with two uncertain nodes names both digests and offers only the cancel | `tests/integration/task-coordinated-plan.test.mjs:333` | same |
| SSI-30 through the binary, macOS and Linux: a v2 dry run shows the topology and the preconditions (`extra-usage-confirmation` with no statement), and its text form agrees with its JSON form on every member, the four that each invocation creates anew (`runId`, `bindingDigest`, `approvalExpiresAt`, `review`) only present | `tests/e2e/task-cli-e2e.test.mjs:831` | `node scripts/test-scope.mjs e2e tests/e2e/task-cli-e2e.test.mjs`: 45 of 45 |
| SSI-32 in the run's result: a quota signal mid-graph shows each node's state (`plan` completed, `build` failed, `review` pending) and no uncertain node, next a plain resume | `tests/e2e/task-subscription-e2e.test.mjs:116` | `node scripts/test-scope.mjs e2e tests/e2e/task-subscription-e2e.test.mjs tests/e2e/task-coordinated-e2e.test.mjs`: 13 of 13 |
| SSI-32, D4: the start that a writer's quota signal stopped after its write offers the reconcile command and shows the same nodes as status; status shows the window and reset the provider reported; its text form agrees with its JSON form on every member | `tests/e2e/task-subscription-e2e.test.mjs:281` | same |

Tests changed, none deleted. `tests/integration/task-coordinated-plan.test.mjs`
"status of a suspended run…" keeps every assertion; its expected nodes gain
the topology members, and its setup moved into the file's `suspended` helper,
shared with the new two-node case. T6's citations of that file move from
`:167`, `:252`, `:261` to `:232`, `:309`, `:318`. The T6 journeys in
`tests/e2e/task-subscription-e2e.test.mjs` gain assertions only; their
citations move from `:55`, `:75`, `:115`, `:151`, `:218`, `:268`, `:322`,
`:349`, `:373` to `:56`, `:76`, `:116`, `:163`, `:230`, `:281`, `:341`, `:368`,
`:392`. `tests/unit/task-billing.test.mjs` citations at or after `:20` move by
one line (one more import). The Requirement Evidence table below cites the
current lines; the T5 and T6 sections stay as written at their commits.

Discrimination (author run, one source edit per mutant, restored after the
run): V1 the role ignores the writer rule (any Claude Code node writes), V2 a
swarm node lists no destinations, V3 several uncertain nodes offer the first
one's reconcile, V4 status nodes lose the topology, V5 a swarm's start is not
shown, V6 the preconditions always read `ready`, V7 the preconditions skip the
API-key check, V8 the plan surface drops the topology, V9 the plan surface
drops the preconditions, V10 `task plan` passes no preconditions (journey),
V11 a suspended start offers the plain resume (journey), V12 the run result
drops the nodes (journey), V13 the text form leaves a member out (journey), V14
the text form prints a nested value otherwise than JSON (journey) — all
killed.

Gates at this commit: `pnpm gate:quick` PASS (format, lint, complexity,
typecheck; unit 2925, agent-readiness 357, census 13); `pnpm test:architecture`
131/131; `pnpm agent:check` PASS; the e2e suites `task-cli-e2e` 45/45 and
`task-subscription-e2e` with `task-coordinated-e2e` 13/13; the integration
suite `task-coordinated-plan` 20/20; 0 failed, 0 skipped, 0 todo.
`complexity-baseline.json` is unchanged (no function above 10) and so is the
census (no file gained or lost `JSON.stringify` or `createHash`). Not run here,
for the platform matrix: `pnpm gate:full`, `pnpm gate:build`, `pnpm
gate:security`, and the Linux and Windows runs.

Citations moved with the reshaped files, for the lines that were current at
the base: `task-status.ts` in `.specs/features/architecture-deepening-2/validation-t9.md`
sections 2 to 4 (`:77`, `:81`, `:82`, `:175` → `:69`, `:73`, `:74`, `:110`;
`reasonOf` `:280-283` → `:215-218`; `:181` → `:116`), in `validation-t7.md`
(`:181` → `:116`, `:236` → `:171`), and in the pilot's validation (`:257` →
`:192`; `:21` did not move); the CLI's `task-run.ts` in `validation-t7.md`
(`:264`, `:275`, `:282` → `:265`, `:276`, `:283`), `validation-t1.md` (`:418`
→ `:426`), `validation-c6.md` (`:416` → `:424`), and the pilot's validation
(`:62`, `:650-651`, `:439`, `:689-691` → `:63`, `:658-659`, `:447`,
`:709-711`); `task-plan.ts` in `validation-t8.md` (`:317` → `:323`, twice);
and `tests/e2e/task-cli-e2e.test.mjs` in this file's SSI-83 row (`:827-852`,
`:854-871` → `:830-873`, `:875-892`). Left as written: validation-t9's section
1 and its `task-run.ts:292` (already stale at the base), the "is now" records
of `validation-t7.md`, `validation-t8.md`'s `:215-231` (the friction at its
own base), and `coordination-plan.ts`, whose lines did not move.

### Commit 2 — one example Task Request per mode

`docs/examples/task-request-agent.json`, `task-request-graph.json`, and
`task-request-swarm.json` are complete Task Requests v2 for one small change
(`parseDuration` accepts `1h30m`), the change the quick start's v1 example
makes, so a reader can compare the two. The agent runs one Claude Code writer;
the graph plans with a Codex reader, writes with a Claude Code node that takes
the plan as input, and reviews with a Codex reader that takes both; the swarm
hands work between a Claude Code writer and a Codex reviewer, starting at the
writer. Every provider is Claude Code or Codex, which authenticate by
subscription by default; a request cannot name an authentication method. Each
declares only limits at or below their defaults, sized to the run (the graph
`maxNodes` 3 and `maxEdges` 2; the swarm `maxSwarmAgents` 2 and `maxHandoffs`
4, with a run result bound of five visits of 32 KiB). `sourceRevision` is the
quick start's placeholder, which the reader replaces with `git rev-parse HEAD`.

| Behaviour | Assertion (file:line) | Run |
| --- | --- | --- |
| SSI-36: each example plans through the real binary with `--dry-run` against a repository holding the files it names, after its placeholder revision is replaced: its declared topology (passport, role, destinations per node), both providers on subscriptions, the preflight `ready` with the owner's confirmation, every declared limit as written and every effective limit at or below its default; its text form agrees with its JSON form | `tests/e2e/task-request-examples-e2e.test.mjs:62` | `node scripts/test-scope.mjs e2e tests/e2e/task-request-examples-e2e.test.mjs`: 3 of 3 (macOS; Linux on the platform matrix; Windows reports the task path refused with a diagnostic) |

Discrimination (author run, one edit per mutant to an example, restored after
the run): X1 the swarm raises `maxHandoffs` above its default, X2 a graph edge
names an unknown node, X3 a Codex node declares a write scope, X4 the verifier
names an authentication method, X5 the example names a revision other than the
placeholder — all killed.

Gates at this commit: `pnpm gate:quick` PASS (format, lint, complexity,
typecheck; unit 2925, agent-readiness 357, census 13); `pnpm agent:check`
PASS; the examples journey 3/3; 0 failed, 0 skipped, 0 todo. No product source
changed. Not run here, for the platform matrix: `pnpm gate:full` (which runs
the journey on Linux) and the Windows run.

### Commit 3 — user documentation

`docs/quick-start.md` gains "Coordinated runs: agent, graph, and swarm"
(modes, the writer rule, how to write a v2 request with the three examples,
the limits, subscriptions only with extra usage off and the hand-written
statement, what `plan`, `start`, and `status` show, and suspension and resume
with `--reconcile`), plus pointers from "What you need", steps 6 and 9, and
the qualification limits. `README.md` gains a short section with the same
facts and a link to it. Every documented fact is enforced or observed where
the table says; nothing is documented that the code does not do.

| Documented fact | Where it holds (file:line) |
| --- | --- |
| The statement's file, its exact members, `auth` per provider (`subscription`, `chatgpt`), `extraUsage: "disabled"`, a Codex `planType` in lowercase, and the regime instants 2026-06-16 and 2026-10-03 | `apps/vestra-cli/src/task/task-billing.ts:17`, `:27-30`, `:38-41`, `:46-51`; `tests/unit/task-billing.test.mjs:43`, `:75` (19 refusals) |
| No token, account ID, e-mail address, name, or path can be stored | `tests/unit/task-billing.test.mjs:117` |
| Both providers need an entry, in every mode | `tests/unit/task-billing.test.mjs:67` |
| A missing or non-matching statement is `not configured` (`extra-usage-confirmation`) and the terminal names the file and the entries; an API-key provider is `coordinated-run-subscription` | `tests/unit/task-billing.test.mjs:164`, `:174`; journeys `tests/e2e/task-subscription-e2e.test.mjs:56`, `:76` |
| Codex credits: `not configured` (`codex-credits`), the run suspended, and resumed once they are gone | `tests/e2e/task-subscription-e2e.test.mjs:163`, `:368` |
| Plan-time `coordination` and `subscription`; status nodes and states; text and JSON agree | Commit 1 rows above |
| The seven limits, their defaults and ceilings, and the refusal above a ceiling | `packages/application/src/execution/coordination-plan.ts:58-78`; `packages/application/src/execution/task-request.ts:398-399` |
| Mode `agent` never loads the Strands Agents SDK; `graph` and `swarm` load it | `tests/integration/task-coordination-loading.test.mjs:46`, `:52` |
| Codex 0.159.3 or later for a coordinated run | `packages/drivers/src/codex-driver.ts:90`, `:559` |
| Suspension keeps the work and the worktree, releases the lease, stays `IMPLEMENTING`, and names reason, provider, time, window, and reset | `tests/e2e/task-subscription-e2e.test.mjs:116`, `:281` |
| Resume rechecks the statement, the approval (seven days, `apps/vestra-cli/src/task/task-plan.ts:39`), and the worktree; replays completed nodes; runs again a node with no effect | `tests/e2e/task-subscription-e2e.test.mjs:230`, `:341` |
| An uncertain node needs `--reconcile <digest>`; a digest naming nothing is refused; two uncertain nodes leave only cancel; cancel of a suspended run removes its worktree | `tests/e2e/task-subscription-e2e.test.mjs:281`, `:392`; `tests/integration/task-coordinated-plan.test.mjs:333` |
| Windows: the task path is still refused | `apps/vestra-cli/src/task/task-command.ts:102-103`; T7 commit 4 is not on `origin/main` (checked at `d641415` before writing) |
| No published release includes coordinated runs | `docs/qualification/tuf-publication-ledger.json:120`: the latest recorded publication, `0.0.0-qualification.6`, was built from `7e274f2`, this feature's base |
| Qualified with deterministic stand-ins on macOS only | the coordinated journeys return with a diagnostic off macOS (`tests/e2e/task-subscription-e2e.test.mjs:34`); pilots are T9 |

Gates at this commit: `pnpm gate:quick` PASS (unit 2925, agent-readiness
357, census 13); `pnpm agent:check` PASS; `pnpm site:check` PASS (site unit
50/50, `astro check` 0 errors, 135 pages built, internal links and metadata
valid). `pnpm site:test` could not complete on the authoring machine for
reasons outside this change: Astro 7's `preview` returns at once and leaves
its server running in the background, so Playwright's `webServer` reports
"exited early", and with that server reused, the Playwright 1.62.1 browsers
(Chromium headless shell 1234, Firefox, WebKit) are not installed there; no
assertion ran, none failed. It runs in CI, which installs the browsers. The
README and the quick start are not site pages; the README reaches the site
only through `llms-full.txt`, which `site:check` builds and checks.

## Requirement Evidence

Each row needs a file-and-assertion citation (`path:line` and what the assertion
checks), the gate run that executed it, and PASS or FAIL. A row without
evidence is FAIL.

| Requirement | Evidence (file:line, assertion) | Gate run | Verdict |
| --- | --- | --- | --- |
| SSI-01 | `tests/agent-readiness/dependency-policy.test.mjs:51`, `:73`, `:96` exact pins in agent-runtime only, importer and snapshot resolution, installed release and its required peers; lockfile review in T5 commit 3 | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-02 | `tests/architecture/strands-coordination-subpath.test.mjs:69` only `@strands-agents/sdk/multiagent`, in every import form; mutant S7 killed | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-03 | `tests/architecture/strands-coordination-subpath.test.mjs:87` no Agent, model, router, MCP client, session manager, sandbox, vended tool, or telemetry; `tests/integration/strands-empty-environment.test.mjs:50` no Bedrock client constructed; mutant S6 killed by each | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-04 | `tests/integration/strands-coordination-engine.test.mjs:245` a structural agent has only `id`, `invoke`, `stream` and calls the runner; `:53`, `:126` Graph and Swarm run only structural agents | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-05 | `tests/integration/strands-coordination-engine.test.mjs:295` `preserveContext` false on every node; `tests/architecture/strands-coordination-subpath.test.mjs:87` the name is banned; resumption replays the node ledger (`tests/unit/coordinated-driver.test.mjs:301`, `:327`); mutant S8 killed | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-06 | `tests/integration/strands-coordination-engine.test.mjs:245` the SDK's assembled input is ignored; `tests/unit/node-result.test.mjs:100` the prompt is built from the plan, declared inputs, and handoff only | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-07 | `tests/integration/strands-coordination-engine.test.mjs:245` one text block naming the payload reference; mutant S1 killed | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-08 | `tests/integration/strands-coordination-engine.test.mjs:269` errors carry only a stable code and no cause; `:101` the SDK's line names node and code only; mutant S4 killed | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-09 | `tests/integration/strands-coordination-engine.test.mjs:295` finite concurrency, steps, run and node timeouts from the plan and the remaining budget; mutant S3 killed | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-10 | `tests/integration/strands-coordination-engine.test.mjs:320` INTERRUPTED, an unasked CANCELLED, and unknown codes are coordination failures; mutant S5 killed | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-11 | T3 part: `tests/contract/task-request-v2.test.mjs:57-59` the v2 schema names no SDK, schema library, or provider SDK; the coordination plan and normalizer import only `@verchestra/domain`, and application sources cannot import a third-party package (`scripts/architecture.mjs` `VES_ARCH_THIRD_PARTY_IMPORT`, `tests/architecture/repository-boundaries.test.mjs`); node-result, handoff, and coordinated-driver modules are T5; T5 part: `node-result.ts`, `coordinated-driver.ts`, `coordination-engine.ts`, `coordination-ledger.ts`, `node-prompt.ts` import only `@verchestra/domain` (`VES_ARCH_THIRD_PARTY_IMPORT` scan, `pnpm test:architecture` 130/130) | `pnpm test:contract` 907/907, `pnpm test:architecture` 122/122 (tip); T5 gates | PASS (author, T3 and T5 parts) |
| SSI-12 | `tests/architecture/strands-coordination-subpath.test.mjs:69`, `:110` placement under `coordination/strands/` and the one subpath export | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-13 | `tests/architecture/strands-coordination-subpath.test.mjs:110` main entry closure free of the SDK; `tests/integration/task-coordination-loading.test.mjs:40`, `:46` `vestra --version` and agent runs load none of it; mutant K3 killed | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-14 | `tests/architecture/strands-coordination-subpath.test.mjs:143` one literal dynamic import; `tests/integration/task-coordination-loading.test.mjs:52`; `tests/e2e/task-coordinated-e2e.test.mjs:189` a graph through the real binary; mutant K2 killed | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-15 | `tests/integration/coordinated-executor.test.mjs:60` one executor run: node-scope refusal before the executor, protected-path refusal by it, usage once on the meter; `tests/unit/coordinated-driver.test.mjs:469` usage and checkpoints; `:386`, `:407` cancellation follows the executor's signal | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-16 | The coordination runs inside one `TaskExecutionCoordinator.execute` (`tests/integration/coordinated-executor.test.mjs:60`: one authority start, one worktree); `task-scheduler.ts` and the `vestra task` command set are unchanged (no diff) | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-17 | T4 share: a structured or quota session keeps `model.resolved` provider `anthropic` or `openai` and the Passport reference; no new event names another provider (`spikes/claude-code-driver/test/claude-driver-structured.test.mjs:40-50`, `spikes/codex-driver/test/codex-driver-structured.test.mjs:47-55`). T5 owns the node records.; T5 part: each node keeps its driver (`tests/e2e/task-coordinated-e2e.test.mjs:189`: Claude Code and Codex sessions by their own passports and logins); Strands appears as no provider, passport, or authentication mode | `pnpm qualify:claude`, `pnpm qualify:codex`; T5 gates | PASS (T4 share); PASS (author, T5 part) |
| SSI-18 | T3 part: `tests/contract/task-request-v2.test.mjs:460-465` a Codex node with a write scope is refused in a graph and in a swarm with `VES_TASK_REQUEST_EXECUTION_INVALID`; the runtime part (Codex node sessions are readers) is T5; T3 part: `tests/contract/task-request-v2.test.mjs:453-454` a Codex node with a write scope is refused in a graph and in a swarm with `VES_TASK_REQUEST_EXECUTION_INVALID`; the runtime part (Codex node sessions are readers) is T5; T5 runtime part: a Codex node gets no tool and Codex's read-only sandbox (`tests/e2e/task-coordinated-e2e.test.mjs:189`), and a reader's write is refused before the executor (`tests/unit/coordinated-driver.test.mjs:148`) | `pnpm test:contract` (906/906, commit 2); T5 gates | PASS (author, T3 and T5 parts) |
| SSI-19 | `tests/e2e/task-coordinated-e2e.test.mjs:189` the independent Codex verifier still runs on its own and its prompt holds no node result; the review surface and verdict are unchanged | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-20 | `tests/contract/task-request-v2.test.mjs:25-27` registry holds `task-request@2` and accepts one example per mode; `:35` shared members equal v1's; `tests/contract/task-request-v1-golden.test.mjs:25` v1 schema bytes equal the `dc35c52` golden; `:36` generated v1 output byte-identical; `tests/contract/schema-registry.test.mjs` zero drift of the generator (`--check`) | `pnpm test:contract` (814/814, commit 1) | PASS (author) |
| SSI-21 | `tests/contract/task-request-v1-golden.test.mjs:43-57` normalized form and execution-contract digest; `:73-79` Execution Package payload digest and approval binding digest; `:85-87` plan surface; all equal the values recorded on `dc35c52` before any change | `pnpm gate:build` contract 907/907 (tip) | PASS (author) |
| SSI-22 | `tests/contract/task-request-v1-golden.test.mjs:64-68` a v1 plan record is written with the recorded bytes and loads unchanged; existing Run record suites unchanged and passing; `tests/integration/task-coordinated-plan.test.mjs:53-80` a v2 record loads through the same validated reader and fails closed when invalid or tampered | `pnpm gate:build` contract 907, integration 1149 (tip) | PASS (author) |
| SSI-23 | `tests/contract/task-request-v2.test.mjs:145` each mode normalizes to its whole descriptor plus all seven limits at the SSI-37 defaults; `:156-163` a declared limit is kept and the rest default; `:534` the canonical encoding carries the whole descriptor | `pnpm test:contract` (906/906, commit 2) | PASS (author) |
| SSI-24 | `tests/contract/task-request-v2.test.mjs:234-268` 26 cases (API key, authentication mode, billing, endpoint, executable, credential, the v1 `driver`, unknown members on nodes, node drivers, edges, handoffs, limits, the verifier, the task, a gate, budgets, the repair policy, members of another mode, missing members) refused by the schema and by the normalizer with `VES_TASK_REQUEST_INVALID` | `pnpm test:contract` (906/906, commit 2) | PASS (author) |
| SSI-25 | `tests/contract/task-request-v2.test.mjs:441-448` cycle, self-edge, node no source reaches, unknown edge node, unknown input, descendant input, self input, input on an agent; schema admits, normalizer refuses with `VES_TASK_REQUEST_EXECUTION_INVALID` (`:497-498`); shape cases (duplicate input or edge, malformed IDs) refused by both (`:423-424`) | `pnpm test:contract` (906/906, commit 2) | PASS (author) |
| SSI-26 | `tests/contract/task-request-v2.test.mjs:449-480` read or write scope outside the change scope (and a letter-case variant), write scope containing, inside, or case-folding onto a protected path, Git metadata, Codex write scope (graph and swarm), unordered writers, no writer (agent, graph, swarm); `:508-530` ordered writers and several swarm writers are accepted | `pnpm test:contract` (906/906, commit 2) | PASS (author) |
| SSI-27 | `tests/contract/task-request-v2.test.mjs:482-490` unknown start, handoff to or from an unknown node, handoff to itself, a source listed twice; `:395` a swarm node with inputs refused by both | `pnpm test:contract` (906/906, commit 2) | PASS (author) |
| SSI-28 | `tests/unit/task-plan-binding.test.mjs:68-72` one test per element (mode, node identifier, driver, model, instructions, description, read scope, write scope, input, edge, start, handoff target, and each of the seven limits) asserts a new binding digest; `:74-77` all 19 digests differ; sensor D1–D5 and D7 kill when a field leaves the binding | `pnpm gate:quick` unit 2689 (tip) | PASS (author) |
| SSI-29 | T3 part: `tests/unit/task-plan-binding.test.mjs:82-91` the Execution Package seals the whole normalized v2 request as its execution contract and the approval binds that package; `tests/integration/task-coordinated-plan.test.mjs:53-63` the plan record seals the same request; T8 part: `start` and `resume` take a run ID and no request path (`tests/contract/cli-surface.test.mjs:167`, `:175`), execute the request sealed in the plan record, which is refused as tampered when it no longer matches its digest (`tests/integration/task-coordinated-plan.test.mjs:84`), and run its descriptor in the journeys (`tests/e2e/task-coordinated-e2e.test.mjs:32`, `:57`, `:109`) | `pnpm gate:build` (tip, T3); T8 gates | PASS (author) |
| SSI-30 | `plan` of a v2 request presents the mode, every node with its passport (driver and model), role, read and write scope (in `execution`), and destinations (in `coordination`), the edges or handoff targets, the effective limits, and the subscription preconditions with the requirement `start` would refuse: `tests/unit/task-coordination-surface.test.mjs:22`, `:33`, `:44`, `:53`; `tests/unit/task-billing.test.mjs:212`, `:236`; `tests/unit/task-plan-binding.test.mjs:114`; through the binary `tests/e2e/task-cli-e2e.test.mjs:831`; mutants V1, V2, V5–V10 killed | T8 commit 1 (see T8 Evidence) | PASS (author) |
| SSI-31 | The installed command list is unchanged, `--reconcile` is an option of `task resume`, and no `workflow` command exists: `tests/contract/cli-surface.test.mjs:72`, `:175`; plan, approve, start, status, cancel, and review drive v2 runs in `tests/e2e/task-coordinated-e2e.test.mjs:32`, `:57`, `:120`, and resume in `tests/e2e/task-subscription-e2e.test.mjs:230`; the v1 journeys pass unchanged (`tests/e2e/task-cli-e2e.test.mjs`) | T5, T6, T8 gates | PASS (author) |
| SSI-32 | T6 part: status of a v2 run shows each node's state, visit count, and result digest, the suspension (reason, provider, window, reset when reported), and every uncertain node with its digest and reconcile command: `tests/integration/task-coordinated-plan.test.mjs:271`; journeys `tests/e2e/task-subscription-e2e.test.mjs:116`, `:281`; mutant R15 killed. T8 part: each node also shows its passport, role, and destinations (`tests/integration/task-coordinated-plan.test.mjs:271`); two uncertain nodes offer no resume that would be refused (`:294`); the result of `start` and `resume` shows the same nodes and the same next action (`tests/e2e/task-subscription-e2e.test.mjs:116`, `:281`); the text form of status agrees with its JSON form (`:281`); mutants V3, V4, V11–V14 killed | T6 commit 3; T8 commit 1 (see T8 Evidence) | PASS (author) |
| SSI-33 | `task resume` revalidates the workflow state, the subscription preconditions and the extra-usage confirmation (commit 1), the approval against the Workspace policy in force, and the worktree change digest before any node starts, and a refusal changes nothing: `tests/unit/task-resumption.test.mjs:70`, `:82`, `:92`; journeys `tests/e2e/task-subscription-e2e.test.mjs:230` (confirmation), `:341` (drift, expired approval); mutants R1, R3, R4 killed | T6 commit 3 (see T6 Evidence) | PASS (author) |
| SSI-34 | `tests/e2e/task-coordinated-e2e.test.mjs:252` cancel stops the running node's provider and ends ABORTED; `tests/unit/coordinated-driver.test.mjs:386`, `tests/integration/strands-coordination-engine.test.mjs:184` every running node cancelled; mutant K6 killed | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-35 | A v2 run is reviewed by the same typed-back decision over the same review surface: `tests/e2e/task-coordinated-e2e.test.mjs:51`, `:105` accept with the surface digest typed back on standard input; `apps/vestra-cli/src/task/task-review.ts` is unchanged by T8 | T5 gates; T8 gates | PASS (author) |
| SSI-36 | One example per mode under `docs/examples/`, each planned with `--dry-run` through the binary: `tests/e2e/task-request-examples-e2e.test.mjs:62`; mutants X1–X5 killed | T8 commit 2 (see T8 Evidence) | PASS (author; macOS) |
| SSI-37 | `tests/contract/task-request-v2.test.mjs:145` absent limits take 1, 64, 128, 8, 32, 64 KiB, 256 KiB; `:176-185` 1, default−1, default, default+1 accepted per limit; `:196-209` 65 graph nodes, 129 edges, and 9 swarm agents refused at the default and accepted when raised, 64 nodes, 128 edges, and 8 agents accepted at it | `pnpm test:contract` (906/906, commit 2) | PASS (author) |
| SSI-38 | `tests/contract/task-request-v2.test.mjs:176-185` ceiling−1 and ceiling accepted per limit; `:187-194` ceiling+1, 0, 1.5, and a string refused by both; `:211-229` 256 nodes, 16 agents, and 512 edges plan at their ceilings, 257, 17, and 513 are refused by both | `pnpm test:contract` (906/906, commit 2) | PASS (author) |
| SSI-39 | T5 part: `tests/integration/coordinated-executor.test.mjs:60` and `tests/e2e/task-coordinated-e2e.test.mjs:189` usage of every node accumulates on the run's one ledger (330 tokens; 42 tokens in 4 events); across resumes is T6; T6 part: the spend at a suspension is saved and the resumed meter continues from it (`tests/unit/task-run-coordinator.test.mjs:312`, controllable clock), and a graph suspended mid-run then resumed holds the same 42 tokens in 4 events as one uninterrupted (`tests/e2e/task-subscription-e2e.test.mjs:230`); mutant S12 killed | T5 gates (see T5 Evidence); T6 commits 2 and 3 | PASS (author, T5 part); PASS (author, T6 part) |
| SSI-40 | `tests/unit/coordinated-driver.test.mjs:129`, `tests/integration/strands-coordination-engine.test.mjs:163` writers never overlap; mutant C2 killed | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-41 | `tests/unit/coordinated-driver.test.mjs:148`, `tests/integration/coordinated-executor.test.mjs:60` writes outside the node's write scope refused before the executor; mutants C1, C16 killed | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-42 | A Claude Code node's bridge read scope is the node's read scope (`apps/vestra-cli/src/task/task-coordination.ts` `nodeDriver`, `readScope: session.node.readScope`; the bridge confinement itself is `tests/integration/mcp-tool-bridge.test.mjs`, unchanged); a Codex node does not read through the bridge (open question in the T5 report) | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-43 | `tests/unit/node-result.test.mjs:32`, `:86`; `tests/contract/strands-node-result-parity.test.mjs:31`, `:67`; mutants C5, C6, S2, S10 killed | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-44 | `tests/unit/coordinated-driver.test.mjs:255`, `:263`; `tests/integration/strands-coordination-engine.test.mjs:141` undeclared, malformed, or missing decisions fail the swarm with no repair cycle | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-45 | `tests/unit/coordinated-driver.test.mjs:276`, `tests/integration/strands-coordination-engine.test.mjs:150` `VES_COORDINATION_HANDOFF_LIMIT`; mutant C4 killed | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-46 | T4 share: a structured session without an answer, with exhausted retries, or with an unreadable answer fails with a stable driver code and hands nothing on (`tests/contract/claude-code-driver-structured.test.mjs:88`, `tests/contract/codex-driver-structured.test.mjs:157`); mutants M12, M13 killed. T5 maps it to `VES_COORDINATION_RESULT_INVALID`.; T5 part: `tests/unit/node-result.test.mjs:53`, `tests/unit/coordinated-driver.test.mjs:215`, `tests/integration/strands-coordination-engine.test.mjs:115` `VES_COORDINATION_RESULT_INVALID`, no repair cycle | `pnpm test:contract`; T5 gates | PASS (T4 share); PASS (author, T5 part) |
| SSI-47 | `tests/unit/node-result.test.mjs:93`, `tests/unit/coordinated-driver.test.mjs:194` refused before persistence; mutants C7, C8, C9 killed | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-48 | The bound is applied before emission (`tests/unit/driver-event.test.mjs:143`; driver boundaries `tests/contract/claude-code-driver-structured.test.mjs:119`, `tests/contract/codex-driver-structured.test.mjs:157`) and the port carries only `payload:sha256:<digest>` of the canonical bytes (`tests/integration/driver-execution-adapter.test.mjs:307`); mutants M10, M11 killed. | `pnpm test:unit`, `pnpm test:contract`, `pnpm test:integration` | PASS |
| SSI-49 | T4 share: the new events carry only the canonical answer, a closed-vocabulary scope, and an ISO reset; checkpoints gain nothing (`tests/security/driver-structured-results-security.test.mjs:58`, `:162`, `:173`). T5 owns the persisted node results and ledger.; T5 part: `tests/security/coordination-record-security.test.mjs:27`, `tests/unit/coordinated-driver.test.mjs:493` the ledger and results hold no session, credential, prompt, or path | `pnpm test:security`; T5 gates | PASS (T4 share); PASS (author, T5 part) |
| SSI-50 | `tests/unit/node-result.test.mjs:100` earlier results, the handoff, and the context are delimited untrusted data after the rules; tools and scopes come from the plan (`tests/unit/coordinated-driver.test.mjs:148`) | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-51 | Every provider, verifier included, must be `subscription` or the run is `not configured` (`coordinated-run-subscription`) before any credential, transition, or worktree: `tests/unit/task-billing.test.mjs:164`, `tests/integration/task-coordinated-plan.test.mjs:114`, journey `tests/e2e/task-subscription-e2e.test.mjs:76`; mutants B1, B10 killed | T6 commit 1 (see T6 Evidence) | PASS (author) |
| SSI-52 | A confirmation naming each provider and its effective method under the current regime is required at `start` and `resume`; absent, malformed, or mismatched is `not configured` (`extra-usage-confirmation`): `tests/unit/task-billing.test.mjs:75`, `:174`, `tests/integration/task-coordinated-plan.test.mjs:136`, journey `tests/e2e/task-subscription-e2e.test.mjs:56`; mutants B1–B9, B11 killed | T6 commit 1 (see T6 Evidence) | PASS (author) |
| SSI-53 | The statement is a closed shape of closed values and bounded grammars; a token, account identifier, e-mail address, name, path, or key member is refused at either level, and a free-text plan type is refused: `tests/unit/task-billing.test.mjs:75`, `:117`; mutant B8 killed | T6 commit 1 (see T6 Evidence) | PASS (author) |
| SSI-54 | `apiKeySource` other than `none` fails a subscription session with `VES_CLAUDE_AUTH_METHOD_MISMATCH` before `session.started` and any tool effect (`tests/contract/claude-code-driver-structured.test.mjs:172`, `spikes/claude-code-driver/test/claude-driver-structured.test.mjs:108`); mutant M1 killed. | `pnpm test:contract`, `pnpm qualify:claude` | PASS |
| SSI-55 | A subscription-only Codex session reads `account/read` before `model/list` and refuses `apiKey`, `amazonBedrock`, and no account with `VES_CODEX_AUTH_METHOD_MISMATCH` before `thread/start` (`tests/contract/codex-driver-structured.test.mjs:217`, `:232`; `spikes/codex-driver/test/codex-driver-structured.test.mjs:68`); mutant M2 killed. | `pnpm test:contract`, `pnpm qualify:codex` | PASS |
| SSI-56 | T4 share: credits on any snapshot stop the session before its turn with `VES_CODEX_CREDITS_PRESENT` (`tests/contract/codex-driver-structured.test.mjs:249`); mutant M5 killed. T6 maps it to `not configured`. | `pnpm test:contract`; T6 commit 2 | PASS (T4 share); PASS (author, T6 part: credits on the account of a Codex node suspend the run and the command is `not configured` (`codex-credits`), `tests/unit/coordinated-suspension.test.mjs:196`, journey `tests/e2e/task-subscription-e2e.test.mjs:163`; mutants S9, S14, S15 killed) |
| SSI-57 | The client sends only its allowlist, refuses every other method at the single write path, and no product source names a credit or login method (`tests/contract/codex-driver-structured.test.mjs:73`, `:92`, `:107`; `tests/architecture/codex-client-methods.test.mjs:42`, `:49`, `:60`); no fallback model, budget, key, or key helper flag is in any pinned invocation (`tests/contract/claude-code-driver-structured.test.mjs:47`); mutants M3, M4 killed. | `pnpm test:contract`, `pnpm test:architecture` | PASS |
| SSI-58 | Claude `rejected` (with and without reset), Codex `usageLimitExceeded`, a usage-limit or credits-depleted `rateLimitReachedType`, and `ordinaryUsageAllowed: false` each emit one `quota.exhausted` with a reset only when reported; `allowed_warning` is one warning; `rate_limit_reached` is none (`tests/contract/claude-code-driver-structured.test.mjs:187`, `:214`; `tests/contract/codex-driver-structured.test.mjs:283`, `:313`, `:329`); mutants M6–M9, M16 killed. | `pnpm test:contract`, `pnpm test:integration` | PASS |
| SSI-59 | A quota signal from any node starts no further node (an engine that keeps scheduling is refused), cancels and waits for every running node, and suspends the run: `tests/unit/coordinated-suspension.test.mjs:48`, `:107`; inside the executor `tests/integration/coordinated-executor.test.mjs:162`; journey `tests/e2e/task-subscription-e2e.test.mjs:116`; mutants S5, S6 killed | T6 commit 2 (see T6 Evidence) | PASS (author) |
| SSI-60 | Completed node results, receipts, the ledger, and the budget ledger persist; the worktree is kept; the writer coordination and the active marker are released; the state stays `IMPLEMENTING`: `tests/integration/coordinated-executor.test.mjs:162`, `tests/unit/task-run-coordinator.test.mjs:274`, journey `tests/e2e/task-subscription-e2e.test.mjs:116`; mutants S1, S3, S10, S11, S12 killed | T6 commit 2 (see T6 Evidence) | PASS (author) |
| SSI-61 | The record is the code of the signal, the provider, the instant, and only the reported window and reset, each in its grammar, at every layer: `tests/unit/coordinated-suspension.test.mjs:48`, `:140`, `:228`; `tests/integration/coordinated-executor.test.mjs:228`; `tests/unit/task-run-record-readers.test.mjs:170`; mutants S4, S7, S8, S13 killed (the window `scope` is kept beside the four members: spec-precision note in T6 commit 2) | T6 commit 2 (see T6 Evidence) | PASS (author) |
| SSI-62 | No code path resumes, retries, or switches anything on its own: a suspended command exits with no active process (`tests/e2e/task-subscription-e2e.test.mjs:116`), the reset time is shown and never acted on, and a resumed node runs the sealed descriptor's driver and model under the same preflight (`:230`); spec-precision note (4) of T6 commit 3 | T6 commits 2 and 3 (see T6 Evidence) | PASS (author) |
| SSI-63 | A suspended run continues only through `vestra task resume`; the suspension surface names it as the one next step and status keeps it with `cancel` (`tests/e2e/task-subscription-e2e.test.mjs:116`, `tests/integration/task-coordinated-plan.test.mjs:348`) | T6 commits 2 and 3 (see T6 Evidence) | PASS (author) |
| SSI-64 | Suspension is an executor checkpoint stage and a run outcome, never a workflow state: only `START_IMPLEMENTATION` is applied (`tests/unit/task-run-coordinator.test.mjs:274`); no file under `packages/domain/src/workflow/` changed, and the workflow machine suites pass unchanged | T6 commit 2 (see T6 Evidence) | PASS (author) |
| SSI-65 | A completed node starts no session again and its persisted result is replayed: `tests/unit/coordinated-suspension.test.mjs:362`, `:453`, `:478`; journey `tests/e2e/task-subscription-e2e.test.mjs:230` (one planner session); mutants R7, R8 killed | T6 commit 3 (see T6 Evidence) | PASS (author) |
| SSI-66 | A node with no recorded end, or one that ended without a result after an effect landed, refuses the resume with `VES_TASK_NODE_UNCERTAIN` until its uncertainty digest is typed back, at the CLI before any change and again in the driver: `tests/unit/task-resumption.test.mjs:106`, `:114`, `:130`; `tests/unit/coordinated-suspension.test.mjs:379`, `:387`, `:406`; journey `tests/e2e/task-subscription-e2e.test.mjs:281`; fault `tests/fault-injection/task-coordinated-crash-faults.test.mjs:34`; mutants R2, R5, R6, R10, R11, R13 killed | T6 commit 3 (see T6 Evidence) | PASS (author) |
| SSI-67 | A node that ended failed with no receipt and an unchanged change digest runs again on resume, recorded with `rerunOf`: `tests/unit/coordinated-suspension.test.mjs:362`, `:429`; `tests/unit/task-resumption.test.mjs:97`; journeys `tests/e2e/task-subscription-e2e.test.mjs:230`, `:368`; mutants R9, R12 killed | T6 commit 3 (see T6 Evidence) | PASS (author) |
| SSI-68 | With a controllable clock, five suspended hours are not counted: the resumed meter starts at the 2 s active before the suspension and ends at 2.5 s; tokens accumulate; usage on subscriptions stays unbilled (`tests/unit/task-run-coordinator.test.mjs:312`; `tests/e2e/task-subscription-e2e.test.mjs:230` reports `not billed (subscription)`); mutant S12 killed | T6 commits 2 and 3 (see T6 Evidence) | PASS (author) |
| SSI-69 | T7 Evidence, commit 1 row SSI-69 | gate:quick, test:integration, test:security (bridge suites) | PASS on darwin; Linux and Windows legs pending the platform matrix |
| SSI-70 | T7 Evidence, commit 1 row SSI-70 | test:integration | PASS on darwin; Windows implementation in commit 2 |
| SSI-71 | T7 Evidence, commit 2 row SSI-71 | test:unit, test:security | PASS on darwin; Windows leg of platform matrix run 37162941507 (gate:security) passed the eight real named-pipe cases |
| SSI-72 | T7 Evidence, commit 2 row SSI-72 | test:unit | PASS on darwin |
| SSI-73 | T7 Evidence, commit 2 row SSI-73 (PowerShell, logging, ACL); managed policy with SSI-74; commit 4 open question 1 (each prerequisite `not configured`, named, before the first transition) and open question 3 (the Claude Code isolation directory owner-only) | test:unit, test:contract, test:security | PASS on darwin; win32 cases pending the Windows leg |
| SSI-74 | T7 Evidence, commit 3 row SSI-74; commit 4 open question 1 (`claude-managed-policy` before the first transition) | test:contract, test:unit | PASS on darwin; win32 case pending the Windows leg |
| SSI-75 | T7 Evidence, commit 2 row SSI-75 | test:unit, test:security | PASS on darwin; Windows leg of platform matrix run 37162941507 (gate:security) passed the eight real named-pipe cases |
| SSI-76 | T7 Evidence, commit 2 row SSI-76 and its second-client deviation | test:security | PASS on darwin; Windows leg of platform matrix run 37162941507 (gate:security) passed the eight real named-pipe cases |
| SSI-77 | T7 Evidence, commit 2 row SSI-77 (refusals kept until qualified); commit 4 row SSI-77 (lifted after the Windows leg passed) | test:contract, test:integration, test:e2e | PASS on darwin; the Windows journey pending the Windows leg |
| SSI-78 | Re-derived by the independent verifier: see "Independent Verification (T9)", requirement table | T9 | PARTIAL (verifier) |
| SSI-79 | `tests/integration/strands-empty-environment.test.mjs:50` with a positive control at `:69`; mutant S6 killed by the probe alone | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-80 | T5 share: 43 mutants killed (validation.md, "T5 discrimination summary"); scope narrowing C1/C16, writer mutex C2, limits C3/C4/C8/C9/S3, destination check C5/C6/S2/S10; T6 share: 42 mutants killed (T6 Evidence, commits 1 to 3), the billing block B1–B11 and the uncertain refusal R2, R6 among them | T5 gates (see T5 Evidence); T6 gates | PASS (author) |
| SSI-81 | T4 share: events, checkpoints, payloads, and the quota refusal carry no token, session, account data, provider prose, or temporary path (`tests/security/driver-structured-results-security.test.mjs:58`, `:162`, `:173`); mutant M18 killed. T5 and T6 own their records.; T5 part: the node ledger and node results carry no token, session, prompt, repository context, or path (`tests/security/coordination-record-security.test.mjs:27`); T6 part: the extra-usage statement holds no secret and a refusal echoes none (`tests/unit/task-billing.test.mjs:117`, `tests/security/task-suspension-security.test.mjs:35`); the suspension record, the `suspended` checkpoint, the ledger with `rerunOf`, the outcome marker, and status hold no session, account data, purchase field, credential, or path (`tests/security/task-suspension-security.test.mjs:57`, `tests/unit/coordinated-suspension.test.mjs:228`, journeys `tests/e2e/task-subscription-e2e.test.mjs:116`, `:163`) | `pnpm test:security`; T5 gates; T6 gates | PASS (T4 share); PASS (author, T5 part); PASS (author, T6 part) |
| SSI-82 | `tests/build/sealed-self-containment.test.mjs:115` every sealed artifact, the adapter included, imports `node:` built-ins only; sizes, cold start, and a silent `--activation-health` recorded in T5 commits 5 and 6; the staged-layout gate suite runs on the platform matrix | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-83 | T3 part: v1 is unchanged (SSI-20, SSI-21, SSI-22 rows); a v2 request is opt-in by `schemaVersion: 2` (`packages/application/src/execution/task-request.ts` `normalizeTaskRequest`); `tests/e2e/task-cli-e2e.test.mjs:823-865` a v2 dry run plans through the binary, `:867-883` an invalid descriptor is `VES_TASK_REQUEST_REJECTED` with reason `VES_TASK_REQUEST_EXECUTION_INVALID` and nothing written; T5 part: `tests/integration/task-coordination-loading.test.mjs:40` other commands load no SDK; the v1 journeys pass unchanged (`tests/e2e/task-cli-e2e.test.mjs`, `mediated-task-execution-e2e.test.mjs`, 48/48) | `node --test tests/e2e/task-cli-e2e.test.mjs` 45/45 (tip); T5 gates | PASS (author, T3 and T5 parts) |
| SSI-84 | `docs/qualification/coordinated-run-pilots.md`: agent, graph, and swarm pilots pending (owner) on Windows, macOS, and Linux; stand-in qualification per platform recorded there | T9 commit 2 | PENDING (owner) |
| SSI-85 | T6 part: quota suspension is qualified with deterministic fakes only (the labelled fake Claude Code's `rate_limit_event` and the fake Codex's credits, under fixture flags; `tests/e2e/task-subscription-e2e.test.mjs:116`, `:163`); no allowance is touched. The pilots are T9 | T6 commits 2 and 3 | PASS (author, T6 part); T9 pending |

## Discrimination Sensor (planned)

Each mutant is applied in a scratch worktree, the named suite is run, and the
mutant must be killed (a test fails). A surviving mutant becomes a fix task.

| Mutant | Requirement | Expected killer | Result |
| --- | --- | --- | --- |
| Drop one descriptor field from the canonical request before digesting | SSI-28 | Per-field binding-digest test | Killed (T9 M01: node `instructions` left out of both package digests; `tests/unit/task-plan-binding.test.mjs` 2 of 23 fail) |
| Accept a cycle in the graph normalizer | SSI-25 | Cycle rejection case | Killed (T9 M02: Kahn's result ignored; `tests/contract/task-request-v2.test.mjs` 3 of 97 fail) |
| Let a write scope leave `task.changeScope` | SSI-26 | Scope rejection case | Killed (T9 M03: only read scopes checked; same suite 2 of 97 fail) |
| Skip node write-scope narrowing in the coordinated driver | SSI-41 | Out-of-node-scope write refused before the executor | Killed (T9 M04: unit `coordinated-driver` 1 of 23, integration `coordinated-executor` 1 of 9) |
| Remove the writer mutex | SSI-40 | Two writers never overlap (instrumented fake) | Killed (T9 M05: unit `coordinated-driver` 1 of 23, integration `strands-coordination-engine` 1 of 16) |
| Raise a default limit by one | SSI-37 | Limit boundary cases | Killed (T9 M06a `maxEdges` 129: 4 of 97; M06b `runResultBytes` + 1: 2 of 97) |
| Accept an undeclared handoff target | SSI-43 | Forbidden-destination swarm case | Killed (T9 M07, in the application validator: unit 2 of 32, integration 1 of 16) |
| Persist a result before checking its size | SSI-47 | Oversized result leaves nothing persisted | Killed (T9 M08: unit `coordinated-driver` 3 of 23) |
| Skip the `apiKeySource` check | SSI-54 | Fake init with `ANTHROPIC_API_KEY` | Killed (T9 M09: `claude-code-driver-structured` 1 of 9) |
| Skip the Codex `account/read` check | SSI-55 | Fake `apiKey` account | Killed (T9 M10: `codex-driver-structured` 1 of 14) |
| Allow `account/rateLimitResetCredit/consume` | SSI-57 | Method allowlist test | Killed (T9 M11: contract 2 of 14, architecture `codex-client-methods` 1 of 3) |
| Skip the billing confirmation at resume | SSI-52 | Resume without confirmation is `not configured` | Killed (T9 M12: integration `task-coordinated-plan` 5 of 21, e2e `task-subscription-e2e` 1 of 9, macOS) |
| Clean up the worktree on `suspended` | SSI-60 | Suspended worktree survives | Killed (T9 M13: integration `coordinated-executor` 1 of 9) |
| Re-run a partial node silently | SSI-66 | Uncertain-node refusal | Killed (T9 M14: unit `coordinated-suspension` 3 of 19) |
| Construct a Strands `Agent` in the adapter | SSI-03, SSI-79 | Architecture ban and empty-environment probe | Killed by each on its own (T9 M15a: architecture 2 of 6; M15b: probe 2 of 2, 5 Bedrock clients counted where 0 are allowed) |
| Import the SDK root entry | SSI-02 | Architecture test and sealed build | Killed by each on its own (T9 M16a: architecture 1 of 6; M16b: `tests/build/sealed-self-containment.test.mjs` 1 of 7) |

**Sensor result**: killed in full by the independent verifier at `c3223c6`
(16 of 16 rows, 19 mutant runs; method and the verifier's additional mutants
in "Independent Verification (T9)"). T4's author-run share follows.

T4 mutants, each applied to a copy of one source file in place, run against the
named killer suite, and restored; `git status --porcelain` matched the baseline
before and after the run:

| Mutant | Requirement | Killer | Result |
| --- | --- | --- | --- |
| M1 the `apiKeySource` check returns nothing | SSI-54 | `tests/contract/claude-code-driver-structured.test.mjs` | Killed |
| M2 the Codex account type check accepts any account | SSI-55 | `tests/contract/codex-driver-structured.test.mjs` | Killed |
| M3 `account/rateLimitResetCredit/consume` joins the allowlist | SSI-57 | same, and `tests/architecture/codex-client-methods.test.mjs` | Killed (3 tests) |
| M4 the frame guard admits every method | SSI-57 | `tests/contract/codex-driver-structured.test.mjs` | Killed |
| M5 reported credits are ignored | SSI-56 | same | Killed |
| M6 Claude `rejected` is not mapped | SSI-58 | `tests/contract/claude-code-driver-structured.test.mjs` | Killed |
| M7 Codex `usageLimitExceeded` is not mapped | SSI-58 | `tests/contract/codex-driver-structured.test.mjs` | Killed |
| M8 a transient `rate_limit_reached` counts as quota | SSI-58 | same | Killed |
| M9 every quota signal is reported, not the first | SSI-58 | same | Killed |
| M10 the byte bound admits one byte more | SSI-48 | `tests/unit/driver-event.test.mjs:143` (multi-byte case); with the length pre-check also raised, `tests/contract/claude-code-driver-structured.test.mjs:119` and `tests/contract/codex-driver-structured.test.mjs:157` | Killed |
| M11 the adapter hands on no payload reference | SSI-48 | `tests/integration/driver-execution-adapter.test.mjs` | Killed |
| M12 exhausted retries become a plain failure | SSI-46 | `tests/contract/claude-code-driver-structured.test.mjs` | Killed |
| M13 a success without an answer is accepted | SSI-46 | Claude and Codex structured contract suites | Killed |
| M14 the structured floor is skipped | floor decision | `tests/contract/codex-driver-structured.test.mjs` | Killed |
| M15 `StructuredOutput` is allowed without a schema | SSI-57 | `tests/contract/claude-code-driver-structured.test.mjs` | Killed |
| M16 the adapter swallows the quota signal | SSI-58, SSI-59 seam | `tests/integration/driver-execution-adapter.test.mjs` | Killed |
| M17 Codex sends no `outputSchema` | SSI-48 | `tests/contract/codex-driver-structured.test.mjs` | Killed (2 tests) |
| M18 a quota scope carries the provider's overage reason | SSI-81 | `tests/contract/claude-code-driver-structured.test.mjs` | Killed |

## Deleted Case → Replacement

Every test deleted by T3–T8 is listed here with the test at the deepened
interface that covers the same case.

- T5: `tests/integration/task-coordinated-plan.test.mjs` "start / resume /
  review refuses a v2 run as not configured (`coordinated-run`)" (T3's interim
  refusal, three cases) → `:99` (API-key providers refused, four cases), `:110`
  (subscription runs composed, two cases), and the v2 review journeys
  `tests/e2e/task-coordinated-e2e.test.mjs:164`, `:189`.
- T5: the text-scan assertion inside `tests/build/sealed-launcher-closure.test.mjs:462`
  → the same case's metafile assertion, and `tests/build/sealed-self-containment.test.mjs:73`,
  `:92`, `:137`.

- T6: `tests/unit/coordinated-driver.test.mjs` "a quota signal from one node
  starts no further node and cancels the nodes still running" (T5's SSI-59
  seam, which expected the run to fail with the quota code) →
  `tests/unit/coordinated-suspension.test.mjs:48`, the same scenario and
  assertions with the run suspended.

- T7: `tests/unit/windows-acl.test.mjs` "the grant removes inheritance and
  gives the SID alone inheritable full control" (the grant arguments) →
  "the DACL is replaced whole from a BOM-less UTF-16LE file beside the
  directory" (`:113`), which pins the arguments and file that replaced the
  grant; the grant itself is now the refused case "the hosted runner's grant
  leaves SYSTEM and Administrators beside the owner, so that path is refused"
  (`:197`).
- T7 commit 4: `tests/contract/claude-code-driver-mediated.test.mjs` "the
  mediated profile refuses Windows before anything is spawned" and
  `tests/contract/claude-code-driver-subscription.test.mjs` "the subscription
  profile refuses Windows before anything is spawned" (the lifted refusal) →
  `tests/contract/claude-code-driver-windows.test.mjs:48`, which constructs
  both kinds on every platform and, on Windows, refuses each without an
  owner-only proof.

## Independent Verification (T9)

**Verifier**: an independent agent session that wrote none of T1–T8 (author ≠
verifier). **Date**: 2026-10-04. **Head**: `c3223c6` on
`strands/t9-verification`, equal to `origin/main`. **Diff range**:
`7e274f2..c3223c6` (49 commits, 223 files; the range also carries #18, #406,
and other commits outside this feature, read only where they touch it).

**Method.** The pinned `code-review` skill against this `.specs` path and the
diff base, its Standards and Spec axes run as separate read-only reviews; and
the `tlc-spec-driven` validate procedure: every SSI row re-derived from the
code and tests at this head, with the T3–T8 evidence above treated as claims;
the cited tests run; the planned discrimination list executed (each mutant
applied in place, its killer suites run through `scripts/test-scope.mjs`, then
`git restore`, with `git status --porcelain` empty before and after every
mutant); the threat model checked against the code; the platform matrix read
job by job, logs included. Nothing outside this file, `tasks.md`, and the pilot
record was changed. No real provider was called; no gate beyond `gate:quick`
ran locally (disk), the full, build, and security gates ran on the matrix.

**Result**: FAIL. The ranked findings follow; each is a fix task for an
implementer, then a fresh verification.

### Findings, ranked

Each finding names its evidence at `c3223c6` and the change that would fix it.

1. **FAIL — D3b and the no-paid-path goal: the Codex verifier of a v2 run is
   never checked for credits.** `subscriptionOnly` is set only for Codex
   *nodes* (`apps/vestra-cli/src/task/task-coordination.ts:213`); the
   verifier's `resolveExecution` carries none
   (`apps/vestra-cli/src/task/task-codex.ts:236`), and the driver reads the
   account and its rate limits only when it is set
   (`packages/drivers/src/codex-driver.ts:388`). So an `agent` run, or any run
   whose only Codex session is the verifier (the shipped
   `docs/examples/task-request-agent.json`), never reads
   `account/rateLimits/read`: credits on the account are never seen (D3b
   "block the run as `not configured`"), and a verifier usage limit fails the
   run instead of suspending it (by reading: `task-codex.ts` has no quota
   handling). SSI-55 and SSI-56 name node sessions, so
   their letter holds for nodes; the binding decision D3b does not. Fix: run
   the v2 verifier with `subscriptionOnly: true` (the 0.159.3 floor then
   applies to it), report its credits as `codex-credits` and its quota as a
   suspension, and add an agent-mode journey with the fake's `codex-credits`
   flag.
2. **FAIL — SSI-52 (and D3's re-confirmation on a plan change): the plan type
   is never compared with the account.** The statement's `planType` is checked
   for shape only (`apps/vestra-cli/src/task/task-billing.ts:93`); the Codex
   driver reads only the account's `type` and keeps nothing else
   (`packages/drivers/src/codex-driver.ts:370-372`). A statement naming another
   plan type passes. AD-079 item 1 and `docs/quick-start.md` record this as a
   choice; the spec was not amended. Fix: have the account check report the
   plan type as a closed value and refuse a mismatch, or have the owner amend
   SSI-52 and D3.
3. **FAIL — SSI-46 (spec edge case) and SSI-47 (code): structured-output
   failures of real drivers end the node with `VES_COORDINATION_NODE_FAILED`.**
   A Claude Code `success` without `structured_output`,
   `error_max_structured_output_retries`, an unreadable Codex answer, or an
   answer over the node bound is a driver error event; the session outcome is
   `failed`, the node adapters return `{ status: "failed" }`
   (`packages/agent-runtime/src/execution/driver-execution-adapter.ts:147`,
   `apps/vestra-cli/src/task/task-coordination.ts:265`), and the coordinated
   driver maps every non-completed status to `VES_COORDINATION_NODE_FAILED`
   (`packages/application/src/execution/coordinated-driver.ts:458`). The
   spec's edge case requires `VES_COORDINATION_RESULT_INVALID`, and SSI-47
   requires `VES_COORDINATION_RESULT_TOO_LARGE` for a per-node oversize. The
   unit cases (`tests/unit/coordinated-driver.test.mjs:187`, `:208`) use fakes
   that hand bytes past the drivers, so no test sees this path. Nothing is
   persisted in either case, so the "refused before persisted" half holds
   (mutants M08 and X01 killed). Fix: map the drivers'
   `*_STRUCTURED_OUTPUT_MISSING` and `_INVALID` codes to
   `VES_COORDINATION_RESULT_INVALID` and `_LIMIT` to
   `VES_COORDINATION_RESULT_TOO_LARGE` in both node adapters, and drive the
   fake Claude Code's missing, retries, and oversized scenarios through the
   coordinated driver.
4. **FAIL — SSI-42: no test shows a node's read tools confined to its read
   scope.** The wiring exists
   (`apps/vestra-cli/src/task/task-coordination.ts:106` →
   `packages/agent-runtime/src/execution/driver-execution-adapter.ts:164`), but
   mutant X04, which hands every Claude Code node the task's whole change scope
   instead, survived the whole unit scope (2957), the coordinated plan and
   loading integration suites, and both coordinated journeys: every fixture's
   node read scope equals the task scope. The cited
   `tests/integration/mcp-tool-bridge.test.mjs:32` is the generic bridge test.
   Codex reader nodes read through Codex's own sandbox (`sandbox: "read-only"`,
   `approvalPolicy: "untrusted"`, `packages/drivers/src/codex-driver.ts:465-466`)
   with the worktree as working directory; their read scope is a prompt line
   only (`packages/application/src/execution/node-prompt.ts:28`). That is
   outside SSI-42's "through the bridge", but it leaves TM-004's read-scope
   mitigation unenforced for Codex. Fix: a node-level case whose read scope is
   narrower than the change scope and a bridge read outside it refused with
   `VES_BRIDGE_SCOPE_DENIED`; then confine Codex readers to their read scope or
   record the unconfined read as an accepted risk in the spec and threat model.
5. **FAIL — SSI-49 (results), PARTIAL SSI-81: a persisted node result is the
   model's text, unscreened.** A result is bounded and schema-checked, then
   saved as it came (`packages/application/src/execution/coordinated-driver.ts:505-507`).
   `tests/unit/coordinated-driver.test.mjs:441` feeds a summary holding a
   token-shaped string and a home-directory path and asserts only that the
   *ledger* lacks them; `tests/security/coordination-record-security.test.mjs:27` asserts
   the results lack a token and paths that its fake nodes never write, so it
   cannot fail for model-authored content. A result also feeds later nodes'
   prompts. With finding 4, a prompt-injected Codex reader could read a local
   file beyond its scope and carry it into a persisted result (by reading the
   code; not exercised). No security-scope test covers the `SUSPENDED` outcome
   marker, the v2 `status` output, or the v2 plan record and surface (the
   macOS-only journey `tests/e2e/task-subscription-e2e.test.mjs:116` checks some
   of them). Fix: refuse a result holding any of the run's sensitive values or
   machine-local roots before it is persisted (`VES_COORDINATION_RESULT_INVALID`),
   add security cases for each new record, or have the owner narrow SSI-49 and
   SSI-81 to what Verchestra itself writes.
6. **FAIL — SSI-29, the clause "proven against the approved package digest".**
   `start` and `resume` take only a run ID (`tests/contract/cli-surface.test.mjs:167`,
   `:175`) and run the request sealed in the plan record, but that request is
   proven only against the plan record's own digest
   (`apps/vestra-cli/src/task/task-run-record.ts:144`) inside an unkeyed
   self-digest seal (`apps/vestra-cli/src/task/task-files.ts:77`). The
   package's `executionContractDigest` is written
   (`apps/vestra-cli/src/task/task-plan.ts:100`) and read nowhere. A consistent
   rewrite of `plan.json` would run another descriptor under the old approval.
   This is pre-existing for v1, and same-user tampering is outside the threat
   model (D7, TM-010), but the requirement names the proof. Fix: in `runTask`,
   load `approvedPackage(plan)` and require its `executionContractDigest` to
   equal `plan.requestDigest`; test a consistent rewrite.
7. **PARTIAL — SSI-07, swarm nodes.** A swarm structural agent hands the SDK
   `{ agentId, message }` as `structuredOutput`
   (`packages/agent-runtime/src/coordination/strands/structural-agent.ts:32`,
   `:45`); `message` is the provider-written handoff text, which the SDK keeps
   as text blocks. `design.md` both prescribes this mapping and says "no
   provider text". The return shape of a swarm node is not tested
   (`tests/integration/strands-coordination-engine.test.mjs:245` covers a graph
   node). Fix: hand the SDK the result token as `message`; the coordinated
   driver already holds the real message.
8. **PARTIAL — SSI-58's edge case: `allowed_warning` is not recorded by the
   run.** The driver emits one `warning`
   (`tests/contract/claude-code-driver-structured.test.mjs:214`), but the node
   adapters drop it (`packages/agent-runtime/src/execution/driver-execution-adapter.ts:238`;
   `observeCodex`, `apps/vestra-cli/src/task/task-coordination.ts:134`), so no
   Run record holds it. Fix: record the warning code in the node's
   `driver-finished` checkpoint or the ledger, with a test.
9. **PARTIAL — SSI-61 "only".** The suspension record also carries the
   provider's limit window `scope`
   (`packages/application/src/execution/task-executor.ts:61`), recorded as a
   spec-precision note in T6 and in AD-079 item 2; `spec.md` and
   `design.md:345` were not amended. Fix: owner amends SSI-61, or drop it.
10. **PARTIAL — SSI-73.** The managed-policy prerequisite is checked only for
    the subscription profile (`apps/vestra-cli/src/task/task-windows.ts:51`;
    `tests/unit/task-windows.test.mjs:139` asserts "the subscription profile
    only"), while SSI-73 is unconditional. The prerequisites run before the
    active claim, the writer lease, any transition, and the worktree
    (`apps/vestra-cli/src/task/task-run.ts:202` against `:752`), after the
    credential read (`:190`); no test pins that order, and no darwin mutant can
    (the check is a no-op off Windows). Fix: amend the spec or extend the check
    to the API-key profile, and pin the order with an injected host.
11. **PARTIAL — SSI-78, SSI-84's stand-in share, and the spec's Success
    Criteria: the coordinated journeys run on macOS only, and pass silently
    elsewhere.** `tests/e2e/task-coordinated-e2e.test.mjs:33`, `:61`, `:110`,
    `:121` return without a diagnostic off macOS; `task-subscription-e2e` and
    the crash fault return with one. On the matrix the Linux and Windows legs
    "pass" the agent, graph, swarm, cancel, credits, resume, and crash journeys
    in under 4 ms each, against 3–19 s on macOS (job logs below). The success
    criterion "each mode runs from a plan to `HUMAN_REVIEW` with fakes on macOS
    and Linux, and on Windows after T7" is not met. Separately, the Codex
    protocol spike passes by diagnostic on the fleet, which installs Codex
    0.115.0 (`.github/workflows/platform-matrix.yml:194`), so the 0.159.3
    protocol evidence is the author's local run only
    (`spikes/codex-driver/test/codex-driver-structured.test.mjs:147-151` has no
    pin guard). Fix: give the journeys an asserting branch or `t.skip` off
    macOS and enable them on Linux and Windows; pin the fleet's Codex at the
    floor or record the limit.
12. **PARTIAL — SSI-80.** Every named check has a killer (planned list and
    X01–X03, X09) except read-scope narrowing (X04 survived) and the billing
    block for the verifier, which does not exist (finding 1).
13. **PARTIAL — SSI-83.** v1 behaviour changes outside SSI-77: the
    verification scratch layout moves and a `state-path-length` refusal runs
    before every `start` and `resume` on every platform (AD-080 item 5, status
    proposed). The T5 claim that the v1 journeys pass "with no edit" no longer
    holds at this head: `tests/e2e/task-cli-e2e.test.mjs` and
    `mediated-task-execution-e2e.test.mjs` gained v2 cases (`1b8b81d`,
    `7507143`) and were edited for the Windows path and the new layout
    (`9a776e0`, `702b344`). Fix: owner approval of AD-080 item 5 recorded before merge.
14. **PARTIAL — SSI-17.** Each node keeps its passport and driver, but a usage
    event carries only `model` (`packages/application/src/execution/budget-meter.ts:33-37`),
    not the provider; "Strands is never a provider" rests on reading, with no
    negative test. Fix: narrow the spec wording, or add the provider to node
    usage and a test.
15. **AD-079 (the expired-grant renewal on resume): bounded in code as claimed,
    but its bounds are untested.** The code renews only when `revalidate()`
    armed it (`apps/vestra-cli/src/task/task-run.ts:371`, only on `resume`,
    only when the latest executor checkpoint is `suspended`, after the approval
    was verified against the policy in force and the worktree digest matched),
    only a grant that exists, is not revoked, and has expired (`:353`), and the
    new grant ends at the earlier of the approval's expiry and the run's
    duration plus the margin (`:343-345`). Mutant X06 (renew a revoked grant)
    and X07 (arm renewal on every resume) both survived the unit scope, the
    coordinated plan suite, and the subscription and v1 journeys. A grant close
    to expiry is reused, not renewed, and can lapse mid-run (by reading). Fix:
    tests for a revoked grant, a non-suspended resume, and the lifetime cap;
    renew when the grant's remaining life is shorter than the run's remaining
    duration; record the replaced grant.
16. **PENDING — SSI-84.** No coordinated run with real subscriptions has been
    recorded on any platform; see "Coordinated-run pilots" and
    `docs/qualification/coordinated-run-pilots.md`.
17. **Documentation and standards (Standards axis).** `docs/quick-start.md:355-356`
    says "On Windows the task path, coordinated runs included, runs with
    stand-ins on the hosted Windows runner": no coordinated journey executes on
    Windows (finding 11). `spec.md:102-103` quotes the owner in Portuguese
    (English-only rule). Six comments added or moved in the range lack the
    `why:`/`hazard:`/`invariant:` prefix (`apps/vestra-cli/src/task/task-windows.ts:38`,
    `packages/application/src/execution/gate-repair.ts:79`,
    `packages/agent-runtime/src/execution/bridge-transport.ts:30`,
    `packages/platform-node/src/windows-pipe-transport.ts:391`,
    `scripts/t76-build-candidate.mjs:318`, `:398`). `handoff.md`
    (`lastCompletedTask: T1`), `spec.md:127`, `design.md:5`, and the
    traceability table still read as before T3 (T10 owns them). D1's
    transitive packages were accepted by delegation, not by the owner
    (`spec.md:111`): the owner should confirm D1 before merge. Judgement-call
    smells: `isWriter` in `coordinated-driver.ts:123` repeats the exported
    `isWriterNode`; the Codex node driver repeats the verifier's construction,
    and the copies already differ (finding 1).

### Requirement evidence (verifier)

Runs (darwin arm64, Node 24.14.0, at `c3223c6`): **Q** `pnpm gate:quick` PASS
(unit 2957/2957, agent-readiness 357/357, census 13/13); **A**
`pnpm test:architecture` 132/132; **C** the twelve contract files this table
cites, 306/306; **I** the nine integration files, 82/82; **S** the six security
files, 44/44; **B** `tests/build/sealed-self-containment.test.mjs` 7/7; **F**
`tests/fault-injection/task-coordinated-crash-faults.test.mjs` 1/1; **E** the
six e2e files (coordinated, subscription, examples, Windows, mediated, task
CLI), 65/65; every run through `scripts/test-scope.mjs`, 0 failed, 0 skipped, 0
todo, no temporary entry left. **M** the platform matrix at this head (below).
"macOS only" marks an assertion that returns before it runs on Linux and
Windows.

| ID | Verdict | Evidence (`file:line` — what it asserts) | Run | Note |
| --- | --- | --- | --- | --- |
| SSI-01 | PASS | `tests/agent-readiness/dependency-policy.test.mjs:51` exact pins in agent-runtime only; `:73` the lockfile resolves each pin exactly; `:96` installed SDK 1.19.0 with exactly its required peers | Q | — |
| SSI-02 | PASS | `tests/architecture/strands-coordination-subpath.test.mjs:69` no import but `@strands-agents/sdk/multiagent`, in every form; M16a and M16b killed | A, B | — |
| SSI-03 | PASS | `tests/architecture/strands-coordination-subpath.test.mjs:87` bans; `tests/integration/strands-empty-environment.test.mjs:50` zero Bedrock clients, positive control `:69`; M15a and M15b killed, each on its own | A, I | — |
| SSI-04 | PASS | `tests/integration/strands-coordination-engine.test.mjs:245` a structural agent is exactly `id`, `invoke`, `stream` and calls the runner; `:53`, `:126` Graph and Swarm of structural agents | I | — |
| SSI-05 | PASS | `structural-agent.ts` never sets `preserveContext`; `tests/integration/strands-coordination-engine.test.mjs:295` it reads `false` (swarm nodes only); resume replays the ledger, `:215` | I | Graph nodes not asserted |
| SSI-06 | PASS | `tests/integration/strands-coordination-engine.test.mjs:245` the SDK's input is ignored; `tests/unit/node-result.test.mjs:103` the prompt is built from the approved node, declared inputs, and handoff | I, Q | The prompt also carries the approved repository context and gate feedback (`node-prompt.ts:74-75`), which the spec does not list: spec-precision note |
| SSI-07 | PARTIAL | `tests/integration/strands-coordination-engine.test.mjs:245` one text block naming the payload reference (graph node) | I | Finding 7 |
| SSI-08 | PASS | `tests/integration/strands-coordination-engine.test.mjs:269` the error's message is the code and it has no cause; `:101` the SDK's log line names node and code only | I | — |
| SSI-09 | PASS | `tests/integration/strands-coordination-engine.test.mjs:295` exact finite `maxConcurrency`, `maxSteps`, `timeout`, `nodeTimeout`; `:67` concurrency held | I | — |
| SSI-10 | PASS | `tests/integration/strands-coordination-engine.test.mjs:320` `INTERRUPTED`, an unasked `CANCELLED`, and unknown codes become coordination failures; `:150` the swarm's step-limit throw | I | The "max steps" and "wall-clock budget" throw branches (`strands-engine.ts:89-90`) are untested |
| SSI-11 | PASS | `tests/contract/task-request-v2.test.mjs:55-59` the v2 schema names no SDK or schema library; the application's third-party import ban holds over the coordination modules | C, A | — |
| SSI-12 | PASS | `tests/architecture/strands-coordination-subpath.test.mjs:69`, `:110` placement and the two package entries | A | — |
| SSI-13 | PASS | `tests/architecture/strands-coordination-subpath.test.mjs:110` the main entry's closure reaches no adapter, SDK, or Zod; `tests/integration/task-coordination-loading.test.mjs:40`, `:46` nothing loaded, positive control `:52` | A, I | — |
| SSI-14 | PASS | `tests/architecture/strands-coordination-subpath.test.mjs:143` one literal dynamic import; `tests/integration/task-coordination-loading.test.mjs:52` | A, I | The node driver factory runs only in macOS-only journeys |
| SSI-15 | PASS | `tests/integration/coordinated-executor.test.mjs:65` inside one real executor: a write outside the node scope refused before it, a protected path refused by it, 330 tokens metered once, one authority start; M04 killed | I | The grant-check refusal is not exercised |
| SSI-16 | PASS | `git diff 7e274f2 c3223c6 -- packages/application/src/execution/task-scheduler.ts` is empty; one `execute` per run (`coordinated-executor.test.mjs:65`) | I | — |
| SSI-17 | PARTIAL | Per-node passports in `tests/integration/task-coordinated-plan.test.mjs:271`; `tests/e2e/task-coordinated-e2e.test.mjs:57` each session by its own passport and login (macOS only) | I, E | Finding 14 |
| SSI-18 | PASS | `tests/contract/task-request-v2.test.mjs:482` a Codex write scope is refused; `tests/unit/coordinated-driver.test.mjs:141` a reader's write is refused before the executor; `tests/e2e/task-coordinated-e2e.test.mjs:57` read-only sandbox, no tool (macOS only) | C, Q, E | — |
| SSI-19 | PASS | `tests/e2e/task-coordinated-e2e.test.mjs:57` the verifier's prompt holds no node result (macOS only); the verifier's code changed only in the implementer's name | E | — |
| SSI-20 | PASS | `git diff 7e274f2 c3223c6 -- schemas/task-request/1.schema.json` is empty; `tests/contract/task-request-v1-golden.test.mjs:24` schema bytes, `:31` generated v1 output unchanged | C | — |
| SSI-21 | PASS | `tests/contract/task-request-v1-golden.test.mjs:42` normalized form and contract digest; `:71` package, binding, and surface digests | C | Goldens recorded by the authors on `dc35c52` (docs-only over the base); not re-recorded |
| SSI-22 | PASS | `tests/contract/task-request-v1-golden.test.mjs:61` a v1 plan record's bytes and load; `tests/integration/task-coordinated-plan.test.mjs:65`, `:77`, `:84` | C, I | — |
| SSI-23 | PASS | `tests/contract/task-request-v2.test.mjs:162` the whole descriptor with every limit at its default | C | — |
| SSI-24 | PASS | `tests/contract/task-request-v2.test.mjs:256-291` 26 members refused by schema and normalizer with `VES_TASK_REQUEST_INVALID` | C | — |
| SSI-25 | PASS | `tests/contract/task-request-v2.test.mjs:463-470` with `VES_TASK_REQUEST_EXECUTION_INVALID`; `tests/e2e/task-cli-e2e.test.mjs:867` nothing written; M02 killed | C, E | An edge with an unknown `from` is untested |
| SSI-26 | PASS | `tests/contract/task-request-v2.test.mjs:471-502`; M03 killed | C | — |
| SSI-27 | PASS | `tests/contract/task-request-v2.test.mjs:504-512`, `:417` | C | — |
| SSI-28 | PASS | `tests/unit/task-plan-binding.test.mjs:35-72` a new binding digest per element (19), `:74` all distinct; M01 killed | Q | — |
| SSI-29 | FAIL | Run ID only (`tests/contract/cli-surface.test.mjs:167`, `:175`); sealed request, tamper refused (`tests/integration/task-coordinated-plan.test.mjs:84`) | C, I | Finding 6 |
| SSI-30 | PASS | `tests/unit/task-coordination-surface.test.mjs:22-60`; `tests/unit/task-billing.test.mjs:212`, `:236`; `tests/unit/task-plan-binding.test.mjs:114`; `tests/e2e/task-cli-e2e.test.mjs:823` through the binary | Q, E | — |
| SSI-31 | PASS | `tests/contract/cli-surface.test.mjs:72` the command list, `:175` `--reconcile` an option of `task resume` | C | v2 journeys macOS only |
| SSI-32 | PASS | `tests/integration/task-coordinated-plan.test.mjs:271` state, visits, result digest, suspension with reset, uncertain node; `:333`; `tests/e2e/task-subscription-e2e.test.mjs:116`, `:281` (macOS only) | I, E | A visit count above 1 is not asserted |
| SSI-33 | PASS | `tests/unit/task-resumption.test.mjs:70`, `:82`, `:92`; `tests/integration/task-coordinated-plan.test.mjs:136` a refused resume leaves the run as it was; M12 killed | Q, I, E | A changed Workspace policy is tested through a stand-in |
| SSI-34 | PASS | `tests/e2e/task-coordinated-e2e.test.mjs:120` the hung node's process ends and the run is `ABORTED` (macOS only); `tests/integration/strands-coordination-engine.test.mjs:184` every running node cancelled | E, I | Several live process trees at once are untested |
| SSI-35 | PASS | `task-review.ts` changed only in its model selection; `tests/e2e/task-coordinated-e2e.test.mjs:32`, `:57` the typed-back surface digest (macOS only) | E | — |
| SSI-36 | PASS | `tests/e2e/task-request-examples-e2e.test.mjs:62` each example planned with `--dry-run`; ran on all five platforms (matrix logs) | E, M | — |
| SSI-37 | PASS | `tests/contract/task-request-v2.test.mjs:162` the seven defaults, `:198-207` below, at, and above; M06a and M06b killed | C | — |
| SSI-38 | PASS | `tests/contract/task-request-v2.test.mjs:198-216`, `:233-254` at and beyond each ceiling; `tests/unit/task-plan-binding.test.mjs:55-63` a raise is bound | C, Q | — |
| SSI-39 | PASS | `tests/integration/coordinated-executor.test.mjs:65` one meter for all nodes; `tests/unit/task-run-coordinator.test.mjs:312` across a resume | I, Q | No test of a token or time limit stopping later nodes |
| SSI-40 | PASS | `tests/unit/coordinated-driver.test.mjs:122`; `tests/integration/strands-coordination-engine.test.mjs:163`; M05 killed | Q, I | — |
| SSI-41 | PASS | `tests/unit/coordinated-driver.test.mjs:141`; `tests/integration/coordinated-executor.test.mjs:65`; M04 killed | Q, I | — |
| SSI-42 | FAIL | No node-level evidence; X04 survived | Q, I, E | Finding 4 |
| SSI-43 | PASS | `tests/unit/node-result.test.mjs:32` the enum is the declared targets and `<complete>`; `tests/contract/strands-node-result-parity.test.mjs:31`, `:67`; M07 killed | Q, C | — |
| SSI-44 | PASS | `tests/unit/node-result.test.mjs:56`, `:89`; `tests/unit/coordinated-driver.test.mjs:248`, `:256`; `tests/integration/strands-coordination-engine.test.mjs:141` | Q, I | Malformed and missing decisions are tested at the validator only |
| SSI-45 | PASS | `tests/unit/coordinated-driver.test.mjs:269`; `tests/integration/strands-coordination-engine.test.mjs:150`; X03 killed | Q, I | — |
| SSI-46 | FAIL | `tests/unit/node-result.test.mjs:56`, `tests/unit/coordinated-driver.test.mjs:208` (fakes) | Q | Finding 3 |
| SSI-47 | FAIL | `tests/unit/node-result.test.mjs:96`, `tests/unit/coordinated-driver.test.mjs:187` refused before persistence; M08, X01 killed | Q | Finding 3 (the code) |
| SSI-48 | PASS | `tests/integration/driver-execution-adapter.test.mjs:307` one `payload:sha256:` reference to the canonical bytes | I | — |
| SSI-49 | FAIL | Ledger: `tests/security/coordination-record-security.test.mjs:27`, `tests/unit/coordinated-driver.test.mjs:441` (holds) | S, Q | Finding 5 (results) |
| SSI-50 | PASS | `tests/unit/node-result.test.mjs:103` earlier results, handoff, and context delimited as untrusted after the rules | Q | The delimiters are fixed text a result can repeat (`node-prompt.ts:47`); the prompt's own rule still names everything below it data |
| SSI-51 | PASS | `tests/unit/task-billing.test.mjs:164`; `tests/integration/task-coordinated-plan.test.mjs:112-124` start and resume refuse and leave state, files, and marker; `tests/e2e/task-subscription-e2e.test.mjs:76` (macOS only) | Q, I, E | — |
| SSI-52 | FAIL | `tests/unit/task-billing.test.mjs:75-111` 19 refusals; `tests/integration/task-coordinated-plan.test.mjs:136` | Q, I | Finding 2 |
| SSI-53 | PASS | `tests/unit/task-billing.test.mjs:117` token, account ID, e-mail, name, path, and key members refused at both levels; `tests/security/task-suspension-security.test.mjs:35` | Q, S | `planType`'s grammar (`task-billing.ts:47`) cannot tell a plan from a personal name |
| SSI-54 | PASS | `tests/contract/claude-code-driver-structured.test.mjs:172` before `session.started` and any effect; M09 killed | C | The live value is unobserved (owner probe pending) |
| SSI-55 | PASS | `tests/contract/codex-driver-structured.test.mjs:217`, `:232`; M10 killed | C | Node sessions only: finding 1 |
| SSI-56 | PARTIAL | `tests/contract/codex-driver-structured.test.mjs:249`; `tests/unit/coordinated-suspension.test.mjs:196`; `tests/e2e/task-subscription-e2e.test.mjs:163` (macOS only) | C, Q, E | Finding 1 |
| SSI-57 | PASS | `tests/contract/codex-driver-structured.test.mjs:73`, `:92`, `:107`; `tests/architecture/codex-client-methods.test.mjs:42`, `:49`, `:60`; M11 killed | C, A | — |
| SSI-58 | PARTIAL | `tests/contract/claude-code-driver-structured.test.mjs:187`, `:214`; `tests/contract/codex-driver-structured.test.mjs:283`, `:313`, `:329` | C | Finding 8 |
| SSI-59 | PASS | `tests/unit/coordinated-suspension.test.mjs:48`, `:107`, `:140`; `tests/integration/coordinated-executor.test.mjs:162` | Q, I | — |
| SSI-60 | PASS | `tests/integration/coordinated-executor.test.mjs:162` worktree kept, coordination released; `tests/unit/task-run-coordinator.test.mjs:274`; M13 killed | I, Q | The active-claim release is asserted on macOS only |
| SSI-61 | PARTIAL | `tests/unit/coordinated-suspension.test.mjs:228`; `tests/security/task-suspension-security.test.mjs:57`; `tests/unit/task-run-record-readers.test.mjs:194` | Q, S | Finding 9 |
| SSI-62 | PASS | No code path reads `resetsAt` to act, switches a provider, or retries (read across `task-run.ts`, `coordinated-driver.ts`, `task-resumption.ts`); `tests/e2e/task-subscription-e2e.test.mjs:116` no active process after a suspension (macOS only) | E | Absence of behaviour, by reading |
| SSI-63 | PASS | `tests/e2e/task-subscription-e2e.test.mjs:116` the next action is `vestra task resume`; `task-command.ts` is the only caller of a resume | E | — |
| SSI-64 | PASS | `git diff 7e274f2 c3223c6 -- packages/domain/src/workflow/` is empty; `tests/unit/task-run-coordinator.test.mjs:274` only `START_IMPLEMENTATION` applied | Q | — |
| SSI-65 | PASS | `tests/unit/coordinated-suspension.test.mjs:362`, `:478` | Q | — |
| SSI-66 | PASS | `tests/unit/task-resumption.test.mjs:106`, `:114`, `:130`; `tests/unit/coordinated-suspension.test.mjs:379`, `:387`, `:406`; `tests/fault-injection/task-coordinated-crash-faults.test.mjs:34` (macOS only); M14 killed | Q, F | One `--reconcile` per resume, as D4 allows |
| SSI-67 | PASS | `tests/unit/coordinated-suspension.test.mjs:362` re-run recorded with `rerunOf`; `tests/unit/task-resumption.test.mjs:97` | Q | — |
| SSI-68 | PASS | `tests/unit/task-run-coordinator.test.mjs:312` five suspended hours uncounted, usage not billed | Q | — |
| SSI-69 | PASS | Every Unix assertion of the pre-existing bridge suites is unchanged (only win32 branches moved); `tests/integration/bridge-transport-seam.test.mjs:195`; Linux and macOS legs green | I, M | — |
| SSI-70 | PASS | `tests/integration/bridge-transport-seam.test.mjs:72-193` the controller over an in-memory transport | I | — |
| SSI-71 | PASS | `tests/unit/windows-pipe-transport.test.mjs:34`, `:106`, `:121`, `:258`; the nine win32 named-pipe security cases passed on the Windows security leg (log); X08 killed | Q, M | No test opens the pipe as another user (the story's independent test) |
| SSI-72 | PASS | `tests/unit/windows-pipe-transport.test.mjs:71` pinned script digest, `:48-69` names refused, `:121` argument vector | Q | — |
| SSI-73 | PARTIAL | `tests/unit/task-windows.test.mjs:94-190`; `tests/unit/windows-acl.test.mjs:133-262`; win32: `tests/security/windows-pipe-bridge-security.test.mjs:167`, `:269`, `tests/unit/task-windows.test.mjs:212` passed (log) | Q, M | Finding 10 |
| SSI-74 | PASS | `tests/contract/claude-code-driver-managed-policy.test.mjs:60`, `:76-107`; `tests/unit/windows-registry.test.mjs:70` passed on win32 (log) | C, M | `reg` exit 1 also means access denied |
| SSI-75 | PASS | `tests/unit/windows-pipe-transport.test.mjs:310`; win32 `tests/security/windows-pipe-bridge-security.test.mjs:269` passed (log) | Q, M | No live Claude Code tree is ended on Windows in a test |
| SSI-76 | PASS | `tests/security/windows-pipe-bridge-security.test.mjs:90-119` every platform; win32 `:194`, `:204`, `:217`, `:233` passed (log) | S, M | The second client is refused by the kernel (`ERROR_PIPE_BUSY`), a recorded deviation |
| SSI-77 | PASS | Lifted in `9a776e0` after run 37162941507 qualified the transport; at this head the Windows full, build, and security legs pass, the win32 journey (`tests/e2e/task-windows-e2e.test.mjs:139`) and the mediated session over the pipe (`tests/contract/claude-code-driver-windows.test.mjs:239`) included | M | Every Windows run between the lift and this head failed something; this head is the first fully green one |
| SSI-78 | PARTIAL | Fakes and fixtures only in the coordinated suites; owner probes outside the suites | E, M | Finding 11 |
| SSI-79 | PASS | `tests/integration/strands-empty-environment.test.mjs:50` (empty environment, no Bedrock client, network, DNS, process, or credential read), control `:69`; M15b killed | I | Only the Bedrock counter has a positive control |
| SSI-80 | PARTIAL | Planned list killed; X01–X03, X09 killed | — | Finding 12 |
| SSI-81 | PARTIAL | `tests/security/coordination-record-security.test.mjs:27`, `tests/security/task-suspension-security.test.mjs:35`, `:57`, `tests/security/driver-structured-results-security.test.mjs:58`, `:162`, `:173` | S | Finding 5 |
| SSI-82 | PASS | `tests/build/sealed-self-containment.test.mjs:115` every sealed artifact imports `node:` only (here and on every build leg); the sealed `vestra task` and activation-health cases of `tests/build/sealed-launcher-closure.test.mjs` pass on the matrix (`test:build` 179/179) | B, M | No assertion that the adapter is inside the closure |
| SSI-83 | PARTIAL | `tests/contract/task-request-v1-golden.test.mjs`; `tests/integration/task-coordination-loading.test.mjs:40`, `:46` | C, I | Finding 13 |
| SSI-84 | PENDING | `docs/qualification/coordinated-run-pilots.md` records every platform and mode as pending (owner) | M | Finding 16 |
| SSI-85 | PASS | Quota suspension qualified with the labelled fakes only (`tests/integration/coordinated-executor.test.mjs:162`; `tests/e2e/task-subscription-e2e.test.mjs:116`, `:163`, macOS only); no allowance touched | I, E | — |

**Decisions.** D1 PASS (exact pins, `dependency-policy.test.mjs:51`), owner
confirmation of the delegated acceptance still due; D2 PASS (M16b killed;
`test:build` green on all legs); D3 PARTIAL (plan type, finding 2); D3b FAIL
(finding 1); D4 PASS (`task-resumption.test.mjs:114`, M14); D5 PASS
(`task-coordination-loading.test.mjs:46`, `strands-coordination-engine.test.mjs:348`);
D6 PASS (pinned PowerShell 7 path, `windows-pipe-transport.test.mjs:121`); D7
assumptions, not a code check; D8 pending the owner; D9 PASS (regime instants,
`task-billing.test.mjs:43`, `:75`).

**Edge cases.** Writer dies after a write → partial, reconcile: PASS
(`coordinated-suspension.test.mjs:166`, `:387`). Drift on resume → refused:
PASS (`task-resumption.test.mjs:92`). Approval expires while suspended →
refused: PASS (`task-resumption.test.mjs:82`; journey `:341`, macOS only).
`allowed_warning` → a recorded warning: FAIL (finding 8). Two concurrent quota
signals → one suspension, the first: PASS (`coordinated-suspension.test.mjs:140`).
A swarm revisit has its own ledger entry and its own result, PASS (`coordinated-driver.test.mjs:269`);
counted against the run's result limit: by reading
(`coordinated-driver.ts:494-496`), untested. `success` without
`structured_output` or retries exhausted → `VES_COORDINATION_RESULT_INVALID`:
FAIL (finding 3).

### Discrimination sensor (verifier)

The planned list above: 16 of 16 rows killed. Additional mutants, chosen where
the evidence looked thin:

| Mutant | Requirement | Killer suites run | Result |
| --- | --- | --- | --- |
| X01 drop the per-run result limit | SSI-47, SSI-80 | unit `node-result`, `coordinated-driver` | Killed (2 of 32) |
| X02 drop the runtime concurrency limit | SSI-37, SSI-80 | unit `coordinated-driver`; integration `strands-coordination-engine` | Killed (unit 1 of 23) |
| X03 drop the handoff-limit refusal | SSI-45 | same | Killed (unit 1 of 23) |
| X04 a Claude Code node reads the whole change scope | SSI-42 | the whole unit scope (2957); `task-coordinated-plan`, `task-coordination-loading`; `task-coordinated-e2e`, `task-subscription-e2e` | **Survived** (finding 4) |
| X05 Git's `$GIT_DIR` budget off by one | AD-080 | unit `task-worktree-path-budget` | Killed (5 of 6) |
| X06 renew a revoked writer grant on resume | AD-079 | the whole unit scope; `task-coordinated-plan`; `task-subscription-e2e` | **Survived** (finding 15) |
| X07 arm grant renewal on every resume | AD-079 | the whole unit scope; `task-coordinated-plan`; `task-subscription-e2e`, `task-cli-e2e` | **Survived** (finding 15) |
| X08 the pipe name is not validated | SSI-72 | unit `windows-pipe-transport` | Killed (11 of 40) |
| X09 the verifier's provider needs no confirmation | SSI-52 | unit `task-billing` | Killed (1 of 41) |

Sensor depth: P0 (billing and authority), 28 mutant runs in all; 25 killed, 3
survived. Every run left `git status --porcelain` empty.

### Threat model

| Item | Verdict | Evidence |
| --- | --- | --- |
| TM-001 Bedrock through the SDK | Closed | Subpath only and bans (`strands-coordination-subpath.test.mjs:69`, `:87`); the probe counts 0 clients and 5 under M15b |
| TM-002 paid usage after the allowance | Open in part | Owner statement and typed quota signals hold for nodes; the verifier is never checked for credits (finding 1); the plan type is never compared (finding 2); the server-side setting stays unverifiable (residual, as designed) |
| TM-003 API-key overlay | Closed for v2 | Preflight (`task-billing.test.mjs:164`), `apiKeySource` (M09), `account/read` for nodes (M10); the verifier's identity is a ChatGPT login (`requireCodexSubscription`) but its account type is not read at session start |
| TM-004 injected escalation | Open in part | Write narrowing holds (M04); read narrowing untested for Claude Code nodes and absent for Codex nodes (finding 4) |
| TM-005 handoff hijack | Closed | M07, `coordinated-driver.test.mjs:256`, structural-agent Zod check |
| TM-006 credit-consuming RPC | Closed | Allowlist and single write path (M11, `codex-client-methods.test.mjs:42`, `:60`) |
| TM-007 request edited after approval | Open in part | Finding 6 |
| TM-008 runaway output or loop | Closed | Limits and ceilings (M06a, M06b, X01–X03), SDK limits (`strands-coordination-engine.test.mjs:295`) |
| TM-009 duplicate effects on resume | Closed | M14, `task-resumption.test.mjs:106` |
| TM-010 forged ledger or result | Closed (same-user out of scope) | Sealed by digest (`task-run-coordination-record` suite); the seal is unkeyed |
| TM-011 drift while suspended | Closed | `task-resumption.test.mjs:92` |
| TM-012 pipe squatting | Closed on the runner | Pre-created name refused, second client refused, owner-only directory, all on the Windows leg; another user's access untested |
| TM-013 logging, injection in the helper | Closed | Constant script digest, logging guard (`windows-pipe-transport.test.mjs:71`, `:90`), X08 |
| TM-014 managed policy on Windows | Closed for the subscription profile | Finding 10 |
| TM-015 personal data in records | Open in part | Finding 5 |
| TM-016 supply chain | Closed as designed | Exact pins; no new package declares an install script; `allowBuilds` unchanged; D1's acceptance awaits the owner |
| TM-017 telemetry export | Closed | No tracer provider or `@opentelemetry/sdk-*` import anywhere; the ban test scans the adapter only |
| TM-018 node output as verification | Closed | `task-coordinated-e2e.test.mjs:57` (macOS only) |
| TM-019 a node survives cancel | Closed for one node | `task-coordinated-e2e.test.mjs:120` (macOS only), unit cancel of every node; several live trees untested |
| TM-020 a looser self-containment check | Closed | Metafile check (`sealed-self-containment.test.mjs:73`, `:92`, `:137`), M16b |

The owner's focus points: **no paid path** — no API-key fallback for a v2 run,
no Strands `Agent` or Bedrock client constructed, no credit purchase or nudge
method reachable; the one gap is finding 1. **SDK confinement** — holds: one
literal dynamic import after the agent branch, `graph` and `swarm` only.
**Records** — finding 5. **Billing preflight** — confirmation and D9 hold;
D3b fails for the verifier. **Suspension and resume** — the worktree is kept
(M13) and `INTERRUPTED` stays terminal (workflow diff empty). **AD-079** —
finding 15. **Windows** — the owner-only ACL proof is set, read back, and
verified on the runner, its `SY`, `LS`, `NS` aliases accepted only for that
exact SID, and `LA`/`LG` by SID shape (a domain RID-500 account would read as
`LA`, which needs an owner or administrator rewrite between restore and
read-back, outside D7); the pipe refusals hold on the Windows leg; the
prerequisites run before any state change, lease, worktree, or provider
process (finding 10 for the order's test); Git's path budget is exact (UTF-8
bytes plus `/.git` within PATH_MAX − 40; X05 killed), and its scratch-layout
move applies to every platform (finding 13).

### Gates

Local (darwin arm64, Node 24.14.0): `pnpm gate:quick` PASS (format, lint,
complexity, typecheck; unit 2957, agent-readiness 357, census 13);
`pnpm test:architecture` 132/132; `pnpm agent:check` PASS; the focused runs
above. 0 failed, 0 skipped, 0 todo. The `tlc-spec-driven` completion gate
(`validate_state.py`) exits 1 on this report, as it must for a FAIL verdict.

Platform matrix at `c3223c6`, every stage 0 failed, 0 skipped, 0 todo (read
from each job's log):

| Run | Gate | Windows x64 | macOS x64 | macOS arm64 | Linux glibc x64 | Linux glibc arm64 |
| --- | --- | --- | --- | --- | --- | --- |
| 37190404353 | `gate:full` (unit 2957, contract 954, integration 1208, e2e 294, fault 310, mutation 8) | success | success | success | success | success |
| 37190406187 | `gate:build` (unit 2957, contract 954, integration 1208, e2e 294, architecture 132, build 179, qualification 358) | success | success | success | success | success |
| 37190408045 | `gate:security` (unit 2957, contract 954, e2e 294, architecture 132, qualification 358, security 1345, fault 310) | success | success | success | success | success |

"0 skipped" counts `node:test` skips only: off macOS, the coordinated journeys
return early and are counted as passes (finding 11).

### Stale citations in the author sections

Not corrected here (the author sections stay as written); the table above
cites current lines. `tests/unit/coordinated-driver.test.mjs:469` and `:493`
are past the file's end (now `:417`, `:441`); `:129`, `:148`, `:194`, `:215`,
`:276` are now `:122`, `:141`, `:187`, `:208`, `:269`.
`tests/integration/coordinated-executor.test.mjs:60` is `:65`.
`tests/e2e/task-coordinated-e2e.test.mjs:164`, `:189`, `:241`, `:252` are past
its 147 lines (now `:32`, `:57`, `:109`, `:120`).
`tests/contract/task-request-v2.test.mjs` citations in the SSI-18, SSI-23–27,
SSI-37, and SSI-38 rows are 17 to 29 lines early (for example `:145` → `:162`,
`:441-448` → `:463-470`, `:453-465` → `:482-487`).
`tests/integration/task-coordinated-plan.test.mjs:53-80` is `:65-82`, `:294` is
`:333`, and SSI-63's `:348` is the single-session case. The T8 rows that say the
example dry runs return off macOS predate `7282300`, which runs them
everywhere.

### Not verified, and why

- Anything that needs a real subscription: the live `apiKeySource` value, the
  live `structured_output` shape, quota and credit signals from real accounts,
  and every pilot (no provider may be called here).
- That Codex's read-only sandbox lets a node read outside its working
  directory (finding 4 and 5 rely on reading the configuration, not on a run).
- The win32 cases on a machine of mine: they are evidence only from the
  Windows legs' logs.
- `tests/build/sealed-launcher-closure.test.mjs` locally (disk); its matrix
  result is recorded above.
- Lessons distillation (`lessons.py`) was not run: it writes outside the two
  files this verification may change; the coordinator owns it.

### Coordinated-run pilots

Recorded in `docs/qualification/coordinated-run-pilots.md` (T9 commit 2),
never inferred:

| Platform | Real-subscription pilots (agent, graph, swarm) | Deterministic stand-ins at `c3223c6` |
| --- | --- | --- |
| Windows x64 | pending (owner) | Coordinated journeys not exercised (they return before running); example dry runs and the single-session named-pipe journey passed |
| macOS (arm64, x64) | pending (owner) | Every coordinated journey executed and passed, suspension, credits, resume, and crash included |
| Linux glibc (x64, arm64) | pending (owner) | Coordinated journeys not exercised; example dry runs passed |

No coordinated run with a real subscription has been recorded. What the owner
must do per platform is in the record: install Claude Code 2.1.282 or later
and Codex 0.159.3 or later (on Windows, PowerShell 7 at its pinned path and
native `claude.exe` and `codex.exe`); set both providers to `subscription`;
turn extra usage off in both accounts and keep no Codex credits (the verifier
does not check them at this revision, finding 1); write `task-billing.json` by
hand; then plan, approve, start, check `status`, and review each example from
a source checkout, never exhausting an allowance, and record the fields the
record lists. The optional Claude Code probe of
`docs/qualification/claude-code-driver-structured-results.md` is pending with
them.

Checks for this record: `pnpm agent:check` PASS; `pnpm site:check` PASS (135
pages built, internal links and metadata valid). The record is not a
`tNN-validation.md` report, so it enters neither the qualification chain nor
the site's navigation.

### Remediation R2 (node results, read scope, provider)

**Implementer**: a session that wrote none of T1–T9. **Branch**:
`strands/t9r2-node-results` from `origin/main` `867a784`. Findings 3, 4, 5,
7, 8, 14, and the `isWriter` smell of finding 17. The verifier's findings and
rows above are unchanged; a fresh verifier re-derives them. No real provider
was called. Commits, one concern each:

| Commit | Finding | Change |
| --- | --- | --- |
| `d4b41fc` | 3 (SSI-46, SSI-47) | `assertStructuredAnswer` (`coordinated-driver.ts:151`) maps `*_STRUCTURED_OUTPUT_MISSING`/`_INVALID` to `VES_COORDINATION_RESULT_INVALID` and `_LIMIT` to `VES_COORDINATION_RESULT_TOO_LARGE`; both node adapters apply it after the node's end is recorded (`driver-execution-adapter.ts:165`, `task-coordination.ts:353`) |
| `25db8d4` | 4 (SSI-42, TM-004) | `WorktreeReadView.materialize` (`mcp-bridge-tools.ts:125`) and `removeMaterializedView` (`:282`); a Codex node runs in its own read-only view of its read scope, never the worktree (`task-coordination.ts:291`, `:327`, `:357`) |
| `858ca4a` | 4 | a view a killed session left at the node's path is cleared before the node runs again (`task-coordination.ts:325`) |
| `c24a740` | 5 (SSI-49, SSI-81) | a validated result is screened before it is persisted (`coordinated-driver.ts:177`, `:593`) against the composition's `nodeResultWithheld` (`task-coordination.ts:113`, wired at `:91`) |
| `b404ca6` | 7 (SSI-07) | a swarm structural agent hands the SDK the result token as `message` (`structural-agent.ts:35`) |
| `d60a41c` | 8 (SSI-58) | both adapters keep each warning's stable code once and record `warningCodes` in `driver-finished` (`driver-execution-adapter.ts:163`, `:258`; `task-coordination.ts:215`, `:350`) |
| `f32f49f` | 14 (SSI-17) | `UsageEvent.provider` (`budget-meter.ts:38`); the coordinated driver puts node usage under the node driver's provider and refuses another (`coordinated-driver.ts:200`, `:559`); the Codex adapter reports its passport's provider (`task-coordination.ts:198`) |
| `9e2cf68` | 17 (smell) | the private `isWriter` is replaced by the exported `isWriterNode` (`coordinated-driver.ts:462`) |
| `7903efe` | hygiene | the new cases' fixture ports return plain promises; no assertion changes |

**Evidence, finding by finding.**

- **3.** Through the composition (`task-coordination.ts`) over the production
  drivers and the spike fakes: the fake Claude Code's `structured-missing`
  and `structured-retries` end as `VES_COORDINATION_RESULT_INVALID` and
  `structured-large` as `VES_COORDINATION_RESULT_TOO_LARGE`
  (`tests/integration/coordinated-node-adapters.test.mjs:55`, `:63`); the
  fake Codex's `structured-missing`, `structured-invalid` (unreadable), and
  `structured-large` likewise (`:71`). Each asserts the visit failed with the
  coordination code, nothing persisted, and the driver's own code in
  `driver-finished` (`:45`, `:46`). Mapping table:
  `tests/unit/coordinated-driver.test.mjs:236`.
- **4.** A Claude Code node whose read scope (`lib`) is narrower than the
  change scope (`src`, `lib`) is answered `denied: VES_BRIDGE_SCOPE_DENIED`
  for `src/a.txt` (`coordinated-node-adapters.test.mjs:140`), with the
  positive control (`:146`). A Codex node's working directory holds exactly
  its read scope's text files, all non-writable, without the protected
  `lib/secret`, the binary, the directory link, or the file link, is not the
  worktree, and is gone after the run (`:164`, `:179`, `:189`); a node runs
  again over the read-only view a killed session left (`:194`); a scope over
  a bound fails `VES_BRIDGE_VIEW_LIMIT` before the session (`:210`). View
  bounds: a file over 1 MiB, a listing over 1,000 entries, and 5,001 files
  are each refused whole, a file of exactly 1 MiB is copied
  (`tests/integration/read-scope-view.test.mjs:71`); content, modes, and
  removal (`:46`).
- **5.** Unit: a value, a root in another letter case or separator, and a
  root at the end of the text are refused before anything is persisted; a
  path that only shares a prefix is not; a swarm message is screened too
  (`coordinated-driver.test.mjs:247`, `:265`, `:280`). Composition list:
  credentials, home, the layout's state root, the worktree, the temporary
  root, never a filesystem root (`tests/unit/task-coordination-withheld.test.mjs:37`,
  `:44`, `:48`). Through the composition: `coordinated-node-adapters.test.mjs:222`.
  Security cases: a model-written Claude token, Codex key, home, state,
  worktree, or temporary path is refused and leaves no result file
  (`tests/security/coordination-record-security.test.mjs:97`, `:136`); the
  SUSPENDED outcome marker holds nothing of a hostile signal
  (`tests/security/task-suspension-security.test.mjs:106`) and a marker
  carrying an address, a session, a path, or a token is refused on read
  (`:112`, `:133`); the v2 plan record and plan surface of each mode, and the
  status of a suspended graph, hold no credential, address, or local root
  (`tests/security/coordinated-surface-security.test.mjs:52`, `:80`).
- **7.** `tests/integration/strands-coordination-engine.test.mjs:272`: a
  swarm node's return shape, handing off (`{ agentId, message: token }`) and
  ending (`{ message: token }`), with no provider text (`:296`).
- **8.** `tests/integration/driver-execution-adapter.test.mjs:172`, `:193`;
  through both adapters, the fake Claude Code's `rate-warning` and the fake
  Codex's denied built-in effect (`coordinated-node-adapters.test.mjs:241`).
- **14.** `coordinated-driver.test.mjs:506`: node usage names `openai` or
  `anthropic` (`:521`); a node reporting `strands`, `bedrock`, or the other
  kind's provider fails and the meter receives nothing (`:536`, `:539`);
  real node sessions name `openai`, `anthropic`, `openai`
  (`coordinated-node-adapters.test.mjs:104`). The single-session
  implementer's usage is unchanged (`mediated-task-execution-e2e` 3/3).

**Mutants** (each applied in place, its killer suites run through
`scripts/test-scope.mjs`, then `git restore`; `git status --porcelain` empty
before and after each):

| Mutant | Killed by |
| --- | --- |
| M3a the Claude Code adapter skips the mapping | `coordinated-node-adapters` (2 of 4) |
| M3b the Codex adapter skips the mapping | `coordinated-node-adapters` (1 of 4) |
| M3c `_LIMIT` maps to RESULT_INVALID | `coordinated-node-adapters` (2 of 4), unit mapping case |
| X04 a Claude Code node gets the change scope (`task-coordination.ts`) | `coordinated-node-adapters` (1 of 7) |
| X04b the adapter ignores the node's read scope | `coordinated-node-adapters` (1 of 7) |
| V1 a Codex node runs in the worktree | `coordinated-node-adapters` (1 of 7) |
| V2 no listing bound; V3 file bound doubled; V4 size bound + 1 | `read-scope-view` (1 of 3 each; V4 also composition) |
| V5 view files writable | `read-scope-view`, `coordinated-node-adapters` (2 of 10) |
| V6 the view ignores protected paths | `coordinated-node-adapters` (1 of 7) |
| M4r no clearing of a stale view | `coordinated-node-adapters` (1 of 10) |
| M5a no screen | unit (1 of 25), `coordination-record-security` (1 of 2) |
| M5b the composition passes no list | `coordinated-node-adapters` (1 of 8) |
| M5c no worktree root; M5d state root one level short | unit `task-coordination-withheld` (1 of 2 each); the security case survives both, as its temporary root covers the fixture |
| M5e no name boundary; M5f no folding | unit (1 of 25 each) |
| M5g a filesystem root kept | unit `task-coordination-withheld` (1 of 2) |
| M7 the provider's message to the SDK | `strands-coordination-engine` (1 of 17) |
| M8a, M8b an adapter drops warnings | `driver-execution-adapter` + composition (2 of 25); composition (1 of 9) |
| M14a no provider on node usage | unit (1 of 26), composition (1 of 9) |
| M14b another provider accepted; M14c Codex named `strands` | unit (1 of 26 each) |
| M17 no writer mutex (sanity for `isWriterNode`) | unit (1 of 26) |

Sensor depth: 26 mutant runs; every one killed, M5c and M5d by the unit suite
alone.

**Residual and proposals for the owner.** Codex's sandbox (`sandbox:
"read-only"`, `codex-driver.ts:465`, no readable root) withholds writes and
network, not reads, by Codex's documented modes (not observed against a real
Codex here): a prompt-injected Codex node can still read a file by absolute
path outside its view. What it can persist is limited by the result screen,
not by content. Proposed text, not applied:

- `spec.md` SSI-42: "WHEN a node reads through the bridge THEN its read tools
  SHALL be confined to the node's read scope; WHEN a Codex node reads through
  its own sandbox THEN its working directory SHALL be a read-only copy of its
  read scope alone, bounded by the bridge's read limits and removed when the
  node ends, and a read by absolute path outside that copy is an accepted
  residual risk (TM-004). (SSI-42)"
- `threat-model.md` TM-004, columns from "Threat action" on: "A writer node
  asks for out-of-scope or protected writes; a reader node reads beyond its
  read scope | Repository integrity, disclosure | Repository, protected
  paths, files outside a node's read scope | Executor scope, protected-path,
  grant, authority checks (`task-executor.ts:640-671`); mediated tools only
  (AD-039) | A Codex node's sandbox permits a read by absolute path outside
  its working directory (accepted residual) | Node write-scope narrowing
  before the executor (SSI-41); node read scope through the bridge, and for a
  Codex node a read-only copy of its read scope as its working directory
  (SSI-42, AD-081); node results screened for the run's credentials and
  machine-local roots before they persist (SSI-49); untrusted labelling
  (SSI-50) | Denied tool counts in the node ledger; `VES_BRIDGE_VIEW_LIMIT`;
  `VES_COORDINATION_RESULT_INVALID` | medium | high | high"
- `design.md:287-288`: "The adapter maps `next` to the SDK's `{ agentId?,
  message }`, omitting `agentId` for `<complete>`, with `message` the node
  result's token, never the provider's handoff text (SSI-07); the
  coordinated driver keeps the validated message and hands it to the next
  node itself."
- SSI-17 needs no narrowing: node usage now names the provider.

**Outside this remediation's files.** `tests/e2e/task-coordinated-e2e.test.mjs:77`
(R3's) asserts the two Codex nodes of a graph share one working directory;
each now has its own view, so the macOS leg fails there until it reads
`assert.notEqual(nodes[0].cwd, nodes[1].cwd);` followed by
`for (const node of nodes) assert.match(node.cwd, /[\\/]sessions[\\/]codex-node-[^\\/]+[\\/]scope$/u);`.
With that change applied locally and restored, the file passed 4/4; without
it, 3/4. `task-subscription-e2e` passed 9/9 and `mediated-task-execution-e2e`
3/3 unchanged. Citations of `coordinated-driver.ts`, `task-coordination.ts`,
and `driver-execution-adapter.ts` lines in the author and verifier sections
move with these commits; the lines above are current.

**Gates** (darwin arm64, Node 24.14.0, at `9e2cf68`): `pnpm gate:quick` PASS
(format, lint, complexity, typecheck; unit 2962, agent-readiness 357, census
13); `pnpm test:architecture` 132/132; `pnpm agent:check` PASS. At
`7903efe` (test-only) and `858ca4a`: the touched unit, integration, and
security files re-run green; typecheck, lint, and complexity PASS. Focused: integration 84/84 over the eight touched or adjacent
suites; security 10/10 over the four coordination record suites. 0 failed,
0 skipped, 0 todo. No test was deleted; the hostile-signal security case was
extended with the outcome marker, and `coordinated-driver-fixture.mjs` passes
`withheld` through.

### Remediation R3 (journeys on every platform, documentation, standards)

**Author**: an implementation session that wrote none of T1–T9. **Branch**:
`strands/t9r3-journeys-docs` from `origin/main` `867a784`. **Scope**: finding
11, the documentation part of finding 13, and finding 17 except
`task-windows.ts:38` (R1) and `isWriter` (R2). The findings and requirement
rows above are left as the verifier wrote them; the line map under item 1
gives their citations at this branch.

#### Item 1 — finding 11: the coordinated journeys on Linux and Windows

**Why each case returned early.** Fourteen cases: the four of
`tests/e2e/task-coordinated-e2e.test.mjs` (`if (!DARWIN) return;`, no
diagnostic), the nine of `tests/e2e/task-subscription-e2e.test.mjs`, and the
crash fault (`if (!DARWIN) return t.diagnostic(...)`). No product code is
macOS-only on this path: below the credential store, the task path branches
only on `win32`.

- **Linux.** The fixture had no stand-in for the Secret Service. Its
  environment carries no session bus, so the backend reports the store
  unavailable before it runs anything
  (`packages/platform-node/src/os-secret-backends/linux-secret-service.ts:137`,
  `VES_TASK_NOT_CONFIGURED`, requirement `credential-store`); and the fixture
  passed `--keychain` everywhere but Windows, which the store refuses off
  macOS (`credential-store.ts:103`, `VES_SECRET_KEYCHAIN_INVALID`).
- **Windows.** Nothing blocked them. T7 made `taskFixture` run on Windows
  (placeholder `claude.exe` and `codex.exe`, the Credential Manager answered by
  `tests/helpers/fake-windows-spawn.mjs`), and a coordinated node uses the same
  resolved executables and the same Claude Code session adapter, with the
  named-pipe transport (`apps/vestra-cli/src/task/task-coordination.ts:96`,
  `task-implementer.ts:181`). The guards date from T5 and T6, before T7, and
  were never lifted.
- **Correction to the brief.** `task-cli-e2e` does not run its journeys on
  Linux or Windows: off macOS each asserts `not configured`
  (`notConfiguredOffMacOS`, `tests/e2e/task-cli-e2e.test.mjs:959`). The one
  single-session journey on Windows is `tests/e2e/task-windows-e2e.test.mjs:139`.
  Linux has no single-session journey; this change leaves it so (out of
  scope).

**Change** (commit `test(e2e): run the coordinated journeys on Linux and Windows (T9 R3)`):

- `tests/helpers/fake-keychain-spawn.mjs:45`, `:56`, `:69` answer the Linux
  backend's two programs at their fixed paths from the fixture's store: a piped
  `secret-tool lookup` (the value and exit 0, or exit 1 and nothing) and the
  `dbus-send` SearchItems reply (unlocked paths, then locked), with the
  conventions `docs/qualification/os-secret-backend-linux.md` measured; a
  store or a clear is refused. The macOS `security` answers are unchanged.
- `tests/helpers/task-cli-fixture.mjs:275`: a fixture asked for
  `secretService: true` gets, on Linux only, a session bus address that names
  a socket that does not exist, so only the fake answers; `:450` passes
  `--keychain` on macOS only. A fixture without the option keeps its Linux
  behaviour (`notConfiguredOffMacOS` still asserts `credential-store`).
- `tests/helpers/task-coordinated-fixture.mjs:85`: every coordinated fixture
  asks for the stand-in. `ok()` (`:72`) puts the Windows witnesses' tails in a
  failing step's assertion message (`:64`).
- The fourteen guards are removed; no case is left that cannot run on a
  platform, so none needs an asserting branch or a diagnostic.
- New platform-path assertion, `tests/e2e/task-coordinated-e2e.test.mjs:37`
  (agent journey, `:50`): every credential came from the platform's own store
  programs (`find-generic-password`; SearchItems and `lookup`; `cmdkey` and
  `Read`), the read among them, and only names of the subscription mode.
- Strengthened: `tests/e2e/task-subscription-e2e.test.mjs:37` looks for each
  machine path also as JSON escapes it (`:68`, `:112-113`). Before, the check
  for `fixture.home`, `fixture.root`, and the state root could not fail on
  Windows, where every record spells the separators `\\`.
- Hardened, no assertion changed:
  `tests/fault-injection/task-coordinated-crash-faults.test.mjs:51-58`. The
  orphaned node ends by itself once the killed driver's pipe closes: with a
  3 s wait inserted before the kill (local experiment, reverted), the orphan
  was already gone on macOS. The case passed only by winning that race, and a
  lost race threw `ESRCH`; the kill now tolerates `ESRCH`, and the next line
  still waits for the process to be gone.

**Evidence.**

| Platform | Run | Result |
| --- | --- | --- |
| macOS arm64 (local) | `node scripts/test-scope.mjs e2e` on the three files | 14/14 pass, 0 skipped, 49.6 s |
| Linux arm64 (local container, not the matrix) | Ubuntu 22.04, Git 2.34.1, Node 24.14.0, non-root user, `docker run --init`, worktree mounted read-only | 14/14 pass, 41 s; no temporary directory left |
| Windows x64 | not run locally | the platform matrix proves it |

Without `--init` the container's crash fault timed out at its 10 s wait: no
init reaped the orphan, and a zombie still answers signal 0. Hosted runners
have one; the run with `--init` is the faithful one. v1 regression, the
fixture and the fake keychain being shared: `task-cli-e2e`,
`task-windows-e2e`, `task-request-examples-e2e`, and `task-cli-security`
58/58 on macOS and 58/58 in the Linux container, where their cases still
assert `not configured` or the Unix socket path as before.

**Cases that must now execute on the Linux x64, Linux arm64, and Windows x64
legs** (seconds each, as on macOS, not the under-4 ms early returns), in
every gate that runs e2e (`gate:full`, `gate:build`, `gate:security`) and, for
the last, every gate that runs fault (`gate:full`, `gate:security`):

- `task-coordinated-e2e`: "an agent run is planned, approved, run on the
  native engine, verified, and accepted"; "a graph runs its Codex readers and
  Claude Code writer in order through the SDK, one run, one verifier"; "a
  swarm hands work from the writer to the reviewer and ends where the reviewer
  ends it"; "cancel reaches a running node: its provider stops and the
  coordinated run is aborted".
- `task-subscription-e2e`: "a coordinated run without the extra-usage
  confirmation is not configured before anything starts"; "a coordinated run
  with a provider on an API key is not configured, confirmation or not"; "a
  quota signal mid-graph suspends the run in IMPLEMENTING with its worktree
  and first node kept"; "Codex credits on a node's account are not
  configured, and the run is suspended, not lost"; "resume of a
  quota-suspended graph needs the confirmation, then skips the completed node
  and re-runs the stopped one"; "a node suspended after its write is refused
  at resume until its digest is typed back, then it runs again"; "resume
  refuses drift and an approval that expired while suspended, and renews a
  writer grant that lapsed"; "Codex credits that are gone at resume let the
  suspended run continue from the node they stopped"; "cancel of a suspended
  run removes its worktree and ends it aborted".
- `task-coordinated-crash-faults`: "a run killed while a node runs leaves it
  uncertain until the owner reconciles it".

The test counts do not change (e2e 294, fault 310); only the durations do. The
stand-in column of `docs/qualification/coordinated-run-pilots.md` is bound to
`c3223c6` and stays as recorded; the matrix run of this branch is its
successor evidence.

**The Codex protocol spike's limit.** Every fleet workflow installs Codex
0.115.0 (`.github/workflows/platform-matrix.yml:194`, `ci.yml:50`,
`full-validation.yml:121`, `t76-candidate-build.yml:158`), below the 0.159.3
structured floor, so on every leg "the installed Codex at or above the floor
generates every protocol element the driver relies on" proves only that
structured and subscription-only sessions are refused below the floor. The pin
is not moved here: that is a dependency upgrade and needs the owner. The case
now carries a pin guard
(`spikes/codex-driver/test/codex-driver-structured.test.mjs:145-155`): under
`VES_REQUIRE_PINNED_PROVIDERS=1`, as on the fleet, the installed Codex must be
exactly 0.115.0, and every run states the version it ran against
(`t.diagnostic`, `:157`). Local runs (darwin arm64, Codex 0.159.3): without
the variable, 5/5 pass and the protocol is asserted ("ran against Codex
0.159.3; the structured floor is 0.159.3"); with it, the case fails "the
fleet's Codex is not its pin 0.115.0". **Recorded limit**: the protocol
evidence at the floor is local only (T4's author run and this one), never a
fleet run, until the owner moves the pin.

**Line map.** Citations in the sections above, at `867a784` → at this branch:
`tests/e2e/task-coordinated-e2e.test.mjs` `:32` → `:50`, `:57` → `:75`,
`:109` → `:126`, `:120` → `:136`; `tests/e2e/task-subscription-e2e.test.mjs`
`:56` → `:59`, `:76` → `:79`, `:116` → `:118`, `:163` → `:164`, `:230` →
`:230`, `:281` → `:280`, `:341` → `:339`, `:368` → `:365`, `:392` → `:388`;
`tests/fault-injection/task-coordinated-crash-faults.test.mjs` `:34` → `:35`;
`spikes/codex-driver/test/codex-driver-structured.test.mjs` `:145` (the floor
case, cited as `:147-151`) → `:153`, its lines above `:139` unchanged.

#### Item 2 — documentation (findings 13 and 17)

Commit `docs(quick-start): state where the coordinated journeys run and the v1 path-length changes (T9 R3)`:

- **The overclaim.** `docs/quick-start.md:355-356` said the task path,
  coordinated runs included, runs with stand-ins on the hosted Windows runner,
  while no coordinated journey ran there. The status note (now `:363-372`)
  says what runs: each mode from a plan to `HUMAN_REVIEW`, and cancel,
  suspension, resume, and a killed run, with stand-ins for both providers and
  each platform's credential store, on macOS, Linux, and Windows (item 1).
  "What you need" (`:16-26`) and the first limit (`:611-616`) separate the
  single-session journeys (end to end on macOS; one journey, plan to accepted
  review over the named pipe, on Windows; Linux in parts) from the
  coordinated ones (all three). `README.md:279-283` said "macOS only" and now
  says the same as the quick start.
- **AD-080 item 5, for every run, v1 included.** `start` (`:275-283`) now
  says that `start` and `resume` first measure the run's worktree and both
  verification checkout roots against Git's limit on the platform (215, 979,
  and 4051 bytes) and stop with `state-path-length` before the run is read
  or changed, on every platform; the Windows prerequisites table keeps its
  row. The state bullet (`:695-701`) gives the verification layout,
  `verification/<16 hex digits of the run ID's SHA-256>/r` and `/m`, and
  the one it replaces, `verification/<runId>/review` and `/mutations`, on
  every platform. The owner's approval of AD-080 item 5 (finding 13's fix) is
  still the owner's; this change only documents it.
- Not changed: `docs/qualification/coordinated-run-pilots.md`, a record bound
  to `c3223c6` (see item 1).

#### Item 3 — standards (finding 17)

Commit `style: translate the owner's quote and prefix five comments (T9 R3)`:

- **The quote.** `spec.md:102-103` quoted the owner in Portuguese. It now
  reads, marked as the owner's words translated from Portuguese, "do all of
  this, I trust you more" (`spec.md:102-104`, the same meaning: the owner
  delegates all of it and trusts the session to do it). The paragraph keeps
  its line count, so no later citation of `spec.md` moves.
- **Comment prefixes**, the meaning unchanged and the line count of each
  comment kept, so no citation moves:
  `packages/application/src/execution/gate-repair.ts:79` (`invariant:`),
  `packages/agent-runtime/src/execution/bridge-transport.ts:30`
  (`invariant:`), `packages/platform-node/src/windows-pipe-transport.ts:391`
  (`invariant:`), `scripts/t76-build-candidate.mjs:318` (`why:`, the
  decision D2 sentences the range added to an older comment) and `:398`
  (`invariant:`, in the `/** invariant: ... */` form of
  `scripts/build-vestra-binary.mjs:60`). Left to their owners:
  `apps/vestra-cli/src/task/task-windows.ts:38` (R1) and `isWriter` (R2).

#### R3 gates and next action

Local, darwin arm64, Node 24.14.0, at the item 3 commit: `pnpm gate:quick`
PASS (format, lint, complexity: 171 baselined keys and nothing above 10
unaccounted, typecheck, unit 2957, agent-readiness 357, census 13);
`pnpm typecheck` PASS; `pnpm test:architecture` 132/132; `pnpm agent:check`
PASS; `pnpm site:check` PASS (135 pages, internal links and metadata valid);
the focused runs above. 0 failed, 0 skipped, 0 todo. No complexity key, census
entry, migration, or error catalog changed.

**Next action**: run the platform matrix (`gate:full`, `gate:build`,
`gate:security`) on this branch and confirm, in each Linux and Windows job
log, the fourteen cases named under item 1 at second-scale durations and the
spike's "ran against Codex 0.115.0" diagnostic; a failing Windows case is
fixed here before merge, with the quick start's claim in the same change.
Then a fresh verification of findings 11, 13 (documentation part), and 17.

### Remediation R1 (billing, verifier, approval proof)

**Implementer**: an agent session that wrote none of T1–T9 and verifies
nothing here; a fresh verifier re-derives every verdict above. **Branch**:
`strands/t9r1-billing-verifier` from `867a784`, rebased onto `f561274` (R3).
**Scope**: findings 1, 2, 6,
10, and 15, and finding 17's comment prefix at `task-windows.ts:38` only. The
findings and requirement rows above are unchanged. Decision record:
`.specs/STATE.md`, AD-082.

Commits: `ca97f3d` (finding 1), `dfcd551` and `e5ff886` (finding 2),
`2b6ae15` (finding 6), `052e9a6` (finding 10), `551c22b` (finding 15), and
`528db10` (the five journeys added here run on macOS, Linux, and Windows, as
R3's coordinated journeys do).

#### Finding 1 (D3b): the verifier of a v2 run

The verifier of a v2 request asks for a subscription-only session
(`apps/vestra-cli/src/task/task-codex.ts:311`), through the same session seam
as the account read (`codexSession`, `:250`). Its first quota signal stops
the session (`observeQuota`, `:185`); a quota or a credits refusal leaves as
`TaskExecutionSuspended` with a closed record (`verifierSuspension`, `:195`);
the run coordinator ends the run SUSPENDED in VERIFYING, releases the writer
coordination, and applies no workflow command
(`packages/application/src/execution/task-run.ts:255`); `runTask`'s existing
mapping reports credits as `not configured` (`codex-credits`).

**v1 is not changed.** D3b is a decision of this feature, whose billing
checks (SSI-51, SSI-52) apply "WHEN a v2 run starts or resumes"; SSI-83 and
the Goals keep every v1 request "exactly as before", and the spec's
assumption row for the Codex floor says a raised floor "would fail v1 runs at
verification on older builds (SSI-83)". The rate-limit read needs 0.159.3, so
checking v1 credits means raising v1's floor. A v1 run on a subscription can
therefore still spend Codex credits at verification; extending the check is
an owner decision (proposed amendment below).

| Requirement | Evidence (`file:line`, what it asserts) |
| --- | --- |
| D3b, SSI-55 for the verifier | `tests/integration/codex-verifier-session.test.mjs:242` a v2 verifier reads its account and rate limits before its turn; `:252` a v1 verifier on a subscription reads none and is not stopped by credits |
| D3b, SSI-56 | `:262` credits suspend the verifier before its turn, record exactly `{reason: VES_CODEX_CREDITS_PRESENT, provider: codex, at}`, no turn, session root removed |
| SSI-58, SSI-59 for the verifier | `:270` `ordinaryUsageAllowed: false` and a mid-turn `usageLimitExceeded` each suspend with scope and reset as reported |
| SSI-60 for the verifier | `tests/unit/task-run-coordinator.test.mjs:382` SUSPENDED in VERIFYING, commands only `START_IMPLEMENTATION`, `START_VERIFICATION`, released once; `:399` a non-suspension error fails and a cancel aborts |
| Journeys (every platform) | `tests/e2e/task-codex-account-e2e.test.mjs:77` agent run, `codex-credits`: `not configured` (`codex-credits`), VERIFYING, commit kept, no verifier turn, record holds no e-mail, balance, or path; resumed once clear, reaches review with the account checked; `:110` agent run, `codex-quota`: SUSPENDED in VERIFYING, `next` is resume |

Mutants (in place, killer suites through `scripts/test-scope.mjs`, then
`git restore`, `git status --porcelain` unchanged every time): M1a verifier
not subscription-only, killed (integration 3 of 15; journeys 2 of 2); M1b
suspension dropped, killed (2 of 15); M1c coordinator rethrows a verifier
suspension, killed (unit 1 of 19); M1d no release on it, killed (1 of 19);
M1e v1 verifier subscription-only too, killed (1 of 15); M1f a cancel no
longer wins, killed (1 of 19).

#### Finding 2 (SSI-52): the plan type

`CODEX_PLAN_TYPES` (`packages/drivers/src/codex-driver.ts:75`) is the 0.159.3
`PlanType` without `unknown`, read from `codex app-server generate-ts
--experimental` of the installed 0.159.3 into a disposable directory with a
disposable `HOME` and `CODEX_HOME` (no login read, no model invoked). The
account read reports the plan type as one of them or `unknown` and keeps
nothing else (`accountRead`, `:410`); an account-only session reads the
account and ends (`accountSteps`, `:432`; plan validation `:623`). The
statement's plan type must be one of them (`task-billing.ts:95`);
`requireStatedPlanType` (`:205`) refuses another as `not configured`
(`extra-usage-confirmation`). `prepare` reads it after the login is proven
and before the first transition (`task-run.ts:254`, `codexAccountPlanType`
in `task-codex.ts:408`).

| Requirement | Evidence |
| --- | --- |
| SSI-52 (plan type compared) | `tests/unit/task-billing.test.mjs:260` the reported type must equal the stated one, `pro` and `unknown` refused, both values told; `tests/e2e/task-codex-account-e2e.test.mjs:192` a statement naming `pro` against a `plus` login is `not configured` at `start` with no transition, grant, worktree, thread, or turn, then runs once confirmed |
| SSI-49, SSI-53 (closed value, nothing else kept) | `tests/contract/codex-driver-structured.test.mjs:254` free text, wrong case, a number, and an absent type all report `unknown`; `tests/security/codex-account-security.test.mjs:36` the report is exactly `planType` and no report or event keeps the e-mail address or account identifier; `tests/unit/task-billing.test.mjs` rows "a plan type Codex does not name", "a handle in the shape of a plan type", "the catch-all plan type unknown"; `:250` every vocabulary value is accepted |
| The account-only session | `tests/contract/codex-driver-structured.test.mjs:242` methods exactly `initialize`, `initialized`, `account/read`, completed, no session events; `:282` a non-ChatGPT account is refused and reports nothing; `:181` refused below 0.159.3 before spawn; `:200` asking it for a turn is refused before spawn; `tests/integration/codex-verifier-session.test.mjs:319` over the task fake it opens no thread or turn; `:328` an API-key login is `codex-account`, a 0.159.2 build `codex-version` |

Mutants: M2a any reported type accepted, killed (unit 1 of 46); M2b
free-text statement accepted, killed (4 of 46); M2c account text reported,
killed (contract 1 of 17; security 1 of 2); M2d account-only session goes on
to its turn, killed (1 of 17); M2e the run never reads the plan type, killed
(journeys 1 of 3); M2f the version refusal not told apart, killed
(integration 1 of 17); M2g the report carries the whole account, killed
(security 1 of 2).

#### Finding 6 (SSI-29): the request proven against the approved package

`requireApprovedRequest` (`apps/vestra-cli/src/task/task-run.ts:309`, called
at `:848`, after the workflow state and before `prepare`) loads the package
through the Run record's checked reader and requires the plan's package
digest to be the one its approval intent binds and the package's
`executionContractDigest` to be the plan's request digest, else
`VES_TASK_STATE_INVALID` (`VES_TASK_PACKAGE_INVALID`).

| Requirement | Evidence |
| --- | --- |
| SSI-29 (v1 and v2, start and resume) | `tests/integration/task-coordinated-plan.test.mjs:205` the approved record reaches its credential read; the same record rewritten consistently (another request, its digest, and the seal recomputed by `savePlan`) loads, and is refused before the billing preflight (statement removed), a transition, a claim, or a file; `:228` a package that is not the one the approval intent binds is refused |

Mutants: M6a no proof, killed (5 of 26); M6b execution contract not
compared, killed (4 of 26); M6c approval intent not compared, killed (1 of
26); M6d proof moved after `prepare`, killed (5 of 26).

#### Finding 10 (SSI-73): every mediated profile, and the order

`requireWindowsPrerequisites` refuses a managed policy for either mediated
profile (`apps/vestra-cli/src/task/task-windows.ts:58`); `:41` now carries
its `invariant:` prefix. In `prepare` the prerequisites run after the
provider modes and the billing statement and before the credential read
(`task-run.ts:233` against `:241`); `runTask` takes the machine they are
proven on (`WindowsMachine`).

The API-key profile is not exempt: it runs `--bare`, which reads no OAuth or
keychain and skips hooks, but a managed policy outranks every settings
source a profile passes and can add instructions or a credential helper to
the session that holds the bridge token, and SSI-73 makes no exception;
`docs/quick-start.md` already says the task path does not run under a
managed policy. No spec change is needed.

| Requirement | Evidence |
| --- | --- |
| SSI-73 (both profiles) | `tests/unit/task-windows.test.mjs:141` a policy refuses the subscription and the API-key profile, and neither is refused without one |
| SSI-73 (order, observed on darwin) | `tests/integration/task-run-prerequisites.test.mjs:140` `start` and `resume`, both profiles: at each of the fake host's three questions no credential was read, no active claim, no writer lease, the workflow state unchanged, no worktree; refused `claude-managed-policy`; `:154` with every prerequisite the run goes on to its first credential read; `:162` a v2 run asks the machine only after its billing statement |

Mutants: M10a policy for the subscription profile only, killed (unit 1 of
15; integration 2 of 7); M10b prerequisites after the credential read,
killed (7 of 7); M10c after the active claim, killed (7 of 7); M10d before
the billing statement, killed (1 of 7); M10e injected machine ignored,
killed (7 of 7).

#### Finding 15 (AD-079): the renewal bounds

`grantExpiry` (`apps/vestra-cli/src/task/task-run.ts:276`) caps every grant
at the earlier of the approval's expiry and the run's duration plus the
margin; `renewsGrant` (`:298`) renews only when armed (`:465`, a resume from
a suspension), never a revoked or unknown grant, when the remaining life is
shorter than the run's remaining duration read from its meter, and only if
the new grant outlives the old. `#grant` (`:433`) writes the replaced grants
into the marker (`task-run-record.ts:572`, validated at `:206`).

| Requirement | Evidence |
| --- | --- |
| Lifetime cap | `tests/unit/task-grant-renewal.test.mjs:28`; `:56` a cap that would not extend the grant renews nothing |
| X06, revoked | `:41` a revoked grant is never renewed, expired or not |
| X07, armed only from a suspension | `:37` unit; `tests/e2e/task-grant-renewal-e2e.test.mjs:80` a graph run killed while its reader hangs, reconciled and resumed three hours later, keeps its expired grant, and the writer's first effect is refused (`VES_EXECUTOR_APPROVAL_INVALID`) |
| Near expiry | `tests/unit/task-grant-renewal.test.mjs:50` five minutes left of eight renewed, exactly eight reused; `tests/e2e/task-grant-renewal-e2e.test.mjs:106` a suspended run resumed with five of seventy minutes left gets a new grant and reaches review |
| Replaced grant recorded | `tests/e2e/task-grant-renewal-e2e.test.mjs:106` the marker is `{grantId, replaced: [previous]}`; `tests/unit/task-run-record-readers.test.mjs:136` both marker forms, a first grant unchanged, malformed lists refused |

Mutants: X06 killed (unit 1 of 7); X07 killed (journeys 1 of 2), X07b (the
decision ignores the arming) killed (unit 1 of 7); X10 lifetime cap dropped,
killed (2 of 7); X11 the old expired-only rule, killed (journeys 1 of 2);
X12 replaced grant not recorded, killed (1 of 2); X13 renewal that does not
extend, killed (1 of 7).

#### Deleted case → replacement

- `tests/unit/task-windows.test.mjs` "a managed Claude Code policy refuses
  the subscription profile only" (it asserted the API-key profile never read
  the policy, the behaviour finding 10 removes) → `:141`, both profiles
  refused under a policy and passed without one, and
  `tests/integration/task-run-prerequisites.test.mjs:140` for both profiles
  through `start` and `resume`.

#### Spec amendments proposed (owner)

Not applied here; `spec.md` is unchanged.

- SSI-55: "WHEN a Codex node session, or the verifier session of a v2 run,
  starts THEN the driver SHALL require `account/read` to report an account of
  type `chatgpt`, and IF it does not THEN the session SHALL fail with
  `VES_CODEX_AUTH_METHOD_MISMATCH` before the turn starts."
- SSI-56: "IF a Codex rate-limit snapshot of a node or of the verifier of a
  v2 run reports a credit balance or unlimited credits THEN that session
  SHALL not start its turn and the run SHALL be `not configured` with
  `VES_CODEX_CREDITS_PRESENT`."
- SSI-60, last clause: "…and the workflow state SHALL stay `IMPLEMENTING`, or
  `VERIFYING` when the verifier's session raised the signal."
- SSI-52, appended: "The plan type SHALL be one of the plan types the Codex
  App Server protocol names, other than `unknown`, and WHEN a v2 run starts or
  resumes THEN the plan type the Codex account reports SHALL equal it."
- Open owner decision, if v1 should be covered: amend SSI-83 to "…SHALL behave
  as before, except that a v1 verifier on a subscription is subscription-only
  and requires Codex 0.159.3", and the floor assumption row accordingly.

#### Citations above that moved

For the fresh verifier; the findings keep their `c3223c6` lines.
`task-codex.ts:236` → `:278` (`resolveExecution` in `codexSession`) and
`:311`; `codex-driver.ts:370-372` → `:410-416`, `:388` → `:432`;
`task-billing.ts:93` → `:95`; `task-run.ts:190` → `:241`, `:202` → `:233`,
`:752` → `:850`, `:343-345` → `:276-282`, `:353` → `:298-303`, `:371` →
`:465`; `task-windows.ts:51` → `:58`, `:38` → `:41`. Line citations of these
files in other features' validation records name the lines at their own
commits and are left as written.

#### Gates (darwin arm64, Node 24.14.0)

`pnpm gate:quick` PASS after commits 2 to 5 and again on the rebased head
(format, lint, complexity, typecheck; unit 2972, agent-readiness 357, census
13); `pnpm test:architecture` 132/132; `pnpm test:contract` 957/957;
`pnpm agent:check` PASS; complexity no new hotspot (171 keys, none raised);
the census unchanged (no file gained or lost `JSON.stringify` or
`createHash`). Focused runs on the rebased head: integration 158/158 over
the nine task and Codex suites; security 17/17 (`codex-account-security`,
`task-suspension-security`, `driver-structured-results-security`,
`coordination-record-security`, `task-cli-security`); fault
`task-coordinated-crash-faults` 1/1; e2e 70/70 over the eight task journey
files (Codex account, grant renewal, coordinated, subscription, task CLI,
mediated, examples, Windows); `spikes/codex-driver` 39/39. 0 failed, 0
skipped, 0 todo; every scope left its temporary directory empty. No real
provider was called. The five journeys added here ran on macOS only; their
Linux and Windows legs, and the full, build, and security gates, are the
coordinator's matrix.

#### Follow-up: a run suspended at its verifier, and the documentation

`0a81297`: a run in VERIFYING whose last outcome is a suspension
(`apps/vestra-cli/src/task/task-run.ts:468`) resumes on the checks a node
suspension gets. `prepare` has already run the preflight, the statement, and
the plan type; the resume then requires the approval valid against the policy
in force and the task commit as the run left it
(`apps/vestra-cli/src/task/task-resumption.ts:134`, `:155`): the recorded
commit, whose only parent is the plan's source revision, under the task
branch that anchors it (`task-run.ts:455`), else `VES_TASK_FAILED`
(`VES_TASK_COMMIT_DRIFT`). Each refusal leaves the run in VERIFYING with its
suspension.

| Requirement | Evidence |
| --- | --- |
| SSI-33 at the verifier (interface) | `tests/unit/task-resumption.test.mjs:118` a valid approval and a standing commit resume, no grant renewal armed, no worktree asked; `:125` an expired, stale, or revoked approval refused before the commit is read; `:131` a moved commit or branch refused as drift |
| SSI-33 at the verifier (journey) | `tests/e2e/task-codex-account-e2e.test.mjs:140` a run suspended at its verifier is refused without its statement (`extra-usage-confirmation`), eight days later on an expired approval (`VES_APPROVAL_EXPIRED`), with its branch moved to the base and with its branch deleted (`VES_TASK_COMMIT_DRIFT`), each time still VERIFYING and SUSPENDED with no verifier turn, then resumed to review with the branch on the commit |

Mutants: M11a the check removed where the composition asks it, killed
(journeys 1 of 4); M11b the check removed from the resume interface, killed
(unit 5 of 21); M11c no approval check at the verifier, killed (5 of 21);
M11d the anchored branch not compared, killed (journeys 1 of 4); M11e the
suspension at the verifier never recognised, killed (1 of 4).

`ac043bd`: `docs/quick-start.md` lists what `start` and `resume` of a
coordinated run may refuse with the owner's action for each
(`coordinated-run-subscription`, `extra-usage-confirmation`, `codex-login`,
`codex-version`, `codex-account`, `codex-credits`), states the extra Codex
process that reads only the account, the closed `planType` vocabulary and its
comparison, the verifier's credit check and suspension, and
`VES_TASK_COMMIT_DRIFT`; `docs/qualification/coordinated-run-pilots.md` no
longer says the verifier does not check credits. `pnpm site:check` PASS (135
pages, internal links and metadata valid); `pnpm gate:quick` PASS (unit
2977, agent-readiness 357, census 13); `pnpm agent:check` PASS. Journeys after
the follow-up: 64/64 over the Codex account, subscription, grant renewal,
task CLI, and coordinated files; fault `task-coordinated-crash-faults` 1/1;
integration 49/49 over `task-coordinated-plan`, `task-run-prerequisites`, and
`task-commit-recovery`.

#### Not done here, and residual risks

- The node adapters do not compare the plan type themselves; the comparison
  is at `start` and `resume` (SSI-52), so a plan changed mid-run is seen at
  the next resume.
- By reading, a resume at VERIFYING claims the writer lease and, reaching
  review, does not release it; it lapses with the lease (pre-existing,
  unchanged here).

## Independent Re-verification (T9, second pass)

**Verifier**: a fresh agent session that wrote none of T1–T8, none of
remediations R1–R3, and not the first verification (author ≠ verifier).
**Date**: 2026-10-04. **Head**: `93b38c5` on `strands/t9-reverification`,
equal to `origin/main`. **Diff range**: `7e274f2..93b38c5` (80 commits, 239
files); the remediation range is `c3223c6..93b38c5` (31 commits).

**Method.** The pinned `code-review` skill against this `.specs` path with
the diff base `7e274f2`, its Standards and Spec axes run as two separate
read-only reviews whose findings were then checked here by reading and, where
practical, by running code; and the `tlc-spec-driven` validate procedure. Every
SSI row was re-derived from the code and tests at this head; the first
verifier's findings and the R1, R2, and R3 evidence were treated as claims.
Each mutant was applied in place, its killer suites run through
`scripts/test-scope.mjs`, then `git restore`, with `git status --porcelain`
empty before and after every run. One finding was reproduced by a scratch
test outside the repository, never tracked. No real provider was called. No
gate beyond `gate:quick` ran locally (disk); the full, build, and security
gates ran on the platform matrix at this head.

**Result: FAIL.** Two requirements fail (SSI-49, SSI-83), three are partial
(SSI-60 and SSI-61, which wait for spec amendments, and SSI-81, which follows
SSI-49), SSI-84 is pending (owner), and 79 pass; and the Windows leg of
`gate:security` hung at this head (finding 3). Every first-pass finding
that R1, R2, or R3 addressed is closed at this head, except that R1's verifier
change introduced finding 1 below and R2's screen leaves finding 2 open;
first-pass finding 13 (the owner's approval of AD-080 item 5) and finding 16
(the pilots) still wait for the owner. The discrimination list is killed in
full, the three survivors of the first pass (X04, X06, X07) are killed, and 19
sampled remediation mutants are killed; 3 of my 12 mutants survive (O12, O13,
O15), none of them on a check SSI-80 names.

### Findings, ranked (second pass)

1. **FAIL — SSI-83: a v1 verifier that meets a Codex usage limit now
   suspends the run instead of failing it.** R1 made the verifier stop on
   its first quota signal and raise `TaskExecutionSuspended`
   (`apps/vestra-cli/src/task/task-codex.ts:185`, `:195`, `:354`, `:359`)
   without regard to the request's version; only `subscriptionOnly` is
   limited to v2 (`:311`). The Codex driver reports a usage limit for every
   session, the T04 conversation included
   (`packages/drivers/src/codex-driver.ts:350`, `:364`), and the run
   coordinator turns any verifier suspension into `SUSPENDED` in `VERIFYING`
   (`packages/application/src/execution/task-run.ts:255`). At `c3223c6` the
   verifier had no quota handling (by reading), so the same session failed
   the run (`VES_TASK_FAILED`). Reproduced at this head: the fake Codex's
   `usage-limit` scenario under the verifier fixture of
   `tests/integration/codex-verifier-session.test.mjs`, with
   `schemaVersion: 1`, raised `VES_EXECUTOR_SUSPENDED` with
   `{reason: VES_DRIVER_QUOTA_EXHAUSTED, provider: codex, scope:
   usage_limit_exceeded}`, on a subscription and on an API key alike (2 of 2
   cases). This contradicts SSI-83 ("a v1 request … SHALL behave as before")
   and AD-082 item 1 ("A v1 verifier keeps the T04 conversation even on a
   subscription, because SSI-83 keeps every v1 run as it was"); no test
   covers a v1 verifier with a quota signal
   (`tests/integration/codex-verifier-session.test.mjs:252` covers credits
   only). The change may be the better behaviour, but it is unrecorded and
   unapproved. Fix: observe the quota and raise the suspension only when the
   request is v2 (as `subscriptionOnly` is), and add a v1 `usage-limit` case
   that asserts `VES_TASK_FAILED`; or have the owner extend the open SSI-83
   amendment of R1 to "a v1 verifier that meets a usage limit suspends the
   run in `VERIFYING`", record it in AD-082, and test it.
2. **FAIL — SSI-49 (and SSI-81, TM-004, TM-015): the Codex subscription
   login, which every Codex node can read, is not withheld from node
   results.** The screen refuses a result naming a value of
   `nodeResultWithheld` (`apps/vestra-cli/src/task/task-coordination.ts:113`),
   whose values are the Claude Code credential and the Codex session's
   `sensitiveValues` (`:116`), and those are empty for a subscription login
   (`apps/vestra-cli/src/task/task-codex.ts:158-168`);
   `tests/unit/task-coordination-withheld.test.mjs:52` asserts exactly that.
   Yet a Codex node runs with `CODEX_HOME` set to the Workspace's identity
   directory (`task-coordination.ts:252`, `task-codex.ts:148`), whose
   `auth.json` holds the ChatGPT tokens (`task-codex-identity.ts:20`), and
   its read-only sandbox withholds writes, not reads (AD-081). A
   prompt-injected Codex node can copy those tokens into its summary or
   handoff message; the result passes the screen, is persisted in the Run
   record, and is handed to later nodes. SSI-49 says a persisted node result
   SHALL contain no credential. By reading; not exercised against a real
   Codex. Fix: add the token values of the Codex login (read from
   `auth.json` by the composition, never persisted or printed) to the
   withheld values, with a composition case whose fake identity holds a token
   the fake answers with; or give a Codex node a credential source it cannot
   read back; or have the owner narrow SSI-49 to what Verchestra hands a
   session.
3. **The Windows leg of `gate:security` did not pass at this head: its
   security stage hung.** Run 37199001702, job Windows x64: unit, contract,
   e2e, architecture, and qualification passed (2982, 957, 300, 132, 358);
   the security stage reported its last result at 11:41:31 UTC, 1317 of 1351
   tests, then nothing until the job's 60-minute limit cancelled it at
   12:31:36 UTC, so the fault stage never ran there. The three files that
   never reported are the last three in order:
   `tests/security/windows-pipe-bridge-security.test.mjs` (12 cases, the
   win32 named-pipe cases among them), `workspace-scanner-security`, and
   `worktree-tool-security`; the runner reports files in order, so the first
   of them most likely hung. The same leg passed in 11 minutes on
   `f285f2b` (run 37197307202), whose tree differs from this head in two
   Markdown files only, every win32 named-pipe case included. A hang that
   comes and goes on the same code is a defect of the pipe suite or the
   transport, not of the change since; a hung pipe case must fail, not
   hang. Fix: re-run the leg (`gh run rerun 37199001702 --failed`), and give
   the named-pipe cases a bounded timeout so a hang names its case; if the
   case is in the transport, a fix there.
4. **The residual AD-081 accepts is wider than its text and the proposed
   SSI-42 amendment say.** The view is
   `<Workspace>/sessions/codex-node-<run>-<node>-<visit>/scope`, so a
   relative path through `..` reaches the run's worktree
   (`../../../worktrees/…`) and the Codex identity directory
   (`../../../codex-identity/auth.json`) as an absolute path does. AD-081's
   "the view confines every read relative to the working directory" is not
   so for `..`; the copy changes where a node starts reading, not what it can
   read. Fix (T10): word the SSI-42 amendment's and TM-004's residual as "any
   read outside that copy, by an absolute path or one through `..`", and
   correct AD-081's rejected-alternative sentence.
5. **PARTIAL — SSI-60 and SSI-61 wait for amendments.** A run suspended at
   its verifier stays `VERIFYING` (`tests/unit/task-run-coordinator.test.mjs:382`),
   not `IMPLEMENTING` as SSI-60 reads; R1's amendment text covers it. The
   suspension record keeps the provider's window `scope` beside the four
   members SSI-61 allows (`packages/application/src/execution/coordinated-driver.ts:122-135`);
   no remediation proposed text for SSI-61.
6. **Survivors (fix tasks, none on an SSI-80 check).** O12 and O13: the two
   halves of "the recorded commit stands on its base"
   (`apps/vestra-cli/src/task/task-run.ts:457`, `:462`) are untested; only
   the branch half is (`tests/e2e/task-codex-account-e2e.test.mjs:140`).
   O15: the composition's hand-off of a stored grant's revocation to the
   renewal decision (`task-run.ts:443`) is untested; X06 is killed only at the
   decision function (`tests/unit/task-grant-renewal.test.mjs:41`). No task
   command revokes a writer grant today, so O15 is reachable only by a
   same-user edit of the runtime store (out of scope, D7). Fix: a verifier
   resume whose recorded commit names another base, and one whose commit
   has another parent, each refused `VES_TASK_COMMIT_DRIFT`; a suspended run
   whose stored grant is revoked in the runtime store resumes without a new
   grant and its first effect is refused.
7. **Residual risks and minor defects (no SSI row changes).**
   - A Codex node's view is removed when the node ends, but not when the
     command is interrupted: `provider.end()` parks forever on SIGINT,
     SIGTERM, or SIGHUP (`apps/vestra-cli/src/task/task-process-tree.ts:72`),
     so the `finally` at `task-coordination.ts:357` never runs. A resume
     clears it (`:325`, R-M4r killed); `task cancel` does not, and a plain
     removal fails on its `0500` directories. AD-081 records this; a cancel
     that clears `sessions/codex-node-<runId>-*` would close it.
   - On Windows the view's directories stay writable (only files are
     read-only); `tests/integration/read-scope-view.test.mjs:64` skips that
     assertion there. Writes stay blocked by Codex's own sandbox.
   - The grant marker refuses a `replaced` list over 100
     (`apps/vestra-cli/src/task/task-run-record.ts:211`) that `saveGrant`
     (`:572`) never caps, so a run renewed a 101st time fails closed.
   - `#renewalArmed` is never cleared within a command, so each gate-repair
     attempt of a resumed run asks `renewsGrant` again; its bounds still hold.
   - A Codex node now works in a directory that is not a Git checkout.
     Whether a real Codex App Server at 0.159.3 accepts that is unverified
     (no provider may be called); the owner's graph and swarm pilots will
     show it.
   - Standards axis: the Codex driver construction is still repeated
     (`task-coordination.ts:235-284` against `task-codex.ts:250-287`), with
     the provider literal, the `subscriptionOnly` rule, and the codes declared
     twice; the remaining unprefixed comments are lines added before
     `c3223c6` (for example `tests/contract/task-request-v2.test.mjs:254`,
     `tests/helpers/coordinated-driver-fixture.mjs:154`) and the
     `DETERMINISTIC FAKE` headers of two new helpers, which follow house
     style. No test was weakened, skipped, or deleted without a recorded
     replacement in the remediation range; no secret or machine-local path
     was added to a tracked file.

### Requirement evidence (second pass)

Runs at `93b38c5` (darwin arm64, Node 24.14.0): **Q** `pnpm gate:quick` PASS
(unit 2982/2982, agent-readiness 357/357, census 13/13); **A**
`pnpm test:architecture` 132/132; **C** 13 contract files 276/276; **I** 16
integration files 239/239; **S** 8 security files 83/83; **U** 17 feature
unit files 345/345; **E** 9 e2e files 85/85 (Codex account, coordinated,
grant renewal, examples, subscription, Windows, task CLI, mediated, path
case); **F** `task-coordinated-crash-faults` 1/1; **B**
`sealed-self-containment` 7/7. Every run 0 failed, 0 skipped, 0 todo, no
temporary entry left. **M** the platform matrix at this head (Gates below).

| ID | Verdict | Evidence at `93b38c5` (`file:line` — what it asserts) | Run | Note |
| --- | --- | --- | --- | --- |
| SSI-01 | PASS | `tests/agent-readiness/dependency-policy.test.mjs:51` exact pins in agent-runtime only, `:73` lockfile resolution, `:96` installed 1.19.0 with exactly its required peers | Q | D1 still awaits the owner's own confirmation |
| SSI-02 | PASS | `tests/architecture/strands-coordination-subpath.test.mjs:69` only `./multiagent`; P16a, P16b killed | A, B | — |
| SSI-03 | PASS | `strands-coordination-subpath.test.mjs:87` bans; `tests/integration/strands-empty-environment.test.mjs:50` no Bedrock client, control `:69`; P15a, P15b killed | A, I | — |
| SSI-04 | PASS | `tests/integration/strands-coordination-engine.test.mjs:245` exactly `id`, `invoke`, `stream`, calls the runner; `:53`, `:126` | I | — |
| SSI-05 | PASS | `strands-coordination-engine.test.mjs:326` `preserveContext` false; resume replays the ledger, `:215` | I | Graph nodes' `preserveContext` not asserted |
| SSI-06 | PASS | `strands-coordination-engine.test.mjs:245` the SDK's input ignored; `tests/unit/node-result.test.mjs:103` | I, U | — |
| SSI-07 | PASS | `strands-coordination-engine.test.mjs:245` graph node; `:272` swarm node hands `{agentId, message: token}` or `{message: token}`, no provider text; R-M7 killed | I | First-pass finding 7 closed |
| SSI-08 | PASS | `strands-coordination-engine.test.mjs:300` code only, no cause; `:101` | I | — |
| SSI-09 | PASS | `strands-coordination-engine.test.mjs:326` exact finite limits; `:67` | I | — |
| SSI-10 | PASS | `strands-coordination-engine.test.mjs:351`; `:150` | I | — |
| SSI-11 | PASS | `tests/contract/task-request-v2.test.mjs:56`; the application's third-party import ban | C, A | — |
| SSI-12 | PASS | `strands-coordination-subpath.test.mjs:69`, `:110` | A | — |
| SSI-13 | PASS | `strands-coordination-subpath.test.mjs:110`; `tests/integration/task-coordination-loading.test.mjs:40`, `:46`, control `:52` | A, I | — |
| SSI-14 | PASS | `strands-coordination-subpath.test.mjs:143`; `task-coordination-loading.test.mjs:52`; the node driver factory runs in the graph and swarm journeys on all five legs | A, I, M | — |
| SSI-15 | PASS | `tests/integration/coordinated-executor.test.mjs:65`; P04 killed | I | — |
| SSI-16 | PASS | `git diff 7e274f2 93b38c5 -- packages/application/src/execution/task-scheduler.ts` empty; one `execute` per run (`coordinated-executor.test.mjs:65`) | I | — |
| SSI-17 | PASS | `tests/unit/coordinated-driver.test.mjs:506` node usage names its own provider, another fails the node; `tests/integration/coordinated-node-adapters.test.mjs:83` real sessions name `openai`, `anthropic`, `openai`; R-M14a killed | U, I | First-pass finding 14 closed |
| SSI-18 | PASS | `task-request-v2.test.mjs:482-487` a Codex write scope refused; `coordinated-driver.test.mjs:145`; `tests/e2e/task-coordinated-e2e.test.mjs:75` read-only, no tool | C, U, E | — |
| SSI-19 | PASS | `task-coordinated-e2e.test.mjs:75` the verifier's prompt holds no node result, three Codex sessions | E, M | — |
| SSI-20 | PASS | `git diff 7e274f2 93b38c5 -- schemas/task-request/1.schema.json` empty; `tests/contract/task-request-v1-golden.test.mjs:24`, `:31` | C | — |
| SSI-21 | PASS | `task-request-v1-golden.test.mjs:42`, `:71` | C | Goldens recorded by the authors; not re-recorded |
| SSI-22 | PASS | `task-request-v1-golden.test.mjs:61`; `tests/integration/task-coordinated-plan.test.mjs:78`, `:90`, `:97` | C, I | — |
| SSI-23 | PASS | `task-request-v2.test.mjs:162` | C | — |
| SSI-24 | PASS | `task-request-v2.test.mjs:256-291` | C | — |
| SSI-25 | PASS | `task-request-v2.test.mjs:463-470`, `:517`; P02 killed | C | — |
| SSI-26 | PASS | `task-request-v2.test.mjs:471-502`; P03 killed | C | — |
| SSI-27 | PASS | `task-request-v2.test.mjs:504-512`, `:417` | C | — |
| SSI-28 | PASS | `tests/unit/task-plan-binding.test.mjs:69` one case per element, `:74` all distinct; P01 killed | U | — |
| SSI-29 | PASS | `task-coordinated-plan.test.mjs:205` start and resume, v1 and v2: a consistent rewrite is refused `VES_TASK_PACKAGE_INVALID` before the billing preflight, a transition, a claim, or a file; `:228` a package the approval intent does not bind; R-M6b, O7 killed | I | First-pass finding 6 closed |
| SSI-30 | PASS | `tests/unit/task-coordination-surface.test.mjs:22-53`; `tests/unit/task-billing.test.mjs:220`, `:244`; `task-plan-binding.test.mjs:114`; `tests/e2e/task-cli-e2e.test.mjs:823` | U, E | — |
| SSI-31 | PASS | `tests/contract/cli-surface.test.mjs:72`, `:149`; v2 journeys drive every command on all five legs | C, M | — |
| SSI-32 | PASS | `task-coordinated-plan.test.mjs:348`, `:410`; `tests/e2e/task-subscription-e2e.test.mjs:118`, `:280` | I, E | — |
| SSI-33 | PASS | `tests/unit/task-resumption.test.mjs:70`, `:82`, `:92` at a node; `:118`, `:125`, `:131` at the verifier; `task-coordinated-plan.test.mjs:127`, `:149` resume refusals change nothing; `tests/e2e/task-codex-account-e2e.test.mjs:140`; P12, R-M11d, O14 killed | U, I, E | O12, O13 survive (finding 6) |
| SSI-34 | PASS | `task-coordinated-e2e.test.mjs:138` the running node's provider ends, run `ABORTED`, on all five legs; `strands-coordination-engine.test.mjs:184`; `coordinated-driver.test.mjs:441` | E, I, U, M | — |
| SSI-35 | PASS | `task-coordinated-e2e.test.mjs:50`, `:75` the typed-back surface digest | E | — |
| SSI-36 | PASS | `tests/e2e/task-request-examples-e2e.test.mjs:62` | E, M | — |
| SSI-37 | PASS | `task-request-v2.test.mjs:162`, `:198-207`; P06a, P06b killed | C | — |
| SSI-38 | PASS | `task-request-v2.test.mjs:198-216`, `:233-254`; `task-plan-binding.test.mjs:69` (limits bound) | C, U | — |
| SSI-39 | PASS | `coordinated-executor.test.mjs:65`; `tests/unit/task-run-coordinator.test.mjs:312` | I, U | — |
| SSI-40 | PASS | `coordinated-driver.test.mjs:126`; `strands-coordination-engine.test.mjs:163`; P05 killed | U, I | — |
| SSI-41 | PASS | `coordinated-driver.test.mjs:145`; `coordinated-executor.test.mjs:65`; P04 killed | U, I | — |
| SSI-42 | PASS | `coordinated-node-adapters.test.mjs:135` a Claude Code node whose read scope is narrower than the change scope is answered `denied: VES_BRIDGE_SCOPE_DENIED`, positive control in the same case; X04 killed (1 of 10). Codex nodes, outside the current text: `:164`, `:194`, `:210`, `tests/integration/read-scope-view.test.mjs:46`, `:71`; R-V1, R-V6, R-M4r, O1, O2, O3 killed | I | First-pass finding 4 closed for the text as written; see finding 4 for the amendment |
| SSI-43 | PASS | `node-result.test.mjs:32`; `tests/contract/strands-node-result-parity.test.mjs:31`, `:67`; P07 killed | U, C | — |
| SSI-44 | PASS | `node-result.test.mjs:56`, `:89`; `coordinated-driver.test.mjs:310`, `:318`; `strands-coordination-engine.test.mjs:141` | U, I | — |
| SSI-45 | PASS | `coordinated-driver.test.mjs:331`; `strands-coordination-engine.test.mjs:150` | U, I | — |
| SSI-46 | PASS | `coordinated-node-adapters.test.mjs:55` Claude Code missing and retries, `:71` Codex missing and unreadable, each `VES_COORDINATION_RESULT_INVALID`, nothing persisted, the driver's code in `driver-finished`; `coordinated-driver.test.mjs:228`; R-M3a, R-M3b killed | I, U | First-pass finding 3 closed |
| SSI-47 | PASS | `coordinated-node-adapters.test.mjs:63`, `:71` over the node bound `VES_COORDINATION_RESULT_TOO_LARGE`; `node-result.test.mjs:96`; `coordinated-driver.test.mjs:191`; P08 killed | I, U | First-pass finding 3 closed |
| SSI-48 | PASS | `tests/integration/driver-execution-adapter.test.mjs:337` | I | — |
| SSI-49 | FAIL | Ledger: `tests/security/coordination-record-security.test.mjs:31`; results screened: `coordinated-driver.test.mjs:247`, `coordination-record-security.test.mjs:97`, `coordinated-node-adapters.test.mjs:222`; R-M5a, R-M5b, O4, O5 killed | U, S, I | Finding 2: the Codex login is not withheld (`tests/unit/task-coordination-withheld.test.mjs:52`) |
| SSI-50 | PASS | `node-result.test.mjs:103` | U | — |
| SSI-51 | PASS | `task-billing.test.mjs:162`, `:172`; `task-coordinated-plan.test.mjs:127`; `task-subscription-e2e.test.mjs:79` | U, I, E | — |
| SSI-52 | PASS | `task-billing.test.mjs:260` the reported plan type must equal the stated one, `unknown` refused; `task-codex-account-e2e.test.mjs:192` a statement naming `pro` against a `plus` login is `not configured` at `start` before anything; `task-coordinated-plan.test.mjs:149`; P12, R-M2a, R-M2e, O9 killed | U, I, E | First-pass finding 2 closed on the current text |
| SSI-53 | PASS | `task-billing.test.mjs:119`, `:126`; `tests/security/codex-account-security.test.mjs:36`, `:51` | U, S | — |
| SSI-54 | PASS | `tests/contract/claude-code-driver-structured.test.mjs:172`; P09 killed | C | Live value unobserved (owner probe) |
| SSI-55 | PASS | `tests/contract/codex-driver-structured.test.mjs:282`, `:295`; P10, O10 killed; the v2 verifier too, `tests/integration/codex-verifier-session.test.mjs:242`, R-M1a killed | C, I | Text names node sessions; the amendment matches the code |
| SSI-56 | PASS | `codex-driver-structured.test.mjs:312`; `tests/unit/coordinated-suspension.test.mjs:196`; `task-subscription-e2e.test.mjs:164`; the v2 verifier, `codex-verifier-session.test.mjs:262`, `task-codex-account-e2e.test.mjs:77` | C, U, I, E | First-pass finding 1 closed for v2; v1 credits are an open owner decision |
| SSI-57 | PASS | `codex-driver-structured.test.mjs:77`, `:96`, `:111`; `tests/architecture/codex-client-methods.test.mjs:42`, `:49`, `:60`; P11 killed | C, A | — |
| SSI-58 | PASS | `claude-code-driver-structured.test.mjs:187`, `:214`; `codex-driver-structured.test.mjs:346`, `:376`, `:392`; the warning recorded in the run, `coordinated-node-adapters.test.mjs:241`, `driver-execution-adapter.test.mjs:172`; R-M8b killed | C, I | First-pass finding 8 closed |
| SSI-59 | PASS | `coordinated-suspension.test.mjs:48`, `:107`, `:140`; `coordinated-executor.test.mjs:162` | U, I | — |
| SSI-60 | PARTIAL | At a node: `coordinated-executor.test.mjs:162`, `task-run-coordinator.test.mjs:274`; P13 killed. At the verifier the run stays `VERIFYING`: `task-run-coordinator.test.mjs:382` | I, U | Finding 5; R1's amendment makes it PASS |
| SSI-61 | PARTIAL | `coordinated-suspension.test.mjs:228`; `tests/security/task-suspension-security.test.mjs:61`; the window `scope` is a fifth member | U, S | Finding 5; no amendment text yet |
| SSI-62 | PASS | No path acts on `resetsAt`, retries, or switches (read across `task-run.ts`, `task-codex.ts`, `coordinated-driver.ts`, `task-resumption.ts`); `task-subscription-e2e.test.mjs:118` | E | Absence, by reading |
| SSI-63 | PASS | `task-subscription-e2e.test.mjs:118`; `task-coordinated-plan.test.mjs:348` | E, I | — |
| SSI-64 | PASS | `git diff 7e274f2 93b38c5 -- packages/domain/src/workflow/` empty; `task-run-coordinator.test.mjs:274`, `:382` | U | — |
| SSI-65 | PASS | `coordinated-suspension.test.mjs:362`, `:478` | U | — |
| SSI-66 | PASS | `task-resumption.test.mjs:146`, `:154`; `coordinated-suspension.test.mjs:379`, `:387`, `:406`; `tests/fault-injection/task-coordinated-crash-faults.test.mjs:35` on all five legs; P14 killed | U, F, M | — |
| SSI-67 | PASS | `coordinated-suspension.test.mjs:362`; `task-resumption.test.mjs:137` | U | — |
| SSI-68 | PASS | `task-run-coordinator.test.mjs:312` | U | — |
| SSI-69 | PASS | `tests/integration/bridge-transport-seam.test.mjs:195`; Unix legs green | I, M | — |
| SSI-70 | PASS | `bridge-transport-seam.test.mjs:72-159` | I | — |
| SSI-71 | PASS | `tests/unit/windows-pipe-transport.test.mjs:34`, `:106`, `:121`, `:258`; the win32 cases of `tests/security/windows-pipe-bridge-security.test.mjs:167-336` passed on the Windows `gate:security` leg of run 37197307202 at `f285f2b` (the same code); at this head that leg hung before reporting them (finding 3) | U, M | Another user's access untested |
| SSI-72 | PASS | `windows-pipe-transport.test.mjs:63`, `:71`, `:121` | U | — |
| SSI-73 | PASS | `tests/unit/task-windows.test.mjs:95`, `:127`, `:141` both mediated profiles; `tests/integration/task-run-prerequisites.test.mjs:140`, `:154`, `:162` before any credential, claim, lease, transition, or worktree, after the statement; R-M10a, R-M10b killed | U, I, M | First-pass finding 10 closed |
| SSI-74 | PASS | `tests/contract/claude-code-driver-managed-policy.test.mjs:60`, `:82-107`; `tests/unit/windows-registry.test.mjs:70` on win32 | C, M | — |
| SSI-75 | PASS | `windows-pipe-transport.test.mjs:310`; `windows-pipe-bridge-security.test.mjs:269` on win32 at `f285f2b` (run 37197307202) | U, M | Not re-observed at this head (finding 3) |
| SSI-76 | PASS | `windows-pipe-bridge-security.test.mjs:95`, `:104` on every leg that finished; win32 `:194`, `:204`, `:217`, `:233` at `f285f2b` (run 37197307202) | S, M | Second client refused by the kernel (recorded deviation); the win32 cases not re-observed at this head (finding 3) |
| SSI-77 | PASS | Lifted after the transport qualified; `tests/e2e/task-windows-e2e.test.mjs:139`, `tests/contract/claude-code-driver-windows.test.mjs:239`, and now every coordinated journey, on the Windows legs | M | — |
| SSI-78 | PASS | Fakes and fixtures only; the coordinated journeys execute on all five legs at second scale (Gates); the Codex protocol spike states the version it ran against and, on the fleet, asserts the refusal below the floor (`spikes/codex-driver/test/codex-driver-structured.test.mjs:153`, log "ran against Codex 0.115.0") | E, M | First-pass finding 11 closed; the floor protocol evidence stays local (recorded limit) |
| SSI-79 | PASS | `strands-empty-environment.test.mjs:50`, control `:69`; P15b killed | I | — |
| SSI-80 | PASS | Every check SSI-80 names has a killer: binding P01; limits P06a, P06b, X01–X03 (first pass); destination P07, R-M7; scope narrowing P03, P04, X04; single writer P05; authentication P09, P10, O10, R-M1a; billing block P12, R-M2a, R-M2e, O9 | — | First-pass finding 12 closed |
| SSI-81 | PARTIAL | `coordination-record-security.test.mjs:31`, `:97`; `task-suspension-security.test.mjs:39`, `:61`, `:112`; `tests/security/coordinated-surface-security.test.mjs:52`, `:80`; `codex-account-security.test.mjs:36` | S | Follows SSI-49 (finding 2) |
| SSI-82 | PASS | `tests/build/sealed-self-containment.test.mjs:115`; `test:build` 179/179 on every build leg | B, M | — |
| SSI-83 | FAIL | `task-request-v1-golden.test.mjs`; `task-coordination-loading.test.mjs:40`, `:46`; `codex-verifier-session.test.mjs:252` | C, I | Finding 1; AD-080 item 5 (`state-path-length`, scratch layout) still awaits the owner's approval |
| SSI-84 | PENDING | `docs/qualification/coordinated-run-pilots.md`: every platform and mode pending (owner) | M | — |
| SSI-85 | PASS | Quota suspension qualified with the labelled fakes only, now on all five legs (`coordinated-executor.test.mjs:162`; `task-subscription-e2e.test.mjs:118`, `:164`; `task-codex-account-e2e.test.mjs:77`, `:110`) | I, E, M | — |

**Counts**: PASS 79, PARTIAL 3 (SSI-60, SSI-61, SSI-81), FAIL 2 (SSI-49,
SSI-83), PENDING 1 (SSI-84).

**Rows that hinge on the spec amendments T10 applies.**

| Row | On the current text | With the proposed amendment |
| --- | --- | --- |
| SSI-42 | PASS (the bridge confines a Claude Code node) | PASS for the copy, once its residual clause names any read outside the copy (finding 4); the copy is not removed on an interrupted command (finding 7) |
| SSI-52 | PASS (the plan type is compared at `start` and `resume`) | PASS; the amendment adds the closed vocabulary the code already enforces |
| SSI-55 | PASS (node sessions) | PASS; the v2 verifier reads its account (`codex-verifier-session.test.mjs:242`) |
| SSI-56 | PASS (node sessions) | PASS; the v2 verifier's credits suspend the run (`:262`, `task-codex-account-e2e.test.mjs:77`) |
| SSI-60 | PARTIAL (`VERIFYING` at the verifier) | PASS (R1's text) |
| SSI-61 | PARTIAL (`scope` kept) | PASS once a text adds the window `scope` in its closed grammar; none is proposed yet |
| TM-004 | Open in part | Accepted residual, once worded as in finding 4 |
| SSI-83 | FAIL (finding 1) | R1's open v1 amendment covers v1 credits only; it does not cover finding 1 |

**Decisions.** D1 PASS in code, owner confirmation still due; D2 PASS (P16b);
D3 PASS (plan type compared, `task-billing.test.mjs:260`); D3b PASS for v2
(nodes and verifier), v1 credits an open owner decision (AD-082); D4 PASS
(P14, `task-resumption.test.mjs:154`); D5 PASS
(`task-coordination-loading.test.mjs:46`); D6 PASS; D7 assumptions; D8
pending the owner; D9 PASS.

**Edge cases.** Writer dies after a write → partial, reconcile: PASS
(`coordinated-suspension.test.mjs:166`, `:387`). Drift on resume: PASS
(`task-resumption.test.mjs:92`). Approval expires while suspended: PASS
(`task-resumption.test.mjs:82`, `:125`; journey `task-subscription-e2e.test.mjs:339`).
`allowed_warning` recorded: PASS (`coordinated-node-adapters.test.mjs:241`).
Two quota signals → one suspension: PASS (`coordinated-suspension.test.mjs:140`).
A swarm revisit has its own entry and result: PASS (`coordinated-driver.test.mjs:331`);
counted against the run's limit: by reading (`coordinated-driver.ts:580`, `:591`).
`success` without `structured_output` or retries exhausted →
`VES_COORDINATION_RESULT_INVALID`: PASS (`coordinated-node-adapters.test.mjs:55`).

### Discrimination sensor (second pass)

Each mutant applied in place, its suites run through `scripts/test-scope.mjs`,
then `git restore`; `git status --porcelain` was empty before and after every
run.

**Planned list, re-run in full** (16 rows, 19 runs, all killed):

| Mutant | Row | Killer (failed of total) |
| --- | --- | --- |
| P01 node `instructions` out of both package digests | SSI-28 | unit `task-plan-binding` 2/23 |
| P02 Kahn's result ignored | SSI-25 | contract `task-request-v2` 3/97 |
| P03 only read scopes checked against the change scope | SSI-26 | same 2/97 |
| P04 node write-scope narrowing removed | SSI-41 | unit `coordinated-driver` 1/26; integration `coordinated-executor` 1/9 |
| P05 writer mutex removed | SSI-40 | unit 1/26; integration `strands-coordination-engine` 1/17 |
| P06a default `maxEdges` 129; P06b default `runResultBytes` + 1 | SSI-37 | contract 4/97; 2/97 |
| P07 the application validator accepts an undeclared target | SSI-43 | unit `node-result` + `coordinated-driver` 2/35; integration 1/17 |
| P08 result persisted before its bounds and checks | SSI-47 | unit `coordinated-driver` 4/26 |
| P09 `apiKeySource` check removed | SSI-54 | contract `claude-code-driver-structured` 1/9 |
| P10 Codex account type check removed | SSI-55 | contract `codex-driver-structured` 2/17 |
| P11 `account/rateLimitResetCredit/consume` allowed | SSI-57 | contract 2/17; architecture `codex-client-methods` 1/3 |
| P12 billing preflight skipped at resume | SSI-52 | integration `task-coordinated-plan` 5/26; e2e `task-subscription-e2e` 1/9 |
| P13 worktree cleaned up on a suspension | SSI-60 | integration `coordinated-executor` 1/9 |
| P14 an unsettled node re-run without its digest | SSI-66 | unit `coordinated-suspension` 3/19 |
| P15a, P15b a Strands `Agent` constructed in the engine | SSI-03, SSI-79 | architecture 2/6; probe alone 2/2 |
| P16a, P16b the SDK root entry imported | SSI-02 | architecture 1/6; build `sealed-self-containment` 1/7 |

**Survivors of the first pass**: X04 (a Claude Code node gets the change
scope) killed, integration `coordinated-node-adapters` 1/10; X06 (renew a
revoked grant, in `renewsGrant`) killed, unit `task-grant-renewal` 1/7; X07
(renewal armed on every resume) killed, e2e `task-grant-renewal-e2e` 1/2.

**Remediation mutants, sampled (19, all killed)**: R2 — R-M3a Claude Code
adapter skips the structured mapping (`coordinated-node-adapters` 4/10),
R-M3b Codex adapter likewise (2/10), R-V1 a Codex node in the worktree
(2/10), R-V6 the view ignores protected paths (1/10), R-M4r no clearing of a
stale view (1/10), R-M5a no screen (unit 1/26, security 1/2), R-M5b no
withheld list from the composition (1/10), R-M7 the provider's message to the
SDK (`strands-coordination-engine` 1/17), R-M8b the Codex adapter drops
warnings (1/10), R-M14a no provider on node usage (unit 1/26). R1 — R-M1a the
v2 verifier not subscription-only (`codex-verifier-session` 3/17), R-M2a any
reported plan type accepted (`task-billing` 1/46), R-M2e the plan type never
read (`task-codex-account-e2e` 1/4), R-M6b the execution contract not
compared (`task-coordinated-plan` 4/26), R-M10a the policy for the
subscription profile only (unit 1/15, integration 2/7), R-M10b the
prerequisites after the credential read (`task-run-prerequisites` 7/7), R-X10
no lifetime cap (unit 1/7), R-X12 the replaced grant not recorded (e2e 1/2),
R-M11d the anchored branch not compared at a verifier resume (e2e 1/4).

**My mutants** (12; 9 killed, 3 survived):

| Mutant | Target | Suites run | Result |
| --- | --- | --- | --- |
| O1 a binary file copied into a Codex node's view | read-scope copy | `read-scope-view`, `coordinated-node-adapters` | Killed (1/3, 1/10) |
| O2 the view's removal at node end dropped, the root's removal error swallowed | read-scope copy | `coordinated-node-adapters` | Killed (2/10) |
| O3 the view's root directory left writable | read-scope copy | `read-scope-view`, `coordinated-node-adapters` | Killed (1/3, 1/10) |
| O4 a swarm handoff message not screened | result screening | unit `coordinated-driver` | Killed (1/26) |
| O5 the Claude Code credential not withheld | result screening | unit `task-coordination-withheld`, security `coordination-record-security` | Killed (2/2, 1/2) |
| O7 the approved-package proof at `start` only | approved-package check | `task-coordinated-plan` | Killed (2/26) |
| O9 an account reporting `unknown` accepted | plan-type comparison | unit `task-billing`, security `codex-account-security` | Killed (1/46, 1/2) |
| O10 an account-only session reports the plan of a login that is not ChatGPT | plan-type comparison | contract `codex-driver-structured`, integration `codex-verifier-session` | Killed (1/17, 1/17) |
| O12 the task commit's parent not checked at a verifier resume | verifier-suspension resume | e2e `task-codex-account-e2e`; then integration `task-commit-recovery`, `task-branch-anchoring`, `task-coordinated-plan`, unit `task-resumption`, `task-run-coordinator`, e2e `task-subscription-e2e`, `task-cli-e2e` | **Survived** (finding 6) |
| O13 the recorded commit's base not compared with the plan's revision | verifier-suspension resume | same | **Survived** (finding 6) |
| O14 a resume at the verifier arms the grant renewal | verifier-suspension resume | unit `task-resumption` | Killed (1/21) |
| O15 the composition drops a stored grant's revocation before the renewal decision | grant renewal | e2e `task-grant-renewal-e2e`; then integration `task-coordinated-plan`, `task-run-containment`, unit `task-grant-renewal`, `task-run-record-readers`, e2e `task-subscription-e2e`, `task-codex-account-e2e` | **Survived** (finding 6) |

Sensor depth: P0 (billing, authority, records). 53 mutants in 56 runs (the
three survivors were run again against the wider suites named above): 50
killed, 3 survived.

### Threat model (second pass)

| Item | Verdict at `93b38c5` | Evidence |
| --- | --- | --- |
| TM-001 Bedrock through the SDK | Closed | P15a, P15b, P16a, P16b |
| TM-002 paid usage after the allowance | Closed for v2, residual as designed | Statement and typed quota signals for nodes and the v2 verifier; credits refused for both (R-M1a); plan type compared at `start` and `resume` (R-M2a, R-M2e, O9). Residual: the server-side setting is unverifiable; a v1 run on a subscription can still spend Codex credits at verification (owner decision, AD-082); a plan changed mid-run is seen at the next resume |
| TM-003 API-key overlay | Closed for v2 | Preflight (P12); `apiKeySource` (P09); `account/read` for nodes, the v2 verifier, and the account-only session (P10, R-M1a, O10) |
| TM-004 injected escalation | Open in part | Writes narrowed (P04); Claude Code reads narrowed (X04); a Codex node starts in its read-only copy (R-V1, R-V6), but its sandbox reads anything by an absolute path or through `..`, the Codex identity included (findings 2, 4) |
| TM-005 handoff hijack | Closed | P07, R-M7 |
| TM-006 credit-consuming RPC | Closed | P11 |
| TM-007 request edited after approval | Closed | `requireApprovedRequest` (R-M6b, O7) |
| TM-008 runaway output or loop | Closed | P06a, P06b, P08; first-pass X01–X03 |
| TM-009 duplicate effects on resume | Closed | P14 |
| TM-010 forged ledger or result | Closed (same-user out of scope) | Sealed by digest; the seal is unkeyed |
| TM-011 drift while suspended | Closed in part | Worktree drift (`task-resumption.test.mjs:92`); at the verifier the branch half is tested (R-M11d), the base and parent halves are not (O12, O13) |
| TM-012 pipe squatting | Closed on the runner, at `f285f2b` | win32 security cases on the Windows leg of run 37197307202 (same code); at this head that leg hung before reporting them (finding 3); another user's access untested |
| TM-013 logging, injection in the helper | Closed | `windows-pipe-transport.test.mjs:63`, `:71`, `:90` |
| TM-014 managed policy on Windows | Closed for both profiles | R-M10a, R-M10b |
| TM-015 personal data in records | Open in part | Plan type a closed value (`codex-account-security.test.mjs:36`); the Codex login is not withheld from node results (finding 2) |
| TM-016 supply chain | Closed as designed | Exact pins; D1 awaits the owner |
| TM-017 telemetry export | Closed | Ban test; no tracer provider |
| TM-018 node output as verification | Closed | `task-coordinated-e2e.test.mjs:75` on all five legs |
| TM-019 a node survives cancel | Closed | `task-coordinated-e2e.test.mjs:138` on all five legs |
| TM-020 a looser self-containment check | Closed | P16b |

The owner's focus points. **AD-081's residual**: confirmed by reading
(Codex's documented read-only mode, no readable root in the thread
parameters, `packages/drivers/src/codex-driver.ts:523-534`), and wider than
recorded (finding 4); what it can carry into the Run record is limited by the
screen except for the Codex login itself (finding 2). **Grant renewal bounds
(AD-079, AD-082)**: renewal only when a resume from a suspension armed it
(X07, O14), never a revoked or unknown grant at the decision (X06,
`task-grant-renewal.test.mjs:46`), only when the grant would lapse first and
the new one outlives it (`:50`, `:56`), capped at the earlier of the
approval's expiry and the longest duration plus the margin (R-X10), and the
replaced grant recorded (R-X12); the composition's hand-off of a revocation
is untested (O15). **No paid path**: no Strands model, no API-key fallback in
a v2 run, no credit method reachable, nodes and the v2 verifier refuse
credits before their turn; v1 verification on a subscription can still spend
credits (owner decision). **Records**: finding 2. **Windows**: the
prerequisites hold for both mediated profiles before any credential (R-M10a,
R-M10b), the pipe cases passed on the same code at `f285f2b` but hung this
head's Windows security leg (finding 3), and Git's path budget is
exact (first-pass X05); the `state-path-length` refusal and scratch layout of
AD-080 item 5 still await the owner (SSI-83 note).

### Gates (second pass)

Local (darwin arm64, Node 24.14.0, at `93b38c5`): `pnpm gate:quick` PASS
(format, lint, complexity, typecheck; unit 2982, agent-readiness 357, census
13); `pnpm test:architecture` 132/132; `pnpm agent:check` PASS; the focused
runs above; 0 failed, 0 skipped, 0 todo.

Platform matrix at `93b38c5`, read from each job's log. Every stage that
finished has 0 failed, 0 cancelled, 0 skipped, 0 todo; one leg did not
finish (finding 3):

| Run | Gate (per-stage counts) | Windows x64 | macOS x64 | macOS arm64 | Linux glibc x64 | Linux glibc arm64 |
| --- | --- | --- | --- | --- | --- | --- |
| 37198997592 | `gate:full` (unit 2982, contract 957, integration 1241, e2e 300, fault 310, mutation 8) | success | success | success | success | success |
| 37198999663 | `gate:build` (unit 2982, contract 957, integration 1241, e2e 300, architecture 132, build 179, qualification 358) | success | success | success | success | success |
| 37199001702 | `gate:security` (unit 2982, contract 957, e2e 300, architecture 132, qualification 358, security 1351, fault 310) | **cancelled**: unit, contract, e2e, architecture, and qualification passed; security hung after 1317 of 1351 and hit the 60-minute limit; fault not run | success | success | success | success |

The coordinated journeys now execute everywhere. In every leg's log the 14
journeys R3 named (four in `task-coordinated-e2e`, nine in
`task-subscription-e2e`, the crash fault where the gate runs fault, except on
the Windows `gate:security` leg, whose fault stage never ran) and the six
R1 added (`task-codex-account-e2e`, `task-grant-renewal-e2e`) pass at second
scale: agent, graph, swarm, and cancel take 5.0–7.6 s on Linux, 5.2–8.6 s
on macOS arm64, 12.9–16.1 s on macOS x64, and 13.1–34.2 s on Windows in
`gate:full`, and across every leg the journeys take 2.5 to 42.1 s. None
returns early. The Codex protocol
spike states "ran against Codex 0.115.0; the structured floor is 0.159.3" on
the fleet. The `tlc-spec-driven` completion gate (`validate_state.py`) exits
1 on this file: it reads the result lines of every section together and
reports them as an unfilled verdict. This pass is FAIL either way, so the
feature is not done.

### Coordinated-run pilots (second pass)

`docs/qualification/coordinated-run-pilots.md` now records the stand-in
qualification at `93b38c5`; the owner's pilots are unchanged and never
inferred:

| Platform | Real-subscription pilots (agent, graph, swarm) | Deterministic stand-ins at `93b38c5` |
| --- | --- | --- |
| Windows x64 | pending (owner) | Every coordinated journey executed and passed in `gate:full` and `gate:build`, and every e2e journey in `gate:security`, whose fault stage never ran (finding 3) |
| macOS arm64 | pending (owner) | Executed and passed in all three gates |
| macOS x64 | pending (owner) | Executed and passed in all three gates |
| Linux glibc x64 | pending (owner) | Executed and passed in all three gates |
| Linux glibc arm64 | pending (owner) | Executed and passed in all three gates |

### Not verified, and why

- Anything that needs a real subscription: the live `apiKeySource`, the live
  `structured_output`, real quota, credit, and plan-type signals, whether a
  real Codex App Server reads outside its working directory (findings 2 and 4
  rest on Codex's documented modes) and accepts a working directory that is
  not a Git checkout, and every pilot.
- The win32 behaviour of the read-scope copy outside the journeys: the
  integration cases of `coordinated-node-adapters` assert the Windows refusal
  of the fake's POSIX launcher there instead; the graph journey exercises the
  copy on Windows.
- `tests/build/sealed-launcher-closure.test.mjs` locally (disk); its matrix
  result is above.
- Lessons distillation (`lessons.py`) was not run: it writes outside the
  files this verification may change.

**Next action**: re-run the Windows leg of `gate:security` (finding 3) and
bound the named-pipe cases; fix tasks for findings 1, 2, and 6 (an
implementer who is not this verifier); the amendment texts of findings 4 and
5 for T10; the owner's decisions on SSI-83 (finding 1 and AD-080 item 5) and
D1; then a fresh verification of SSI-49, SSI-81, SSI-83, and the survivors.

### Remediation R4 (second-pass findings)

**Author**: an implementation session that wrote neither verification.
**Base**: `91a7916` (`origin/main`). **Branch**: `strands/t9r4-final-fixes`.
The second pass's findings and citations above are left as written; this
section records the fixes, their evidence, and the amendment texts T10 applies.
No real provider was called and no real Codex login was read: every login,
token, and key below is a fixture value.

| Commit | Finding | Change |
| --- | --- | --- |
| `0f46028` | 1 (SSI-83) | A v1 verifier does not observe a usage limit, so it fails the run as before; only a v2 verifier suspends (`apps/vestra-cli/src/task/task-codex.ts:355`, under the `subscriptionOnly` of `:312`) |
| `6af0598` | 2 (SSI-49, SSI-81, TM-015) | `codexLoginSecrets` (`apps/vestra-cli/src/task/task-codex-identity.ts:72`) reads the identity directory's `auth.json` only to withhold its `access_token`, `refresh_token`, `id_token`, and every field named like an API key (`:33`, `:34`); `nodeResultWithheld` adds them (`task-coordination.ts:122`); a file that is not a login is `not configured` (`codex-login`) with no cause (`task-codex-identity.ts:38`); the coordinated driver resolves the withheld text for every result it screens (`packages/application/src/execution/coordinated-driver.ts:593`), so a token Codex renews mid-round is withheld |
| `56a041d` | 3 (gate) | Every case of `tests/security/windows-pipe-bridge-security.test.mjs` has `PIPE_CASE` (120 s); every wait in it is `settlesWithin` 45 s with a diagnostic (`tests/helpers/pipe-bridge-fixture.mjs:17`, `:20`, `:33`); a relay request is rejected when the relay exits before answering (`tests/helpers/mcp-bridge-fixture.mjs:96`); the cleanup is bounded and destroys every raw client (`pipe-bridge-fixture.mjs:61`) |
| `01c317d` | 4 (SSI-42, TM-004) | AD-081 in `.specs/STATE.md`: the residual is any read outside the copy; the "confines every read relative to the working directory" reason is corrected; moving the copy out of the state tree is a rejected alternative |
| `eb5b5fd` | 6 (O12, O13, O15) | Killer cases in the verifier-resume and grant-renewal journeys |

**Evidence by finding.**

1. SSI-83: `tests/integration/codex-verifier-session.test.mjs:266` — a v1
   verifier under the fake's `usage-limit` scenario, on a subscription and on
   an API key, is refused `VES_TASK_FAILED` `{reason: VES_TASK_VERIFIER_FAILED}`
   (`:270`), the outcome of `c3223c6` (no quota handling: a failed session
   is `VES_TASK_VERIFIER_FAILED` when there is no meter refusal, ceiling, or
   cancel), opens one turn with no account read, and leaves no session root.
   The v2 cases (`:280`, `:288`) and the agent-run journeys
   (`tests/e2e/task-codex-account-e2e.test.mjs:78`, `:111`) still suspend.
2. SSI-49: `tests/unit/task-coordination-withheld.test.mjs:76` asserts the
   values are the Claude Code credential then the access, refresh, and ID
   tokens and the API key (`:78`), a ChatGPT-only login without its null key
   (`:87`), and a directory with no login file only the Claude Code credential
   (`:93`); `:98` refuses a file that is not JSON, an array, and `null` as
   `codex-login` with no cause and none of the file's text (`:104`).
   `tests/security/coordination-record-security.test.mjs:148`: a swarm whose
   reviewer's summary carries each of the four login secrets, and one carrying
   an access token the writer node renews in `auth.json` after the round
   opened, is refused `VES_COORDINATION_RESULT_INVALID`; only the writer's
   result is persisted (`:213`) and no persisted file holds the secret; the
   same run naming no secret completes (`:206`, the control).
3. Gate: the cause the code shows is the relay fixture. `request` waited
   only for an answer, and the relay exits 1 when its own five-second
   authentication wait ends (`packages/agent-runtime/src/execution/mcp-tool-bridge.ts:321-327`),
   which on Windows spans the relay, the pipe, two .NET copy tasks in the
   PowerShell helper, and the controller; a relay that exited first left
   `relay.initialize()` or a call (4 cases) waiting for ever, and no case had
   a timeout. No transport defect could be shown from the code: every
   transport wait is bounded (startup 30 s, exit 5 s, the controller's
   five-second authentication timeout). `windows-pipe-bridge-security.test.mjs:146`
   proves the bounds on every platform: a relay with no channel fails its
   waiting `initialize` with `the relay exited with 1 … VES_BRIDGE_NOT_CONFIGURED`,
   and a wait that never settles fails with its label. Not verified: the
   win32 cases on Windows (no local Windows host; the leg runs on the matrix).
4. AD-081: no code change. Moving the copy under the temporary directory was
   considered and rejected: a Codex node's `CODEX_HOME` must stay the
   Workspace identity directory, which Codex reads and rewrites to
   authenticate, and `HOME` and `CODEX_HOME` are in the environment Codex's
   commands inherit (by Codex's documented shell environment policy, which
   drops only names with KEY, SECRET, or TOKEN; not observed against a real
   Codex), so `$CODEX_HOME/auth.json` and `$CODEX_HOME/../worktrees/` reach
   what `../../../` does. The move would change the spelling of the reach,
   not the reach, and would need a fixed path under a shared temporary
   directory or a marker to clear a killed session's view. The e2e assertion
   on the view's place (`tests/e2e/task-coordinated-e2e.test.mjs:96`) stands.
5. Survivors: `tests/e2e/task-codex-account-e2e.test.mjs:201` rewrites the
   sealed commit record to a commit on top of the task commit with the branch
   anchoring it, recorded on the plan's revision (its parent is not that
   base), and `:202` recorded on the task commit (a base that is not the
   plan's revision); each is refused `VES_TASK_COMMIT_DRIFT` (`:207`) and the
   run stays suspended with no verifier turn.
   `tests/e2e/task-grant-renewal-e2e.test.mjs:135` revokes a suspended run's
   grant in the runtime store (`:147`); the resume at the time the renewal
   case renews keeps it (`:158`) and its first effect is refused
   `VES_EXECUTOR_APPROVAL_INVALID` (`:157`).

**Can a Codex node's identity be narrowed so `auth.json` is out of its
reach?** No, within this design. Codex authenticates from
`$CODEX_HOME/auth.json` and writes renewed tokens back to it, from the same
process whose sandboxed commands the model drives, and the read-only sandbox
withholds writes and network, not reads (AD-081). A per-node copy of the login
would hold the same tokens, and a renewal inside it would, with rotating
refresh tokens, leave the Workspace's own login stale. The OS credential
store is refused for the Codex login (`task-codex-identity.ts:20-24`), and
no readable-root policy is verified at 0.159.3 without a provider call.
Withholding the values is what this design can enforce.

**Discrimination.** Each mutant applied in place, its suites run through
`scripts/test-scope.mjs`, then restored; `git status --porcelain` was clean
of it after every run.

| Mutant | Target | Killer (failed of total) |
| --- | --- | --- |
| R4-M1 the v2 condition on the verifier's quota observation removed | SSI-83 | integration `codex-verifier-session` 1/18 (with e2e `task-codex-account` 0/4 in the same run) |
| R4-M2a the composition withholds no login secret | SSI-49 | unit `task-coordination-withheld` 2/3; security `coordination-record-security` 1/3 |
| R4-M2b the withheld text resolved once at round open (the previous `coordinated-driver.ts`) | SSI-49 | security `coordination-record-security` 1/3 (unit `coordinated-driver` 0/26, `task-coordination-withheld` 0/3) |
| R4-M3 a relay's exit leaves a waiting request unsettled | gate | security `windows-pipe-bridge-security` 1/16, failed by its 45 s bound, not a hang |
| O12 the commit's parent not checked (`task-run.ts:462` returns true) | SSI-33, TM-011 | e2e `task-codex-account` 1/4 |
| O13 the recorded base not compared with the plan's revision (`:457`) | SSI-33, TM-011 | e2e `task-codex-account` 1/4 |
| O15 the stored grant handed to the decision without its revocation (`:443`) | AD-082 item 5 | e2e `task-grant-renewal` 1/3 |

**Deleted case → replacement.** `tests/unit/task-coordination-withheld.test.mjs:52`
"a Codex session on the Workspace login has no value to withhold beside the
Claude Code credential" → `:76` "…withholds the login's tokens and API key
beside the Claude Code credential", whose `:93` keeps the old case's assertion
for a directory with no login file.

**Proposed text for T10, not applied.**

- `spec.md` SSI-42: "WHEN a node reads through the bridge THEN its read tools
  SHALL be confined to the node's read scope; WHEN a Codex node reads through
  its own sandbox THEN its working directory SHALL be a read-only copy of its
  read scope alone, bounded by the bridge's read limits and removed when the
  node ends, and any read outside that copy, by an absolute path, by a
  relative path through `..`, or by a path built from the session's `HOME` or
  `CODEX_HOME`, is an accepted residual risk (TM-004). (SSI-42)"
- `threat-model.md` TM-004, columns from "Threat action" on: "A writer node
  asks for out-of-scope or protected writes; a reader node reads beyond its
  read scope | Repository integrity, disclosure | Repository, protected
  paths, files outside a node's read scope, the Workspace's Codex login |
  Executor scope, protected-path, grant, authority checks
  (`task-executor.ts:640-671`); mediated tools only (AD-039) | A Codex node's
  sandbox permits any read outside its working directory, by an absolute
  path, a relative path through `..`, or a path built from `HOME` or
  `CODEX_HOME`, the run's worktree and the Codex login's `auth.json` included
  (accepted residual) | Node write-scope narrowing before the executor
  (SSI-41); node read scope through the bridge, and for a Codex node a
  read-only copy of its read scope as its working directory (SSI-42,
  AD-081); node results screened before they persist for the run's
  credentials, the Codex login's tokens and API key, and its machine-local
  roots (SSI-49); untrusted labelling (SSI-50) | Denied tool counts in the
  node ledger; `VES_BRIDGE_VIEW_LIMIT`; `VES_COORDINATION_RESULT_INVALID` |
  medium | high | high"
- `spec.md` SSI-83: "The integration SHALL be opt-in, so a v1 request and
  every command other than a v2 `graph` or `swarm` run SHALL behave as
  before; a v1 verifier SHALL read no Codex account, and a usage limit it
  meets SHALL fail the run, never suspend it. (SSI-83)" R1's open v1 credits
  decision is unchanged.

**Residual risks.** The screen matches exact values: a secret the model
encodes, splits, or transforms passes, as for the Claude Code credential.
The login file is read again for every screened result; if a parallel Codex
node is rewriting it at that instant (Codex writes it in place) the read is
not JSON and the run fails closed as `codex-login`, never open. The real
named-pipe cases are bounded but were not run here.

**Gates** (darwin arm64, Node 24.14.0, at `eb5b5fd`): `pnpm gate:quick` PASS
(format, lint, complexity with 171 baselined keys and none above 10
unaccounted, typecheck; unit 2983/2983, agent-readiness 357/357, census
13/13); `pnpm test:architecture` 132/132; `pnpm agent:check` PASS; the
touched suites together (14 files across unit, integration, security, e2e)
145/145; 0 failed, 0 skipped, 0 todo, no temporary entry left. No file gained
or lost `JSON.stringify` or `createHash`; no complexity key changed.

**Citations that moved** (for the fresh verifier): `task-codex.ts:311` →
`:312`, `:354` → `:355`, `:359` → `:360`; `task-coordination.ts:113` →
`:115`, `:116` → `:119-123`, `:252` → `:259`, `:316` → `:323`, `:325` →
`:332`, `:357` → `:364`; `coordinated-driver.ts:307`'s round-open resolution
is gone, the screen resolves at `:593`. `task-run.ts:443`, `:457`, `:462` are
unchanged.

**Next action**: superseded by the follow-up below.

#### R4 follow-up: the named-pipe helper outlived a refusal (SSI-75)

On `070be02` the bounds of `56a041d` named the stall: the Windows leg of
`gate:security` (run 37204692414) failed `win32: a frame beyond its bound on
the named pipe is refused` with "the pipe client's close did not settle within
45000 ms; connected: true; 50 bytes received". The client had its `ready`
line (50 bytes) and stayed connected, so the PowerShell helper still held the
pipe's server end. The same case took 578 ms at `f285f2b` (run 37197307202):
an intermittent stall, most likely the one that hung `93b38c5`. The full and
build gates passed on Windows at `070be02`.

**Cause in the code.** A scratch run with the fake host (not tracked)
delivered the 8 MiB + 1 frame in 64 KiB chunks under backpressure and
reached the refusal and the tree termination, so the Node side of the
refusal holds. What followed it was one unverified attempt: on a closed
connection, or the channel's close, the transport called the tree terminator
once (`taskkill` from PATH on Windows, no timeout), swallowed its failure,
never checked that the helper exited, and had no other means; the helper's
own exit depends on PowerShell noticing the end of its standard streams.
Which of the two failed on the runner cannot be shown without a Windows
host; either leaves the helper holding the pipe.

**Change** (`2aadcc2`, `packages/platform-node/src/windows-pipe-transport.ts`):
every end of the channel (a refused client and a client that left through
the connection's close, `:394`; the channel's close through `#shutdown`) goes
through one memoized `#endHelper` (`:411`): the tree termination is awaited
under the exit bound (`settlesWithin`, `:250`), then the helper's exit under
the same bound, and a helper still running is killed through its own handle
(`:419`; `PipeHelperProcess.kill`, `:207`, which cannot reach a process that
reused the pid), then its exit is awaited once more. The bound is 5 s per
step (`exitWaitMs`). The helper script is unchanged (its digest is pinned):
it already ends when its standard input ends. The security case is
unchanged.

**Tests** (every platform, fakes only): the fake helper ignores the end of
its streams, and the fake host's tree terminator can miss it or never return
(`tests/helpers/pipe-bridge-fixture.mjs:123`, `:154`).
`tests/unit/windows-pipe-transport.test.mjs:317`: a refused client's helper is
killed by its handle within the bound when the tree termination misses or
hangs, ended once, and the run's directory removed; `:333`: the same for the
channel's close; `:307`: a helper its tree termination ended is not killed
again.

| Mutant | Killer (failed of total, unit `windows-pipe-transport` + security `windows-pipe-bridge-security`) |
| --- | --- |
| R4-M4a no termination when the connection closes (`:394` removed) | 7/60: both new refusal cases and five existing ones |
| R4-M4b no kill through the handle (`:419` removed) | 4/60: all four new cases |
| R4-M4c the tree termination awaited without its bound | 2/60: both `hangs` cases |

Gates at `2aadcc2` (darwin arm64): `pnpm gate:quick` PASS (unit 2987/2987,
agent-readiness 357/357, census 13/13, complexity unchanged); `pnpm
test:architecture` 132/132; `pnpm agent:check` PASS. Not verified here: the
real pipe on Windows; the next Windows `gate:security` leg must pass
`windows-pipe-bridge-security.test.mjs` as it stands.

**Next action**: push the branch and run the platform matrix, with the
Windows `gate:security` leg first; T10 applies the three texts above; then a
fresh verification of SSI-49, SSI-81, SSI-83, SSI-75, and O12, O13, O15.

### Delta verification of R4

**Verifier**: the second-pass verifier, who wrote none of R4. **Head**:
`d2c9341` on `strands/t9-delta-verification` (`origin/main`); R4's matrix ran
on `f58afa1`, whose tree is the same (`git rev-parse` of both trees:
`e8c1371`). Each R4 claim was re-derived from the code; mutants were applied
in place, run through `scripts/test-scope.mjs`, and removed with
`git restore`, `git status --porcelain` empty before and after each. No real
provider was called.

**Verdict: PASS**, with no row FAIL. It holds on these open items, none of
which is a failing check:

- PENDING: SSI-84, the owner's agent, graph, and swarm pilots on every
  platform.
- PARTIAL until T10 or the owner: SSI-60 (R1's amendment text), SSI-61 (no
  text proposed yet; this one would do: "The suspension record SHALL hold
  only a reason code, the provider, the time of suspension, and, when the
  provider reported them, its limit window in a closed grammar and its reset
  time."), and SSI-83 (R4's amendment text, and the owner's approval of
  AD-080 item 5, the `state-path-length` refusal and scratch layout every v1
  run now gets).
- PASS on the current text, amendment wording settled by R4: SSI-42, and
  TM-004 in the threat model.
- Owner decisions outside the rows: D1, D8, and whether a v1 verifier on a
  subscription should be refused Codex credits (R1).

**Counts**: PASS 81, PARTIAL 3 (SSI-60, SSI-61, SSI-83), FAIL 0, PENDING 1
(SSI-84).

**The claims, re-derived.**

| Second-pass finding | R4 claim | Verdict | Evidence at `d2c9341` |
| --- | --- | --- | --- |
| 1, SSI-83 | A v1 verifier fails on a usage limit as before | Holds | The quota is observed only under `subscriptionOnly` (`apps/vestra-cli/src/task/task-codex.ts:355`, `:312`); `tests/integration/codex-verifier-session.test.mjs:266` refuses v1 with `VES_TASK_FAILED` `{reason: VES_TASK_VERIFIER_FAILED}` on a subscription and an API key, and `:280`, `:288` still suspend v2. My scratch probe of the second pass, re-run here, now gets `VES_TASK_FAILED` `{reason: VES_TASK_VERIFIER_FAILED}` with no suspension, 2 of 2. R4-M1 and D5 killed |
| 2, SSI-49, SSI-81 | The Codex login's secrets are withheld | Holds | `codexLoginSecrets` (`apps/vestra-cli/src/task/task-codex-identity.ts:72`) reads the access, refresh, and ID tokens and every API-key-named field (`:33`, `:34`), and refuses a file that is no login as `codex-login` with no cause; `nodeResultWithheld` adds them (`task-coordination.ts:122`); the screen resolves them for every result (`packages/application/src/execution/coordinated-driver.ts:593`). `tests/unit/task-coordination-withheld.test.mjs:76`, `:98`; `tests/security/coordination-record-security.test.mjs:148` refuses each secret and a renewed token, persisting only the writer's result. R4-M2a, R4-M2b (round open), D1, D2, D3 killed; D6 survived (new finding 2) |
| 3, gate | The pipe cases are bounded and the helper ends within a bound | Holds | Every end of the channel goes through `#endHelper` (`packages/platform-node/src/windows-pipe-transport.ts:394`, `:411`): the tree termination and each exit wait bounded, then a kill through the helper's own handle (`:419`). `tests/unit/windows-pipe-transport.test.mjs:317`, `:333` (on every platform) kill a helper whose tree termination misses or hangs, once; `tests/security/windows-pipe-bridge-security.test.mjs:146` fails an unanswered relay and an endless wait by their bounds. The stall R4 names is in the log of run 37204692414 at `070be02` ("the pipe client's close did not settle within 45000 ms; connected: true; 50 bytes received"). R4-M3, R4-M4a, R4-M4b, R4-M4c, D4 killed |
| 4, SSI-42, TM-004 | AD-081's residual is every read outside the copy | Holds | `.specs/STATE.md` AD-081 now names absolute paths, `..`, and paths from `HOME` or `CODEX_HOME`, and drops the "confines every read relative to the working directory" reason; R4's SSI-42 and TM-004 texts say the same. Documentation only |
| 6, O12, O13, O15 | The three survivors are killed | Holds | `tests/e2e/task-codex-account-e2e.test.mjs:142` (a recorded commit off the plan's base, and one whose parent is not that base, each `VES_TASK_COMMIT_DRIFT`, `:207`); `tests/e2e/task-grant-renewal-e2e.test.mjs:134` (a revoked grant is kept, its first effect refused). O12, O13, O15 killed |

**Rows re-judged.** SSI-49 PASS (was FAIL). SSI-81 PASS (was PARTIAL; it
followed SSI-49). SSI-83 PARTIAL (was FAIL): only the amendment and AD-080
item 5 remain. SSI-75 PASS, re-observed: the helper's bounded end is new code
under the requirement, killed by four mutants, and the real case passed on
Windows. SSI-71 and SSI-76 PASS, re-observed on Windows at this tree. SSI-33
PASS, its O12 and O13 note closed. SSI-42 unchanged (PASS); TM-004 and TM-015
are now accepted residuals, worded as R4 proposes.

**Discrimination (delta).**

| Mutant | Suites (failed of total) | Result |
| --- | --- | --- |
| R4-M1 the v2 condition on the verifier's quota removed | integration `codex-verifier-session` 1/18 | Killed |
| R4-M2a no login secret withheld | unit `task-coordination-withheld` 2/3; security `coordination-record-security` 1/3 | Killed |
| R4-M2b the withheld text resolved once at round open | security 1/3 (unit `coordinated-driver` and `task-coordination-withheld` 0/29) | Killed |
| R4-M3 a relay's exit leaves a waiting request unsettled (fixture) | security `windows-pipe-bridge-security` 1/16, by its bound | Killed |
| R4-M4a no termination when the connection closes | unit `windows-pipe-transport` 3/44; security 4/16 | Killed |
| R4-M4b no kill through the helper's handle | unit 4/44 | Killed |
| R4-M4c the tree termination awaited without its bound | unit 2/44 | Killed |
| O12 the commit's parent not checked | e2e `task-codex-account-e2e` 1/4 | Killed |
| O13 the recorded base not compared | same 1/4 | Killed |
| O15 the revocation dropped before the renewal decision | e2e `task-grant-renewal-e2e` 1/3 | Killed |
| D1 the refresh token not withheld | unit 1/3; security 1/3 | Killed |
| D2 only a field named exactly `api_key` withheld | unit 1/3; security 1/3 | Killed |
| D3 an unreadable login file withholds nothing instead of refusing | unit 1/3 | Killed |
| D4 a helper already gone terminated again (the pid-reuse guard dropped) | unit 1/44 | Killed |
| D5 the v1/v2 quota condition inverted | integration 2/18 | Killed |
| D6 the withheld text resolved once, at the round's first result | security 0/3 | **Survived** |

16 mutants; 15 killed, 1 survived. Off Windows the win32 cases of
`windows-pipe-bridge-security` do not run, so R4-M4b and D4 are killed by the
unit suite alone.

**New findings (minor; no row FAIL).**

1. **SSI-49 screen: a renewal after the round's first result is untested
   (D6).** The security case renews the token in the writer, the round's
   first node, so a screen resolved once at the first settled result still
   withholds it. The code resolves per result (`coordinated-driver.ts:593`),
   so this is a test gap. Fix: renew the token in a later node (the
   reviewer, whose own result carries it) after the writer's result is
   settled.
2. **SSI-81: the login's `account_id` is not withheld.** `codexLoginSecrets`
   withholds tokens and keys; `tokens.account_id`
   (`tests/unit/task-coordination-withheld.test.mjs:71` holds one) is an
   account identifier, which the project treats as sensitive (SSI-53), and a
   Codex node can read it as it reads the tokens. Exact-value matching also
   leaves the e-mail address inside the ID token's payload to a model that
   decodes it, as R4 records for any transformed secret. Fix: withhold
   `account_id`, or record both in TM-015's residual.
3. **Windows `gate:security` stability.** The leg failed intermittently on
   unchanged code (a hang at `93b38c5`, a 45-second stall at `070be02`) and
   has passed once since the fix, at `f58afa1`. A recurrence now fails a
   named case within its bound instead of hanging the leg; that one green run
   does not by itself show the cause gone.

**Gates.** Local, darwin arm64, Node 24.14.0, at `d2c9341`: `pnpm gate:quick`
PASS (unit 2987, agent-readiness 357, census 13); the touched suites: unit
73/73 (`task-coordination-withheld`, `windows-pipe-transport`,
`coordinated-driver`), integration 28/28 (`codex-verifier-session`,
`coordinated-node-adapters`), security 33/33 (`coordination-record-security`,
`windows-pipe-bridge-security`, `mcp-tool-bridge-security`), e2e 11/11
(`task-codex-account-e2e`, `task-grant-renewal-e2e`, `task-coordinated-e2e`);
0 failed, 0 skipped, 0 todo. Platform matrix at `f58afa1`, read from each
job's log: runs 37206571680 (`gate:full`: unit 2987, contract 957,
integration 1242, e2e 301, fault 310, mutation 8), 37206573582
(`gate:build`: also architecture 132, build 179, qualification 358), and
37206575734 (`gate:security`: unit 2987, contract 957, e2e 301,
architecture 132, qualification 358, security 1353, fault 310). All five
legs of each passed, every stage with 0 failed, 0 cancelled, 0 skipped, and 0
todo. The 20 coordinated journeys ran on every leg (19 in `gate:build`) at
4.9 to 52.8 s on Windows. On the Windows `gate:security` leg every named-pipe
case ran:

| Case (`tests/security/windows-pipe-bridge-security.test.mjs`) | Duration |
| --- | --- |
| win32: the system tools prove a real per-run directory owner-only | 78 ms |
| win32: the relay reaches the controller over the named pipe and its writes become executor requests | 545 ms |
| win32: a relay presenting the wrong token is refused with the Unix code | 516 ms |
| win32: a pipe client that never authenticates is refused when the authentication timeout ends | 5,386 ms |
| win32: a frame beyond its bound on the named pipe is refused | 382 ms |
| win32: a second same-user client cannot reach the controller while the relay holds the pipe | 2,039 ms |
| win32: a pipe name that already exists makes the transport refuse | 383 ms |
| win32: the per-run directory is owner-only while the channel is open, and the helper and directory are gone at close | 387 ms |
| win32: the relay's read, list, and search tools serve the read scope over the named pipe | 581 ms |
| win32: the read tools refuse over the named pipe what they refuse over the socket, and every Windows spelling | 548 ms |

The same leg also ran the mediated session over the named pipe (2,545 ms) and
the governed task journey over it (12,083 ms), and its fault stage, which the
hung leg at `93b38c5` never reached, passed 310/310.

**Next action**: T10 applies the SSI-42, TM-004, SSI-60, SSI-61, and SSI-83
texts; the owner decides AD-080 item 5, D1, D8, and v1 Codex credits, and
runs the pilots (SSI-84); the two minor findings above are fix tasks for an
implementer who is not this verifier.

### Remediation R5 (delta findings)

**Author**: an implementation session that wrote neither R4 nor its delta
verification. **Base**: `8a1ab11` (`origin/main`). **Branch**:
`strands/t9r5-account-id`. The delta verification above is left as written;
this section records the fixes for its two minor findings. No real provider
was called and no real Codex login was read: every login, token, claim, and
key below is a fixture value.

| Commit | Delta finding | Change |
| --- | --- | --- |
| `381779c` | 2 (SSI-49, SSI-81, SSI-53) | `codexLoginSecrets` (`apps/vestra-cli/src/task/task-codex-identity.ts:113`) also withholds `tokens.account_id` (`:33`) and the account identifiers the ID token's JWT payload carries decoded (`idTokenClaims`, `:96`): the `sub`, `sid`, and `email` claims and every claim named `id` or ending in `_id`, at any depth, walked without recursion (`:38`, `:71`, `:77`), each value once (`:124`). The payload is read only to be withheld; a parser's message, which quotes it, is dropped, so a token whose payload is not JSON names nothing decoded and is withheld whole (`:102`) |
| `a7fa8af` | 1 (D6) | The security case's reviewer, the round's second node, renews the access token after the writer's result is screened and carries it in its own result |

**Which claims, and why.** An ID token is a JWT whose payload anyone can
decode, so a model that reads `auth.json` can copy the account's identifiers
out of it in plain text, where the token's exact value no longer matches.
The fixtures mirror an OpenAI ID token's shape: top-level `sub`, `sid`, and
`email`, and an `https://api.openai.com/auth` claim with
`chatgpt_account_id`, `chatgpt_user_id`, `user_id`, and `organizations[].id`.
That shape was not checked against a real login. The rule is the claim's
name, not a fixed path, so an identifier claim moved or added under another
`*_id` name is still withheld. Not withheld: issuer, audience, plan type,
flags, times, and organization titles and roles. They name no one, and a
common word such as `plus` or `owner` would refuse ordinary results.

**Evidence.**

1. Unit `tests/unit/task-coordination-withheld.test.mjs:111` asserts the
   values in order (`:113`): the Claude Code credential, the access, refresh,
   and ID tokens, the account id, the API key, then the six identifiers
   decoded from the fixture ID token (`:102`: subject, e-mail address,
   sign-in session, ChatGPT user id, user id, organization id). The payload's
   `chatgpt_account_id` equals the account id and appears once; the issuer,
   audience, plan, flags, times, and title are absent. A ChatGPT-only login
   gives the same values without the key (`:124`). An ID token that is not a
   JWT, and one whose payload is not JSON, are withheld whole beside the
   other secrets without refusing the run (`:133`, `:136`). A directory with
   no login file withholds only the Claude Code credential (`:144`).
2. Security `tests/security/coordination-record-security.test.mjs:150`: a
   swarm whose reviewer's summary carries the account id (`:178`), the
   e-mail address or user id decoded from the ID token's payload (`:162`),
   the ID token, or any earlier login secret is refused
   `VES_COORDINATION_RESULT_INVALID` (`:227`). Only the writer's result is
   persisted (`:230`), and no persisted file holds the value. Here the
   payload carries no `chatgpt_account_id`, so the account id is refused by
   its own value and the decoded identifiers by the decoding. The same run
   naming no secret completes (`:223`, the control).
3. D6: the reviewer renews the access token in `auth.json` (`:212`, `:213`)
   after the writer's result is screened, and its own result carries it. A
   screen that resolved what it withholds once per round, at its opening
   (R4-M2b) or at its first result (D6), misses the renewal: the case fails
   with "Missing expected rejection:
   fixture-security-renewed-access-token-d4f6". At `381779c`, before this
   change, D6 still survived (security 0/3).

**Changed case (no deletion).** `coordination-record-security.test.mjs:150`
renews in the reviewer instead of the writer. It fails every resolution the
writer case failed (R4-M2b) and D6 as well, so the writer case is not kept
beside it. Its title gained "or an account identifier".
`task-coordination-withheld.test.mjs:111` gained "account identifiers" in its
title, and its fixture ID token is now a JWT.

**Discrimination.** Each mutant applied in place, run through
`scripts/test-scope.mjs`, then removed with `git restore`; `git status
--porcelain` was empty before and after each. Unit is
`task-coordination-withheld` with `coordinated-driver` (29 tests); security
is `coordination-record-security` (3 tests).

| Mutant | Unit (failed of 29) | Security (failed of 3) | Result |
| --- | --- | --- | --- |
| D6 the withheld text resolved once, at the round's first result | 0 | 1 | Killed (survived before) |
| R4-M2b the withheld text resolved once, when the round is constructed | 0 | 1 | Killed |
| R5-M1 `account_id` not withheld | 1 | 1 | Killed |
| R5-M2 no ID-token claim withheld | 1 | 1 | Killed |
| R5-M3 only the payload's top level walked | 1 | 1 | Killed |
| R5-M4 claims ending in `_id` not withheld | 1 | 1 | Killed |
| R5-M5 a payload that is not JSON rethrown instead of naming nothing | 1 | 0 | Killed |
| R5-M6 the `email` claim not withheld | 1 | 1 | Killed |

8 mutants; 8 killed.

**Rows.** No row is re-judged here; that is the next verifier's. The change
narrows the residual R4 recorded for transformed secrets to the cases below.

**Proposed text for T10, not applied.** In R4's TM-004 text, "the Codex
login's tokens and API key" becomes "the Codex login's tokens, account id,
the account identifiers its ID token carries, and API key".

**Residual risks.** The screen still matches exact values, so a value the
model transforms passes: an e-mail address in another case, or a split or
encoded id. A `name` claim, and any personal data the payload carries under
another name, is not withheld. The access token is not decoded. In the shape
the fixtures mirror, its identifiers repeat the ID token's, but that was not
verified against a real login.

**Gates** (darwin arm64, Node 24.14.0, at `a7fa8af`): `pnpm gate:quick` PASS
(format, lint, complexity with 171 baselined keys and none above 10
unaccounted, typecheck; unit 2987/2987, agent-readiness 357/357, census
13/13); `pnpm typecheck` PASS; `pnpm test:architecture` 132/132; `pnpm
agent:check` PASS; `pnpm census:refresh` left the census
unchanged and `pnpm test:census` 13/13; the touched suites with
`coordinated-driver` and `coordinated-node-adapters` 42/42; 0 failed, 0
skipped, 0 todo, no temporary entry left. No file gained or lost
`JSON.stringify` or `createHash` outside the tests; no complexity key changed.

**Citations that moved** (for the next verifier): `task-codex-identity.ts:72`
→ `:113`, `:38` → `:42`; `:33` now lists `account_id`; `:34` is unchanged.
`task-coordination-withheld.test.mjs:71` → `:95`, `:76` → `:111`, `:78` →
`:113`, `:87` → `:124`, `:93` → `:144`, `:98` → `:149`, `:104` → `:155`.
`coordination-record-security.test.mjs:148` → `:150`, `:206` → `:223`,
`:213` → `:230`.

**Next action**: push the branch for the platform matrix and human review;
then a delta verification of R5 (SSI-49, SSI-81, D6, and the R5 mutants) by
a verifier who wrote none of it. T10 applies the texts, with the TM-004
wording above; the owner items of the delta verification are unchanged.

## T10 handoff

T10 (branch `strands/t10-handoff`, an implementation session that verified
nothing above) applied the amendment texts this file proposes, unchanged and
marked "amended 2026-10-04" with their section: SSI-42 and TM-004 (R4),
SSI-52, SSI-55, SSI-56, and SSI-60 (R1), SSI-61 ("Delta verification of R4"),
SSI-83 (R4), and `design.md`'s handoff mapping (R2) with the passages the
verifications named stale. It recorded D1b (the lockfile set of D1) and D10
(AD-080 item 5) in `spec.md` as approvals by delegation dated 2026-10-04,
awaiting the owner's confirmation at human review, and the open v1
Codex-credits question as D11. The traceability table in `spec.md` reads 84
PASS and SSI-84 PENDING from the delta verification above; no verdict in this
file was changed. The verdict line at the top of this file is the first
pass's, kept as written; the latest verdict is the delta verification's.
Next: `handoff.md`.

## Remediation R6 (the named pipe's close)

**Author**: an implementation session (the author of R4), not a verifier.
**Base**: `d574e29` (`origin/main`). **Branch**: `strands/t9r6-pipe-close`.
No verdict above is changed; no real provider was called.

**What failed.** The `.7` candidate build (run 37211970828, `d574e29`, which
holds R4's bounded end of the helper) failed `win32: a frame beyond its bound
on the named pipe is refused` on Windows x64 in both gates that run it
(security and release), at 45.6 s each: "the pipe client's close did not
settle within 45000 ms; connected: true; 50 bytes received". The same case
passed in 382 ms on run 37206575734. The 50 bytes are the `ready` line
(`{"type":"ready","protocol":"verchestra-bridge/1"}` and a newline), so the
client had authenticated; the frame came after.

**What the code shows.**

- A client's pending write cannot hold the close after a refusal. The
  controller refuses only once the pending line passes 8 MiB
  (`packages/agent-runtime/src/execution/mcp-bridge-protocol.ts:122`), that
  is, with the frame's last byte, so every byte of the client's single write
  (libuv 1.51.0, Node 24.14's, answers `uv_try_write` on a named pipe with
  `EAGAIN`, so the frame is one overlapped `WriteFile`) had been taken from
  the pipe by then. And a client whose write is pending sees `EPIPE` then
  `close` when its server stops reading and closes (reproduced below).
- A server end outliving the helper needs another process to hold it. The
  helper starts no process and its `NamedPipeServerStream` constructor
  creates a handle that is not inheritable; the tree terminator would end
  any child it had (reproduced below, and now pinned by
  `tests/unit/windows-pipe-transport.test.mjs:91`).
- After a refusal R4's end of the helper kills it through its own handle
  within about 15 s at most (`windows-pipe-transport.ts:454`), which closes
  its server end, yet the client stayed connected for 45 s. So the likeliest
  link that broke is the first: the frame never wholly reached the
  controller, there was no refusal, and the end of the helper never began.
  On Node's side it does not reproduce: fake helpers fed the frame in 64 KiB
  to 8 MiB chunks, before and after the `connected` line, and a real child
  process relaying a local socket over its stdio (25 rounds, scratch, not
  tracked), all reached the refusal. What is left is Windows-only (the
  PowerShell relay, the pipe driver, or libuv's Windows pipes), which no
  host here can run. This is an inference; the trace below settles it.

**Change.** `d665b36`: the transport takes an optional observer and reports
each step of a channel's life in a closed vocabulary (`PipeChannelEvent`,
`windows-pipe-transport.ts:217`, option `:487`): the helper's start and pid,
`listening`, `connected`, the connection's close, the start of the
helper's end with its trigger (`connection-closed` or `channel-closed`) and
whether the helper still ran (`:438`), how the tree terminator returned
(`returned`, `failed`, `timed-out`, `:461`), a kill through the handle
(`:463`), the helper's exit code or signal, and the channel's close; never a
byte or a line of the helper's, and an observer that throws changes nothing
(`:407`). `a68cebc`: the real-pipe case asserts the refusal link by link
(`tests/helpers/pipe-bridge-fixture.mjs:270`, used at
`tests/security/windows-pipe-bridge-security.test.mjs:284`), each link
bounded and its failure carrying the trace (`:139`): the controller's
refusal, the helper's exit, the pipe's server end gone from the Windows pipe
namespace (`\\.\pipe\`, read without connecting, `:127`), and the client's
disconnect, which a write it makes then reports even while an earlier write
of its own is pending. The diagnosis holds the transport's steps with their
milliseconds, the bytes that reached the controller, the refusal count,
whether the pipe name is listed, and the client's state (`:102`): connected,
closed, first error code, bytes received, `writableLength`, and libuv's
`writeQueueSize`. The case's bound is unchanged (45 s per link, 120 s per
case) and no assertion was removed: the client's close is still required.

**How to read the next failure.** No `end` step, `rejected: 0`, `reached`
below 8388609, and `writeQueueSize` above 0: the frame never reached the
controller (link 1). `end` and `tree-terminated` but no `helper-exited`: the
helper was not ended. `helper-exited` with `listed: true`: another process
holds the server end. `listed: false` with the client not closed: the client
did not see it.

**Reproduction on every platform** (`tests/integration/windows-pipe-transport-relay.test.mjs`,
real processes: the stand-in `tests/helpers/pipe-relay-stand-in.mjs` relays a
named pipe on Windows and a Unix socket elsewhere over its stdio, ended by
the real tree terminator, `pipe-bridge-fixture.mjs:295`):

| Case | Shows |
| --- | --- |
| `:63` a frame refused on a faithful relay, three rounds | every link holds; the trace begins `helper-started`, `listening`, `connected`, `connection-closed`, `end` (`connection-closed`) |
| `:84` a helper that stops taking a pending frame | the trace tells link 1 apart (no refusal, at least 64 KiB reached, the client's write waiting); the channel's close still ends the helper (`end`: `channel-closed`, running) and the client is disconnected with its write pending |
| `:107` a refused channel whose helper's child holds the connection | ending the whole tree disconnects the client; the tree terminator returned |

Unit (`tests/unit/windows-pipe-transport.test.mjs:375`, `:389`, `:402`): the
exact trace when the tree termination ends, misses, or hangs, for a channel
closed before any client, and an observer that throws.

**Discrimination** (each applied, the unit transport suite and the stand-in
suite run, then restored):

| Mutant | Killer (failed of 52) |
| --- | --- |
| R6-M1 the tree terminator never called | 10, the child-holds-connection stand-in case among them (the client stays connected) |
| R6-M2 no end of the helper when the connection closes | 9, the faithful-relay and child stand-in cases among them |
| R6-M3 no end of the helper when the channel closes | 10, the stalled stand-in case among them |
| R6-M4 the trace not reported | 7, all three stand-in cases among them |

**Gates** (darwin arm64, Node 24.14.0, at `a68cebc`): `pnpm gate:quick` PASS
(unit 2992/2992, agent-readiness 357/357, census 13/13, complexity
unchanged); `pnpm test:architecture` 132/132; `pnpm agent:check` PASS; the
pipe suites (unit, both security, three integration) 111/111; 0 failed, 0
skipped, 0 todo, no temporary entry left. Not verified here: the real pipe on
Windows.

**Next action**: push the branch and run the Windows `gate:security` leg. If
the case fails, its message now names the link and carries the trace; a
failure at link 1 puts the fault in the relay between the client and the
controller (PowerShell's copy tasks or the pipe driver), which a fix must
then address there.

## Remediation R7 (the relay's held block)

**Author**: an implementation session (the author of R4 and R6), not a
verifier. **Base**: `537752c` (`origin/main`). **Branch**:
`strands/t9r7-relay-flush`. No verdict above is changed; no real provider was
called.

**What the trace showed.** Run 37219409058 (`537752c`), Windows x64, the frame
case failed at its first link: "the controller's refusal was not reached
within 45000 ms", with `rejected: 0`, the client `writableLength: 0` and
`writeQueueSize: 0` (every byte handed to the pipe), the pipe still listed,
`reached: 8257662`, and no `end` step. The hello line is 125 bytes and the
frame 8,388,609 = 64 × 131,072 + 1, so the controller held 8,257,537 =
63 × 131,072 + 1 frame bytes, and exactly 131,072 were missing. The refusal
needs the frame's last byte (`packages/agent-runtime/src/execution/mcp-bridge-protocol.ts:122`).

**Cause the code shows.** 131,072 is the helper's read size.
The relay was `$verchestraServer.CopyToAsync([Console]::OpenStandardOutput())`
(`packages/platform-node/src/windows-pipe-transport.ts:95` at `537752c`):
`Stream.CopyToAsync` asks for 81,920 bytes, the array pool rents 131,072, and
it reads into the whole array, so every read was one 128 KiB block (the
failure's accounting is whole blocks). Each read reached standard output only
through the console stream's queued write task (`Stream.WriteAsync` over a
stream with no asynchronous write of its own) and the copy's continuation,
both on the thread pool, one of whose threads the stdin copy holds in a
blocking read for the channel's life. The client's write completed, so the
helper had read the last block; none of it reached the controller. On the
Node side the reader does not stop: the connection pauses the helper's stdout
only when `push()` returns false and resumes it in `_read`
(`windows-pipe-transport.ts:324`, `:329`), and in flowing mode the controller's
synchronous readers take each chunk as it comes; a stand-in that writes as
that helper wrote (synchronous 128 KiB blocks, a short read once nothing more
waits) delivers every byte, 125 + 8,388,609, to the controller (below), and
so did 15 scratch rounds and the 25 rounds of R6. The helper's stdout was the
unbuffered raw console stream (no `StreamWriter`, nothing to flush), and the
pipe was created with no buffer sizes (0). Which thread-pool step lost the
block on the runner cannot be shown without a Windows host; that one whole
read never reached the controller is what the trace proves.

**Change.**

1. `d07a1a3`, the helper (`windows-pipe-transport.ts:80`, the relay at
   `:104` to `:112`). Toward the controller it relays on its own thread: it
   reads at most 64 KiB from the pipe (`ReadAsync` awaited by `Wait`), writes
   exactly the bytes read to standard output, and flushes them before it
   reads again. The controller's replies are copied from standard input by a
   task with an explicit 64 KiB buffer. It ends when the client leaves (a
   read of 0 bytes) or its input ends. Diff of the relay (the lines after
   `verchestra-pipe:connected`):

   ```diff
   -$verchestraRelays = [System.Threading.Tasks.Task[]]@([Console]::OpenStandardInput().CopyToAsync($verchestraServer), $verchestraServer.CopyToAsync([Console]::OpenStandardOutput()))
   -$null = [System.Threading.Tasks.Task]::WaitAny($verchestraRelays)
   +$verchestraToClient = [Console]::OpenStandardInput().CopyToAsync($verchestraServer, 65536)
   +$verchestraOut = [Console]::OpenStandardOutput()
   +$verchestraBlock = [byte[]]::new(65536)
   +while ($true) {
   +$verchestraRead = $verchestraServer.ReadAsync($verchestraBlock, 0, $verchestraBlock.Length)
   +while (-not $verchestraRead.Wait(250)) { if ($verchestraToClient.IsCompleted) { $verchestraServer.Dispose(); exit 0 } }
   +if ($verchestraRead.Result -eq 0) { break }
   +$verchestraOut.Write($verchestraBlock, 0, $verchestraRead.Result)
   +$verchestraOut.Flush()
   +}
    $verchestraServer.Dispose()
    exit 0
   ```

   The pinned digest moved deliberately, `e3e36678…` to `933d8330…`
   (`tests/unit/windows-pipe-transport.test.mjs:75`, with its reason in a
   comment), because the script changed for this cause and no other line did.
2. `2996c05`, the controller (`mcp-tool-bridge.ts:34`, `:164`, `:206`). A
   line that stops arriving part way, with no byte for 10 s, refuses its
   connection as an oversized frame is refused, so the channel, its helper,
   and its client end within a bound however the bytes stopped; a line's end
   or the connection's close ends the wait. These refusals are counted apart
   (`stalledFrames`, `:64`). The real-pipe frame case also requires its
   refusal to be for the frame's size (`tests/security/windows-pipe-bridge-security.test.mjs:316`),
   so a relay that still held a tail fails it with the trace rather than
   passing through the deadline.
3. `9646b00`, the reproduction on every platform
   (`tests/integration/windows-pipe-transport-relay.test.mjs`, stand-in modes
   in `tests/helpers/pipe-relay-stand-in.mjs`).

**Tests.**

| Case | Asserts |
| --- | --- |
| `windows-pipe-transport.test.mjs:134` | the relay toward the controller, line by line: read at most 64 KiB, write exactly what was read, flush, before the next read; no `CopyToAsync` carries the client's bytes |
| `windows-pipe-bridge-security.test.mjs:147` (every platform, fake helper) | a frame that arrives in two parts 100 ms apart is served; a frame that stops part way is refused at the 300 ms bound, counted as stalled, and the helper is ended |
| `windows-pipe-transport-relay.test.mjs:125` (real stand-in, `blocks`) | a frame relayed in synchronous 128 KiB blocks reaches the controller whole (125 + 8,388,609 bytes) and is refused for its size; every link of the refusal holds |
| `windows-pipe-transport-relay.test.mjs:140` (real stand-in, `holds-tail`) | a relay that never flushes a frame's tail has its channel refused at the stall bound, its helper ended, and its client disconnected |
| `windows-pipe-bridge-security.test.mjs:316` (Windows) | the real pipe's refusal is for the frame's size, no stalled frame |

**Discrimination** (each applied, the suites run, then restored):

| Mutant | Killer (failed of total) |
| --- | --- |
| R7-M1 no frame-stall watch | 2/22: the fake stalled-frame case and the `holds-tail` stand-in case |
| R7-M2 a stalled refusal not counted | 2/22: the same two |
| R7-M3 the stall wait not reset by a frame's progress | 1/22: the fake case (a frame arriving in parts is refused) |
| R7-M4 the helper's relay back to the two `CopyToAsync` | 2/50 unit: the pinned digest and the relay's lines (text only; no PowerShell runs here) |

**Gates** (darwin arm64, Node 24.14.0, at `9646b00`): `pnpm gate:quick` PASS
(unit 2993/2993, agent-readiness 357/357, census 13/13, complexity
unchanged); `pnpm test:architecture` 132/132; `pnpm agent:check` PASS; the
bridge and pipe suites 116/116; the stand-in suite 5/5 in three runs; the
mediated, path-case, coordinated, and node-adapter suites 31/31; 0 failed,
0 skipped, 0 todo, no temporary entry left. Not verified here: the new helper
script on Windows (no PowerShell host); the next Windows `gate:security` leg
is its proof, and its frame case must be refused for its size.

**Proposed text for T10, not applied.** `spec.md` SSI-76: "IF a second
client connects, a client fails authentication, authentication times out, a
frame exceeds its bound, or a frame stops arriving part way for 10 s THEN the
Windows transport SHALL refuse with the codes the Unix transport uses.
(SSI-76)"

**Next action**: push the branch and run the Windows `gate:security` leg. A
pass with no stalled frame shows the relay fixed; a failure carries the
trace and the statistics, and a stalled-frame refusal there would mean the
new relay still holds a tail.

#### R7 follow-up: the stand-in's writes on Linux

The two R7 stand-in cases failed on Linux x64 and arm64 in the full and
build gates (runs 37223972972, 37223978709): the stand-in exited with code 1
about 30 ms after connecting, and the client saw `ECONNRESET`. Its block
relay wrote with `fs.writeSync(1, …)` and ignored the count it returns; on
Linux that write fails with `EAGAIN` once the pipe to the parent is full.
Reproduced in a Linux arm64 container (`eclipse-temurin:8-jre-jammy`, the
official Node 24.14.0 linux-arm64 build, checksum verified, the worktree
mounted read-only): the committed stand-in failed both cases, and with the
error report in place its trace reads
`{"step":"stand-in-error","code":"EAGAIN"}` then `helper-exited` code 1.

**Change** (test-only): each block is one `process.stdout.write`, and a full
pipe pauses the client's socket until stdout drains
(`tests/helpers/pipe-relay-stand-in.mjs`); a failure of the stand-in's own
goes to stderr as `verchestra-stand-in:error:<code>` before it exits 1, and
the host adds it to the case's trace (`tests/helpers/pipe-bridge-fixture.mjs`,
`standInHost`).

**Product code not implicated.** A scratch stand-in that exits 1 mid-frame
(not tracked) showed the transport's trace `helper-exited` (code 1),
`connection-closed`, then `end` (`connection-closed`, the helper no longer
running), the client disconnected, and no refusal, since no frame completed:
what the code says (`HelperConnection` ends with the helper's stdout and its
close begins the end, `windows-pipe-transport.ts:448`).

**Linux run of the relay suite** (container, `--init` so orphans are reaped
as on a host): 5/5, twice. Without `--init` the child-holds-connection case's
tree terminator reports `failed`: the container's PID 1 is the test runner,
which never reaps the orphaned child, so its group still answers a signal;
the client is disconnected either way. The CI legs run under an init.

**Still discriminating** (macOS, the relay suite, each applied then
restored): `blocks` holding its tail fails the block case (1/5, refused as
stalled); `holds-tail` flushing everything fails the held-tail case (1/5,
refused for its size); no stall watch fails the held-tail case (1/5, no
refusal within 45 s).

Gates at the fix: `pnpm gate:quick` PASS (unit 2993/2993, agent-readiness
357/357, census 13/13); `pnpm test:architecture` 132/132; `pnpm agent:check`
PASS; the pipe suites 72/72.
