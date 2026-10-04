// DETERMINISTIC FAKE - not Codex. A labeled stand-in for `codex app-server`
// that answers the JSON-RPC protocol the production CodexDriver speaks and
// returns a verdict block, and for `codex login status`. A turn that carries
// an `outputSchema` is a coordinated node's: it answers one structured result,
// after the account and rate-limit reads a subscription-only session makes. It never contacts a
// provider. It cites the gate script's own check as evidence and the
// implementation file the task changed, reading both from its working
// directory (the review checkout). `verifier-scenario:<name>` in the prompt
// selects a turn that does not answer with a verdict.
//
// Its login is a fixture: `$CODEX_HOME/auth.json` holding
// `{"fixtureLogin":"chatgpt"}` or `{"fixtureLogin":"api-key"}`, written by the
// test in place of the owner's one-time `codex login`. Like the CLI it stands
// in for, it reports an API-key login as not logged in when `config.toml`
// forces the ChatGPT method, and it refuses to verify without a credential.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";

import { credentialMatchesStore, fixtureFlag, fixtureLog, providerArguments } from "./fixture-channel.mjs";

// why: the `codex-0.159.2` flag reports the build just below the floor of the
// account reads, as an owner who has not updated Codex has.
if (process.argv.includes("--version")) {
  process.stdout.write(`codex-cli ${fixtureFlag("codex-0.159.2") ? "0.159.2" : "0.159.3"}\n`);
  process.exit(0);
}

const emit = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const log = fixtureLog("fake-codex.log");
// why: a turn names its process in a log of its own, so a test can tell that a
// verifier it stopped was really running, and that the process is gone.
const turnLog = fixtureLog("fake-codex-turn.log");
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
  // why: the `slow-login-status` flag makes this probe answer 2 s late, as a
  // slow host does. The probe runs before a run's first meter exists, so the
  // flag delays when the run's own clock starts, not anything it measures.
  if (fixtureFlag("slow-login-status")) await new Promise((resolve) => setTimeout(resolve, 2_000));
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

function forked() {
  const idle = ["-e", "setInterval(() => {}, 1000)"];
  const sameGroup = spawn(process.execPath, idle, { stdio: ["ignore", "inherit", "ignore"] });
  const escaped = spawn(process.execPath, idle, { stdio: "ignore", detached: true });
  return { sameGroup: sameGroup.pid, escaped: escaped.pid };
}

// why: the protocol 0.159.3 generates for a ChatGPT login with no credits and
// ordinary usage allowed; a fixture API-key login reads as an API-key account.
function account() {
  return fixtureLogin() === "chatgpt"
    ? { type: "chatgpt", email: "owner@example.invalid", planType: "plus" }
    : { type: "apiKey" };
}
const RATE_LIMITS = Object.freeze({
  ordinaryUsageAllowed: true,
  rateLimits: {
    limitId: "codex",
    limitName: null,
    primary: { usedPercent: 1, windowDurationMins: 300, resetsAt: 1_790_000_000 },
    secondary: null,
    credits: { hasCredits: false, unlimited: false, balance: "0" },
    planType: "plus",
    rateLimitReachedType: null
  },
  rateLimitsByLimitId: null
});

// why: the `codex-credits` flag makes the account report a credit balance, as
// a Plus account with purchased credits does (decision D3b); the `codex-quota`
// flag makes it report ordinary usage refused, with its five-hour window used
// up, as an account whose allowance is exhausted does.
function rateLimits() {
  if (fixtureFlag("codex-quota"))
    return {
      ...RATE_LIMITS,
      ordinaryUsageAllowed: false,
      rateLimits: { ...RATE_LIMITS.rateLimits, primary: { ...RATE_LIMITS.rateLimits.primary, usedPercent: 100 } }
    };
  if (!fixtureFlag("codex-credits")) return RATE_LIMITS;
  const credits = { hasCredits: true, unlimited: false, balance: "25.00" };
  return { ...RATE_LIMITS, rateLimits: { ...RATE_LIMITS.rateLimits, credits } };
}

// why: a node answers its schema: done, a summary, and for a swarm node the
// prompt's `next:<node>` marker or the end.
function nodeAnswer(prompt, schema) {
  const answer = { outcome: "done", summary: "fake codex node read the scope" };
  if (schema.properties?.next === undefined) return answer;
  const next = /\bnext:([a-z][a-z0-9-]*|<complete>)/u.exec(prompt)?.[1] ?? "<complete>";
  return { ...answer, next, message: `handed on by fake codex to ${next}` };
}

// why: a subscription-only session reads its account and its rate limits
// before its turn; the node log says whether this one did.
const accountReads = new Set();

function nodeTurn(message, prompt) {
  // why: `node-hang` in the prompt, or the `codex-node-hang` flag, leaves the
  // turn open until the process is stopped; the flag lets a test lift it
  // before the same node is run again.
  const hang = prompt.includes("node-hang") || fixtureFlag("codex-node-hang");
  fixtureLog("fake-codex-node.log")({
    pid: process.pid,
    cwd: process.cwd(),
    hang,
    accountChecked: accountReads.has("account/read") && accountReads.has("account/rateLimits/read")
  });
  emit({ id: message.id, result: { turn: { id: "private-turn-id" } } });
  if (hang) return;
  const text = JSON.stringify(nodeAnswer(prompt, message.params.outputSchema));
  emit({
    method: "item/completed",
    params: {
      threadId: "private-thread-id",
      turnId: "private-turn-id",
      item: { type: "agentMessage", id: "msg-node", text, phase: "final_answer" }
    }
  });
  emit({
    method: "turn/completed",
    params: { turn: { id: "private-turn-id", status: "completed" }, usage: { inputTokens: 5, outputTokens: 3 } }
  });
  process.stdout.write("", () => process.exit(0));
}

function startThread(message) {
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
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    emit({ id: message.id, result: { userAgent: "fake-codex-task" } });
  } else if (message.method === "account/read") {
    accountReads.add(message.method);
    emit({ id: message.id, result: { account: account(), requiresOpenaiAuth: true } });
  } else if (message.method === "account/rateLimits/read") {
    accountReads.add(message.method);
    emit({ id: message.id, result: rateLimits() });
  } else if (message.method === "model/list") {
    emit({ id: message.id, result: { data: models.map((model) => ({ id: model, model })) } });
  } else if (message.method === "thread/start") {
    startThread(message);
  } else if (message.method === "turn/start" && message.params.outputSchema !== undefined) {
    nodeTurn(message, message.params.input?.[0]?.text ?? "");
  } else if (message.method === "turn/start") {
    const prompt = message.params.input?.[0]?.text ?? "";
    // why: the `fork-verifier` flag selects the forking turn without a word in
    // the prompt, so one request can be interrupted in its first run and
    // verified when it is resumed.
    const flagged = fixtureFlag("fork-verifier") ? "fork" : "verdict";
    const scenario = /verifier-scenario:([a-z-]+)/u.exec(prompt)?.[1] ?? flagged;
    emit({ id: message.id, result: { turn: { id: "private-turn-id" } } });
    // why: `verifier-scenario:fork` is a verifier that starts processes of its
    // own: one stays in its process group and holds its output open, the
    // other leaves the group with setsid(). The turn log names both.
    // why: SSI-19. A node's result is never part of what the verifier judges;
    // the fake reports whether any node's answer reached its prompt.
    const nodeResultInPrompt = /fake (?:claude|codex node)/u.test(prompt);
    const accountChecked = accountReads.has("account/read") && accountReads.has("account/rateLimits/read");
    turnLog({
      pid: process.pid,
      scenario,
      nodeResultInPrompt,
      accountChecked,
      ...(scenario === "fork" ? forked() : {})
    });
    // why: `hang` and `fork` leave the turn open until the process is stopped,
    // the way a verifier that never answers would.
    if (scenario === "hang" || scenario === "fork") return;
    // why: `usage-limit` is a verifier whose allowance runs out mid-turn: the
    // App Server reports `usageLimitExceeded` and fails the turn.
    if (scenario === "usage-limit") {
      emit({ method: "error", params: { error: { message: "limit", codexErrorInfo: "usageLimitExceeded" } } });
      emit({
        method: "turn/completed",
        params: { turn: { id: "private-turn-id", status: "failed" }, usage: { inputTokens: 5, outputTokens: 0 } }
      });
      process.stdout.write("", () => process.exit(0));
      return;
    }
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
