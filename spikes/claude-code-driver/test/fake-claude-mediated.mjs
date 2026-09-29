// DETERMINISTIC FAKE — not Claude Code. A labeled stand-in executable that
// behaves like `claude --print --input-format stream-json` in the mediated
// profile: it reads --mcp-config, launches the configured MCP server, performs
// the MCP handshake and tool calls over stdio, and reports stream-json events.
// It never contacts a provider. Scenario selection comes from the prompt text.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERSION = "2.1.282";
if (process.argv.includes("--version")) {
  process.stdout.write(`${VERSION} (Claude Code)\n`);
  process.exit(0);
}

const argv = process.argv.slice(2);
const option = (name) => {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
};
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

let input = "";
for await (const chunk of process.stdin) input += chunk;
const prompt = JSON.parse(input.trim().split(/\r?\n/u)[0]).message.content[0].text;
const scenario = /scenario:([a-z-]+)/u.exec(prompt)?.[1] ?? "read-write";
const model = option("--model");
const mcpConfigPath = option("--mcp-config");
const mcpConfig = JSON.parse(readFileSync(mcpConfigPath, "utf8"));
const server = mcpConfig.mcpServers.verchestra;

const observation = {
  argv,
  cwd: process.cwd(),
  environmentKeys: Object.keys(process.env).sort(),
  home: process.env.HOME,
  configDirectory: process.env.CLAUDE_CONFIG_DIR,
  credentialDigest: createHash("sha256").update(process.env.ANTHROPIC_API_KEY ?? "").digest("hex"),
  mcpConfigMode: statSync(mcpConfigPath).mode & 0o777,
  mcpServers: Object.keys(mcpConfig.mcpServers),
  toolResults: []
};
const observe = () => {
  if (process.env.TMPDIR !== undefined)
    writeFileSync(join(process.env.TMPDIR, "fake-claude-observation.json"), JSON.stringify(observation));
};

function mcpClient() {
  // Claude Code merges its own environment with the configured server env.
  const child = spawn(server.command, server.args, { env: { ...process.env, ...server.env }, stdio: ["pipe", "pipe", "inherit"] });
  const waiting = new Map();
  let buffer = "";
  let nextId = 0;
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const message = JSON.parse(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
      index = buffer.indexOf("\n");
    }
  });
  const exited = new Promise((resolve) => child.once("close", resolve));
  return {
    request(method, params) {
      nextId += 1;
      const id = nextId;
      const response = new Promise((resolve, reject) => {
        waiting.set(id, resolve);
        exited.then(() => reject(new Error("MCP server exited")));
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return response;
    },
    notify(method) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
    },
    close() {
      child.stdin.end();
      return exited;
    }
  };
}

let client;
let connected = scenario !== "bridge-down";
let tools = [];
if (connected) {
  client = mcpClient();
  try {
    await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "fake-claude-mediated", version: VERSION }
    });
    client.notify("notifications/initialized");
    tools = (await client.request("tools/list", {})).result.tools.map((tool) => `mcp__verchestra__${tool.name}`);
  } catch {
    connected = false;
  }
}
if (scenario === "extra-tool") tools = [...tools, "Bash"];
emit({
  type: "system",
  subtype: "init",
  session_id: "private-session-id",
  model,
  tools,
  mcp_servers: [{ name: "verchestra", status: connected ? "connected" : "failed" }]
});

async function call(name, args) {
  emit({ type: "assistant", message: { content: [{ type: "tool_use", id: `tool-${observation.toolResults.length + 1}`, name: `mcp__verchestra__${name}`, input: args }] } });
  const result = (await client.request("tools/call", { name, arguments: args })).result;
  observation.toolResults.push({ name, isError: result.isError, text: result.content.map((entry) => entry.text).join("") });
  return result;
}

if (scenario === "read-write") {
  const read = await call("read_file", { path: "src/a.txt" });
  await call("write_file", { path: "src/a.txt", content: "implemented by the fake\n" });
  emit({ type: "stream_event", event: { delta: { type: "text_delta", text: `read:${read.content[0].text}` } } });
} else if (scenario === "read-escape") {
  await call("read_file", { path: "../outside.txt" });
  await call("read_file", { path: ".git/config" });
} else if (scenario === "write-outside") {
  await call("write_file", { path: "docs/outside.txt", content: "outside the change scope\n" });
  await call("write_file", { path: "src/a.txt", content: "implemented inside the scope\n" });
} else if (scenario === "outside-tool") {
  emit({ type: "assistant", message: { content: [{ type: "tool_use", id: "tool-bash", name: "Bash", input: { command: "id" } }] } });
} else if (scenario === "secret") {
  emit({ type: "stream_event", event: { delta: { type: "text_delta", text: `key:${process.env.ANTHROPIC_API_KEY}` } } });
} else if (scenario === "hang") {
  observe();
  setInterval(() => {}, 1_000);
  await new Promise(() => {});
}
observe();
await client?.close();
emit({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "done",
  total_cost_usd: 0.01,
  usage: { input_tokens: 11, output_tokens: 7 },
  session_id: "private-session-id"
});
