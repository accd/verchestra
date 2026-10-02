if (process.argv.includes("--version")) {
  process.stdout.write(`${process.env.FAKE_CLAUDE_VERSION ?? "2.1.168"} (Claude Code)\n`);
  process.exit(0);
}

// why: a provider that starts processes of its own. One descendant stays in the
// provider's process group and holds its output open; the other leaves the
// group with setsid(). The line it returns names all three processes.
async function forkTree() {
  const { spawn } = await import("node:child_process");
  const idle = ["-e", "setInterval(() => {}, 1000)"];
  const sameGroup = spawn(process.execPath, idle, { stdio: ["ignore", "inherit", "ignore"] });
  const escaped = spawn(process.execPath, idle, { stdio: "ignore", detached: true });
  return JSON.stringify({ type: "stream_event", event: { delta: { type: "text_delta", text: `tree:${process.pid}:${sameGroup.pid}:${escaped.pid}` } } });
}
// invariant: FAKE_CLAUDE_FORK=1 makes any mode start that tree and name it
// before the mode acts, so a provider that fails or stops answering can be one
// that has descendants.
const forks = process.env.FAKE_CLAUDE_FORK === "1";

if (process.env.FAKE_CLAUDE_MODE === "deaf") {
  // why: a provider that announces itself, stops reading its input before it
  // has read its prompt, and never answers.
  const init = JSON.stringify({ type: "system", subtype: "init", session_id: "private-session-id", model: "claude-opus-4-8", tools: [] });
  const announced = forks ? `${init}\n${await forkTree()}\n` : `${init}\n`;
  // why: the descriptor is closed directly; the runtime keeps a standard
  // stream's descriptor open when the stream is destroyed.
  const { closeSync } = await import("node:fs");
  process.stdout.write(announced, () => closeSync(0));
  await new Promise(() => setInterval(() => {}, 1_000));
}

let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = input.trim() ? JSON.parse(input.trim().split(/\r?\n/)[0]) : undefined;
const prompt = request?.message?.content?.[0]?.text ?? "";
const mode = process.env.FAKE_CLAUDE_MODE ?? "success";

const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
if (mode === "chatter") {
  // why: a provider whose every line reaches its reader in one piece of output
  // and that then never answers, so a reader that fails on the first line still
  // has the others to read while the provider is alive.
  const delta = JSON.stringify({ type: "stream_event", event: { delta: { type: "text_delta", text: "chatter" } } });
  const init = JSON.stringify({ type: "system", subtype: "init", session_id: "private-session-id", model: "claude-opus-4-8", tools: [] });
  process.stdout.write(`${[init, delta, delta, delta].join("\n")}\n`);
  await new Promise(() => setInterval(() => {}, 1_000));
}
emit({ type: "system", subtype: "init", session_id: "private-session-id", model: process.env.FAKE_CLAUDE_MODEL ?? "claude-opus-4-8", tools: [] });
if (forks) process.stdout.write(`${await forkTree()}\n`);

if (mode === "malformed") {
  process.stdout.write("{not-json}\n");
} else if (mode === "tool") {
  emit({ type: "assistant", message: { content: [{ type: "tool_use", id: "tool-1", name: "vestra_echo", input: { value: "x" } }] } });
  emit({ type: "result", subtype: "success", is_error: false, result: "tool requested", total_cost_usd: 0.01, usage: { input_tokens: 4, output_tokens: 2 }, session_id: "private-session-id" });
} else if (mode === "invalid-tool") {
  emit({ type: "assistant", message: { content: [{ type: "tool_use", id: 7, name: null, input: {} }] } });
} else if (mode === "invalid-usage") {
  emit({ type: "result", subtype: "success", is_error: false, result: "bad usage", usage: { input_tokens: -1, output_tokens: "many" }, session_id: "private-session-id" });
} else if (mode === "error") {
  emit({ type: "result", subtype: "error_during_execution", is_error: true, result: "provider failed", total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 0 }, session_id: "private-session-id" });
} else if (mode === "secret") {
  process.stderr.write(`debug:${process.env.TEST_SECRET}\n`);
  emit({ type: "stream_event", event: { delta: { type: "text_delta", text: `value:${process.env.TEST_SECRET}` } } });
  emit({ type: "result", subtype: "success", is_error: false, result: `done:${process.env.TEST_SECRET}`, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, session_id: "private-session-id" });
} else if (mode === "hang") {
  setInterval(() => {}, 1_000);
} else if (mode === "garbled") {
  // why: a provider whose stream breaks, that says one more thing after the
  // break, and that then never answers. A reader that is stopped once it has
  // seen that last thing is stopped after its stream had already failed.
  const delta = JSON.stringify({ type: "stream_event", event: { delta: { type: "text_delta", text: "after-the-failure" } } });
  process.stdout.write(`{not-json}\n${delta}\n`);
  setInterval(() => {}, 1_000);
} else if (mode === "flood") {
  // why: a provider that writes more than any output limit a test sets and
  // then never answers.
  for (let index = 0; index < 40; index += 1) emit({ type: "stream_event", event: { delta: { type: "text_delta", text: "x".repeat(100) } } });
  setInterval(() => {}, 1_000);
} else if (mode === "fork") {
  // why: a provider that starts processes of its own and then never answers.
  process.stdout.write(`${await forkTree()}\n`);
  setInterval(() => {}, 1_000);
} else {
  emit({ type: "stream_event", event: { delta: { type: "text_delta", text: `echo:${prompt}` } } });
  emit({ type: "result", subtype: "success", is_error: false, result: `echo:${prompt}`, total_cost_usd: 0.02, usage: { input_tokens: 5, output_tokens: 3 }, session_id: "private-session-id" });
}
