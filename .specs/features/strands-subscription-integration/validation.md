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
  (`tests/integration/task-coordinated-plan.test.mjs:65`) and a mismatched
  digest is tampered (`:75`). A build without v2 refuses a v2 record as
  `VES_TASK_STATE_MALFORMED`, because its v1 normalizer rejects
  `schemaVersion: 2`.
- Interim refusal until T5 composes coordinated runs: `singleSessionPlan`
  (`apps/vestra-cli/src/task/task-plan-record.ts`) refuses a v2 run at
  `start`, `resume`, and `review` with the existing public
  `VES_TASK_NOT_CONFIGURED` (`requirement: coordinated-run`) right after the
  plan loads, before any credential read, transition, worktree, or provider
  call (`tests/integration/task-coordinated-plan.test.mjs:98-101`, with the
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

| 4 | SSI-48: a completed session's `result.structured` becomes `outputRefs: ["payload:sha256:<digest of the canonical bytes>"]`; the store returns exactly those bytes; the `driver-finished` checkpoint keeps its six fields and no answer text | `tests/integration/driver-execution-adapter.test.mjs:305` | `node --test tests/integration/driver-execution-adapter.test.mjs`: 15 of 15 |
| 4 | A structured result of a failed session is not handed on (`outputRefs: []`) | `tests/integration/driver-execution-adapter.test.mjs:323` | same |
| 4 | A second structured result, or one whose size is not its canonical size, stops the session with `VES_DRIVER_ADAPTER_INPUT_INVALID` and no `driver-finished` checkpoint | `tests/integration/driver-execution-adapter.test.mjs:333` | same |
| 4 | SSI-58/59 seam: the first `quota.exhausted` stops the session and surfaces as `VES_DRIVER_QUOTA_EXHAUSTED` with a frozen `{ scope, resetsAt? }`; later events are not handed on | `tests/integration/driver-execution-adapter.test.mjs:356` | same |
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

## T7 Evidence (Windows bridge transport, commits 1 to 3)

Author: the T7 implementer. Commit 4 (lifting the refusals) is not on this
branch; it waits for the Windows leg of the platform matrix.

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
| SSI-74 directory, HKLM, HKCU | `documentedManagedPolicySources("win32")` is exactly `C:\Program Files\ClaudeCode` and the keys `HKLM\SOFTWARE\Policies\ClaudeCode`, `HKCU\SOFTWARE\Policies\ClaudeCode`, with `/etc/claude-code` no longer chosen for Windows; Linux and macOS sources unchanged (`tests/contract/claude-code-driver-managed-policy.test.mjs:60`). Presence: either key, both, or neither (`:76-90`); a reader that rejects, answers anything but `false`, or throws synchronously counts as present (`:92`); a populated directory is present before any key is read, an empty one is not (`:107`). Driver path (non-Windows hosts, where the mediated profile runs): a present key refuses with `VES_CLAUDE_MANAGED_POLICY_PRESENT` before any spawn (`:116`); without the composition's reader every key counts as present (`:133`); with the directory and both keys proven absent the session runs (`:144`); malformed keys and keys on the API-key profile are refused at construction, and the API-key profile never consults the reader (`:160`). Registry reader (`packages/platform-node/src/windows-registry.ts`): System32 `reg.exe`, `query <key> /reg:64` (`tests/unit/windows-registry.test.mjs:18`); seven malformed keys refused before anything runs (`:24-43`); exit 1 is absent, 0, 2, and no exit are present (`:45-59`); a query that cannot run is present (`:61`). Windows only: `:70` (an existing key present, a random missing key absent; elsewhere both present, since nothing can prove absence). The composition hands the driver the reader (`apps/vestra-cli/src/task/task-implementer.ts:159`). | PASS (darwin); win32 case pending the Windows leg |

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

## Requirement Evidence

Each row needs a file-and-assertion citation (`path:line` and what the assertion
checks), the gate run that executed it, and PASS or FAIL. A row without
evidence is FAIL.

| Requirement | Evidence (file:line, assertion) | Gate run | Verdict |
| --- | --- | --- | --- |
| SSI-01 | — | — | — |
| SSI-02 | — | — | — |
| SSI-03 | — | — | — |
| SSI-04 | — | — | — |
| SSI-05 | — | — | — |
| SSI-06 | — | — | — |
| SSI-07 | — | — | — |
| SSI-08 | — | — | — |
| SSI-09 | — | — | — |
| SSI-10 | — | — | — |
| SSI-11 | T3 part: `tests/contract/task-request-v2.test.mjs:57-59` the v2 schema names no SDK, schema library, or provider SDK; the coordination plan and normalizer import only `@verchestra/domain`, and application sources cannot import a third-party package (`scripts/architecture.mjs` `VES_ARCH_THIRD_PARTY_IMPORT`, `tests/architecture/repository-boundaries.test.mjs`); node-result, handoff, and coordinated-driver modules are T5 | `pnpm test:contract` 907/907, `pnpm test:architecture` 122/122 (tip) | PASS (author, T3 part) |
| SSI-12 | — | — | — |
| SSI-13 | — | — | — |
| SSI-14 | — | — | — |
| SSI-15 | — | — | — |
| SSI-16 | — | — | — |
| SSI-17 | T4 share: a structured or quota session keeps `model.resolved` provider `anthropic` or `openai` and the Passport reference; no new event names another provider (`spikes/claude-code-driver/test/claude-driver-structured.test.mjs:40-50`, `spikes/codex-driver/test/codex-driver-structured.test.mjs:47-55`). T5 owns the node records. | `pnpm qualify:claude`, `pnpm qualify:codex` | PASS (T4 share); T5 pending |
| SSI-18 | T3 part: `tests/contract/task-request-v2.test.mjs:460-465` a Codex node with a write scope is refused in a graph and in a swarm with `VES_TASK_REQUEST_EXECUTION_INVALID`; the runtime part (Codex node sessions are readers) is T5; T3 part: `tests/contract/task-request-v2.test.mjs:453-454` a Codex node with a write scope is refused in a graph and in a swarm with `VES_TASK_REQUEST_EXECUTION_INVALID`; the runtime part (Codex node sessions are readers) is T5 | `pnpm test:contract` (906/906, commit 2) | PASS (author, T3 part) |
| SSI-19 | — | — | — |
| SSI-20 | `tests/contract/task-request-v2.test.mjs:25-27` registry holds `task-request@2` and accepts one example per mode; `:35` shared members equal v1's; `tests/contract/task-request-v1-golden.test.mjs:25` v1 schema bytes equal the `dc35c52` golden; `:36` generated v1 output byte-identical; `tests/contract/schema-registry.test.mjs` zero drift of the generator (`--check`) | `pnpm test:contract` (814/814, commit 1) | PASS (author) |
| SSI-21 | `tests/contract/task-request-v1-golden.test.mjs:43-57` normalized form and execution-contract digest; `:73-79` Execution Package payload digest and approval binding digest; `:85-87` plan surface; all equal the values recorded on `dc35c52` before any change | `pnpm gate:build` contract 907/907 (tip) | PASS (author) |
| SSI-22 | `tests/contract/task-request-v1-golden.test.mjs:64-68` a v1 plan record is written with the recorded bytes and loads unchanged; existing Run record suites unchanged and passing; `tests/integration/task-coordinated-plan.test.mjs:49-76` a v2 record loads through the same validated reader and fails closed when invalid or tampered | `pnpm gate:build` contract 907, integration 1149 (tip) | PASS (author) |
| SSI-23 | `tests/contract/task-request-v2.test.mjs:145` each mode normalizes to its whole descriptor plus all seven limits at the SSI-37 defaults; `:156-163` a declared limit is kept and the rest default; `:534` the canonical encoding carries the whole descriptor | `pnpm test:contract` (906/906, commit 2) | PASS (author) |
| SSI-24 | `tests/contract/task-request-v2.test.mjs:234-268` 26 cases (API key, authentication mode, billing, endpoint, executable, credential, the v1 `driver`, unknown members on nodes, node drivers, edges, handoffs, limits, the verifier, the task, a gate, budgets, the repair policy, members of another mode, missing members) refused by the schema and by the normalizer with `VES_TASK_REQUEST_INVALID` | `pnpm test:contract` (906/906, commit 2) | PASS (author) |
| SSI-25 | `tests/contract/task-request-v2.test.mjs:441-448` cycle, self-edge, node no source reaches, unknown edge node, unknown input, descendant input, self input, input on an agent; schema admits, normalizer refuses with `VES_TASK_REQUEST_EXECUTION_INVALID` (`:497-498`); shape cases (duplicate input or edge, malformed IDs) refused by both (`:423-424`) | `pnpm test:contract` (906/906, commit 2) | PASS (author) |
| SSI-26 | `tests/contract/task-request-v2.test.mjs:449-480` read or write scope outside the change scope (and a letter-case variant), write scope containing, inside, or case-folding onto a protected path, Git metadata, Codex write scope (graph and swarm), unordered writers, no writer (agent, graph, swarm); `:508-530` ordered writers and several swarm writers are accepted | `pnpm test:contract` (906/906, commit 2) | PASS (author) |
| SSI-27 | `tests/contract/task-request-v2.test.mjs:482-490` unknown start, handoff to or from an unknown node, handoff to itself, a source listed twice; `:395` a swarm node with inputs refused by both | `pnpm test:contract` (906/906, commit 2) | PASS (author) |
| SSI-28 | `tests/unit/task-plan-binding.test.mjs:68-72` one test per element (mode, node identifier, driver, model, instructions, description, read scope, write scope, input, edge, start, handoff target, and each of the seven limits) asserts a new binding digest; `:74-77` all 19 digests differ; sensor D1–D5 and D7 kill when a field leaves the binding | `pnpm gate:quick` unit 2689 (tip) | PASS (author) |
| SSI-29 | T3 part: `tests/unit/task-plan-binding.test.mjs:82-91` the Execution Package seals the whole normalized v2 request as its execution contract and the approval binds that package; `tests/integration/task-coordinated-plan.test.mjs:49-59` the plan record seals the same request; executing it at `start` and `resume` is T5 and T8 (until then they refuse, `:94-102`) | `pnpm gate:build` (tip) | PASS (author, T3 part) |
| SSI-30 | — | — | — |
| SSI-31 | — | — | — |
| SSI-32 | — | — | — |
| SSI-33 | — | — | — |
| SSI-34 | — | — | — |
| SSI-35 | — | — | — |
| SSI-36 | — | — | — |
| SSI-37 | `tests/contract/task-request-v2.test.mjs:145` absent limits take 1, 64, 128, 8, 32, 64 KiB, 256 KiB; `:176-185` 1, default−1, default, default+1 accepted per limit; `:196-209` 65 graph nodes, 129 edges, and 9 swarm agents refused at the default and accepted when raised, 64 nodes, 128 edges, and 8 agents accepted at it | `pnpm test:contract` (906/906, commit 2) | PASS (author) |
| SSI-38 | `tests/contract/task-request-v2.test.mjs:176-185` ceiling−1 and ceiling accepted per limit; `:187-194` ceiling+1, 0, 1.5, and a string refused by both; `:211-229` 256 nodes, 16 agents, and 512 edges plan at their ceilings, 257, 17, and 513 are refused by both | `pnpm test:contract` (906/906, commit 2) | PASS (author) |
| SSI-39 | — | — | — |
| SSI-40 | — | — | — |
| SSI-41 | — | — | — |
| SSI-42 | — | — | — |
| SSI-43 | — | — | — |
| SSI-44 | — | — | — |
| SSI-45 | — | — | — |
| SSI-46 | T4 share: a structured session without an answer, with exhausted retries, or with an unreadable answer fails with a stable driver code and hands nothing on (`tests/contract/claude-code-driver-structured.test.mjs:88`, `tests/contract/codex-driver-structured.test.mjs:157`); mutants M12, M13 killed. T5 maps it to `VES_COORDINATION_RESULT_INVALID`. | `pnpm test:contract` | PASS (T4 share); T5 pending |
| SSI-47 | — | — | — |
| SSI-48 | The bound is applied before emission (`tests/unit/driver-event.test.mjs:143`; driver boundaries `tests/contract/claude-code-driver-structured.test.mjs:119`, `tests/contract/codex-driver-structured.test.mjs:157`) and the port carries only `payload:sha256:<digest>` of the canonical bytes (`tests/integration/driver-execution-adapter.test.mjs:305`); mutants M10, M11 killed. | `pnpm test:unit`, `pnpm test:contract`, `pnpm test:integration` | PASS |
| SSI-49 | T4 share: the new events carry only the canonical answer, a closed-vocabulary scope, and an ISO reset; checkpoints gain nothing (`tests/security/driver-structured-results-security.test.mjs:58`, `:162`, `:173`). T5 owns the persisted node results and ledger. | `pnpm test:security` | PASS (T4 share); T5 pending |
| SSI-50 | — | — | — |
| SSI-51 | — | — | — |
| SSI-52 | — | — | — |
| SSI-53 | — | — | — |
| SSI-54 | `apiKeySource` other than `none` fails a subscription session with `VES_CLAUDE_AUTH_METHOD_MISMATCH` before `session.started` and any tool effect (`tests/contract/claude-code-driver-structured.test.mjs:172`, `spikes/claude-code-driver/test/claude-driver-structured.test.mjs:108`); mutant M1 killed. | `pnpm test:contract`, `pnpm qualify:claude` | PASS |
| SSI-55 | A subscription-only Codex session reads `account/read` before `model/list` and refuses `apiKey`, `amazonBedrock`, and no account with `VES_CODEX_AUTH_METHOD_MISMATCH` before `thread/start` (`tests/contract/codex-driver-structured.test.mjs:217`, `:232`; `spikes/codex-driver/test/codex-driver-structured.test.mjs:68`); mutant M2 killed. | `pnpm test:contract`, `pnpm qualify:codex` | PASS |
| SSI-56 | T4 share: credits on any snapshot stop the session before its turn with `VES_CODEX_CREDITS_PRESENT` (`tests/contract/codex-driver-structured.test.mjs:249`); mutant M5 killed. T6 maps it to `not configured`. | `pnpm test:contract` | PASS (T4 share); T6 pending |
| SSI-57 | The client sends only its allowlist, refuses every other method at the single write path, and no product source names a credit or login method (`tests/contract/codex-driver-structured.test.mjs:73`, `:92`, `:107`; `tests/architecture/codex-client-methods.test.mjs:42`, `:49`, `:60`); no fallback model, budget, key, or key helper flag is in any pinned invocation (`tests/contract/claude-code-driver-structured.test.mjs:47`); mutants M3, M4 killed. | `pnpm test:contract`, `pnpm test:architecture` | PASS |
| SSI-58 | Claude `rejected` (with and without reset), Codex `usageLimitExceeded`, a usage-limit or credits-depleted `rateLimitReachedType`, and `ordinaryUsageAllowed: false` each emit one `quota.exhausted` with a reset only when reported; `allowed_warning` is one warning; `rate_limit_reached` is none (`tests/contract/claude-code-driver-structured.test.mjs:187`, `:214`; `tests/contract/codex-driver-structured.test.mjs:283`, `:313`, `:329`); mutants M6–M9, M16 killed. | `pnpm test:contract`, `pnpm test:integration` | PASS |
| SSI-59 | — | — | — |
| SSI-60 | — | — | — |
| SSI-61 | — | — | — |
| SSI-62 | — | — | — |
| SSI-63 | — | — | — |
| SSI-64 | — | — | — |
| SSI-65 | — | — | — |
| SSI-66 | — | — | — |
| SSI-67 | — | — | — |
| SSI-68 | — | — | — |
| SSI-69 | T7 Evidence, commit 1 row SSI-69 | gate:quick, test:integration, test:security (bridge suites) | PASS on darwin; Linux and Windows legs pending the platform matrix |
| SSI-70 | T7 Evidence, commit 1 row SSI-70 | test:integration | PASS on darwin; Windows implementation in commit 2 |
| SSI-71 | T7 Evidence, commit 2 row SSI-71 | test:unit, test:security | PASS on darwin; win32 cases pending the Windows leg |
| SSI-72 | T7 Evidence, commit 2 row SSI-72 | test:unit | PASS on darwin |
| SSI-73 | T7 Evidence, commit 2 row SSI-73 (PowerShell, logging, ACL); managed policy with SSI-74 | test:unit, test:security | PASS on darwin; win32 cases pending |
| SSI-74 | T7 Evidence, commit 3 row SSI-74 | test:contract, test:unit | PASS on darwin; win32 case pending the Windows leg |
| SSI-75 | T7 Evidence, commit 2 row SSI-75 | test:unit, test:security | PASS on darwin; win32 cases pending |
| SSI-76 | T7 Evidence, commit 2 row SSI-76 and its second-client deviation | test:security | PASS on darwin; win32 cases pending |
| SSI-77 | T7 Evidence, commit 2 row SSI-77 | test:integration | PASS (refusals kept; lifting is commit 4) |
| SSI-78 | — | — | — |
| SSI-79 | — | — | — |
| SSI-80 | — | — | — |
| SSI-81 | T4 share: events, checkpoints, payloads, and the quota refusal carry no token, session, account data, provider prose, or temporary path (`tests/security/driver-structured-results-security.test.mjs:58`, `:162`, `:173`); mutant M18 killed. T5 and T6 own their records. | `pnpm test:security` | PASS (T4 share); T5, T6 pending |
| SSI-82 | — | — | — |
| SSI-83 | T3 part: v1 is unchanged (SSI-20, SSI-21, SSI-22 rows); a v2 request is opt-in by `schemaVersion: 2` (`packages/application/src/execution/task-request.ts` `normalizeTaskRequest`); `tests/e2e/task-cli-e2e.test.mjs:827-852` a v2 dry run plans through the binary, `:854-871` an invalid descriptor is `VES_TASK_REQUEST_REJECTED` with reason `VES_TASK_REQUEST_EXECUTION_INVALID` and nothing written | `node --test tests/e2e/task-cli-e2e.test.mjs` 45/45 (tip) | PASS (author, T3 part) |
| SSI-84 | — | — | — |
| SSI-85 | — | — | — |

## Discrimination Sensor (planned)

Each mutant is applied in a scratch worktree, the named suite is run, and the
mutant must be killed (a test fails). A surviving mutant becomes a fix task.

| Mutant | Requirement | Expected killer | Result |
| --- | --- | --- | --- |
| Drop one descriptor field from the canonical request before digesting | SSI-28 | Per-field binding-digest test | — |
| Accept a cycle in the graph normalizer | SSI-25 | Cycle rejection case | — |
| Let a write scope leave `task.changeScope` | SSI-26 | Scope rejection case | — |
| Skip node write-scope narrowing in the coordinated driver | SSI-41 | Out-of-node-scope write refused before the executor | — |
| Remove the writer mutex | SSI-40 | Two writers never overlap (instrumented fake) | — |
| Raise a default limit by one | SSI-37 | Limit boundary cases | — |
| Accept an undeclared handoff target | SSI-43 | Forbidden-destination swarm case | — |
| Persist a result before checking its size | SSI-47 | Oversized result leaves nothing persisted | — |
| Skip the `apiKeySource` check | SSI-54 | Fake init with `ANTHROPIC_API_KEY` | Killed (T4 M1) |
| Skip the Codex `account/read` check | SSI-55 | Fake `apiKey` account | Killed (T4 M2) |
| Allow `account/rateLimitResetCredit/consume` | SSI-57 | Method allowlist test | Killed (T4 M3) |
| Skip the billing confirmation at resume | SSI-52 | Resume without confirmation is `not configured` | — |
| Clean up the worktree on `suspended` | SSI-60 | Suspended worktree survives | — |
| Re-run a partial node silently | SSI-66 | Uncertain-node refusal | — |
| Construct a Strands `Agent` in the adapter | SSI-03, SSI-79 | Architecture ban and empty-environment probe | — |
| Import the SDK root entry | SSI-02 | Architecture test and sealed build | — |

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

None yet. Every test deleted by T3–T8 is listed here with the test at the
deepened interface that covers the same case.

- T7: `tests/unit/windows-acl.test.mjs` "the grant removes inheritance and
  gives the SID alone inheritable full control" (the grant arguments) →
  "the DACL is replaced whole from a BOM-less UTF-16LE file beside the
  directory" (`:113`), which pins the arguments and file that replaced the
  grant; the grant itself is now the refused case "the hosted runner's grant
  leaves SYSTEM and Administrators beside the owner, so that path is refused"
  (`:196`).
