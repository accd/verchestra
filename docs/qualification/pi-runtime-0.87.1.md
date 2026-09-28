# Pi Runtime Boundary Requalification

**Maintenance scope:** dependency refresh after T77
**Status:** Candidate pending exact-head CI qualification
**Qualified packages:** `@earendil-works/pi-agent-core@0.87.1`, `@earendil-works/pi-ai@0.87.1`

## Qualification boundary

This report supersedes the package-version identity recorded by
`docs/qualification/pi-runtime-0.84.2.md` without changing the driver
architecture or advancing the product roadmap. Pi remains behind the Driver
port and owns no Verchestra policy, workflow, artifact, Approval, or durable
state. The package versions are one coordinated qualification unit.

## Diagnosis of the Dependabot #415 failures

Both failing checks had one root cause: the exact-pin probe rejected the new
installed version with `VES_PI_VERSION_UNSUPPORTED`. The lifecycle-matrix
failure "pi did not resolve its configured provider" is the same rejection
observed through `probe.available === false`; it is not a provider-resolution
regression. Once the pin moved, one further test exposed a real upstream
representation change, described below.

## Upstream change review

The published package contents of `0.84.2`, `0.85.1`, `0.86.0`, `0.86.1`,
`0.87.0`, and `0.87.1` were compared directly on every surface the boundary
depends on.

### Agent class and transcript shape

- **0.86.0** moves the system prompt and tools into the transcript. The `Agent`
  constructor now places a leading `system` message holding the system prompt
  and the tool declarations (`toolsAdded`), and the loop builds the provider
  context with `normalizeContext({ messages })` instead of passing separate
  `systemPrompt` and `tools` fields. The driver's identity `convertToLlm` passes
  that system message through, so the provider still receives the exact
  authorized tool set. Tool declarations are now reduced by `toToolDeclaration`
  to `name`, `description`, and `parameters`, so the internal
  `inputSchemaDigest`, label, and `execute` fields no longer reach the stream
  function.
- Because the driver enforces an empty system prompt and declares one tool, the
  provider now sees `[system(tools), user]` for a fresh start instead of
  `[user]`. `tests/integration/pi-driver-lifecycle.test.mjs` asserted freshness
  through the raw message count. It now asserts the exact provider-visible
  transcript for both starts (empty system prompt, only the authorized tool,
  then one user prompt) while still requiring one visible non-system message.
  The assertion is stricter than before; see the discrimination sensor in the
  feature validation.
- `reset()` now keeps the replayed system baseline (prompt and tool
  declarations) instead of clearing to an empty list. The driver creates a new
  `Agent` for every start and discards it at close, so no transcript survives a
  session.
- **0.87.0** replaces the `shouldStopAfterTurn` option with `finishTurn` and
  adds `prepareRequest` and `peekQueuedMessages`. The driver supplies none of
  them. Construction, `subscribe`, `prompt`, `abort`, `waitForIdle`, and the
  `thinkingLevel: "off"` default are unchanged.

### Tool loop and abort

- `prepareToolCall`, which runs `beforeToolCall`, is byte-identical from
  `0.85.1` to `0.87.1`, so controller authorization still precedes any tool
  execution.
- Every `aborted` check in the agent loop and `Agent.abort()` are identical
  between `0.85.1` and `0.87.1`. Since `0.85.x`, a prepared parallel tool call
  is finalized as an `Operation aborted` error result instead of executing once
  the run signal has aborted, which only tightens abort.
- `0.85.x` also moves `prepareNextTurn` to run only when another turn starts;
  the driver does not supply it.

### Credential lookup and stream dispatch

- The `Agent` resolves an API key only through a caller-supplied `getApiKey` or
  `apiKey`; the driver supplies neither, unchanged since `0.84.2`.
- `pi-ai` stream dispatch (`dist/compat.js`) now normalizes the context before
  dispatch; environment-key injection through `withEnvApiKey` is unchanged.
- `dist/env-api-keys.js` adds one mapping, `meta` → `META_API_KEY`, in
  `0.86.1`. This extends the existing lookup to a new provider id. The driver
  passes no key and injects its own stream function, so it does not reach this
  lookup.

### Session persistence

- The restorable in-memory sessions (`0.85.x`) and the new
  `./experimental/pico3` harness export (`0.86.0`) are separate subpaths. The
  root entry point is byte-identical from `0.85.1` to `0.87.1`, and the
  boundary imports only `Agent`. A full probe, start, and close cycle against
  an empty temporary home and working directory wrote no files.
- The `./session/testing` subpath moved to `./harness/session/testing`. The
  `client` and `experimental/plugin` subpaths are not exported by either
  qualified package at any compared version. Verchestra imports none of them.
- Persistent Claude thinking effort affects only Anthropic provider requests and
  adds a `providerThinkingLevel` field to assistant messages. The driver sets
  `thinkingLevel: "off"` and never returns assistant messages.

### Transitive dependency changes

The owner approved this dependency batch, including these transitive changes.

| Change | Packages |
| --- | --- |
| Added | `@earendil-works/chord@0.87.1` (only its `context` module loads with Pi; its `esbuild` dependency dedupes to the existing `esbuild@0.28.2` and is used only by the unused `chord/node` bundler), `standardwebhooks@1.1.1`, `@stablelib/base64@1.0.1`, `fast-sha256@1.3.0`, `proxy-agent-negotiate@1.1.0` |
| Added alongside an existing major | `agent-base@9.0.0`, `http-proxy-agent@9.1.0`, `https-proxy-agent@9.1.0` |
| Upgraded | `@anthropic-ai/sdk` 0.91.1 → 0.124.0, `@google/genai` 1.52.0 → 2.21.0, `@aws-sdk/client-bedrock-runtime` 3.1048.0 → 3.1127.0 with its `@aws-sdk/*` and `@smithy/*` closure, `typebox` 1.3.7 → 1.3.27, `ignore` 7.0.5 → 7.0.8, `@earendil-works/pi-telemetry` 0.84.2 → 0.87.1 |
| Removed | `@opentelemetry/api@1.9.0`, `@aws-crypto/*@5.2.0`, `@aws-sdk/util-locate-window`, and the superseded `@smithy/*` 2.x helpers |

## Proven behavior

- Both direct Pi packages and their lockfile packages resolve to one exact
  `0.87.1` version.
- The real `PiDriver.probe()` resolves the installed package manifest and
  reports the observed version; an unreadable or absent package is unavailable,
  and any version other than `0.87.1` is unsupported.
- A fresh Pi `Agent` is created for every start and reset at close; each start
  shows the provider only its own prompt and the authorized tool declarations.
- Verchestra supplies the resolved model, exact context, tools, stream
  function, and controller abort signal.
- Tool execution remains guarded by a controller-owned authorization callback.
- Lifecycle, content, tool, usage, abort, provider failure, and runtime failure
  outcomes retain their stable Verchestra representation.
- Transcript, system prompt, session identity, credentials, and provider-local
  state are not returned.

## Evidence

The coordinated dependency change is accepted only when `pnpm qualify:pi`,
`pnpm test:qualification`, `pnpm gate:full`, `pnpm gate:security`,
`pnpm site:test`, and `pnpm site:build` pass on the exact implementation
revision. The Pi boundary outcomes use Pi's deterministic faux provider and do
not contact a paid provider or external model endpoint.
