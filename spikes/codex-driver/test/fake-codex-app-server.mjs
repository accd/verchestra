import readline from "node:readline";

if (process.argv.includes("--version")) {
  process.stdout.write(`codex-cli ${process.env.FAKE_CODEX_VERSION ?? "0.115.0"}\n`);
  process.exit(0);
}

const mode = process.env.FAKE_CODEX_MODE ?? "success";
const emit = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let prompt = "";

lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    emit({ id: message.id, result: { userAgent: "fake-codex", codexHome: "private", platformFamily: "windows", platformOs: "windows" } });
  } else if (message.method === "model/list") {
    emit({ id: message.id, result: { data: [{ id: "gpt-5.5-codex", model: "gpt-5.5-codex", isDefault: true }] } });
  } else if (message.method === "thread/start") {
    emit({ id: message.id, result: { thread: { id: "private-thread-id", model: message.params.model ?? "gpt-5.5-codex", ephemeral: true } } });
    emit({ method: "thread/started", params: { thread: { id: "private-thread-id" } } });
  } else if (message.method === "turn/start") {
    prompt = message.params.input?.[0]?.text ?? "";
    emit({ id: message.id, result: { turn: { id: "private-turn-id", status: "inProgress" } } });
    emit({ method: "turn/started", params: { threadId: "private-thread-id", turn: { id: "private-turn-id" } } });
    if (mode === "malformed") {
      process.stdout.write("{not-json}\n");
    } else if (mode === "tool") {
      emit({ method: "item/tool/call", id: 60, params: { threadId: "private-thread-id", turnId: "private-turn-id", callId: "call-1", tool: "vestra_echo", arguments: { value: "x" } } });
    } else if (mode === "command-approval") {
      emit({ method: "item/commandExecution/requestApproval", id: 61, params: { threadId: "private-thread-id", turnId: "private-turn-id", itemId: "cmd-1", command: "Set-Content sentinel bad" } });
    } else if (mode === "error") {
      emit({ method: "error", params: { threadId: "private-thread-id", turnId: "private-turn-id", error: { message: "provider failed" } } });
      emit({ method: "turn/completed", params: { threadId: "private-thread-id", turn: { id: "private-turn-id", status: "failed", error: { message: "provider failed" } } } });
      process.exit(0);
    } else if (mode === "large") {
      for (let index = 0; index < 20; index += 1) emit({ method: "item/agentMessage/delta", params: { threadId: "private-thread-id", turnId: "private-turn-id", itemId: "msg-1", delta: "x".repeat(100) } });
    } else if (mode === "secret") {
      process.stderr.write(`debug:${process.env.TEST_SECRET}\n`);
      emit({ method: "item/agentMessage/delta", params: { threadId: "private-thread-id", turnId: "private-turn-id", itemId: "msg-1", delta: `value:${process.env.TEST_SECRET}` } });
      emit({ method: "turn/completed", params: { threadId: "private-thread-id", turn: { id: "private-turn-id", status: "completed" }, usage: { inputTokens: 1, outputTokens: 1 } } });
      process.exit(0);
    } else if (mode !== "hang") {
      emit({ method: "item/agentMessage/delta", params: { threadId: "private-thread-id", turnId: "private-turn-id", itemId: "msg-1", delta: `echo:${prompt}` } });
      emit({ method: "turn/completed", params: { threadId: "private-thread-id", turn: { id: "private-turn-id", status: "completed" }, usage: { inputTokens: 7, outputTokens: 4 } } });
      process.exit(0);
    }
  } else if (message.id === 60) {
    process.stderr.write(`tool-response-success:${message.result.success}\n`);
    emit({ method: "turn/completed", params: { threadId: "private-thread-id", turn: { id: "private-turn-id", status: "completed" }, usage: { inputTokens: 3, outputTokens: 2 } } });
    process.exit(0);
  } else if (message.id === 61) {
    process.stderr.write(`approval-decision:${message.result.decision}\n`);
    emit({ method: "turn/completed", params: { threadId: "private-thread-id", turn: { id: "private-turn-id", status: "completed" }, usage: { inputTokens: 3, outputTokens: 2 } } });
    process.exit(0);
  } else if (message.method === "turn/interrupt") {
    process.stderr.write("interrupt-received\n");
    emit({ id: message.id, result: {} });
  }
});
