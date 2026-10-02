// DETERMINISTIC FAKE — not Claude Code. A labeled stand-in executable that
// behaves like `claude --print --input-format stream-json` in the mediated
// profiles: it reads --mcp-config, launches the configured MCP server, performs
// the MCP handshake and tool calls over stdio, and reports stream-json events.
// It never contacts a provider. Scenario selection comes from the prompt text.
// It refuses an invocation whose arguments or credential variable differ from
// the profile it was started in, the way the documented CLI would: `--bare`
// authenticates with ANTHROPIC_API_KEY only, and without `--bare` the
// subscription token arrives in CLAUDE_CODE_OAUTH_TOKEN.
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";

const VERSION = "2.1.282";
if (process.argv.includes("--version")) {
  process.stdout.write(`${VERSION} (Claude Code)\n`);
  process.exit(0);
}

// why: the test names its private observation directory through a fixture
// prefix on the command, never through an ambient temp directory; the prefix
// is not part of the driver's invocation, so it is not observed as argv.
const fixturePrefix = process.argv[2] === "--fixture-observations";
const observationDirectory = fixturePrefix ? process.argv[3] : undefined;
const argv = process.argv.slice(fixturePrefix ? 4 : 2);
const option = (name) => {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
};
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

const BRIDGE_TOOLS =
  "mcp__verchestra__read_file,mcp__verchestra__list_dir,mcp__verchestra__search,mcp__verchestra__write_file,mcp__verchestra__delete_file";
const STREAM = ["--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"];
const SURFACE = (mcpConfig) => [
  "--strict-mcp-config",
  "--mcp-config",
  mcpConfig,
  "--tools",
  "",
  "--allowedTools",
  BRIDGE_TOOLS,
  "--permission-mode",
  "dontAsk",
  "--permission-prompts",
  "none",
  "--no-chrome",
  "--setting-sources",
  ""
];
// invariant: the two qualified invocations, spelled out here independently of
// the driver so a drifted argument list is refused by the fake itself.
const PROFILES = {
  bare: {
    credential: "ANTHROPIC_API_KEY",
    arguments: (mcpConfig, selected) => [
      ...STREAM,
      "--include-partial-messages",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--bare",
      ...SURFACE(mcpConfig),
      "--model",
      selected
    ]
  },
  subscription: {
    credential: "CLAUDE_CODE_OAUTH_TOKEN",
    arguments: (mcpConfig, selected) => [
      ...STREAM,
      "--include-partial-messages",
      "--include-hook-events",
      "--no-session-persistence",
      "--disable-slash-commands",
      ...SURFACE(mcpConfig),
      "--settings",
      '{"disableAllHooks":true,"autoMemoryEnabled":false}',
      "--model",
      selected
    ]
  }
};
const CREDENTIAL_VARIABLES = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"];

function refuse(reason) {
  process.stderr.write(`fake claude refused the invocation: ${reason}\n`);
  process.exit(64);
}

let input = "";
for await (const chunk of process.stdin) input += chunk;
const prompt = JSON.parse(input.trim().split(/\r?\n/u)[0]).message.content[0].text;
const scenario = /scenario:([a-z-]+)/u.exec(prompt)?.[1] ?? "read-write";
const model = option("--model");
const mcpConfigPath = option("--mcp-config");
const profile = PROFILES[argv.includes("--bare") ? "bare" : "subscription"];
const expected = profile.arguments(mcpConfigPath, model);
if (argv.length !== expected.length || argv.some((argument, index) => argument !== expected[index]))
  refuse("the arguments are not the qualified invocation of this profile");
const supplied = CREDENTIAL_VARIABLES.filter((name) => process.env[name] !== undefined);
if (supplied.length !== 1 || supplied[0] !== profile.credential)
  refuse(`this profile authenticates with ${profile.credential} alone`);
const credential = process.env[profile.credential];
const mcpConfig = JSON.parse(readFileSync(mcpConfigPath, "utf8"));
const server = mcpConfig.mcpServers.verchestra;

const observation = {
  argv,
  cwd: process.cwd(),
  workingDirectoryEntries: readdirSync(process.cwd()).length,
  environmentKeys: Object.keys(process.env).sort((left, right) => Number(left > right) - Number(left < right)),
  home: process.env.HOME,
  configDirectory: process.env.CLAUDE_CONFIG_DIR,
  mcpConfigMode: statSync(mcpConfigPath).mode & 0o777,
  mcpServers: Object.keys(mcpConfig.mcpServers),
  toolResults: []
};
// hazard: the named directory must resolve inside the private temp directory
// the driver gave this child, so an argument can never aim the write elsewhere.
function observationPath() {
  const base = `${realpathSync(tmpdir())}${sep}`;
  const target = resolve(realpathSync(observationDirectory), "fake-claude-observation.json");
  if (!target.startsWith(base)) throw new Error("observation directory is outside the child temp directory");
  return target;
}
const observe = () => {
  if (observationDirectory !== undefined) writeFileSync(observationPath(), JSON.stringify(observation));
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
if (scenario === "hook")
  emit({ type: "system", subtype: "hook_started", hook_name: "SessionStart", session_id: "private-session-id" });
emit({
  type: "system",
  subtype: "init",
  session_id: "private-session-id",
  model,
  tools,
  mcp_servers: [
    { name: "verchestra", status: connected ? "connected" : "failed" },
    ...(scenario === "extra-server" ? [{ name: "claude.ai Connector", status: "connected" }] : [])
  ]
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
  emit({ type: "stream_event", event: { delta: { type: "text_delta", text: `key:${credential}` } } });
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
