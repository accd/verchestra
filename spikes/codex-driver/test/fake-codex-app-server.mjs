import { spawn } from "node:child_process";
import readline from "node:readline";

if (process.argv.includes("--version")) {
  process.stdout.write(`codex-cli ${process.env.FAKE_CODEX_VERSION ?? "0.115.0"}\n`);
  process.exit(0);
}

const mode = process.env.FAKE_CODEX_MODE ?? "success";
const emit = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let prompt = "";

// why: a provider that starts processes of its own. One descendant stays in the
// provider's process group and holds its output open; the other leaves the
// group with setsid(). The message names all three processes.
function forkTree() {
  const idle = ["-e", "setInterval(() => {}, 1000)"];
  const sameGroup = spawn(process.execPath, idle, { stdio: ["ignore", "inherit", "ignore"] });
  const escaped = spawn(process.execPath, idle, { stdio: "ignore", detached: true });
  emit({ method: "item/agentMessage/delta", params: { threadId: "private-thread-id", turnId: "private-turn-id", itemId: "msg-1", delta: `tree:${process.pid}:${sameGroup.pid}:${escaped.pid}` } });
}

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
    // invariant: FAKE_CODEX_FORK=1 makes any mode start that tree and name it
    // before the mode acts, so a provider that fails or ends its turn can be
    // one that has descendants.
    if (process.env.FAKE_CODEX_FORK === "1") forkTree();
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
    } else if (mode === "usage") {
      // why: a provider whose completed turn reports the usage FAKE_CODEX_USAGE
      // spells as JSON, whatever its counts are.
      emit({ method: "turn/completed", params: { threadId: "private-thread-id", turn: { id: "private-turn-id", status: "completed" }, usage: JSON.parse(process.env.FAKE_CODEX_USAGE) } });
      process.exit(0);
    } else if (mode === "crash") {
      // why: a provider that ends with a failure before its turn completes.
      process.exit(3);
    } else if (mode === "exit-after-result") {
      // why: a provider that completes its turn and then exits with a failure.
      emit({ method: "turn/completed", params: { threadId: "private-thread-id", turn: { id: "private-turn-id", status: "completed" }, usage: { inputTokens: 1, outputTokens: 1 } } });
      process.exit(1);
    } else if (mode === "primitive-lines") {
      // why: a provider that writes a number, a boolean and an array, then
      // completes its turn, all in one write, and does not exit.
      const completed = JSON.stringify({ method: "turn/completed", params: { threadId: "private-thread-id", turn: { id: "private-turn-id", status: "completed" }, usage: { inputTokens: 1, outputTokens: 1 } } });
      process.stdout.write(`5\ntrue\n[1]\n${completed}\n`);
    } else if (mode === "not-an-object") {
      // why: a provider whose lines parse as JSON and are not objects: null,
      // then a string that spells an error code. It then never answers.
      process.stdout.write(`null\n"VES_CODEX_ABORTED"\n`);
    } else if (mode === "fork") {
      // why: a provider that starts processes of its own and then never answers.
      forkTree();
    } else if (mode === "linger") {
      // why: a provider that completes its turn and does not exit, as an App
      // Server does. Its run ends while it is still running.
      emit({ method: "turn/completed", params: { threadId: "private-thread-id", turn: { id: "private-turn-id", status: "completed" }, usage: { inputTokens: 2, outputTokens: 1 } } });
    } else if (mode === "garbled") {
      // why: a provider whose stream breaks, that says one more thing after the
      // break, and that then never answers. A reader that is stopped once it has
      // seen that last thing is stopped after its stream had already failed.
      const delta = JSON.stringify({ method: "item/agentMessage/delta", params: { threadId: "private-thread-id", turnId: "private-turn-id", itemId: "msg-1", delta: "after-the-failure" } });
      process.stdout.write(`{not-json}\n${delta}\n`);
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
