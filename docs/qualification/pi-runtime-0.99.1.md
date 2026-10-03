# Pi Runtime Boundary Requalification

**Maintenance scope:** dependency refresh after T77
**Status:** Candidate pending exact-head CI qualification
**Qualified packages:** `@earendil-works/pi-agent-core@0.99.1`, `@earendil-works/pi-ai@0.99.1`

## Qualification boundary

This report supersedes the package-version identity recorded by
`docs/qualification/pi-runtime-0.87.1.md` without changing the driver
architecture or advancing the product roadmap. Pi remains behind the Driver
port and owns no Verchestra policy, workflow, artifact, Approval, or durable
state. The package versions are one coordinated qualification unit.

`docs/qualification/pi-driver-usage.md` and
`docs/qualification/pi-driver-cancel-order.md` still name `0.87.1` as the
packages they ran against. They remain the evidence for the usage rule and for
what a stopped session emits; their suites run unchanged against `0.99.1` and
pass, so neither report is rewritten.

## Diagnosis of the Dependabot #490 failure

The Quality check failed once, in `tests/contract/pi-driver.test.mjs`: the
exact-pin probe observed the installed `0.99.1` and refused it with
`VES_PI_VERSION_UNSUPPORTED`. That is the probe working as specified, not a
runtime regression. Once the pin moved, every Pi suite passed with no assertion
changed. Unlike `0.86.0`, this range brings no representation change that an
existing assertion observes.

## Upstream change review

No version was published between `0.87.1` and `0.99.0`; the range is `0.99.0`
and `0.99.1`. The published package contents of `0.87.1` and `0.99.1` were
compared directly on every surface the boundary depends on, alongside the
upstream changelogs of both releases.

### Root entry and module graph

- `pi-agent-core`'s root `dist/index.js` and both packages' `exports` maps are
  byte-identical to `0.87.1`. The boundary still imports only `Agent`.
- Importing the root entry loads 108 Pi package modules. Nine differ from
  `0.87.1`: `agent.js` and `agent-loop.js` in `pi-agent-core`, and in `pi-ai`
  `index.js`, `models.js`, `auth/resolve.js`, `auth/helpers.js`,
  `utils/retry.js`, plus two new pure modules, `utils/model-operations.js` and
  `utils/models-error.js`. Each is reviewed below.
- Only the `context` module of `@earendil-works/chord` loads, and it is
  unchanged. The `openai` SDK is not loaded by the root entry.

### Agent class and options

- **0.99.0** adds the `onProviderStreamEvent` agent option, which is forwarded
  to the stream function's options. The driver does not supply it. Construction,
  `subscribe`, `prompt`, `abort`, `waitForIdle`, `reset`, and the
  `thinkingLevel: "off"` default are otherwise unchanged.
- **0.99.0** records the requested thinking level on each final assistant
  message as `thinkingLevel` (`config.reasoning ?? "off"`, so `"off"` for the
  driver). The driver reads only `usage` and `stopReason` from the last
  assistant message and never returns messages; the privacy assertions pass
  unchanged.

### Tool loop and abort

- `prepareToolCall`, which runs `beforeToolCall`, now takes the tool list as a
  parameter that defaults to the context's tools. The agent loop passes none,
  so a model-issued call still resolves against the context tools, and
  controller authorization still precedes any tool execution.
- **0.99.0** exports `runToolCall()`, which runs one tool call through argument
  preparation, schema validation, `beforeToolCall`, execution, and
  `afterToolCall` for tools that call other tools. It applies only the hooks
  its caller passes. The driver never calls it, and no Verchestra tool receives
  it.
- **Behaviour change.** A tool result that sets `isError: true` now completes
  as an error: `tool_execution_end` and the `toolResult` message carry
  `isError: true`, and the model sees an error result. In `0.87.1` such a
  result completed as a success, and only a thrown error failed a tool. The
  driver emits `tool.requested` from `tool_execution_start` and relays no tool
  result, so its event sequence is unchanged. The spike boundary normalizes the
  completion as `tool.completed`; the new spike case "completes a tool that
  reports its own failure as an error" pins the new outcome. The change only
  tightens what counts as a failed tool.
- `tool_execution_update` emission moved into one helper with the same event
  fields. New result fields `structuredContent` and `outputSchema` are not sent
  to the model; the driver neither declares nor reads them.
- Every `aborted` check in the agent loop and `Agent.abort()` are identical to
  `0.87.1`.

### Credential lookup and stream dispatch

- The `Agent` resolves an API key only through a caller-supplied `getApiKey` or
  `apiKey`; the driver supplies neither, unchanged since `0.84.2`.
- `pi-ai` stream dispatch (`dist/compat.js`), transcript normalization
  (`dist/utils/transcript.js`), and the event stream are byte-identical.
- `dist/env-api-keys.js` adds one mapping, `typesafe` → `TYPESAFE_API_KEY`. The
  driver passes no key and injects its own stream function, so it does not
  reach this lookup.
- `auth/resolve.js` moves `ModelsError` into `utils/models-error.js`; the
  resolution order is unchanged. Sign in with ChatGPT, image and classifier
  model operations, and the new subscription retry patterns are reached only
  through `Models` and its login flows, which the driver does not use.

### Session persistence

- The `harness/pico3` and `harness/session` typings changed. They are separate
  subpaths; Verchestra imports none of them.
- A full probe, start, tool call, and close cycle against an empty temporary
  home and working directory wrote no files.

### Event sequence comparison

The same nine scenarios ran against the `0.87.1` and `0.99.1` installations
with Pi's faux provider: text, an allowed tool with a partial update, a denied
tool, a throwing tool, a tool that reports `isError`, a provider error, an
output limit, a stream rejection, and an abort. Consecutive equal deltas were
collapsed because the faux provider chunks at random sizes. For every scenario
the agent event sequence, the provider-visible context (roles, system message
fields, and declared tool fields), the stop reason, and the transcript after
`reset()` are identical. The only differences are the two recorded above: the
`thinkingLevel` field, and `isError: true` for the tool that reports its own
failure.

The Driver sequences pinned by `tests/contract/pi-driver.test.mjs`,
`tests/contract/driver-lifecycle-matrix.test.mjs`,
`tests/integration/pi-driver-lifecycle.test.mjs`,
`tests/integration/pi-driver-agent-release.test.mjs`,
`spikes/pi-runtime/test/pi-driver-cancel-order.test.mjs`, and
`spikes/pi-runtime/test/pi-driver-usage.test.mjs` pass without edits.

### Transitive dependency changes

The owner approved this dependency batch, including these transitive changes.

| Change | Packages |
| --- | --- |
| Upgraded | `openai` 6.40.0 → 7.19.0 (the exact dependency of `pi-ai`; not loaded by the Pi root entry; its new optional peers `@aws-sdk/credential-provider-node@3.972.84`, `@smithy/signature-v4@5.7.4`, and `undici@8.10.2` link to versions already in the lockfile), `@earendil-works/chord` 0.87.1 → 0.99.2, `@earendil-works/pi-telemetry` 0.87.1 → 0.99.2 |
| Added | none |
| Removed | none |

`chord` and `pi-telemetry` are caret dependencies (`^0.99.1`) of the qualified
packages, and pnpm resolved them to the newest matching release. `pi-telemetry`
`0.99.2` differs from `0.87.1` only in its manifest and source maps; its code is
byte-identical. Of `chord`, only the byte-identical `context` module loads.

## Proven behavior

- Both direct Pi packages and their lockfile packages resolve to one exact
  `0.99.1` version.
- The real `PiDriver.probe()` resolves the installed package manifest and
  reports the observed version; an unreadable or absent package is unavailable,
  and any version other than `0.99.1` is unsupported, including the published
  `0.99.0` and `0.99.2` and the previously qualified `0.87.1`.
- A fresh Pi `Agent` is created for every start and reset at close; each start
  shows the provider only its own prompt and the authorized tool declarations.
- Verchestra supplies the resolved model, exact context, tools, stream
  function, and controller abort signal.
- Tool execution remains guarded by a controller-owned authorization callback.
- A tool that reports its own failure completes as an error.
- Lifecycle, content, tool, usage, abort, provider failure, and runtime failure
  outcomes retain their stable Verchestra representation.
- Transcript, system prompt, session identity, credentials, and provider-local
  state are not returned.

## Evidence

The coordinated dependency change is accepted only when `pnpm qualify:pi`,
`pnpm test:qualification`, `pnpm gate:build`, `pnpm gate:security`,
`pnpm site:test`, and `pnpm site:build` pass on the exact implementation
revision. Local results are in `.specs/features/pi-runtime-0-99-1/validation.md`.
The Pi boundary outcomes use Pi's deterministic faux provider and do not
contact a paid provider or external model endpoint.
