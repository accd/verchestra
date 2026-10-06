import { spawn } from "node:child_process";
import readline from "node:readline";

if (process.argv.includes("--version")) {
  process.stdout.write(`codex-cli ${process.env.FAKE_CODEX_VERSION ?? "0.115.0"}\n`);
  process.exit(0);
}

// DETERMINISTIC FAKE — not Codex. A labeled stand-in for `codex app-server`
// over stdio. Its account, rate-limit, error, and item messages follow the
// protocol `codex app-server generate-ts` produces for 0.159.3 (Account,
// GetAccountRateLimitsResponse, RateLimitSnapshot, CodexErrorInfo,
// ItemCompletedNotification). It never contacts a provider.
const mode = process.env.FAKE_CODEX_MODE ?? "success";
// why: the account the fake reports, and the rate limits it reads, as JSON the
// test spells; the defaults are a ChatGPT Plus login with no credits. Each
// carries the personal and promotional fields a driver must drop.
const account = process.env.FAKE_CODEX_ACCOUNT
  ? JSON.parse(process.env.FAKE_CODEX_ACCOUNT)
  : { type: "chatgpt", email: "owner@example.invalid", planType: "plus" };
const snapshot = (overrides = {}) => ({
  limitId: "codex",
  limitName: null,
  normalModelSlug: null,
  primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_790_000_000 },
  secondary: { usedPercent: 40, windowDurationMins: 10_080, resetsAt: 1_790_500_000 },
  credits: { hasCredits: false, unlimited: false, balance: "0" },
  individualLimit: null,
  spendControlReached: null,
  planType: "plus",
  rateLimitReachedType: null,
  ...overrides
});
const rateLimits = {
  ordinaryUsageAllowed: true,
  rateLimits: snapshot(),
  rateLimitsByLimitId: null,
  rateLimitResetCredits: null,
  accountId: "private-account-id",
  rateLimitUpsell: { message: "upgrade-offer-text" },
  ...(process.env.FAKE_CODEX_RATE_LIMITS ? JSON.parse(process.env.FAKE_CODEX_RATE_LIMITS) : {})
};
const ANSWER = { outcome: "done", summary: "structured by the fake" };
const emit = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let prompt = "";
let outputSchema;
const agentMessage = (text, phase = "final_answer") =>
  emit({ method: "item/completed", params: { threadId: "private-thread-id", turnId: "private-turn-id", completedAtMs: 1, item: { type: "agentMessage", id: `msg-${text.length}`, text, phase, memoryCitation: null, delivery: null, questions: null } } });
const completeTurn = () => {
  emit({ method: "turn/completed", params: { threadId: "private-thread-id", turn: { id: "private-turn-id", status: "completed" }, usage: { inputTokens: 5, outputTokens: 3 } } });
  process.exit(0);
};
// why: the App Server answers a schema in its final message; without one the
// final message is prose, so a driver that did not send the schema gets prose.
const finalAnswer = (answer) => (outputSchema === undefined ? "Here is what I found." : JSON.stringify(answer));

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
  if (message.method === "initialize" && mode === "exit-on-initialize") {
    // why: an App Server that ends before it answers its first request.
    process.exit(3);
  } else if (message.method === "initialize") {
    emit({ id: message.id, result: { userAgent: "fake-codex", codexHome: "private", platformFamily: "windows", platformOs: "windows" } });
  } else if (message.method === "model/list" && mode === "model-list-invalid") {
    // why: an App Server whose model list is not a list.
    emit({ id: message.id, result: { data: "not-a-list" } });
  } else if (message.method === "model/list" && mode === "model-list-missing") {
    // why: an App Server whose answer has no list at all.
    emit({ id: message.id, result: {} });
  } else if (message.method === "model/list") {
    emit({ id: message.id, result: { data: [{ id: "gpt-5.5-codex", model: "gpt-5.5-codex", isDefault: true }] } });
  } else if (message.method === "thread/start" && mode === "thread-refused") {
    // why: an App Server that answers `thread/start` with a JSON-RPC error, as
    // one that is not signed in does.
    emit({ id: message.id, error: { code: -32000, message: "not authenticated" } });
  } else if (message.method === "thread/start") {
    emit({ id: message.id, result: { thread: { id: "private-thread-id", model: message.params.model ?? "gpt-5.5-codex", ephemeral: true } } });
    emit({ method: "thread/started", params: { thread: { id: "private-thread-id" } } });
  } else if (message.method === "account/read") {
    emit({ id: message.id, result: { account, requiresOpenaiAuth: true, workspaceRouting: null } });
  } else if (message.method === "account/rateLimits/read") {
    emit({ id: message.id, result: rateLimits });
  } else if (message.method === "turn/start") {
    prompt = message.params.input?.[0]?.text ?? "";
    outputSchema = message.params.outputSchema;
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
    } else if (mode === "structured") {
      emit({ method: "item/agentMessage/delta", params: { threadId: "private-thread-id", turnId: "private-turn-id", itemId: "msg-1", delta: "working" } });
      agentMessage(finalAnswer(ANSWER));
      completeTurn();
    } else if (mode === "structured-commentary") {
      // why: a turn whose last agent message is the answer and whose earlier
      // one is commentary that is not JSON.
      agentMessage("Reading the scope first.", "commentary");
      agentMessage(finalAnswer(ANSWER));
      completeTurn();
    } else if (mode === "structured-missing") {
      completeTurn();
    } else if (mode === "structured-invalid") {
      agentMessage("{\"outcome\": \"done\", ");
      completeTurn();
    } else if (mode === "structured-large") {
      agentMessage(finalAnswer({ outcome: "done", summary: "x".repeat(8192) }));
      completeTurn();
    } else if (mode === "usage-limit") {
      emit({ method: "error", params: { threadId: "private-thread-id", turnId: "private-turn-id", willRetry: false, error: { message: "You've hit your usage limit. Upgrade to Pro", codexErrorInfo: "usageLimitExceeded", additionalDetails: null, misalignment: null } } });
      emit({ method: "turn/completed", params: { threadId: "private-thread-id", turn: { id: "private-turn-id", status: "failed" }, usage: { inputTokens: 1, outputTokens: 0 } } });
      process.exit(0);
    } else if (mode === "rate-limit-reached") {
      // why: a transient rate limit first, which is not quota, then the
      // allowance running out twice; the turn still completes, as the
      // pricing page says an active turn may.
      emit({ method: "account/rateLimits/updated", params: { rateLimits: snapshot({ rateLimitReachedType: "rate_limit_reached" }) } });
      const exhausted = snapshot({ primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1_790_000_000 }, rateLimitReachedType: "workspace_member_usage_limit_reached" });
      emit({ method: "account/rateLimits/updated", params: { rateLimits: exhausted } });
      emit({ method: "account/rateLimits/updated", params: { rateLimits: exhausted } });
      completeTurn();
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
  } else if (typeof message.id === "number" && typeof message.method === "string") {
    // why: the App Server refuses a method it does not serve.
    emit({ id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  }
});
