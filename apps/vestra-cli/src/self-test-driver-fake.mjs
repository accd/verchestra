import readline from "node:readline";

const kind = process.argv[2];

if (process.argv.includes("--version")) {
  process.stdout.write(
    kind === "claude" ? "2.1.168 (Claude Code)\n" : kind === "codex" ? "codex-cli 0.115.0\n" : "1.17.18\n"
  );
  process.exit(0);
}

const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

if (kind === "claude") {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input.trim().split(/\r?\n/u)[0]);
  const prompt = request.message.content[0].text;
  emit({ type: "system", subtype: "init", session_id: "local", model: "claude-opus-4-8", tools: [] });
  emit({ type: "stream_event", event: { delta: { type: "text_delta", text: `read:${prompt}` } } });
  emit({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "done",
    total_cost_usd: 0,
    usage: { input_tokens: 4, output_tokens: 2 },
    session_id: "local"
  });
} else if (kind === "codex") {
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.method === "initialize") emit({ id: message.id, result: { userAgent: "self-test" } });
    else if (message.method === "model/list")
      emit({ id: message.id, result: { data: [{ id: "gpt-5.5-codex", model: "gpt-5.5-codex", isDefault: true }] } });
    else if (message.method === "thread/start") {
      emit({
        id: message.id,
        result: { thread: { id: "local-thread", model: message.params.model, ephemeral: true } }
      });
      emit({ method: "thread/started", params: { thread: { id: "local-thread" } } });
    } else if (message.method === "turn/start") {
      emit({ id: message.id, result: { turn: { id: "local-turn", status: "inProgress" } } });
      emit({ method: "item/agentMessage/delta", params: { delta: "read:done" } });
      emit({
        method: "turn/completed",
        params: { turn: { id: "local-turn", status: "completed" }, usage: { inputTokens: 4, outputTokens: 2 } }
      });
      process.exit(0);
    }
  });
} else {
  throw new Error("Unknown deterministic Driver substitute");
}
