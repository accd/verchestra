// DETERMINISTIC FAKE - not Claude Code. A labeled stand-in for `claude` that
// reports a qualified version, announces a session, and then asks for a tool
// although the session was granted none. It never contacts a provider.
if (process.argv.includes("--version")) {
  process.stdout.write("2.1.168 (Claude Code)\n");
  process.exit(0);
}

const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
for await (const chunk of process.stdin) void chunk;
emit({ type: "system", subtype: "init", session_id: "local", model: "claude-opus-4-8", tools: [] });
emit({
  type: "assistant",
  message: { content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "id" } }] }
});
emit({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "done",
  usage: { input_tokens: 1, output_tokens: 1 },
  session_id: "local"
});
