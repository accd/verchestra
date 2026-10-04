# Strands Subscription Integration Validation

**Verdict**: PENDING — no implementation task has run. This file holds the
evidence of T1 and T2 and the empty evidence rows that T3–T9 fill. The
independent verifier (author ≠ verifier) fills the verdict after T8, against
`spec.md`, with the discrimination list below.

**Diff range for verification**: `7e274f237648251b972081471134623097122c16..<T9 head>`

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
| SSI-78 | — | — | — |
| SSI-79 | `tests/integration/strands-empty-environment.test.mjs:50` with a positive control at `:69`; mutant S6 killed by the probe alone | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-80 | T5 share: 43 mutants killed (validation.md, "T5 discrimination summary"); scope narrowing C1/C16, writer mutex C2, limits C3/C4/C8/C9/S3, destination check C5/C6/S2/S10; T6 share: 42 mutants killed (T6 Evidence, commits 1 to 3), the billing block B1–B11 and the uncertain refusal R2, R6 among them | T5 gates (see T5 Evidence); T6 gates | PASS (author) |
| SSI-81 | T4 share: events, checkpoints, payloads, and the quota refusal carry no token, session, account data, provider prose, or temporary path (`tests/security/driver-structured-results-security.test.mjs:58`, `:162`, `:173`); mutant M18 killed. T5 and T6 own their records.; T5 part: the node ledger and node results carry no token, session, prompt, repository context, or path (`tests/security/coordination-record-security.test.mjs:27`); T6 part: the extra-usage statement holds no secret and a refusal echoes none (`tests/unit/task-billing.test.mjs:117`, `tests/security/task-suspension-security.test.mjs:35`); the suspension record, the `suspended` checkpoint, the ledger with `rerunOf`, the outcome marker, and status hold no session, account data, purchase field, credential, or path (`tests/security/task-suspension-security.test.mjs:57`, `tests/unit/coordinated-suspension.test.mjs:228`, journeys `tests/e2e/task-subscription-e2e.test.mjs:116`, `:163`) | `pnpm test:security`; T5 gates; T6 gates | PASS (T4 share); PASS (author, T5 part); PASS (author, T6 part) |
| SSI-82 | `tests/build/sealed-self-containment.test.mjs:115` every sealed artifact, the adapter included, imports `node:` built-ins only; sizes, cold start, and a silent `--activation-health` recorded in T5 commits 5 and 6; the staged-layout gate suite runs on the platform matrix | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-83 | T3 part: v1 is unchanged (SSI-20, SSI-21, SSI-22 rows); a v2 request is opt-in by `schemaVersion: 2` (`packages/application/src/execution/task-request.ts` `normalizeTaskRequest`); `tests/e2e/task-cli-e2e.test.mjs:823-865` a v2 dry run plans through the binary, `:867-883` an invalid descriptor is `VES_TASK_REQUEST_REJECTED` with reason `VES_TASK_REQUEST_EXECUTION_INVALID` and nothing written; T5 part: `tests/integration/task-coordination-loading.test.mjs:40` other commands load no SDK; the v1 journeys pass unchanged (`tests/e2e/task-cli-e2e.test.mjs`, `mediated-task-execution-e2e.test.mjs`, 48/48) | `node --test tests/e2e/task-cli-e2e.test.mjs` 45/45 (tip); T5 gates | PASS (author, T3 and T5 parts) |
| SSI-84 | — | — | — |
| SSI-85 | T6 part: quota suspension is qualified with deterministic fakes only (the labelled fake Claude Code's `rate_limit_event` and the fake Codex's credits, under fixture flags; `tests/e2e/task-subscription-e2e.test.mjs:116`, `:163`); no allowance is touched. The pilots are T9 | T6 commits 2 and 3 | PASS (author, T6 part); T9 pending |

## Discrimination Sensor (planned)

Each mutant is applied in a scratch worktree, the named suite is run, and the
mutant must be killed (a test fails). A surviving mutant becomes a fix task.

| Mutant | Requirement | Expected killer | Result |
| --- | --- | --- | --- |
| Drop one descriptor field from the canonical request before digesting | SSI-28 | Per-field binding-digest test | — |
| Accept a cycle in the graph normalizer | SSI-25 | Cycle rejection case | — |
| Let a write scope leave `task.changeScope` | SSI-26 | Scope rejection case | — |
| Skip node write-scope narrowing in the coordinated driver | SSI-41 | Out-of-node-scope write refused before the executor | Killed (T5 C1, C16) |
| Remove the writer mutex | SSI-40 | Two writers never overlap (instrumented fake) | Killed (T5 C2) |
| Raise a default limit by one | SSI-37 | Limit boundary cases | — |
| Accept an undeclared handoff target | SSI-43 | Forbidden-destination swarm case | Killed (T5 C5, C6, S2, S10) |
| Persist a result before checking its size | SSI-47 | Oversized result leaves nothing persisted | Killed (T5 C7) |
| Skip the `apiKeySource` check | SSI-54 | Fake init with `ANTHROPIC_API_KEY` | Killed (T4 M1) |
| Skip the Codex `account/read` check | SSI-55 | Fake `apiKey` account | Killed (T4 M2) |
| Allow `account/rateLimitResetCredit/consume` | SSI-57 | Method allowlist test | Killed (T4 M3) |
| Skip the billing confirmation at resume | SSI-52 | Resume without confirmation is `not configured` | Killed (T6 B1, B2, B3) |
| Clean up the worktree on `suspended` | SSI-60 | Suspended worktree survives | Killed (T6 S1) |
| Re-run a partial node silently | SSI-66 | Uncertain-node refusal | Killed (T6 R2, R6) |
| Construct a Strands `Agent` in the adapter | SSI-03, SSI-79 | Architecture ban and empty-environment probe | Killed (T5 S6, by each on its own) |
| Import the SDK root entry | SSI-02 | Architecture test and sealed build | Killed (T5 S7) |

**Sensor result**: T4's author-run share below (18 of 18 killed); the rest is
not run. The independent verifier re-runs the full list after T8.

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
