// DETERMINISTIC FAKE - not Codex. A labeled stand-in for `codex app-server`
// that answers the JSON-RPC protocol the production CodexDriver speaks and
// returns a verdict block, and for `codex login status`. It never contacts a
// provider. It cites the gate script's own check as evidence and the
// implementation file the task changed, reading both from its working
// directory (the review checkout).
//
// Its login is a fixture: `$CODEX_HOME/auth.json` holding
// `{"fixtureLogin":"chatgpt"}` or `{"fixtureLogin":"api-key"}`, written by the
// test in place of the owner's one-time `codex login`. Like the CLI it stands
// in for, it reports an API-key login as not logged in when `config.toml`
// forces the ChatGPT method, and it refuses to verify without a credential.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";

import { credentialMatchesStore, fixtureLog, providerArguments } from "./fixture-channel.mjs";

if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.130.0\n");
  process.exit(0);
}

const emit = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const log = fixtureLog("fake-codex.log");
const models = ["gpt-5.2-codex"];
const environmentKeys = () =>
  Object.keys(process.env).sort((left, right) => Number(left > right) - Number(left < right));

function readOptional(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

// why: like the CLI, the identity is CODEX_HOME, or `~/.codex` when it is
// unset, so a composition that forgot CODEX_HOME would be caught using the
// invoking user's own login.
const codexHome = () => process.env.CODEX_HOME ?? join(process.env.HOME ?? "", ".codex");
const ambientSeen = () =>
  Object.values(process.env).some((value) => value.includes("ambient-session-marker")) ||
  (readOptional(join(codexHome(), "auth.json")) ?? "").includes("ambient-session-marker");

function fixtureLogin() {
  const home = codexHome();
  if (!existsSync(home)) return "configuration-error";
  const config = readOptional(join(home, "config.toml")) ?? "";
  const stored = readOptional(join(home, "auth.json"));
  const login = stored === undefined ? "none" : JSON.parse(stored).fixtureLogin;
  return login === "api-key" && config.includes('forced_login_method = "chatgpt"') ? "none" : login;
}

const STATUS = Object.freeze({
  chatgpt: ["Logged in using ChatGPT", 0],
  "api-key": ["Logged in using an API key - sk-fake***00000", 0],
  "access-token": ["Logged in using access token", 0],
  "wrong-exit": ["Logged in using ChatGPT", 1],
  none: ["Not logged in", 1],
  "configuration-error": ["Error loading configuration: CODEX_HOME does not exist", 1]
});

if (providerArguments[0] === "login" && providerArguments[1] === "status") {
  const login = fixtureLogin();
  fixtureLog("fake-codex-status.log")({
    login,
    cwd: process.cwd(),
    codexHome: process.env.CODEX_HOME,
    home: process.env.HOME,
    config: readOptional(join(codexHome(), "config.toml")),
    ambientValueSeen: ambientSeen(),
    environmentKeys: environmentKeys()
  });
  if (login === "hang") await new Promise(() => setInterval(() => {}, 1_000));
  const [line, exitCode] = STATUS[login] ?? ["Unexpected error retrieving API key", 1];
  process.stderr.write(`${line}\n`);
  process.exit(exitCode);
}

function verdict(prompt) {
  const requirementIds = /Requirements: ([A-Z0-9, -]+)/u.exec(prompt)?.[1].split(", ") ?? [];
  const lines = existsSync("scripts/check-value.mjs")
    ? readFileSync("scripts/check-value.mjs", "utf8").split("\n")
    : [];
  const line = lines.findIndex((entry) => entry.includes("value !==")) + 1;
  const satisfied = line > 0 && readFileSync("src/value.txt", "utf8") === "new\n";
  const body = {
    requirements: requirementIds.map((requirementId) => ({
      requirementId,
      satisfied,
      evidence: { file: "scripts/check-value.mjs", lineStart: line, lineEnd: line },
      implementationFile: "src/value.txt"
    }))
  };
  return `Reviewed.\nVERCHESTRA-VERDICT-BEGIN\n${JSON.stringify(body)}\nVERCHESTRA-VERDICT-END\n`;
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    emit({ id: message.id, result: { userAgent: "fake-codex-task" } });
  } else if (message.method === "model/list") {
    emit({ id: message.id, result: { data: models.map((model) => ({ id: model, model })) } });
  } else if (message.method === "thread/start") {
    const login = fixtureLogin();
    log({
      cwd: process.cwd(),
      sandbox: message.params.sandbox,
      tools: message.params.dynamicTools.length,
      codexHome: process.env.CODEX_HOME,
      home: process.env.HOME,
      login,
      config: readOptional(join(codexHome(), "config.toml")),
      ambientValueSeen: ambientSeen(),
      credentialMatchesStore: credentialMatchesStore("openai-api-key", process.env.OPENAI_API_KEY),
      environmentKeys: environmentKeys()
    });
    if (process.env.OPENAI_API_KEY === undefined && login !== "chatgpt") {
      emit({ id: message.id, error: { code: -32000, message: "not authenticated" } });
      return;
    }
    emit({ id: message.id, result: { thread: { id: "private-thread-id" } } });
    emit({ method: "thread/started", params: { thread: { id: "private-thread-id" } } });
  } else if (message.method === "turn/start") {
    const prompt = message.params.input?.[0]?.text ?? "";
    emit({ id: message.id, result: { turn: { id: "private-turn-id" } } });
    emit({ method: "item/agentMessage/delta", params: { delta: verdict(prompt) } });
    emit({
      method: "turn/completed",
      params: { turn: { id: "private-turn-id", status: "completed" }, usage: { inputTokens: 5, outputTokens: 3 } }
    });
    process.stdout.write("", () => process.exit(0));
  } else if (message.method === "turn/interrupt") {
    emit({ id: message.id, result: {} });
  }
});
