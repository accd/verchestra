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
| `schemas/task-request/1.schema.json` bytes | `sha256:9bfc24cec02371649ef58c67370e9b631f6d8fbc563ab33363e505213d048d62` | `tests/contract/task-request-v1-golden.test.mjs:23` |
| `packages/contracts/src/generated.ts` before v2 | `sha256:341983f6ffe969ccff397457284597d7a36e54732115291414326be77ba38512` | `tests/contract/task-request-v1-golden.test.mjs:34` |
| Canonical normalized v1 request (with repair policy) | `sha256:e1040b2826bf1725293fa29b017a09694ae5c9919b08ababd25b58ea43496d68` | `tests/contract/task-request-v1-golden.test.mjs:41` |
| Canonical normalized v1 request (without repair policy) | `sha256:cd24f69dc148d13e8d85e811f8968cb5708b065f00b4152032e3160f59673464` | `tests/contract/task-request-v1-golden.test.mjs:47` |
| Execution-contract digest of the fixture request | `sha256:2b4dd994497595fb01d37ea747af6ca34bfe6dc85c01fc7b02c6da7ccdd1a196` | `tests/contract/task-request-v1-golden.test.mjs:53` |
| Sealed `plan.json` bytes of the fixture plan record | `sha256:e6c97cd79c6eb7a6ea93d954e9c098cc8205a4cece0318615b51b7eabed0272f` | `tests/contract/task-request-v1-golden.test.mjs:62` |
| Execution Package payload digest | `sha256:13f2bc46466cabfb74f678f3913e5838cd838ef20b1f2f5ceea1a06be93a11db` | commit 3 |
| Approval binding digest | `sha256:9a6d82f4cc3fe2109fea2ef033b2334eef11d6f09c92eb3f3a5df616dc0f87a5` | commit 3 |
| `task plan` surface of the fixture plan | `sha256:5056fc0cf5335975fbcda1a748b2aeeca4b4313f4418926cf87bbea0ad47ec83` | commit 3 |

### Commit 1 — schema, generator, generated type

- `schemas/task-request/2.schema.json`: closed at every level; shares
  `sourceRevision`, `task`, `gates`, `budgets`, `onGateFailure`, `verifier`,
  and `instructions` with v1 byte for byte as JSON values
  (`tests/contract/task-request-v2.test.mjs:34`); drops `driver` (`:35`); mode
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
  schema and refused by the normalizer (`:490-491`, `:497-498`, `:203-204`).
- Spec-precision notes. SSI-25's "a node unreachable from a source" can only
  happen behind a cycle in a finite directed graph, so one rule (Kahn's order)
  refuses both; the case at `:436` is a cycle that no source reaches. A write
  scope "covers" a protected path when either contains the other in any letter
  case (`taskPathsOverlap`), and Git metadata at any depth counts as protected
  (the task-path invariant). Handoff lists need at least one entry.
- Gates: focused tests 149/149 (v2 contract 96, v1 contract, goldens, request
  security); `pnpm gate:quick` PASS (unit 2666, agent-readiness 331, census
  13; 0 fail, 0 skipped, 0 todo); `pnpm test:architecture` 122/122;
  `pnpm test:contract` 906/906.

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
| SSI-11 | — | — | — |
| SSI-12 | — | — | — |
| SSI-13 | — | — | — |
| SSI-14 | — | — | — |
| SSI-15 | — | — | — |
| SSI-16 | — | — | — |
| SSI-17 | T4 share: a structured or quota session keeps `model.resolved` provider `anthropic` or `openai` and the Passport reference; no new event names another provider (`spikes/claude-code-driver/test/claude-driver-structured.test.mjs:40-50`, `spikes/codex-driver/test/codex-driver-structured.test.mjs:47-55`). T5 owns the node records. | `pnpm qualify:claude`, `pnpm qualify:codex` | PASS (T4 share); T5 pending |
| SSI-18 | T3 part: `tests/contract/task-request-v2.test.mjs:453-454` a Codex node with a write scope is refused in a graph and in a swarm with `VES_TASK_REQUEST_EXECUTION_INVALID`; the runtime part (Codex node sessions are readers) is T5 | `pnpm test:contract` (906/906, commit 2) | PASS (author, T3 part) |
| SSI-19 | — | — | — |
| SSI-20 | `tests/contract/task-request-v2.test.mjs:25-26` registry holds `task-request@2` and accepts one example per mode; `:34` shared members equal v1's; `tests/contract/task-request-v1-golden.test.mjs:23` v1 schema bytes equal the `dc35c52` golden; `:34` generated v1 output byte-identical; `tests/contract/schema-registry.test.mjs` zero drift of the generator (`--check`) | `pnpm test:contract` (814/814, commit 1) | PASS (author) |
| SSI-21 | — | — | — |
| SSI-22 | — | — | — |
| SSI-23 | `tests/contract/task-request-v2.test.mjs:145` each mode normalizes to its whole descriptor plus all seven limits at the SSI-37 defaults; `:156-163` a declared limit is kept and the rest default; `:527` the canonical encoding carries the whole descriptor | `pnpm test:contract` (906/906, commit 2) | PASS (author) |
| SSI-24 | `tests/contract/task-request-v2.test.mjs:234-268` 26 cases (API key, authentication mode, billing, endpoint, executable, credential, the v1 `driver`, unknown members on nodes, node drivers, edges, handoffs, limits, the verifier, the task, a gate, budgets, the repair policy, members of another mode, missing members) refused by the schema and by the normalizer with `VES_TASK_REQUEST_INVALID` | `pnpm test:contract` (906/906, commit 2) | PASS (author) |
| SSI-25 | `tests/contract/task-request-v2.test.mjs:434-441` cycle, self-edge, node no source reaches, unknown edge node, unknown input, descendant input, self input, input on an agent; schema admits, normalizer refuses with `VES_TASK_REQUEST_EXECUTION_INVALID` (`:490-491`); shape cases (duplicate input or edge, malformed IDs) refused by both (`:423-424`) | `pnpm test:contract` (906/906, commit 2) | PASS (author) |
| SSI-26 | `tests/contract/task-request-v2.test.mjs:442-473` read or write scope outside the change scope (and a letter-case variant), write scope containing, inside, or case-folding onto a protected path, Git metadata, Codex write scope (graph and swarm), unordered writers, no writer (agent, graph, swarm); `:501-523` ordered writers and several swarm writers are accepted | `pnpm test:contract` (906/906, commit 2) | PASS (author) |
| SSI-27 | `tests/contract/task-request-v2.test.mjs:475-479` unknown start, handoff to or from an unknown node, handoff to itself, a source listed twice; `:395` a swarm node with inputs refused by both | `pnpm test:contract` (906/906, commit 2) | PASS (author) |
| SSI-28 | — | — | — |
| SSI-29 | — | — | — |
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
| SSI-69 | — | — | — |
| SSI-70 | — | — | — |
| SSI-71 | — | — | — |
| SSI-72 | — | — | — |
| SSI-73 | — | — | — |
| SSI-74 | — | — | — |
| SSI-75 | — | — | — |
| SSI-76 | — | — | — |
| SSI-77 | — | — | — |
| SSI-78 | — | — | — |
| SSI-79 | — | — | — |
| SSI-80 | — | — | — |
| SSI-81 | T4 share: events, checkpoints, payloads, and the quota refusal carry no token, session, account data, provider prose, or temporary path (`tests/security/driver-structured-results-security.test.mjs:58`, `:162`, `:173`); mutant M18 killed. T5 and T6 own their records. | `pnpm test:security` | PASS (T4 share); T5, T6 pending |
| SSI-82 | — | — | — |
| SSI-83 | — | — | — |
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
