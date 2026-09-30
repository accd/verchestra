// DETERMINISTIC FAKE - not Codex. A labeled stand-in for `codex app-server`
// that answers the JSON-RPC protocol the production CodexDriver speaks and
// returns a verdict block. It never contacts a provider. It cites the gate
// script's own check as evidence and the implementation file the task
// changed, reading both from its working directory (the review checkout).
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";

if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.130.0\n");
  process.exit(0);
}

const emit = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const log = (entry) => {
  if (process.env.TMPDIR !== undefined)
    appendFileSync(join(process.env.TMPDIR, "fake-codex.log"), `${JSON.stringify(entry)}\n`);
};
const models = ["gpt-5.2-codex"];

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
    log({
      cwd: process.cwd(),
      sandbox: message.params.sandbox,
      tools: message.params.dynamicTools.length,
      codexHome: process.env.CODEX_HOME,
      home: process.env.HOME,
      credentialDigest: createHash("sha256")
        .update(process.env.OPENAI_API_KEY ?? "")
        .digest("hex"),
      environmentKeys: Object.keys(process.env).sort((left, right) => Number(left > right) - Number(left < right))
    });
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
