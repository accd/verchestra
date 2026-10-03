# Validation T6 — a typed Driver event

Task T6 of the second architecture deepening round (ADR2-6): a Driver event
is a declared, closed type; consumers do not cast it; the usage check is
written once. Source: the architecture review of `main` at `9eb2881`, card 7.
That card predates T3 (one provider child run for Claude Code and Codex) and
the cancel order work; the state below is read again from `main` at
`6fae651`. `main` has since gained T9 (`10747a1`, `2651fa0`), which changes
none of the sources cited or recorded here.

The task is two pull requests, each a contiguous range of commits:

1. **The event type** (sections 1 to 9): `fe6ef6b`, `e9a8c43`, `342234c`,
   `c2893ef` and `087bc89`, which adds this file. Citations of the tip in
   these sections are at `c2893ef`, the last commit of the range that
   changes code.
2. **The framed protocol in the package's entry** (section 10): `d7ea736`
   and the commit that adds that section.

## 1. The friction on `main`

At `6fae651`:

| Point | Where | What |
| --- | --- | --- |
| An open record | `packages/drivers/src/index.ts:349-352` | `DriverEvent = Readonly<Record<string, unknown>> & { type; sequence }`; any field compiles |
| The emit of the ledger | `driver-session-ledger.ts:16`, `:83`, `:92` | takes `Readonly<Record<string, unknown>>` and casts the frozen copy `as DriverEvent` |
| The fields, stated nowhere | — | each driver writes its own literals; the mock alone lists the keys of five types, `index.ts:386-392` |
| The usage check, three copies | Claude Code `claude-code-driver.ts:399-413`, Codex `codex-driver.ts:194-204`, OpenCode `opencode-driver.ts:379-397` | one rule written three times: `Number(value ?? 0)`, a non-negative safe integer, else the driver's `…_STREAM_INVALID` |
| No check | Pi `pi-driver.ts:259-263` | the runtime's counts are emitted as they are relayed |
| A fourth check | the mock, `index.ts:402-406` | `Number.isSafeInteger` only: a negative scripted count is admitted |
| Casts | `driver-execution-adapter.ts:212-213`, `task-codex.ts:171-172` | `event["inputTokens"] as number` |
| Open-record reads | `driver-execution-adapter.ts:183`, `:199`; `task-codex.ts:258`; `driver-session-runner.ts:118-121` | `event["resolvedModel"]`, `event["name"]`, `event["text"]`, `event["sessionId"]`, `event["outcome"]`, `event["code"]` |
| A second event declaration | `driver-session-runner.ts:3` | `DriverSessionEvent = Row & { type: string }`, with an event generic on the port and the runner (`:11`, `:21`, `:50`, `:148`) |
| Fields one driver sets | OpenCode `reasoningTokens`, `cacheReadTokens`, `cacheWriteTokens` (`opencode-driver.ts:390-397`) and `patterns` (`:363-371`); Pi `api` (`pi-driver.ts:217-223`) | read by no product source |

## 2. Where the type lives, and why

`packages/domain/src/driver-event/driver-event.ts`, exported from
`@verchestra/domain`.

| Candidate | Verdict |
| --- | --- |
| `packages/domain` | **Chosen.** Both sides of the Driver seam already depend on it: `packages/drivers` (the emitters) and `packages/agent-runtime` (the session runner and the execution adapter), and the composition root may import it. No dependency edge is added. The module is pure: types, a frozen table, and two functions. |
| `packages/drivers`, with a structural copy in `agent-runtime` | Rejected: agent-runtime may not import a sibling adapter (`docs/repository-map.md`, `scripts/architecture.mjs`), so the fields would be stated twice, which is the friction. |
| `packages/application` | Rejected: `packages/drivers` does not depend on it, so the edge would be a dependency addition, and a Driver event is not a port of a use case. |
| `packages/contracts` | Rejected: it holds versioned schemas and the types generated from them. A Driver event is an in-process value with no serialized form and no schema. |

`packages/drivers/src/index.ts` re-exports the types for its own interface
(`Driver.start` takes a sink of `DriverEvent`). `DriverSessionPort` in
agent-runtime stays structural for the driver, and types its sink with the
domain's event; its event generic is gone.

## 3. The field table

`DRIVER_EVENT_FIELDS` (`driver-event.ts:21-43`) states every type and the
kind of every field; a kind that ends in `?` is set by some drivers only.
`DriverEventOf<T>`, `DriverEventBody` and `DriverEvent` are derived from it
(`:65-75`), so a driver that writes a field outside its row does not compile.
TypeScript does not check a spread against a row, so every emitter names its
fields (`c2893ef`): the OpenCode tool request (`opencode-driver.ts:391-392`)
and the provider child run's error report (`provider-child-run.ts:297`) were
spread from records.

Who sets each field and who reads it, at `c2893ef`:

| Type | Field | Set by | Read by a product source |
| --- | --- | --- | --- |
| `session.started` | `sessionId` | every driver | the session runner, to cancel (`driver-session-runner.ts:119`) |
| `model.resolved` | `passportRef` | every driver | none |
| | `provider`, `resolvedModel` | Claude Code, Codex, OpenCode, Pi | `resolvedModel`: the execution adapter, to meter (`driver-execution-adapter.ts:178`) |
| | `api` | Pi | none |
| `content.delta` | `text` | every driver | the Codex verifier (`task-codex.ts:258`) |
| `tool.requested` | `toolCallId`, `name`, `input` | every driver | `name`: the execution adapter (`driver-execution-adapter.ts:194`) |
| | `patterns` | OpenCode | none |
| `usage.updated` | `inputTokens`, `outputTokens` | every driver | the execution adapter (`:209`) and the Codex verifier (`task-codex.ts:171-172`) |
| | `reasoningTokens`, `cacheReadTokens`, `cacheWriteTokens` | OpenCode | none |
| `warning` | `code`, `message` | Codex, Pi, the mock | none |
| `error` | `code`, `message`, `retryable` | every driver | `code`: the session runner (`:121`) |
| `session.closed` | `outcome`, `reason` | the session ledger, the mock | `outcome`: the session runner (`:120`) |

"Every driver" is Claude Code, Codex, OpenCode, Pi and the mock. The common
fields no product source reads are the Driver vocabulary T33 qualified and
the mock checks; every driver sets them, and each qualification suite pins
sequences that carry them.

### The fields only some drivers set

| Field | Decision | Why |
| --- | --- | --- |
| OpenCode `reasoningTokens`, `cacheReadTokens`, `cacheWriteTokens` | Kept, typed optional | The qualified OpenCode control profile normalizes them (`docs/qualification/opencode-driver.md`, "Qualified control profile"; `opencode-driver-1.18.7.md`, `-1.18.9.md`). No consumer prices them: the budget meter reads input and output only. Removing them changes every OpenCode usage event, so it needs a requalification, and whether reasoning and cache tokens are priced is an owner decision. Each still passes the usage rule, so a malformed step still fails. |
| OpenCode `patterns` | Kept, typed optional | It is the request the controller authorizes (`authorizeTool` receives the same object), so the event reports what was authorized. |
| Pi `api` | Kept, typed optional | Pi's identity is its provider, its `api` and its model; the Passport binds all three (`pi-driver.ts` `#validateExecution`). |

## 4. The usage rule

`usageCount` and `usageUpdated` (`driver-event.ts:81-97`): a count is read as
a number, an absent count (`undefined` or `null`) is 0, and a count that is
then not a non-negative safe integer is refused. That is the rule Claude
Code, Codex and OpenCode each wrote, so their bytes did not move.

| Driver | Reads through the rule | A refused count |
| --- | --- | --- |
| Claude Code | `claude-code-driver.ts:403-408` | `VES_CLAUDE_STREAM_INVALID`, unchanged |
| Codex | `codex-driver.ts:198-200` | `VES_CODEX_STREAM_INVALID`, unchanged |
| OpenCode | `opencode-driver.ts:105-120` (five counts), `:400-402` | `VES_OPENCODE_STREAM_INVALID`, unchanged |
| Pi | `pi-driver.ts:157-180` | `VES_PI_RUNTIME_FAILED`, new for this run (section 6) |
| The mock | `index.ts:389`, `:397` | a scripted count must be one the rule reads as itself |

Pi reports usage, so it gets the rule. How a run that returned ended is one
function (`reportRunEnd`): a stop, which the agent reports as the stop reason
`aborted`, comes first, as the first end decides for every driver (AD-053
item 4, AD-060 item 3); otherwise a refused count is `VES_PI_RUNTIME_FAILED`,
the code a run with no assistant message already reports, and no usage event
is emitted. No code or message was added: a new `VES_PI_STREAM_INVALID` was
rejected for that reason.

## 5. Consumers

| Consumer | Before (`6fae651`) | After |
| --- | --- | --- |
| Session runner | `event["sessionId"]`, `event["outcome"]`, `event["code"]` on `Row & { type: string }` | typed reads, `driver-session-runner.ts:119-121`; `DriverSessionEvent` and the event generic are removed |
| Execution adapter | `event["resolvedModel"]`, `event["name"]`, two `as number` casts | `driver-execution-adapter.ts:178`, `:194`, `:209` |
| Codex verifier | two `as number` casts, `event["text"]` | `task-codex.ts:171-172`, `:258` |
| Self-Test scenarios | count event types only | unchanged |

## 6. Transcript identity

Technique, as in T3 and the first round: a recorder outside the repository
(an ignored scratch directory) runs each scenario of the four drivers and the
mock in a Node process of its own and writes one normalized line per
scenario: every event in order, with every field, its key order, `undefined`
values, `-0` and whether it is frozen; what `start`, `cancel` and `close`
resolved or rejected to; the session runner's result where a case goes
through it; terminator and spawn counts; every message sent to Codex; and any
uncaught exception or unhandled rejection. Session identifiers, temporary
roots, and Pi's time-based identifiers are replaced by constants; the faux
provider's chunking uses a fixed random generator. The recorder ran three
times against the product sources of `main` (`6fae651`) and three times
against the tip, both with the fakes and fixtures of the tip (the fakes only
gained a `usage` mode; the Claude Code fake's `invalid-usage` mode became a
`usage` case of the same values).

188 scenarios: success, tools, redaction, every fake mode, every way a
provider ends, cancel, start-signal abort and the session runner's stop for
each driver, the mediated and subscription profiles, refusals before the
start, the mock's whole lifecycle and every scripted event it refuses, and
the usage values below, each spliced raw into a provider: text, `null`,
absent, a whole usage that is a string, a number, `null` or an array, `-1`,
`1.5`, `2^53`, `-0`, booleans and arrays, `{}`, `"0x10"`, `"1e2"`, a failed
turn or an error result with a refused count, and an aborted Pi message with
a refused count.

| Driver | Identical | Events in identical scenarios |
| --- | --- | --- |
| Claude Code | 56 of 56 | 237 |
| Codex | 41 of 41 | 158 |
| OpenCode | 33 of 33 | 146 |
| Pi | 17 of 26 | 77 |
| The mock | 31 of 32 | 24 |
| **All** | **178 of 188** | **642** |

Every difference:

| Scenario | `main` | Tip |
| --- | --- | --- |
| Pi, counts `"12"` and `3` | `usage.updated` (`"12"`, `3`), `completed` | `usage.updated` (`12`, `3`), `completed` |
| Pi, no input count | `usage.updated` with `inputTokens: undefined` | `usage.updated` (`0`, `3`) |
| Pi, input `null` | `usage.updated` (`null`, `3`) | `usage.updated` (`0`, `3`) |
| Pi, `true` and `[3]` | `usage.updated` (`true`, `[3]`) | `usage.updated` (`1`, `3`) |
| Pi, `-1`, `1.5` or `2^53` (three scenarios) | `usage.updated` with that count, `completed` | `error` (`VES_PI_RUNTIME_FAILED`), `failed` |
| Pi, stop reason `error` with `-1` | `usage.updated` (`-1`, `0`), `error` (`VES_PI_PROVIDER_ERROR`), `failed` | `error` (`VES_PI_RUNTIME_FAILED`), `failed` |
| Pi, stop reason `aborted` with `-1` | `usage.updated` (`-1`, `0`), `error` (`VES_PI_ABORTED`), `cancelled` | `error` (`VES_PI_ABORTED`), `cancelled` |
| The mock, a scripted count of `-1` | admitted | `VES_DRIVER_EVENT_INVALID`, "Mock usage event is invalid" |

Every Pi run with counts the rule reads as they are (`-0` included) is
byte-identical, and so is every other mock scenario.

**Racy scenarios.** Two mediated Claude Code scenarios that fail a surface
check (`bridge-down`, `hook`) are racy on `main` as on the tip: the fake
writes its result after the failed check, and whether that line reaches the
driver before the fixture's terminator kills the fake decides whether a
`usage.updated` precedes the error. Both variants appear in the recordings of
`main` and of the tip. With a terminator that kills 300 ms late, both
scenarios are deterministic and byte-identical on `main` and on the tip, and
show the late variant. The code that reads lines (`provider-child-run.ts`)
and the branch of the Claude Code translation that reads a result are
unchanged.

`c2893ef` (every emitter names its fields) was recorded again on its own:
188 of 188 identical to the commit before it.

## 7. Requalification

- **Pi**: `docs/qualification/pi-driver-usage.md`, bound by
  `spikes/pi-runtime/test/pi-driver-usage.test.mjs` under `pnpm qualify:pi`
  (9 cases, the nine Pi rows above, each pinned whole through the close).
  Against the driver of `main` all nine fail.
- **The mock** is not a qualified provider driver; `docs/qualification/t33-validation.md`
  stays the evidence for its lifecycle. Its one change, a negative scripted
  count refused, is recorded here and in the decision, and pinned by
  `tests/contract/mock-driver.test.mjs` ("refuses a scripted count the usage
  rule does not read as that count").
- **Claude Code, Codex, OpenCode**: no emitted byte changed, so no report.
  Every pinned qualification sequence passes unmodified.

## 8. Tests

### Requirement evidence

| Requirement | Evidence |
| --- | --- |
| ADR2-6: a Driver event is a declared type | `tests/unit/driver-event.test.mjs:16`, `:31`, `:41`, `:61` (the table, its kinds, the always and sometimes fields, the type guard); `tests/architecture/driver-event-locality.test.mjs:57` (the module declares the table, the types and the rule) |
| ADR2-6: the type is closed | `pnpm typecheck` over the derived types (sensors S7, S8, S10 below); `tests/architecture/driver-event-locality.test.mjs:71` (no second declaration), `:107` (no record spread into an event) |
| ADR2-6: consumers do not cast it | `tests/architecture/driver-event-locality.test.mjs:83` |
| ADR2-6: the usage check is written once | `tests/unit/driver-event.test.mjs:101-116` (the rule value by value, the event); `tests/architecture/driver-event-locality.test.mjs:88` (every driver that reports usage calls the rule), `:93` (no other source builds a usage event or checks a count); `tests/contract/driver-lifecycle-matrix.test.mjs:743-767` (the usage axis: each of the four drivers reads a count given as text and an absent one through the rule, and refuses with its own code); `tests/contract/mock-driver.test.mjs:81` |
| Emitted bytes unchanged | section 6; every qualification suite of the four drivers passes unmodified |
| Pi's changed runs are pinned | `spikes/pi-runtime/test/pi-driver-usage.test.mjs:19-83` |

### Deleted case → replacement

| Deleted | Replaced by |
| --- | --- |
| `tests/contract/claude-code-driver.test.mjs`, "Claude Code Driver fails closed for invalid-usage output" | the usage axis, "claude-code fails its run with its own code when a count fails the usage rule" (`tests/contract/driver-lifecycle-matrix.test.mjs:755`), which asserts the same code, no usage event, and the close's outcome, for `-1`, `1.5` and `"many"` |
| The Claude Code fake's `invalid-usage` mode | its `usage` mode, which reports the usage it is given |

### Discrimination sensor

Each mutation applied alone to the tip, the named checks run, the source
restored byte for byte.

| Mutation | Killed by |
| --- | --- |
| S1 Claude Code builds its usage event itself | the locality test |
| S2 the usage rule admits a negative count | the unit test; the usage axis |
| S3 the execution adapter casts a count | the locality test |
| S4 the session runner declares an open event again | the locality test |
| S5 Pi emits its counts unchecked | the Pi usage suite; the usage axis; the locality test |
| S6 the mock checks a scripted count itself | the mock contract test |
| S7 the field table loses OpenCode's `patterns` | the type check (it survived while the tool request was spread from a record; `c2893ef` closed it) |
| S8 Codex emits a field outside its row | the type check |
| S9 the field table makes a tool request's `input` optional | the mock contract test |
| S10 the session runner reads the terminal outcome from the wrong field | the type check |

10 killed, 0 survived. Against the product sources of `main`, the locality
test fails (an open event in two places, casts and open-record reads in three
consumers, four sources that build or check usage), the Pi usage suite fails
9 of 9, and the Pi rows of the usage axis fail 2 of 2.

## 9. Guardrails

- **Complexity** (ratcheted down, `pnpm complexity:update`):
  `packages/drivers/src/claude-code-driver.ts :: Arrow function` 22 → 17;
  `packages/drivers/src/codex-driver.ts :: Arrow function` 31 → 26;
  `packages/drivers/src/opencode-driver.ts :: Async arrow function` 34 → 27;
  `packages/drivers/src/index.ts :: Function 'validateScriptEvent'` 21 → 15;
  `packages/drivers/src/pi-driver.ts :: Async method 'start'` 12 → below the
  target, out of the baseline. No key was added and no value rose.
- **Census:** no source gained or lost `JSON.stringify` or `createHash`;
  `pnpm census:refresh` changes nothing and `pnpm test:census` passes (13).
- **Citations moved**, in the commits that moved them:
  `.specs/features/platform-qualification-matrix/executable-matrices.md`
  (`index.ts:359`, `:280`), `matrix.md` (`claude-code-driver.ts:448`,
  `codex-driver.ts:254`, `opencode-driver.ts:252`, `pi-driver.ts:19`),
  `.specs/features/live-task-pilot/validation.md` (`claude-code-driver.ts:76`,
  `codex-driver.ts:254`, `driver-execution-adapter.ts:106`),
  `.specs/features/dependency-refresh-2026-07/validation.md`
  (`opencode-driver.ts:252`), `.specs/features/pi-runtime-0-87-1/validation.md`
  (`pi-driver.ts:19`), and the comment of
  `tests/contract/driver-lifecycle-matrix.test.mjs` (`index.ts:359`). Citations
  bound to an earlier revision ("at `2ecf087`") or recording an earlier move
  are history and stay.
- The digest-bound reports of `credential-store.ts`, the migration count (12)
  and the runtime error catalog (19) are untouched. No dependency was added
  and no workspace dependency edge.
- No error code or message was added, removed or changed. No existing
  qualification report was edited.

### Gates at the end of the range

| Command | Result |
| --- | --- |
| `pnpm gate:quick` (each commit) | PASS: unit 2646, agent-readiness 331, census 13 before the rebase; unit 2654 at the end of the range |
| `pnpm test:architecture` (each commit) | PASS: 114, then 116, 116, 117 before the rebase; 119 at the end of the range |
| `pnpm gate:build` | PASS: unit 2654, contract 806, integration 1096, e2e 275, architecture 119, build 172, qualification 346 |
| `pnpm gate:security` | PASS: unit 2654, contract 806, e2e 275, architecture 119, qualification 346, security 1324, fault 310 |
| `pnpm test:contract` | PASS: 806 |
| `pnpm test:integration` | PASS: 1096 |
| `pnpm test:qualification` | PASS: 346 |
| `pnpm qualify:claude` | PASS: 71 |
| `pnpm qualify:codex` | PASS: 34 |
| `pnpm qualify:opencode` | PASS: 23 |
| `pnpm qualify:pi` | PASS: 25 |
| `pnpm agent:check` | PASS |

The range was rebased onto `2651fa0` (T9), which adds 8 unit, 2 architecture
and 2 integration cases; the gates at the end of the range ran after the
rebase. No test was skipped, and none is a todo. The change touches the
drivers, so the platform matrix runs on the branch before merge.

## 10. The framed protocol in the package's entry

### What it is and who imports it

At `6fae651`, `packages/drivers/src/index.ts` was 604 lines, and lines 44-346
and 533-583 were the framed Driver protocol T33 qualified: the
Content-Length envelope and its canonical payload digest
(`encodeDriverFrame`, `validateEnvelope`), the frame decoder, the sequence
guard, the handshake, the bounded event queue, the cancellation escalation,
the framed host adapter and the supervisor.

| Importer | Kind |
| --- | --- |
| `tests/contract/driver-protocol.test.mjs` (29 cases) | its suite: framing, envelope, replay, sequence, handshake, digest |
| `tests/fault-injection/driver-supervisor-faults.test.mjs` (10 cases) | its suite: bounded flow, sequence fault, cancellation escalation |
| any production source | none: no source of `packages/` or `apps/` names any of its exports, and `FramedDriverHostAdapter` has no importer at all |

Every driver runs in process behind the Driver interface; no composition
frames, decodes, sequences or supervises a driver's events over a transport.
Nothing outside its tests needs it.

### Decision

Moved out of the entry, not deleted, to
`packages/drivers/src/driver-framed-protocol.ts`, unchanged (`d7ea736`).

| Option | Verdict |
| --- | --- |
| A module of the package, outside its entry | **Chosen.** The entry (`exports: "."`) neither holds nor exports it, so the package's interface is what runs. The module stays under the type check, the lint, the complexity ratchet and the census. It depends on nothing but the error class and the domain, so deleting it with its two suites stays one change. |
| Deleted with its two suites | Not taken here. It is T33's qualified deliverable, and deleting it decides that no driver will run behind a framed transport; the review left that to the owner. `docs/qualification/t33-validation.md` stays immutable either way. |
| Next to its suites, under `tests/` | Rejected: the type check covers `apps` and `packages` only, so the module would lose it, and the census and complexity ratchet would stop seeing it. |
| A spike | Rejected: its suites are contract and fault suites of the product gates, not qualification of a dependency. |

The module states the envelope's two patterns (a `sha256:` digest and a
safe identifier) itself; the entry's start check states the same two for
its fields. Sharing them would tie the start check to a module that may be
deleted. The mock computed its session identifier with the protocol's digest
helper; it now hashes the canonical request itself, to the same identifier
(`index.ts:173`).

### Evidence

| Requirement | Evidence |
| --- | --- |
| The entry no longer holds or exports the protocol | `tests/architecture/driver-framed-protocol.test.mjs:56` |
| No production source imports it | `tests/architecture/driver-framed-protocol.test.mjs:66` |
| Its only importers are its two suites | `tests/architecture/driver-framed-protocol.test.mjs:73` |
| Its behavior is unchanged | the two suites pass unmodified apart from their import lines: 29 and 10 cases |
| Emitted bytes unchanged | the transcript recorder, three runs at `d7ea736` against the three of `c2893ef`: 188 of 188 identical, the mock's session identifiers included |

Against `087bc89` the architecture test fails its first case: the entry
still holds the protocol. No case was deleted.

`index.ts` is 241 lines (597 at `c2893ef`), the module 374. `export
interface Driver {`, which the lifecycle matrix reads from the entry, is at
`index.ts:55`.

### Guardrails

- **Complexity:** the hotspots moved with their values:
  `packages/drivers/src/index.ts :: Function 'validateEnvelope'` (33) is now
  `packages/drivers/src/driver-framed-protocol.ts :: Function
  'validateEnvelope'` (33), and `packages/drivers/src/index.ts :: Method
  'push'` (14) is now `packages/drivers/src/driver-framed-protocol.ts ::
  Method 'push'` (14). No value rose.
- **Census:** `index.ts` lost `JSON.stringify` (1 → 0) and two canonicalizer
  signals (4 → 2); the module carries what moved (canonicalizer 4, digest 2,
  serialization 1). `pnpm census:refresh` added its row as a new candidate,
  and it is classified as the entry was, `migrated-v2`, with the entry's
  reason: the moved code imports `canonicalizeJsonV2`. `pnpm test:census`
  passes (13).
- **Citations moved:** `executable-matrices.md` (`index.ts:55`, and
  `BoundedDriverEventQueue` at `driver-framed-protocol.ts:257`) and the
  comment of `tests/contract/driver-lifecycle-matrix.test.mjs`
  (`index.ts:55`).
- No error code or message changed; the protocol's codes are the module's,
  as they were the entry's. The digest-bound reports, the migration count
  (12) and the runtime error catalog (19) are untouched.

### Gates at the end of the range

| Command | Result |
| --- | --- |
| `pnpm gate:quick` (each commit) | PASS: unit 2654, agent-readiness 331, census 13 |
| `pnpm test:architecture` (each commit) | PASS: 122 |
| `pnpm gate:build` | PASS: unit 2654, contract 806, integration 1096, e2e 275, architecture 122, build 172, qualification 346 |
| `pnpm gate:security` | PASS: unit 2654, contract 806, e2e 275, architecture 122, qualification 346, security 1324, fault 310 |
| `pnpm test:contract` | PASS: 806 |
| `pnpm test:integration` | PASS: 1096 (a first run failed 1 case, see below) |
| `pnpm test:qualification` | PASS: 346 |
| `pnpm qualify:claude` | PASS: 71 |
| `pnpm qualify:codex` | PASS: 34 |
| `pnpm qualify:opencode` | PASS: 23 |
| `pnpm qualify:pi` | PASS: 25 |
| `pnpm agent:check` | PASS |

A first standalone `pnpm test:integration` failed one case of
`tests/integration/provider-child-run.test.mjs`, "a provider that exits by
itself after its result ends the run with no error, and nothing ends it":
the fake exited before its input was written, and the run reported
`VES_FAKE_STDIN_FAILED`. It is a race in that suite, not in this change: run
48 times, 12 at a time, it fails 4 to 6 times with the product sources and
tests of `origin/main` (`2651fa0`), with `main`'s `provider-child-run.ts` on
the branch, and on the branch alike, and 0 of 30 run one at a time. The
rerun passed, and the same suite passed inside `pnpm gate:build`.

No test was skipped, and none is a todo. The platform matrix runs on the
branch before merge, as for the first range.
