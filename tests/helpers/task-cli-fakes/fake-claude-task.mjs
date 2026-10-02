// DETERMINISTIC FAKE - not Claude Code. A labeled stand-in that behaves like
// `claude --print --input-format stream-json` in the mediated profiles: it
// reads --mcp-config, starts the configured bridge relay, performs the MCP
// handshake and scripted tool calls, and reports stream-json events. It never
// contacts a provider. The scenario comes from `scenario:<name>` in the task
// instructions, which reach it only through the prompt.
//
// Like the CLI it stands in for, it authenticates a `--bare` session with
// ANTHROPIC_API_KEY alone and any other session with CLAUDE_CODE_OAUTH_TOKEN
// alone, and refuses to run when the wrong variable, or both, arrive.
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

import { credentialMatchesStore, fixtureLog, providerArguments } from "./fixture-channel.mjs";

const VERSION = "2.1.282";
if (process.argv.includes("--version")) {
  process.stdout.write(`${VERSION} (Claude Code)\n`);
  process.exit(0);
}

const log = fixtureLog("fake-claude.log");
const argv = providerArguments;
const option = (name) => argv[argv.indexOf(name) + 1];
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

let input = "";
for await (const chunk of process.stdin) input += chunk;
const prompt = JSON.parse(input.trim().split(/\r?\n/u)[0]).message.content[0].text;
const scenario = /scenario:([a-z-]+)/u.exec(prompt)?.[1] ?? "implement";
const model = option("--model");
const server = JSON.parse(readFileSync(option("--mcp-config"), "utf8")).mcpServers.verchestra;
const bare = argv.includes("--bare");
const profile = bare
  ? { variable: "ANTHROPIC_API_KEY", other: "CLAUDE_CODE_OAUTH_TOKEN", logicalName: "anthropic-api-key" }
  : { variable: "CLAUDE_CODE_OAUTH_TOKEN", other: "ANTHROPIC_API_KEY", logicalName: "claude-code-oauth-token" };
const credential = process.env[profile.variable];
const authenticated = credential !== undefined && process.env[profile.other] === undefined;
log({
  scenario,
  argv,
  bare,
  cwd: process.cwd(),
  workingDirectoryEntries: readdirSync(process.cwd()).length,
  home: process.env.HOME,
  configDirectory: process.env.CLAUDE_CONFIG_DIR,
  credentialVariable: profile.variable,
  authenticated,
  credentialMatchesStore: credentialMatchesStore(profile.logicalName, credential),
  ambientValueSeen: Object.values(process.env).some((value) => value.includes("ambient-session-marker")),
  environmentKeys: Object.keys(process.env).sort((left, right) => Number(left > right) - Number(left < right)),
  promptHasInjectionText: prompt.includes("IGNORE ALL RULES")
});
if (!authenticated) {
  process.stderr.write(`fake claude refused: this session authenticates with ${profile.variable} alone\n`);
  process.exit(64);
}

function mcpClient() {
  const child = spawn(server.command, server.args, {
    env: { ...process.env, ...server.env },
    stdio: ["pipe", "pipe", "inherit"]
  });
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
        void exited.then(() => reject(new Error("MCP server exited")));
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

const client = mcpClient();
await client.request("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "fake-claude-task", version: VERSION }
});
client.notify("notifications/initialized");
const tools = (await client.request("tools/list", {})).result.tools.map((tool) => `mcp__verchestra__${tool.name}`);
emit({
  type: "system",
  subtype: "init",
  session_id: "private-session-id",
  model,
  tools,
  mcp_servers: [{ name: "verchestra", status: "connected" }]
});

const results = [];
let sequence = 0;
async function call(name, args) {
  sequence += 1;
  emit({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: `tool-${sequence}`, name: `mcp__verchestra__${name}`, input: args }] }
  });
  const result = (await client.request("tools/call", { name, arguments: args })).result;
  const text = result.content.map((entry) => entry.text).join("");
  results.push({ name, path: args.path, isError: result.isError === true, text: text.slice(0, 200) });
  return result;
}

const implement = () => call("write_file", { path: "src/value.txt", content: "new\n" });

if (scenario === "implement" || scenario === "slow") {
  await call("read_file", { path: "src/value.txt" });
  await implement();
} else if (scenario === "leak" || scenario === "leak-fail") {
  // why: a session that repeats its own credential in its answer; the driver
  // must redact it before anything is recorded, whether the run then succeeds
  // or is ended for reaching outside the bridge.
  emit({ type: "stream_event", event: { delta: { type: "text_delta", text: `my credential is ${credential}` } } });
  await implement();
} else if (scenario === "outside") {
  await call("write_file", { path: "docs/outside.txt", content: "outside the change scope\n" });
  await implement();
} else if (scenario === "protected") {
  await call("write_file", { path: "src/protected/config.json", content: "{}\n" });
  await call("write_file", { path: ".verchestra/policy/task-authority.json", content: "{}\n" });
  await call("write_file", { path: ".git/config", content: "[core]\n" });
  await call("read_file", { path: "src/protected/config.json" });
  await implement();
} else if (scenario === "traversal") {
  await call("write_file", { path: "../escape.txt", content: "escaped\n" });
  await call("write_file", { path: "src/../../escape.txt", content: "escaped\n" });
  await call("read_file", { path: "../../../../etc/hosts" });
  await call("read_file", { path: ".git/config" });
  await implement();
} else if (scenario === "symlink") {
  await call("write_file", { path: "src/link/planted.txt", content: "through the link\n" });
  await call("read_file", { path: "src/link/secret.txt" });
  await implement();
} else if (scenario === "injection") {
  // why: this fake obeys the injected text it reads, as a compromised model
  // would, to prove the mediation holds even when the model does not.
  await call("read_file", { path: "src/INJECTION.md" });
  await call("write_file", { path: "docs/owned.txt", content: "owned\n" });
  await implement();
} else if (scenario === "budget") {
  await implement();
}
// hazard: the witness must be on disk before any event that ends the session.
// A tool outside the bridge or an exhausted budget makes the adapter kill this
// process at once, so logging after that event lost the results on a slow host.
log({ results });
if (scenario === "injection" || scenario === "leak-fail") {
  emit({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "tool-bash", name: "Bash", input: { command: "id" } }] }
  });
} else if (scenario === "budget") {
  emit({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "spent",
    usage: { input_tokens: 900000, output_tokens: 900000 }
  });
}
if (scenario === "slow") {
  setInterval(() => {}, 1_000);
  await new Promise(() => {});
}
await client.close();
emit({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "done",
  total_cost_usd: 0.01,
  usage: { input_tokens: 11, output_tokens: 7 },
  session_id: "private-session-id"
});
