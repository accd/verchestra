# Codex Driver Qualification

**Task:** T04  
**Status:** Qualified with a restricted read-only Passport  
**Installed Codex CLI:** 0.115.0  
**Qualified protocol:** App Server v2 over local JSONL stdio

## Decision

The Codex Driver shall use `codex app-server`, not `codex exec`. OpenAI describes App Server as its first-class integration method and recommends it for the full harness event stream, while `exec` is the smaller one-shot automation surface. Verchestra therefore launches a pinned, tested Codex child process and speaks the bidirectional protocol through stdio.

The version-specific schema was generated from the installed executable with:

```text
codex app-server generate-json-schema --experimental --out <temporary-directory>
```

This confirmed v2 initialization, `model/list`, ephemeral `thread/start`, `turn/start`, streamed item notifications, `turn/interrupt`, approval requests, and dynamic `item/tool/call` request/response. A real zero-inference smoke check also completed the `initialize` handshake against 0.115.0 in an isolated temporary `CODEX_HOME`. No model was invoked.

Primary upstream references:

- [OpenAI: Unlocking the Codex harness](https://openai.com/index/unlocking-the-codex-harness/)
- [OpenAI Codex App Server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)

## Qualified security profile

- Local `stdio://` only; no WebSocket or remote listener.
- Prompt is a JSONL `turn/start` input and never a process argument.
- Threads are ephemeral and provider thread/turn IDs are discarded.
- Sandbox is `read-only`; the Driver advertises `projectWrite: false`.
- Approval policy is `untrusted`; any command or file-change approval reaching the client is declined.
- Verchestra tools are injected as dynamic tools. The spike records a normalized `tool.requested` and returns a non-executing response; T36 will connect the full asynchronous Driver `send` path to the controller's policy/effect pipeline.
- Ambient `OPENAI_API_KEY` is not inherited. Authentication must come from an explicit machine-local binding or a deliberately selected `CODEX_HOME`.
- Output is bounded and sensitive values are redacted before entering portable evidence.
- Cancellation attempts `turn/interrupt` before escalating to process-tree termination.

The Passport is deliberately restricted: this qualification makes Codex eligible for read-only orchestration, analysis, and independent validation roles. It does **not** qualify Codex as a project writer. Codex may still perform sandboxed read operations inside its own harness; Verchestra denies all approval-mediated effects and grants no project-writer capability.

## Experimental boundary and drift policy

In 0.115.0, `dynamicTools` and `item/tool/call` require `initialize.params.capabilities.experimentalApi = true`. This is not hidden behind a generic “supported” claim. The exact Codex version, generated schema digest, and conformance result must become Passport evidence in T32/T36. A changed CLI version, missing field, changed approval behavior, or failed fixture quarantines high-risk eligibility until requalification; Verchestra must never silently fall back to `exec` or weaken the tool contract.

## Evidence

Command: `corepack pnpm@10.34.5 gate:full`

- Real read-only version probe: installed Codex reported `codex-cli 0.115.0`; no model was invoked.
- Installed App Server generated both stable and experimental JSON schemas.
- Real isolated App Server accepted the required initialization handshake.
- Deterministic fake App Server covers handshake, model catalog, thread/turn lifecycle, streaming, dynamic tools, approval denial, protocol error, malformed JSONL, cancellation, output pressure, stderr, secrets, and private provider IDs.
- Full gate result: 55 passed, 0 failed, 0 skipped, 0 todo (16 T01 + 12 T02 + 12 T03 + 15 T04).

