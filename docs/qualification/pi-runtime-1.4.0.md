# Pi Runtime Boundary Requalification (1.4.0)

**Maintenance scope:** qualification successor tracked in #563 (DSB-05)
**Status:** Candidate pending exact-head CI qualification
**Qualified packages:** `@earendil-works/pi-agent-core@1.4.0`, `@earendil-works/pi-ai@1.4.0`

## Qualification boundary

This report supersedes the package-version identity recorded by
`docs/qualification/pi-runtime-0.99.1.md` without changing the driver
architecture. Pi remains behind the Driver port and owns no Verchestra policy,
workflow, artifact, Approval, or durable state. The two packages are one
coordinated qualification unit.

`docs/qualification/pi-driver-usage.md` and
`docs/qualification/pi-driver-cancel-order.md` name the versions they first
ran against. Their suites run unchanged against `1.4.0` and pass, so neither
report is rewritten.

## Why the pin had to move

Dependabot's #580 moved Pi to `1.3.0` as generated and turned `main` red:
`PiDriver.probe()` refused the installed version with
`VES_PI_VERSION_UNSUPPORTED`, the exact pin working as specified. #587
reverted it and the owner deferred Pi 1.x to #563; on 2026-10-28 the owner
approved the successor. `1.4.0` is npm's `latest`, published 2026-10-21. Once
the pins moved, every Pi suite passed with no other assertion changed.

## Upstream change review (0.99.1 to 1.4.0)

Sources: the `pi-agent-core` and `pi-ai` changelogs for 0.99.2 through 1.4.0,
and the published package contents of `0.99.1` and `1.4.0`, compared file by
file for every module the root entry loads.

### Root entry and module graph

- **1.0.0 removed the experimental harness** from `pi-agent-core`: sessions
  and session storage, the durable runtime, pico3, harness tools, compaction,
  skills, prompt templates, telemetry schemas, and the `./node`,
  `./harness/*` and `./experimental/pico3` subpaths. The package now holds
  only `Agent`, the agent loop, the proxy stream and their types; its exports
  are `.` and `./package.json`, which the probe resolves. Verchestra imported
  none of the removed surface.
- Importing the root entry now loads 38 Pi modules, down from 108: 6 in
  `pi-agent-core`, 28 in `pi-ai` and 4 in `pi-telemetry`. `@earendil-works/chord`,
  `diff`, `ignore` and `yaml` no longer load. None of the 38 opens a network,
  filesystem or process handle at import; the only `fetch` is in
  `streamProxy()`, which the driver never calls (as in `0.99.1`).

### Agent class and agent loop

- **1.4.0** adds `AgentOptions.identity`. The loop merges it over
  `DEFAULT_AGENT_IDENTITY` (`{ attribution: PI_ATTRIBUTION }`, naming pi) and
  passes the result to the stream function as `options.identity`. The driver
  sets no identity and supplies its own stream function from the execution,
  so what a request carries is that function's decision; pi-ai's own
  providers turn the attribution into headers only for OpenRouter, NVIDIA NIM
  and OpenCode. Observed with a 1.4.0 `Agent`: the stream options carry
  exactly that default.
- **1.1.0** times each tool execution: tool result messages and
  `tool_execution_end` events gain `durationMs`. The driver emits
  `tool.requested` from `tool_execution_start` and relays no tool result, so
  its event sequence is unchanged.
- Construction, `subscribe`, `prompt`, `abort`, `waitForIdle`, `reset`,
  `beforeToolCall`, and the `thinkingLevel: "off"` default are otherwise
  unchanged in `agent.js` and `agent-loop.js`.

### pi-ai modules on the agent loop's path

| Module | Change | Reaches the driver |
| --- | --- | --- |
| `utils/validation.js` | **Behaviour change (1.3.0).** A tool call whose arguments text was malformed carries `argumentsError` and fails validation; before, it ran with the fields parsed before the error | Yes. Validation runs before `beforeToolCall`, so such a call never reaches the controller's authorization or the tool. The new spike case pins this |
| `utils/json-parse.js` | Adds `parseToolCallArguments`, which sets `argumentsError`; the repair no longer treats `\u` followed by a non-hex letter as a valid escape | Through providers' parsing, upstream of the rule above |
| `utils/event-stream.js` | The final assistant message gains `durationMs` | No: the driver reads only `usage` and `stopReason` and returns no message |
| `index.js`, `utils/identity.js`, `utils/version.js`, `telemetry.js` | Export the client identity helpers, `PI_AI_VERSION`, and opt-in request telemetry; `AssistantMessageFrame` is removed (1.3.0) | Only the identity default above |
| `utils/transcript.js`, `utils/retry.js`, `utils/overflow.js`, `api/lazy.js`, `models.js`, `auth/resolve.js`, `utils/model-operations.js` | Provider transcript tool declarations, retry and overflow patterns, model catalog, credential resolution, classifier image checks | No: they serve pi-ai's own `stream()` and `Models`, and the driver injects its own stream function and passes no key |
| `providers/faux.js` | The faux provider streams partial tool-call arguments | Tests only |
| `pi-telemetry` | An in-memory exporter and metrics; no exporter is configured | No |

### Credential lookup and session persistence

- The `Agent` resolves an API key only through a caller-supplied `getApiKey`
  or `apiKey`; the driver supplies neither.
- Session persistence no longer exists in `pi-agent-core` (1.0.0).

### Transitive dependency changes

| Change | Packages |
| --- | --- |
| Upgraded | `@earendil-works/pi-telemetry` 0.99.2 → 1.4.0 and `@anthropic-ai/sdk` 0.124.0 → 0.129.0, both exact dependencies of `pi-ai` and resolved for no other package; `ws` 8.21.3 → 8.22.0 for `@google/genai` 2.21.0, which pnpm deduplicated onto the version every other consumer already resolves |
| Removed | `@earendil-works/chord`, `diff` 8.0.4, `ignore` 7.0.8, `yaml` 2.9.0 (dependencies of the removed harness) |
| Added | none |

## Proven behavior

- Both direct Pi packages and their lockfile packages resolve to one exact
  `1.4.0` version (`tests/agent-readiness/dependency-policy.test.mjs`).
- The real `PiDriver.probe()` reports the installed `1.4.0`; an absent package
  is unavailable, and any other version is unsupported, including `1.4.1`,
  `1.5.0`, `2.0.0` and `1.4.0-beta.1` (`tests/contract/pi-driver.test.mjs`).
- A tool call with malformed arguments is refused before authorization or
  execution (`spikes/pi-runtime/test/pi-boundary.test.mjs`). The same call
  without `argumentsError` is authorized and runs, so that field decides it.
- Tool execution remains guarded by the controller-owned authorization
  callback; a tool that reports its own failure completes as an error.
- Lifecycle, content, tool, usage, abort, provider failure, and runtime
  failure outcomes keep their stable Verchestra representation, and no
  transcript, system prompt, session identity, credential, or provider-local
  state is returned: the Driver sequences pinned by
  `tests/contract/pi-driver.test.mjs`,
  `tests/contract/driver-lifecycle-matrix.test.mjs`,
  `tests/integration/pi-driver-lifecycle.test.mjs`,
  `tests/integration/pi-driver-agent-release.test.mjs`,
  `spikes/pi-runtime/test/pi-driver-cancel-order.test.mjs`, and
  `spikes/pi-runtime/test/pi-driver-usage.test.mjs` pass without edits.

## Evidence

Local results are in `.specs/features/pi-runtime-1-4-0/validation.md`. The Pi
boundary outcomes use Pi's deterministic faux provider and contact no paid
provider or external model endpoint.
