if (process.argv.includes("--version")) {
  process.stdout.write(`${process.env.FAKE_CLAUDE_VERSION ?? "2.1.168"} (Claude Code)\n`);
  process.exit(0);
}

let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = input.trim() ? JSON.parse(input.trim().split(/\r?\n/)[0]) : undefined;
const prompt = request?.message?.content?.[0]?.text ?? "";
const mode = process.env.FAKE_CLAUDE_MODE ?? "success";

const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
emit({ type: "system", subtype: "init", session_id: "private-session-id", model: "claude-opus-4-8", tools: [] });

if (mode === "malformed") {
  process.stdout.write("{not-json}\n");
} else if (mode === "tool") {
  emit({ type: "assistant", message: { content: [{ type: "tool_use", id: "tool-1", name: "vestra_echo", input: { value: "x" } }] } });
  emit({ type: "result", subtype: "success", is_error: false, result: "tool requested", total_cost_usd: 0.01, usage: { input_tokens: 4, output_tokens: 2 }, session_id: "private-session-id" });
} else if (mode === "error") {
  emit({ type: "result", subtype: "error_during_execution", is_error: true, result: "provider failed", total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 0 }, session_id: "private-session-id" });
} else if (mode === "secret") {
  process.stderr.write(`debug:${process.env.TEST_SECRET}\n`);
  emit({ type: "stream_event", event: { delta: { type: "text_delta", text: `value:${process.env.TEST_SECRET}` } } });
  emit({ type: "result", subtype: "success", is_error: false, result: `done:${process.env.TEST_SECRET}`, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, session_id: "private-session-id" });
} else if (mode === "hang") {
  setInterval(() => {}, 1_000);
} else {
  emit({ type: "stream_event", event: { delta: { type: "text_delta", text: `echo:${prompt}` } } });
  emit({ type: "result", subtype: "success", is_error: false, result: `echo:${prompt}`, total_cost_usd: 0.02, usage: { input_tokens: 5, output_tokens: 3 }, session_id: "private-session-id" });
}
