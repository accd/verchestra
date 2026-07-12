# OpenCode/Qwen Driver Qualification

**Task:** T05  
**Status:** Qualified protocol; production host constraints mandatory  
**Pinned OpenCode:** 1.17.18  
**Pinned SDK:** `@opencode-ai/sdk` 1.17.18

## Decision

The full OpenCode Driver shall use the headless Server API plus the matching generated SDK/event stream. `opencode run --format json` remains a constrained no-tools fallback, not the writer integration.

Source inspection found that current `run` reads piped stdin, streams raw JSON events, and internally answers `permission.asked`: without `--auto` it rejects; with `--auto` it approves. Because that prevents Verchestra from owning authorization, the writer-capable path must subscribe to Server events and answer permissions through the SDK only after controller policy/Approval. Dangerous `--auto`, `--yolo`, and `--dangerously-skip-permissions` are prohibited.

Primary upstream references:

- [OpenCode CLI](https://opencode.ai/docs/cli/)
- [OpenCode Server](https://opencode.ai/docs/server/)
- [OpenCode SDK](https://opencode.ai/docs/sdk/)
- [OpenCode permissions](https://opencode.ai/docs/permissions/)
- [OpenCode tools](https://opencode.ai/docs/tools/)
- [OpenCode run source](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)

## Provider-neutral Qwen resolution

Qwen is not a special code path. The Driver flattens the connected OpenCode catalog into exact `provider/model` identities. A corporate deployment such as `company/qwen3-coder-480b` and a non-Qwen model pass through the same resolver, capability filters, event mapping, and Passport rules. An absent or disconnected exact identity blocks before `session.prompt`.

This lets a workplace bind any approved Qwen endpoint/provider locally while the portable Execution Contract asks only for capabilities. Provider keys, base URLs, model aliases, and data destinations remain machine-local bindings.

## Qualified control profile

- Server binds only to `127.0.0.1` on an ephemeral port.
- Sharing is disabled.
- Session permission is `ask` for every operation.
- Only explicitly named tools are enabled in the prompt.
- `permission.asked` becomes a backend-neutral `tool.requested`; `once` or `reject` is sent only from the controller authorization callback.
- Exact provider/model identity is captured before the prompt.
- Event content, usage, cache tokens, reasoning tokens, cost, errors, and idle close are normalized.
- Cancellation calls `session.abort` before server shutdown.
- Session IDs are local-only and discarded; sensitive output is redacted.
- Ambient corporate credential names are not inherited by the process contract; explicit Secret Broker bindings are required.

The final T37 host must add controls that are deliberately outside this disposable protocol spike: spawn `opencode serve --pure` through the isolated Process port, provide a random Basic-auth secret, use a dedicated machine-local profile/config/data root, prohibit mDNS/CORS/external bind, verify the exact SDK/server version pair, restrict built-ins, expose Verchestra effects through its mediated MCP bridge, and kill the process tree on close. The convenience SDK server launcher alone is not sufficient production isolation.

## `run --format json` fallback

The fallback is pinned to `run --format json --pure --model <provider/model>`, sends prompt content through stdin, and forbids continuation, sharing, auto-approval, and permission bypass. It may be eligible only for a no-tools/read-only Passport. It must never silently replace the Server/SDK Driver for a role requiring mediated effects.

## Evidence

Command: `corepack pnpm@10.34.5 gate:full`

- Repo-local OpenCode 1.17.18 version probe succeeds without inference.
- Exact SDK and binary packages are locked together at 1.17.18; only the OpenCode postinstall is allowlisted.
- 17 deterministic cases cover version drift, safe fallback arguments, generic catalog discovery, exact Qwen identity, absent model blocking, server policy, explicit mediated tools, built-in tool rejection, permission allow/deny, streaming/usage/cost, malformed events, provider failure, cancellation order, credential isolation, redaction, and non-portable session state.
- No real model or corporate endpoint was invoked.
- Full gate result: 72 passed, 0 failed, 0 skipped, 0 todo.
