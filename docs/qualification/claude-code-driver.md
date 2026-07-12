# Claude Code Driver Qualification

**Task:** T03  
**Status:** Qualified for the T03 contract  
**Installed Claude Code:** 2.1.168

## Qualified invocation profile

The Driver uses non-interactive structured input/output and supplies the user message through JSONL stdin, never argv. Its baseline arguments enable `--print`, stream-json input/output, verbose partial events, no session persistence, disabled slash commands, strict empty MCP configuration, no built-in tools, `dontAsk` permission mode, no Chrome, and no setting sources. Dangerous permission-bypass flags are forbidden.

Authentication and other required environment values must be supplied explicitly by a future Secret Broker binding. The child does not inherit ambient `ANTHROPIC_API_KEY` or arbitrary parent variables. The Driver returns only normalized model identity, content/tool events, usage/cost, safe stderr, stop reason, and stable errors; Claude session IDs remain local and are discarded.

## Evidence

Command: `corepack pnpm@10.34.5 gate:full`

- Real read-only probe: installed `claude --version` returned `2.1.168`; no model was invoked.
- Deterministic fake executable covers stream-json success, tool use, malformed output, execution error, hang/cancel, stderr, secrets, and private session IDs.
- Prompt transmission is verified on stdin and absent from process arguments.
- Version `2.0.0` fails before execution as unsupported.
- Tool use becomes a normalized request only; the spike executes no Claude built-in tool.
- Cancellation invokes the injected process-tree terminator and returns `VES_CLAUDE_ABORTED`.
- Sensitive values are absent from the serialized result and redacted in stdout/stderr-derived fields.

Full gate result: 40 passed, 0 failed, 0 skipped, 0 todo (16 T01 + 12 T02 + 12 T03).
