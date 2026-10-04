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
| `start` and `resume` refuse a v2 run with either provider on an API key and leave it as it was; on subscriptions they go on to their credential read | `tests/integration/task-coordinated-plan.test.mjs:99`, `:110` | `node --test tests/integration/task-coordinated-plan.test.mjs`: 10 of 10 |
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
| SSI-51, SSI-52 at the command: `start` and `resume` of a v2 run with no confirmation, one missing Claude Code, or one of another Codex method are `not configured` and leave the state, the state root, and the active marker as they were; with the confirmation they reach their credential read | `tests/integration/task-coordinated-plan.test.mjs:124`, `:137` | `node --test tests/integration/task-coordinated-plan.test.mjs`: 16 of 16 |
| Journey, missing confirmation: `start` is `not configured` with nothing started (no grant, no worktree, no provider, not even `codex login status`), the terminal names the step and no machine path reaches the public error; a statement for another method is refused the same way | `tests/e2e/task-subscription-e2e.test.mjs:45` | `node scripts/test-scope.mjs e2e tests/e2e/task-subscription-e2e.test.mjs tests/e2e/task-coordinated-e2e.test.mjs`: 6 of 6 |
| Journey, `api-key` provider: `start` is `not configured` (`coordinated-run-subscription`) with a confirmation present, nothing started | `tests/e2e/task-subscription-e2e.test.mjs:65` | same |

Tests changed, none deleted. `tests/integration/task-coordinated-plan.test.mjs`
"start/resume of a v2 run on subscriptions is composed" now writes the
confirmation first (it is the composed case); T5's citation `:110` of that
case is now `:137`. The coordinated e2e journeys of T5 write the confirmation
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
| SSI-59: a quota signal suspends the run; an engine that keeps scheduling is refused; the node still running is aborted and recorded; the record is exactly the closed members; the round stays `running` | `tests/unit/coordinated-suspension.test.mjs:38` | `node --test tests/unit/coordinated-suspension.test.mjs tests/unit/coordinated-driver.test.mjs`: 31 of 31 |
| SSI-60: the driver returns only once every node it started has ended and been recorded, even under an engine that returns at once | `tests/unit/coordinated-suspension.test.mjs:97` | same |
| Edge case: two quota signals from concurrent readers suspend once, recording the first | `tests/unit/coordinated-suspension.test.mjs:130` | same |
| Edge case: a writer stopped after its write is `partial` with its receipt count; a reset the provider did not report is absent | `tests/unit/coordinated-suspension.test.mjs:156` | same |
| D3b, SSI-56: Codex credits suspend with `VES_CODEX_CREDITS_PRESENT`, the Codex provider, no window or reset; no later node starts | `tests/unit/coordinated-suspension.test.mjs:186` | same |
| Any other node failure still fails the run and closes its round | `tests/unit/coordinated-suspension.test.mjs:203` | same |
| SSI-61, SSI-81: provider text in the window, a reset that is not an instant, an e-mail address, a session, and purchase fields never reach the record or the ledger | `tests/unit/coordinated-suspension.test.mjs:218` | same |
| A cancel that comes first wins over a later quota signal | `tests/unit/coordinated-suspension.test.mjs:241` | same |
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
with the quota code) → `tests/unit/coordinated-suspension.test.mjs:38`, the
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
| SSI-34 | `tests/e2e/task-coordinated-e2e.test.mjs:252` cancel stops the running node's provider and ends ABORTED; `tests/unit/coordinated-driver.test.mjs:386`, `tests/integration/strands-coordination-engine.test.mjs:184` every running node cancelled; mutant K6 killed | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-35 | — | — | — |
| SSI-36 | — | — | — |
| SSI-37 | `tests/contract/task-request-v2.test.mjs:145` absent limits take 1, 64, 128, 8, 32, 64 KiB, 256 KiB; `:176-185` 1, default−1, default, default+1 accepted per limit; `:196-209` 65 graph nodes, 129 edges, and 9 swarm agents refused at the default and accepted when raised, 64 nodes, 128 edges, and 8 agents accepted at it | `pnpm test:contract` (906/906, commit 2) | PASS (author) |
| SSI-38 | `tests/contract/task-request-v2.test.mjs:176-185` ceiling−1 and ceiling accepted per limit; `:187-194` ceiling+1, 0, 1.5, and a string refused by both; `:211-229` 256 nodes, 16 agents, and 512 edges plan at their ceilings, 257, 17, and 513 are refused by both | `pnpm test:contract` (906/906, commit 2) | PASS (author) |
| SSI-39 | T5 part: `tests/integration/coordinated-executor.test.mjs:60` and `tests/e2e/task-coordinated-e2e.test.mjs:189` usage of every node accumulates on the run's one ledger (330 tokens; 42 tokens in 4 events); across resumes is T6 | T5 gates (see T5 Evidence) | PASS (author, T5 part); T6 pending |
| SSI-40 | `tests/unit/coordinated-driver.test.mjs:129`, `tests/integration/strands-coordination-engine.test.mjs:163` writers never overlap; mutant C2 killed | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-41 | `tests/unit/coordinated-driver.test.mjs:148`, `tests/integration/coordinated-executor.test.mjs:60` writes outside the node's write scope refused before the executor; mutants C1, C16 killed | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-42 | A Claude Code node's bridge read scope is the node's read scope (`apps/vestra-cli/src/task/task-coordination.ts` `nodeDriver`, `readScope: session.node.readScope`; the bridge confinement itself is `tests/integration/mcp-tool-bridge.test.mjs`, unchanged); a Codex node does not read through the bridge (open question in the T5 report) | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-43 | `tests/unit/node-result.test.mjs:32`, `:86`; `tests/contract/strands-node-result-parity.test.mjs:31`, `:67`; mutants C5, C6, S2, S10 killed | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-44 | `tests/unit/coordinated-driver.test.mjs:255`, `:263`; `tests/integration/strands-coordination-engine.test.mjs:141` undeclared, malformed, or missing decisions fail the swarm with no repair cycle | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-45 | `tests/unit/coordinated-driver.test.mjs:276`, `tests/integration/strands-coordination-engine.test.mjs:150` `VES_COORDINATION_HANDOFF_LIMIT`; mutant C4 killed | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-46 | T4 share: a structured session without an answer, with exhausted retries, or with an unreadable answer fails with a stable driver code and hands nothing on (`tests/contract/claude-code-driver-structured.test.mjs:88`, `tests/contract/codex-driver-structured.test.mjs:157`); mutants M12, M13 killed. T5 maps it to `VES_COORDINATION_RESULT_INVALID`.; T5 part: `tests/unit/node-result.test.mjs:53`, `tests/unit/coordinated-driver.test.mjs:215`, `tests/integration/strands-coordination-engine.test.mjs:115` `VES_COORDINATION_RESULT_INVALID`, no repair cycle | `pnpm test:contract`; T5 gates | PASS (T4 share); PASS (author, T5 part) |
| SSI-47 | `tests/unit/node-result.test.mjs:93`, `tests/unit/coordinated-driver.test.mjs:194` refused before persistence; mutants C7, C8, C9 killed | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-48 | The bound is applied before emission (`tests/unit/driver-event.test.mjs:143`; driver boundaries `tests/contract/claude-code-driver-structured.test.mjs:119`, `tests/contract/codex-driver-structured.test.mjs:157`) and the port carries only `payload:sha256:<digest>` of the canonical bytes (`tests/integration/driver-execution-adapter.test.mjs:305`); mutants M10, M11 killed. | `pnpm test:unit`, `pnpm test:contract`, `pnpm test:integration` | PASS |
| SSI-49 | T4 share: the new events carry only the canonical answer, a closed-vocabulary scope, and an ISO reset; checkpoints gain nothing (`tests/security/driver-structured-results-security.test.mjs:58`, `:162`, `:173`). T5 owns the persisted node results and ledger.; T5 part: `tests/security/coordination-record-security.test.mjs:27`, `tests/unit/coordinated-driver.test.mjs:493` the ledger and results hold no session, credential, prompt, or path | `pnpm test:security`; T5 gates | PASS (T4 share); PASS (author, T5 part) |
| SSI-50 | `tests/unit/node-result.test.mjs:100` earlier results, the handoff, and the context are delimited untrusted data after the rules; tools and scopes come from the plan (`tests/unit/coordinated-driver.test.mjs:148`) | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-51 | Every provider, verifier included, must be `subscription` or the run is `not configured` (`coordinated-run-subscription`) before any credential, transition, or worktree: `tests/unit/task-billing.test.mjs:163`, `tests/integration/task-coordinated-plan.test.mjs:102`, journey `tests/e2e/task-subscription-e2e.test.mjs:65`; mutants B1, B10 killed | T6 commit 1 (see T6 Evidence) | PASS (author) |
| SSI-52 | A confirmation naming each provider and its effective method under the current regime is required at `start` and `resume`; absent, malformed, or mismatched is `not configured` (`extra-usage-confirmation`): `tests/unit/task-billing.test.mjs:74`, `:173`, `tests/integration/task-coordinated-plan.test.mjs:124`, journey `tests/e2e/task-subscription-e2e.test.mjs:45`; mutants B1–B9, B11 killed | T6 commit 1 (see T6 Evidence) | PASS (author) |
| SSI-53 | The statement is a closed shape of closed values and bounded grammars; a token, account identifier, e-mail address, name, path, or key member is refused at either level, and a free-text plan type is refused: `tests/unit/task-billing.test.mjs:74`, `:116`; mutant B8 killed | T6 commit 1 (see T6 Evidence) | PASS (author) |
| SSI-54 | `apiKeySource` other than `none` fails a subscription session with `VES_CLAUDE_AUTH_METHOD_MISMATCH` before `session.started` and any tool effect (`tests/contract/claude-code-driver-structured.test.mjs:172`, `spikes/claude-code-driver/test/claude-driver-structured.test.mjs:108`); mutant M1 killed. | `pnpm test:contract`, `pnpm qualify:claude` | PASS |
| SSI-55 | A subscription-only Codex session reads `account/read` before `model/list` and refuses `apiKey`, `amazonBedrock`, and no account with `VES_CODEX_AUTH_METHOD_MISMATCH` before `thread/start` (`tests/contract/codex-driver-structured.test.mjs:217`, `:232`; `spikes/codex-driver/test/codex-driver-structured.test.mjs:68`); mutant M2 killed. | `pnpm test:contract`, `pnpm qualify:codex` | PASS |
| SSI-56 | T4 share: credits on any snapshot stop the session before its turn with `VES_CODEX_CREDITS_PRESENT` (`tests/contract/codex-driver-structured.test.mjs:249`); mutant M5 killed. T6 maps it to `not configured`. | `pnpm test:contract`; T6 commit 2 | PASS (T4 share); PASS (author, T6 part: credits on the account of a Codex node suspend the run and the command is `not configured` (`codex-credits`), `tests/unit/coordinated-suspension.test.mjs:186`, journey `tests/e2e/task-subscription-e2e.test.mjs:151`; mutants S9, S14, S15 killed) |
| SSI-57 | The client sends only its allowlist, refuses every other method at the single write path, and no product source names a credit or login method (`tests/contract/codex-driver-structured.test.mjs:73`, `:92`, `:107`; `tests/architecture/codex-client-methods.test.mjs:42`, `:49`, `:60`); no fallback model, budget, key, or key helper flag is in any pinned invocation (`tests/contract/claude-code-driver-structured.test.mjs:47`); mutants M3, M4 killed. | `pnpm test:contract`, `pnpm test:architecture` | PASS |
| SSI-58 | Claude `rejected` (with and without reset), Codex `usageLimitExceeded`, a usage-limit or credits-depleted `rateLimitReachedType`, and `ordinaryUsageAllowed: false` each emit one `quota.exhausted` with a reset only when reported; `allowed_warning` is one warning; `rate_limit_reached` is none (`tests/contract/claude-code-driver-structured.test.mjs:187`, `:214`; `tests/contract/codex-driver-structured.test.mjs:283`, `:313`, `:329`); mutants M6–M9, M16 killed. | `pnpm test:contract`, `pnpm test:integration` | PASS |
| SSI-59 | A quota signal from any node starts no further node (an engine that keeps scheduling is refused), cancels and waits for every running node, and suspends the run: `tests/unit/coordinated-suspension.test.mjs:38`, `:97`; inside the executor `tests/integration/coordinated-executor.test.mjs:162`; journey `tests/e2e/task-subscription-e2e.test.mjs:115`; mutants S5, S6 killed | T6 commit 2 (see T6 Evidence) | PASS (author) |
| SSI-60 | Completed node results, receipts, the ledger, and the budget ledger persist; the worktree is kept; the writer coordination and the active marker are released; the state stays `IMPLEMENTING`: `tests/integration/coordinated-executor.test.mjs:162`, `tests/unit/task-run-coordinator.test.mjs:274`, journey `tests/e2e/task-subscription-e2e.test.mjs:115`; mutants S1, S3, S10, S11, S12 killed | T6 commit 2 (see T6 Evidence) | PASS (author) |
| SSI-61 | The record is the code of the signal, the provider, the instant, and only the reported window and reset, each in its grammar, at every layer: `tests/unit/coordinated-suspension.test.mjs:38`, `:130`, `:218`; `tests/integration/coordinated-executor.test.mjs:228`; `tests/unit/task-run-record-readers.test.mjs:170`; mutants S4, S7, S8, S13 killed (the window `scope` is kept beside the four members: spec-precision note in T6 commit 2) | T6 commit 2 (see T6 Evidence) | PASS (author) |
| SSI-62 | — | — | — |
| SSI-63 | — | — | — |
| SSI-64 | Suspension is an executor checkpoint stage and a run outcome, never a workflow state: only `START_IMPLEMENTATION` is applied (`tests/unit/task-run-coordinator.test.mjs:274`); no file under `packages/domain/src/workflow/` changed, and the workflow machine suites pass unchanged | T6 commit 2 (see T6 Evidence) | PASS (author) |
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
| SSI-79 | `tests/integration/strands-empty-environment.test.mjs:50` with a positive control at `:69`; mutant S6 killed by the probe alone | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-80 | T5 share: 43 mutants killed (validation.md, "T5 discrimination summary"); scope narrowing C1/C16, writer mutex C2, limits C3/C4/C8/C9/S3, destination check C5/C6/S2/S10 | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-81 | T4 share: events, checkpoints, payloads, and the quota refusal carry no token, session, account data, provider prose, or temporary path (`tests/security/driver-structured-results-security.test.mjs:58`, `:162`, `:173`); mutant M18 killed. T5 and T6 own their records.; T5 part: the node ledger and node results carry no token, session, prompt, repository context, or path (`tests/security/coordination-record-security.test.mjs:27`) | `pnpm test:security`; T5 gates | PASS (T4 share); PASS (author, T5 part); T6 pending |
| SSI-82 | `tests/build/sealed-self-containment.test.mjs:115` every sealed artifact, the adapter included, imports `node:` built-ins only; sizes, cold start, and a silent `--activation-health` recorded in T5 commits 5 and 6; the staged-layout gate suite runs on the platform matrix | T5 gates (see T5 Evidence) | PASS (author) |
| SSI-83 | T3 part: v1 is unchanged (SSI-20, SSI-21, SSI-22 rows); a v2 request is opt-in by `schemaVersion: 2` (`packages/application/src/execution/task-request.ts` `normalizeTaskRequest`); `tests/e2e/task-cli-e2e.test.mjs:827-852` a v2 dry run plans through the binary, `:854-871` an invalid descriptor is `VES_TASK_REQUEST_REJECTED` with reason `VES_TASK_REQUEST_EXECUTION_INVALID` and nothing written; T5 part: `tests/integration/task-coordination-loading.test.mjs:40` other commands load no SDK; the v1 journeys pass unchanged (`tests/e2e/task-cli-e2e.test.mjs`, `mediated-task-execution-e2e.test.mjs`, 48/48) | `node --test tests/e2e/task-cli-e2e.test.mjs` 45/45 (tip); T5 gates | PASS (author, T3 and T5 parts) |
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
| Re-run a partial node silently | SSI-66 | Uncertain-node refusal | — |
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

- T7: `tests/unit/windows-acl.test.mjs` "the grant removes inheritance and
  gives the SID alone inheritable full control" (the grant arguments) →
  "the DACL is replaced whole from a BOM-less UTF-16LE file beside the
  directory" (`:113`), which pins the arguments and file that replaced the
  grant; the grant itself is now the refused case "the hosted runner's grant
  leaves SYSTEM and Administrators beside the owner, so that path is refused"
  (`:197`).
