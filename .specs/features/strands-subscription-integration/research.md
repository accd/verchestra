# Strands Subscription Integration — Research

Fact checks for `spec.md` and `design.md`, gathered on 2026-10-03 on the branch
`codex/strands-subscription-integration` at base `7e274f237648251b972081471134623097122c16`
(`origin/main`, the same revision the owner's plan analysed). Every claim names
its primary source. No model was invoked, no login or token command was run, and
no owner configuration, credential, or session was read.

## Findings that change the plan's design

These contradict or sharpen a premise of the owner's plan. Each lists the
smallest design change that keeps the plan's intent; `design.md` applies it.

| # | Finding | Evidence | Design change |
| --- | --- | --- | --- |
| F1 | The SDK's root entry cannot enter the sealed release. On Node it resolves to `dist/src/index.node.js`, which registers a local-environment sandbox reaching `fs/promises`, `path`, and `child_process` without the `node:` prefix. The sealed build accepts only `node:` imports. | S2, S9 (bundle of a root import lists `fs/promises`, `path`, `child_process` as externals) | The adapter imports only the `@strands-agents/sdk/multiagent` subpath, which bundles with no unprefixed built-in. `AgentResult`, `Message`, `TextBlock`, and `configureLogging` are root-only, so structural agents return duck-typed results (verified to work, S7) and the SDK logger stays at its default. |
| F2 | Even the `./multiagent` bundle fails the sealed build's self-containment check: the check scans the bundle text with a regular expression, and the SDK's MCP module carries the string literal `import from "@strands-agents/sdk"` in an error message. | S9, `scripts/t76-build-candidate.mjs:318-326` | Owner decision D2: replace the text scan with an assertion over esbuild's metafile (`imports` with `external: true`), which is exact rather than textual. Fallback if declined: graph and swarm are `not configured` in a sealed release. |
| F3 | The SDK declares three non-optional peers, not one: `zod`, `@modelcontextprotocol/sdk`, and `@opentelemetry/api`. `agent/agent.js` imports the MCP client statically, so the MCP SDK is needed to bundle even `./multiagent`. The lockfile auto-installs peers (`autoInstallPeers: true`). | S1 (`peerDependencies`, `peerDependenciesMeta`), S6, `pnpm-lock.yaml:3-5` | Owner decision D1: approve `@modelcontextprotocol/sdk` (1.32.0 resolved today) and `@opentelemetry/api` (1.9.1, already locked) as pinned transitive peers, with the rest of the tree in S5. T5 does not start without it. |
| F4 | Importing `./multiagent` loads AWS Bedrock runtime and credential-provider modules, but reads no credential: in an empty environment it reads only AWS SDK feature flags, opens no file, socket, or process. Credentials are read only when a `BedrockModel` sends a request, which needs a Strands `Agent` constructed without a model and then invoked. `new Agent()` with no model builds `BedrockModel` with model `global.anthropic.claude-sonnet-4-6` and warns on stderr. | S6, S7, `dist/src/agent/agent.js:221-231`, `dist/src/models/bedrock.js:153-180` | The adapter never constructs `Agent`, a model, an MCP client, or a session manager (SSI-03). An architecture test forbids those imports and a child-process probe test proves no Bedrock client, credential read, network, or process (SSI-79). |
| F5 | Swarm in 1.19.0 has no per-node destination list. Its handoff schema offers every other node, and it trusts a custom agent's `structuredOutput` without re-parsing: an unknown `agentId` crashes the swarm with a `TypeError`. | `dist/src/multiagent/swarm.js:229-247`, `:511-530`; S7 (`agentIdEnum: ["writer","third"]`, `swarmUnvalidatedByNode: TypeError`) | Verchestra enforces declared destinations: each structural agent validates its node's decision against a strict schema listing only that node's targets, then against the schema the SDK supplies. A failure fails the node and ends the swarm FAILED (verified, S8). |
| F6 | Graph accepts cycles, bounded only by `maxSteps`; `maxConcurrency`, `maxSteps`, `timeout`, and `nodeTimeout` default to `Infinity`. Exceeding `maxSteps` throws rather than returning a result. | `dist/src/multiagent/graph.d.ts` (`GraphConfig`), `graph.js:429-442`, `:663`; S7 (`cycle: throws at run`) | Verchestra rejects cycles at normalization (SSI-25) and always passes finite limits (SSI-09). Thrown limits map to stable codes. |
| F7 | The cited Claude page, updated 2026-06-16, opens with: "Update June 15: We're pausing the changes to Claude Agent SDK usage described below. For now, nothing has changed: Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription's usage limits." Usage credits continue consumption at API rates when enabled; the page lists no default. | S10, S11 | The plan's premise holds today. The billing confirmation records the owner's statement for the current regime; a regime change (the paused monthly credit resuming) requires re-confirmation (SSI-52). |
| F8 | Stronger runtime signals exist than the plan assumed. Claude Code emits `rate_limit_event` with `status: "rejected"`, and `errorCode: "credits_required"` when a subscription's included usage is exhausted; its init event reports `apiKeySource`, `"none"` for a subscription login. The Codex App Server reports `codexErrorInfo: "usageLimitExceeded"`, rate-limit snapshots with a credit balance, and `account/read` returns the effective account type. | S12, S13 | Quota classification uses these typed signals only (SSI-58). Effective authentication is verified per session (SSI-54, SSI-55). A Codex credit balance blocks the run (SSI-56). |
| F9 | The repository's Codex driver speaks the App Server JSON-RPC protocol, not `codex exec`, and its minimum version is 0.115.0. Structured output there is `turn/start` `outputSchema`, present in the protocol generated by the installed 0.159.3. | `packages/drivers/src/codex-driver.ts:254`, `:277-296`; S13 | T4 raises the Codex minimum to a version whose generated protocol has `outputSchema`, `account/read`, and `account/rateLimits/read`, proven by `codex app-server generate-ts`. |

None of F1–F9 prevents the plan: Graph and Swarm run non-native nodes in
1.19.0 (S7, S8), and the SDK can be imported without reading credentials (S6).
F1–F3 do change the dependency and release surface and need owner decisions.

## Sources

| ID | Source | Retrieved |
| --- | --- | --- |
| S1 | `npm pack @strands-agents/sdk@1.19.0` (shasum `d49aa0da83ef3a7a8bd3c00fc0b3f4ec17bf8597`, 975.2 kB packed, 4.1 MB unpacked, 1012 files), read in the ignored `.tmp/` | 2026-10-03 |
| S2 | The pack's `package.json` `exports`, `dependencies`, `peerDependencies`, `peerDependenciesMeta`, `engines` | 2026-10-03 |
| S3 | The pack's `dist/src/multiagent/{nodes,graph,swarm,state}.{d.ts,js}`, `dist/src/types/agent.d.ts`, `dist/src/agent/agent.js`, `dist/src/models/bedrock.js`, `dist/src/telemetry/{tracer,config}.js`, `dist/src/logging/logger.js` | 2026-10-03 |
| S4 | Repository of record: `github.com/strands-agents/harness-sdk` (the pack's `repository.url`; the earlier TypeScript repository is archived) | 2026-10-03 |
| S5 | Scratch install of the SDK and `zod@4.6.5` into an ignored directory with its own empty manifest, `--no-save --ignore-scripts`; every package's `license` and size read from `node_modules` | 2026-10-03 |
| S6 | Import probe (Node 24.14.0, empty environment, scratch `HOME`): process environment, network (`net`, `tls`, `dns`, `http`, `https`, `fetch`), child processes, file calls, and console traps installed before a dynamic import | 2026-10-03 |
| S7 | Run probe in the same harness: scripted structural agents through `Graph` and `Swarm` | 2026-10-03 |
| S8 | Subpath-only probe: `@strands-agents/sdk/multiagent` alone, duck-typed results, per-node destination check | 2026-10-03 |
| S9 | Bundle probe: esbuild with the option vector of `bundleSealedLauncher` (`scripts/t76-build-candidate.mjs:333-379`), the regex of `assertSelfContainedLauncher`, and a metafile; current launchers bundled in memory with the repository's own function | 2026-10-03 |
| S10 | `https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan` (last updated 2026-06-16) | 2026-10-03 |
| S11 | `https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans` | 2026-10-03 |
| S12 | `https://code.claude.com/docs/en/agent-sdk/typescript.md` (`SDKResultMessage`, `SDKSystemMessage`, `ApiKeySource`, `SDKRateLimitEvent`), `https://code.claude.com/docs/en/headless`, `https://code.claude.com/docs/en/agent-sdk/structured-outputs`, `https://code.claude.com/docs/en/managed-settings.md` | 2026-10-03 |
| S13 | `codex app-server generate-ts` from the installed `codex-cli 0.159.3`, read in the ignored `.tmp/` (`v2/TurnStartParams.ts`, `CodexErrorInfo.ts`, `RateLimitSnapshot.ts`, `CreditsSnapshot.ts`, `GetAccountRateLimitsResponse.ts`, `Account.ts`, `ClientRequest.ts`) | 2026-10-03 |
| S14 | `claude --help` (2.1.282), `codex --help`, `codex exec --help`, `codex app-server --help` (0.159.3) | 2026-10-03 |
| S15 | `https://learn.chatgpt.com/docs/pricing` | 2026-10-03 |

## SDK and execution model

- **Package.** `@strands-agents/sdk` 1.19.0, Apache-2.0, ESM, `engines.node >=22.0.0`
  (compatible with the pinned Node 24.14.0). Runtime dependencies:
  `@aws-sdk/client-bedrock-runtime ^3.1132.0`, `@smithy/fetch-http-handler ^5.8.0`,
  `@types/json-schema ^7.0.15`, `uuid ^14.0.2`, `yaml ^2.9.1`. Required peers:
  `zod ^4.1.12`, `@modelcontextprotocol/sdk ^1.25.2`, `@opentelemetry/api ^1.9.0`;
  twenty-one further peers are optional. (S2)
- **Structural agents.** `Graph` and `Swarm` accept any object with `id`,
  `invoke(args, options)`, and `stream(args, options)` returning an
  `AgentResult`-shaped value (`InvokableAgent`, `dist/src/types/agent.d.ts:162-191`).
  `AgentNode.handle` reads only `stopReason`, `interrupts`,
  `lastMessage.content`, `structuredOutput`, and `metrics?.accumulatedUsage`
  (`nodes.js` `AgentNode.handle`); no `instanceof` check exists on results or
  content blocks in the multiagent module. A plain object with
  `{ type: "textBlock", text }` blocks works (S8). Graph also accepts a custom
  `Node` subclass; Swarm wraps every entry in an `AgentNode`.
- **`preserveContext`.** `AgentNode` throws at construction when
  `preserveContext: true` wraps anything other than a Strands `Agent`
  ("preserveContext=true requires an Agent instance; non-Agent InvokableAgents
  cannot be snapshotted", `nodes.js` constructor; reproduced in S7). Without it,
  only `Agent` instances are snapshotted, so a structural agent keeps no SDK
  state across visits.
- **No model.** `new Agent()` without `model` assigns `new BedrockModel()`
  (`agent.js:230`), whose default model ID is `global.anthropic.claude-sonnet-4-6`
  with a stderr warning. Construction builds a `BedrockRuntimeClient` but reads
  no credential (S6: no `AWS_ACCESS_KEY_ID`, profile, or file read; no network).
  An invocation would resolve AWS credentials and call Bedrock; this was not
  run.
- **Graph.** AND-semantics dependencies; downstream input is the original task
  plus each upstream node's content blocks, prefixed with `[node: <id>]`
  (`graph.js:591-608`). Cycles are allowed and bounded by `maxSteps`; unknown
  edge endpoints, duplicate IDs, nodes unreachable from a source, and limits
  below 1 throw at construction. Node failures produce a `FAILED` result while
  parallel paths continue; exceeding `maxSteps` or `timeout` throws.
- **Swarm.** Sequential; routing is a Zod schema
  `{ agentId?: enum(other nodes), message: string, context?: record }` passed as
  `structuredOutputSchema` to each node (`swarm.js:511-530`). The swarm reads
  `nodeResult.structuredOutput` and hands off to `this.nodes.get(agentId)`
  without re-validating it (`swarm.js:229-247`). Exceeding `maxSteps` with a
  handoff pending throws (`swarm.js:461-463`).
- **Structured output.** The SDK passes `structuredOutputSchema` (a Zod schema)
  to a node through `InvokeOptions`; a structural agent receives it and must
  validate its own output.
- **Statuses.** `Status` is `PENDING | EXECUTING | COMPLETED | FAILED |
  CANCELLED | INTERRUPTED`; the SDK's `INTERRUPTED` is resumable, unlike
  Verchestra's terminal `INTERRUPTED` (`packages/domain/src/workflow/workflow-machine.ts:34-41`).
- **Import side effects (S6).** Importing `./multiagent` in an empty
  environment loaded 29 third-party packages, including
  `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/credential-provider-node`,
  `@modelcontextprotocol/sdk`, and `@opentelemetry/api`. It read the variables
  `AWS_LAMBDA_BENCHMARK_MODE`, `AWS_LAMBDA_NODEJS_NO_GLOBAL_AWSLAMBDA`,
  `AWS_NEW_RETRIES_2026`, `SMITHY_NEW_RETRIES_2026` (AWS SDK feature flags), and
  `NODE_V8_COVERAGE`, `WATCH_REPORT_DEPENDENCIES` (Node's loader). It made no
  file call outside module loading, no network call, no child process, and no
  console output. The root entry additionally read `OSTYPE` and loaded 36
  packages. A Graph or Swarm run additionally read `OTEL_SERVICE_NAME`,
  `OTEL_SEMCONV_STABILITY_OPT_IN`, `OTEL_EXPORTER_OTLP_ENDPOINT`,
  `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, and `LANGFUSE_BASE_URL` (span attribute
  shaping in `telemetry/tracer.js:1066-1087`), and still made no network call.
- **Telemetry.** Core spans use `trace.getTracer()` from `@opentelemetry/api`,
  a no-op until a process registers a global provider. Exporters live only in
  the `./telemetry` subpath (`telemetry/config.js`), which the adapter never
  imports. No Verchestra source imports `@opentelemetry` today.
- **Logging.** The default logger writes warnings and errors to
  `console.warn`/`console.error` (`logging/logger.js:12-21`). A failed node logs
  `node_id=<id>, error=<message> | node execution failed` (`nodes.js:72`); a
  Graph without `maxSteps` or `timeout` warns "execution is unbounded".
  `configureLogging` is exported only from the root entry (F1).

## Transitive tree and bundle impact

Scratch install (S5), sorted by role. "New" means absent from `pnpm-lock.yaml`
at the base revision at that exact version.

- **Totals:** 127 packages, 27.5 MiB unpacked; 42 packages (15.0 MiB) new to
  the lockfile.
- **Licenses:** MIT 87, Apache-2.0 28, ISC 8, BSD-3-Clause 2, BSD-2-Clause 1,
  0BSD 1. No copyleft license. The repository has no license allowlist; the
  sealed build strips comments and ships no third-party notice (an existing
  gap for Apache-2.0 `NOTICE` handling).
- **Largest new packages:** `@modelcontextprotocol/sdk@1.32.0` (4384 KiB),
  `@strands-agents/sdk@1.19.0` (4032 KiB), `@smithy/core@3.35.1` (1755 KiB),
  `hono@4.13.12` (1258 KiB), `@aws-sdk/client-bedrock-runtime@3.1146.0`
  (841 KiB), `yaml@2.9.1` (670 KiB), `ip-address@10.7.3`, `iconv-lite@0.7.3`,
  `zod-to-json-schema@3.25.2`, `json-schema-typed@8.0.2`,
  `express-rate-limit@8.7.0`, `eventsource@3.0.7`, `@hono/node-server@2.1.3`,
  `express@5.2.1`, and the rest of the Express 5 tree. The MCP SDK brings the
  HTTP server packages; none is imported by the `./multiagent` closure at run
  time beyond the MCP client modules.
- **Version moves:** the SDK needs `@aws-sdk/client-bedrock-runtime ^3.1132.0`
  (lockfile has 3.1127.0 through Pi) and `yaml ^2.9.1` (lockfile has 2.9.0 and
  2.8.3), so both gain a second version. `zod@4.6.5`, `uuid@14.0.2`, and
  `@opentelemetry/api@1.9.1` are already locked. npm's resolution above is an
  approximation; pnpm decides the exact set when T5 updates the lockfile.
- **Bundle (S9).** The current sealed launchers `launcher:vestra` and
  `launcher:verchestra` are 824 KiB each; the self-test crash child is
  313 KiB and the bridge relay 23 KiB. A bundle of `./multiagent` alone is
  1451 KiB minified from 39 packages (largest contributors: `zod` 459 KiB, the
  SDK 264 KiB, `@smithy/core` 180 KiB, `ajv` 110 KiB, `@aws-sdk/core` 74 KiB,
  the MCP SDK 74 KiB). The sealed build sets no `splitting` and requires one
  output file, so a literal dynamic `import()` is inlined: each launcher grows
  by about 1.45 MiB (to about 2.3 MiB), and the module is evaluated only when
  imported. The two launchers are bundled separately, so the release carries
  the closure twice.
- **Precedent.** Pi and OpenCode SDKs are root development dependencies loaded
  through a variable specifier and never bundled
  (`packages/drivers/src/pi-driver.ts:66-68`); Cedar is bundled through its
  `web` glue with the wasm shipped beside it; `vestra task` itself is reached
  through a literal dynamic import so other commands never load it
  (`apps/vestra-cli/src/task/task-command.ts:1-3`).
- **Placement.** `scripts/architecture.mjs:68-93` forbids third-party imports in
  `contracts`, `domain`, `application`, and `vestra-launcher`; adapter packages
  may import third-party code but not sibling adapters. The adapter therefore
  lives in `packages/agent-runtime` behind a package subpath, following
  `@verchestra/platform-node/secrets`
  (`tests/architecture/platform-node-secrets-subpath.test.mjs`).

## Structured output in the CLIs

- **Claude Code 2.1.282 (S14, S12).** `--json-schema <schema>`: "JSON Schema for
  structured output validation". With `--output-format json` the result carries
  `structured_output`; the Agent SDK's result message (the stream-json `result`
  event) declares `structured_output?: unknown` and the error subtype
  `error_max_structured_output_retries`. Schemas are validated as JSON Schema
  draft-07 (`z.toJSONSchema(schema, { target: "draft-7" })`); an invalid schema
  fails the run at startup since 2.1.205. Claude Code re-prompts on a mismatch
  inside its own session; a result with subtype `success` and no
  `structured_output` must be treated as a failure. The repository's mediated
  profiles already use `--output-format stream-json`
  (`packages/drivers/src/claude-code-driver.ts:461-541`); that `stream-json`
  carries `structured_output` on its final `result` event is documented through
  the SDK message type, and T4 confirms it with a recorded fixture before
  relying on it.
- **Codex 0.159.3 (S14, S13).** `codex exec --output-schema <FILE>` ("Path to a
  JSON Schema file describing the model's final response shape"), `--json`
  (JSONL events), `-o/--output-last-message <FILE>`. The driver's App Server
  path takes `outputSchema?: JsonValue | null` on `turn/start` ("Optional JSON
  Schema used to constrain the final assistant message for this turn").
- **Schema shape both accept.** A closed draft-07 object with every property
  required, string enums, and length bounds, and no open `record` member. The
  SDK's own swarm schema has an open `context` record and an optional
  `agentId`; Verchestra's decision schema replaces them with a required `next`
  enum (declared targets plus a reserved completion value) and a bounded
  `message`.

## Subscription billing (S10, S11, S15)

- **Claude Agent SDK and `claude -p`.** As of the 2026-06-15 update, usage
  "still draw[s] from your subscription's usage limits"; the announced monthly
  Agent SDK credit "isn't available"; Anthropic "will share [an update] before
  anything takes effect". The paused design said that past the credit "usage
  moves to usage credits ... only if you've enabled usage credits. If usage
  credits aren't enabled, Agent SDK requests stop until your credit refreshes."
- **Claude usage credits.** "Usage credits allow individuals subscribed to paid
  Claude plans (Pro, Max 5x, and Max 20x) to continue using Claude seamlessly
  after reaching their included usage limits." Enabled and disabled under
  Settings > Usage; optional auto-reload "to automatically make a purchase when
  your balance falls below a threshold"; monthly spending caps; "Usage credits
  apply to both Claude conversations and Claude Code terminal usage." The page
  states no default.
- **Codex.** Plan usage is metered in five-hour windows with weekly limits; "If
  you reach your usage limits during an active turn, the agent will be able to
  continue working on that turn, subject to fair use limits." Plus and Pro "can
  purchase additional credits to continue working"; Business, Edu, and
  Enterprise can buy workspace credits. "All users may also run extra local
  chats using an API key, with usage charged at standard API rates." The page
  does not say whether purchased credits are consumed automatically.
- **Runtime signals (S12, S13).** Claude Code: `rate_limit_event`
  `{ status: "allowed" | "allowed_warning" | "rejected", resetsAt?,
  utilization?, errorCode?: "credits_required", canUserPurchaseCredits?,
  hasChargeableSavedPaymentMethod? }`; `credits_required` means "a claude.ai
  subscription whose included usage is exhausted, and the session cannot
  continue until the user buys usage credits" (Claude Code 2.1.181 or later);
  `system/api_retry` carries an `error` category among `rate_limit`,
  `billing_error`, `authentication_failed`, `account_on_hold`; the init event
  carries `apiKeySource` (`"none"` for a claude.ai login or bearer token).
  Codex App Server: `ErrorNotification.error.codexErrorInfo` includes
  `usageLimitExceeded` and `rateLimitExceeded`; `RateLimitSnapshot` carries
  windows with `resetsAt`, `credits { hasCredits, unlimited, balance }`,
  `spendControlReached`, `planType`, and `rateLimitReachedType` (including
  `workspace_owner_credits_depleted` and `workspace_member_usage_limit_reached`);
  `GetAccountRateLimitsResponse.ordinaryUsageAllowed`; `account/read` returns
  `{ type: "apiKey" } | { type: "chatgpt", email, planType } | { type: "amazonBedrock", ... }`.
  The App Server also exposes `account/rateLimitResetCredit/consume` and
  `account/sendAddCreditsNudgeEmail`, which Verchestra must never call.

**What an owner-confirmed "extra usage is off" check can prove:** that the
owner stated, on this machine and at a recorded time, that usage credits (Claude)
and purchasable credits (Codex) are not enabled for the named provider and
authentication method; that the run uses that provider and method (verified per
session through `apiKeySource` and `account/read`); and, for Codex, that the
account reported no credit balance and no unlimited credits when the node
started.

**What it cannot prove:** the server-side setting itself (no documented local
read exists for Claude usage credits, auto-reload, or spending caps; Codex
reports a balance but no auto-consume switch); a change the owner makes after
confirming; that a paused Anthropic billing change stays paused; or that no
other client of the same account buys usage. Absence of a quota signal proves
nothing. A `rejected`/`credits_required` or `usageLimitExceeded` signal shows
only that, at that moment, the provider did not continue on paid usage.

## Windows bridge feasibility

- **Today's refusals.** `McpToolBridgeController.open` throws
  `VES_BRIDGE_PLATFORM_UNSUPPORTED` on `win32` before creating anything
  (`packages/agent-runtime/src/execution/mcp-tool-bridge.ts:104-108`, which since T7 commit 2 refuses only the default Unix transport); the
  Claude Code mediated profiles throw `VES_CLAUDE_MEDIATION_UNSUPPORTED`
  (`packages/drivers/src/claude-code-driver.ts:226-230`); `vestra task` is `not
  configured` with `requirement: "platform"` (`apps/vestra-cli/src/task/task-command.ts:98-99`).
  Reason: AD-039 scoped the channel to Unix sockets, rejecting loopback TCP
  (reachable by every local user) and an inherited descriptor (Claude Code's MCP
  launcher offers none); AD-040 item 7 keeps the task path refused on Windows.
- **Unix channel.** A socket `bridge.sock` in a fresh `0700` directory checked
  with `lstat` (directory, not a link, no group or other bits, owned by the
  user), the socket `0600`; a 256-bit token compared in constant time; exactly
  one authenticated connection; five-second authentication timeout;
  newline-delimited JSON frames of at most 8 MiB; calls serialised; `close()`
  removes the directory (`bridge-transport.ts:35-65`, `mcp-tool-bridge.ts:100-206`,
  `mcp-bridge-protocol.ts:8-154`). No transport seam existed at `7e274f2`: the
  controller constructed its `net.Server` directly. T7 commit 1 moved it,
  unchanged, behind the transport interface (`bridge-transport.ts:49`).
- **Named pipe.** Node's `net` can serve and connect `\\.\pipe\<name>` but
  exposes no DACL, `FILE_FLAG_FIRST_PIPE_INSTANCE`, or remote-client rejection.
  .NET's `NamedPipeServerStream` exposes `PipeOptions.CurrentUserOnly`,
  `PipeOptions.FirstPipeInstance`, and a one-instance limit, which is why the
  plan routes the server through a PowerShell 7 helper relaying bytes to the
  controller over its standard streams. The relay that Claude Code launches can
  connect with Node's `net.connect`; it cannot check the server's owner, so the
  random name, first-instance creation, `CurrentUserOnly`, and the token carry
  the protection.
- **Known hazards in the repository.** The only PowerShell used today is
  Windows PowerShell 5.1 at a pinned System32 path
  (`packages/platform-node/src/os-secret-backends/windows-credential-manager.ts:43-47`);
  `-Command -` consumes standard input before the program runs; cold starts
  exceed 4 s and `Add-Type` takes 23–33 s (`.specs/STATE.md` AD-041 evidence);
  a guard refuses when script-block logging or transcription is enabled
  (`windows-credential-manager.ts:171-187`), which the pipe helper needs because
  frames carry the token and file content. Windows has no process group, so the
  controller ends trees with `taskkill /T /F`
  (`packages/drivers/src/driver-process-tree.ts`, `process-tree-terminator.ts:13-19`).
  No ACL, `icacls`, `Get-Acl`, or named-pipe code exists in the repository.
- **Managed policy on Windows (S12).** File: `C:\Program Files\ClaudeCode\`
  (`managed-settings.json`, `managed-settings.d/`, `managed-mcp.json`; the
  legacy `C:\ProgramData\ClaudeCode` path is not read); OS policy:
  `HKLM\SOFTWARE\Policies\ClaudeCode` value `Settings`; user-writable fallback:
  `HKCU\SOFTWARE\Policies\ClaudeCode` value `Settings`; server-managed settings
  are not detectable before a session (gap G1 of AD-044). Today's driver returns
  `/etc/claude-code` for every platform but macOS, Windows included
  (`claude-code-driver.ts:198-207`), so lifting the Windows refusal alone would
  check the wrong location and pass.
- **Tests pinning the refusal.** `tests/helpers/mediation-platform.mjs:26-50`
  and its callers in `tests/integration/mcp-tool-bridge.test.mjs`,
  `tests/security/mcp-tool-bridge-security.test.mjs`,
  `spikes/claude-code-driver/test/claude-driver-mediated.test.mjs`,
  `spikes/claude-code-driver/test/claude-driver-subscription.test.mjs`,
  `tests/contract/claude-code-driver-mediated.test.mjs:49-63`,
  `tests/contract/claude-code-driver-subscription.test.mjs:49-128`,
  `tests/integration/driver-execution-adapter.test.mjs:87-242`,
  `tests/e2e/mediated-task-execution-e2e.test.mjs:136-171`, and
  `tests/contract/task-command-platform.test.mjs:23-42`. These change only in
  the commit that lifts the refusal after the Windows qualification passes.

Feasible, with three prerequisites to qualify: PowerShell 7 at a pinned path,
ACL proof for the per-run directory, and the three Windows policy locations.

## Skill inventory

Installed as full copies at pinned commits under `.agents/skills/` of the
coordinator's checkout, excluded from version control through the local
`.git/info/exclude` (entry `.agents/`). All 39 files were re-hashed on
2026-10-03 and match; no extra file exists. The skills were read from these
copies, not from any other installation.

| Skill | Origin | Commit | Path in origin | Files |
| --- | --- | --- | --- | --- |
| `tlc-spec-driven` | `github.com/tech-leads-club/agent-skills` | `120b67676388241b314699fa8fa9af25ada6d1d4` | `packages/skills-catalog/skills/(development)/tlc-spec-driven/` | 18 |
| `modular-design-principles` | `github.com/tech-leads-club/agent-skills` | `120b67676388241b314699fa8fa9af25ada6d1d4` | `packages/skills-catalog/skills/(architecture)/modular-design-principles/` | 2 |
| `security-threat-model` | `github.com/tech-leads-club/agent-skills` | `120b67676388241b314699fa8fa9af25ada6d1d4` | `packages/skills-catalog/skills/(security)/security-threat-model/` | 4 |
| `research` | `github.com/mattpocock/skills` | `d81f3a183412e71a5b1e84ca21bc1a35eea03a60` | `skills/engineering/research/` | 2 |
| `tdd` | `github.com/mattpocock/skills` | `d81f3a183412e71a5b1e84ca21bc1a35eea03a60` | `skills/engineering/tdd/` | 4 |
| `code-review` | `github.com/mattpocock/skills` | `d81f3a183412e71a5b1e84ca21bc1a35eea03a60` | `skills/engineering/code-review/` | 2 |
| `setup-matt-pocock-skills` | `github.com/mattpocock/skills` | `d81f3a183412e71a5b1e84ca21bc1a35eea03a60` | `skills/engineering/setup-matt-pocock-skills/` | 7 |

Per-file SHA-256 (path relative to the skill directory):

| Skill | File | SHA-256 |
| --- | --- | --- |
| tlc-spec-driven | `SKILL.md` | `127a54fdc984939c4953d0a14120563e73f37488befcd885bb9a1dae95b18524` |
| tlc-spec-driven | `references/code-analysis.md` | `38b571c81d98e390b9ac8947563ad19a33843db425d4ff94ad73db70a054f828` |
| tlc-spec-driven | `references/coding-principles.md` | `8c548affbcdaa4c62bd75bf27b39a81af41ec16bd603e5e634f30771bebd4fbb` |
| tlc-spec-driven | `references/context-limits.md` | `bff0c86980d41897b70216fa18b6a05a0c9d74a0e80940939fc0f314a55da482` |
| tlc-spec-driven | `references/design.md` | `1c17dd93d0a5618f002300a362683c8dca74185037aa61d9aeef83b9750b5d40` |
| tlc-spec-driven | `references/discuss.md` | `c601fedf2266047c0f6da372abafe81b35bc97e04d1b3fb15e1a2c65e4dc75ce` |
| tlc-spec-driven | `references/implement.md` | `03ec93c9713b2ebb373c6684f6c8d62588192e865dce0c53970c2c913b9c50c4` |
| tlc-spec-driven | `references/lessons.md` | `77cdc271f6ade34f8b47274456c72fc16731c7af9992967cfd5f548d328fb022` |
| tlc-spec-driven | `references/memory.md` | `ade5d5550146767719c524ba3ef559bc5431c22a08fddce33bc35bc9e762bc38` |
| tlc-spec-driven | `references/specify.md` | `99f1f5693308b8c7ee4ba1152b40f4f00b24abd57767084adaecd409a5aecc17` |
| tlc-spec-driven | `references/sub-agents.md` | `08481bbe05cf1f29062cc504d3d4f204c10f12fc4f683c330bea8e4adb01f1b2` |
| tlc-spec-driven | `references/tasks.md` | `8ea4731f59271029d90db8fbf1ce800333f859b32529016134fcb19de9a570c6` |
| tlc-spec-driven | `references/validate.md` | `149b78e32927ff601fab88366f29d254020c92ca98fa7b3a147bbeaee11ff403` |
| tlc-spec-driven | `scripts/check_commit.py` | `20a0fc0f8423b958ea7bae5eec9286d47e8593c157d87fd9d92c2f17a1464567` |
| tlc-spec-driven | `scripts/lessons.py` | `258cdb508d9787aee1a840bf811e13637c52ef0dd76273b08fab8c19ebac9b09` |
| tlc-spec-driven | `scripts/validate_spec.py` | `2a0b7e334d026f9556c665fbd0386cfa5b17c62a5e921fed52a9422bc27bc006` |
| tlc-spec-driven | `scripts/validate_state.py` | `dc0997e2af32faeeb5e4cd241ce41c3a03a37c6ef25a77850557752988205d3c` |
| tlc-spec-driven | `scripts/validate_tasks.py` | `bfa8533fc3c63e19d999ed25dd79bddeb8ead5d43dc2c0149a0cfc0d9d2bc5d7` |
| modular-design-principles | `SKILL.md` | `52fe4ca680c80de2abd52773f47ba8014ff753030da6ccaa4cc1fe48d4e400f7` |
| modular-design-principles | `references/principles.md` | `090de066fa75d66033a4a635cb9b2fc27618f277fa9048b96747dfbe4960026d` |
| security-threat-model | `LICENSE.txt` | `4dd13869245e356246a5b770723247bbb80a8f07a181d1d3d873a1734297cdb9` |
| security-threat-model | `SKILL.md` | `f4310efb41fba14d80fd69d08cc97a92535fc8f1ccfdbe9201a655c2c28fc412` |
| security-threat-model | `references/prompt-template.md` | `2e2ab1b3e767a27bae8f5d1d91e328ff2ca9a9ce07aa41708f39761cd5abde48` |
| security-threat-model | `references/security-controls-and-assets.md` | `7dfe444ef5b5c27de02831e9a8956be3f076332ab019b81a9334d31eaf104e93` |
| research | `SKILL.md` | `985569f15739c713d6784887c3d186d4ef9ac85bec5ad9c068d25bf0739928e4` |
| research | `agents/openai.yaml` | `9b4c470d63221c1f68f22df70b83e2f12401b317babe0d1b7b5f24a974474d0d` |
| tdd | `SKILL.md` | `93ea419b76e9caaf26153b828e984f7c3fb136f4caa67b14af95f32ea965a1cc` |
| tdd | `agents/openai.yaml` | `ea6f01cf1b8c06a4b0f5b649d74b1b8ce8685e72af1b38d70d877693e092af0b` |
| tdd | `mocking.md` | `3ceb807fdf4a47d6a93d4d9a891e5ba6d362a6247bd08adc451feebfc17361ef` |
| tdd | `tests.md` | `859f9e592c188fda4fc7277dd180e4ce9c7a2e13f6efe1f6f29eccc9d28c106a` |
| code-review | `SKILL.md` | `47f4e52c21694def9c7c11cbfbf891ca35eac7a93e395797515be3c8a409ae50` |
| code-review | `agents/openai.yaml` | `8229ca854e11dc8e6aef2131ee03f31fb1561cf905fab9ccc325180cf3331352` |
| setup-matt-pocock-skills | `SKILL.md` | `9a0c21694be19fa3eefc39343355d3af7414716ba364882c7432c2f821eac3e9` |
| setup-matt-pocock-skills | `agents/openai.yaml` | `9527de0110541c45712319025155aeab8dc7d77c6ed6e5e83271bab1851ab939` |
| setup-matt-pocock-skills | `domain.md` | `593a7042218689f1d24df89df14eaf0a20e19e0d0a7d479a01947ac78f0784b9` |
| setup-matt-pocock-skills | `issue-tracker-github.md` | `afd6852a80185217bd28aa5cbe456bef1e85be25be7bd1fba382d5b8ee428325` |
| setup-matt-pocock-skills | `issue-tracker-gitlab.md` | `ea175f73d193b3f55819c0ed9bbccf6ee0e70ad8f928e3d7607596c53380acd6` |
| setup-matt-pocock-skills | `issue-tracker-local.md` | `7dcda20a2eb4bdc89b95d1143423c0691309921cadae3132e6424f371030506e` |
| setup-matt-pocock-skills | `triage-labels.md` | `4f53c9b40ce2651e3611aa090eaedbd6dbc9b71ef8c5f7e65eac0d8263190d0d` |

**Path corrections to the plan.** The plan placed all three TLC skills under
`(development)`. Only `tlc-spec-driven` is there; `modular-design-principles` is
under `(architecture)` and `security-threat-model` under `(security)`.

**How each was applied.** `tlc-spec-driven`: the artifact set, EARS criteria,
traceability, and `validate_spec.py`/`validate_tasks.py` runs (results in
`validation.md`). `modular-design-principles`: module placement and isolation in
`design.md`. `security-threat-model`: `threat-model.md` in the skill's output
format; its interactive assumption check-in is pending the owner (open decision
D7). `research`: this file. `setup-matt-pocock-skills`: a draft only, in
`setup-draft.md`, as its "Let them edit before writing" step requires.

## Dependency review

| Item | Status | Owner action |
| --- | --- | --- |
| `@strands-agents/sdk` 1.19.0 | Approved by the owner | Pin exactly in `packages/agent-runtime/package.json` (T5) |
| `zod` 4.6.5 | Approved by the owner; already locked as a peer of Pi | Pin exactly beside the SDK (T5) |
| `@modelcontextprotocol/sdk` (1.32.0 today) and its Express/Hono tree | Required peer, not yet approved | Decision D1 |
| `@opentelemetry/api` 1.9.1 | Required peer, already locked through Vitest | Decision D1 |
| `@aws-sdk/client-bedrock-runtime` ≥ 3.1132.0, `yaml` ≥ 2.9.1 | Transitive version moves | Decision D1 (reviewed with the lockfile diff) |
| Optional peers (provider SDKs, OpenTelemetry SDKs, A2A, Express as a direct dependency, Cedar for Strands, QMD, Turndown) | Not added | None |
| Install scripts | None in the SDK tree (`--ignore-scripts` install succeeded; `allowBuilds` unchanged) | None |
| PowerShell 7 on Windows | New runtime prerequisite of the Windows profile | Decision D6 |
