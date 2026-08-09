import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SAFE_ENV_KEYS = ["PATH", "SystemRoot", "ComSpec", "TEMP", "TMP", "HOME", "USERPROFILE"];

// On Windows an npm global install exposes `claude` only as a cmd-shim
// (claude.cmd), which Node refuses to spawn without a shell (CVE-2024-27980
// hardening) — so a bare-name spawn reports an installed CLI as unavailable. A
// shell would also mangle this driver's empty-string arguments and reopen an
// injection surface, so instead resolve the shim to the package entry npm keeps
// beside it (<bin>/node_modules/@anthropic-ai/claude-code/cli.js) and run it
// with this Node executable directly. Native installs (claude.exe) and every
// POSIX platform keep the bare name. The probe result stays honest: when no
// resolvable installation exists the spawn still fails closed to unavailable.
export function resolveClaudeCommand({
  platform = process.platform,
  env = process.env,
  execPath = process.execPath
} = {}) {
  if (platform !== "win32") return ["claude"];
  for (const directory of (env.PATH ?? "").split(path.delimiter)) {
    if (directory === "") continue;
    const resolved = npmShimTarget(path.join(directory, "claude.cmd"), execPath);
    if (resolved !== undefined) return resolved;
  }
  return ["claude"];
}

// npm's cmd-shim has carried the same generated shape for a decade: its final
// line runs `"%_prog%"  "%dp0%\<relative target>" %*`. Reading the target out
// of the shim beats guessing at package layouts, and a shim that does not match
// the generated shape simply resolves to nothing rather than to a wrong file.
function npmShimTarget(shimPath, execPath) {
  if (!existsSync(shimPath)) return undefined;
  let content;
  try {
    content = readFileSync(shimPath, "utf8");
  } catch {
    return undefined;
  }
  const match = /"%dp0%\\([^"]+)"\s+%\*/u.exec(content);
  if (!match) return undefined;
  const target = path.join(path.dirname(shimPath), match[1]);
  if (!existsSync(target)) return undefined;
  return target.toLowerCase().endsWith(".js") ? [execPath, target] : [target];
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  return match ? match.slice(1).map(Number) : undefined;
}

function supported(actual, minimum) {
  const left = parseVersion(actual);
  const right = parseVersion(minimum);
  if (!left || !right || left[0] !== right[0]) return false;
  for (let index = 1; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

function redactor(values) {
  const secrets = [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))].sort((a, b) => b.length - a.length);
  return (text) => secrets.reduce((safe, secret) => safe.replaceAll(secret, "[REDACTED]"), text);
}

function userMessage(prompt) {
  return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } });
}

export class ClaudeCodeDriver {
  constructor({ command = resolveClaudeCommand(), minimumVersion = "2.1.168", terminateTree, onSpawn } = {}) {
    this.command = command;
    this.minimumVersion = minimumVersion;
    this.terminateTree = terminateTree ?? (async (pid) => process.kill(pid));
    this.onSpawn = onSpawn;
  }

  buildEnvironment(explicit = {}) {
    const environment = {};
    for (const key of SAFE_ENV_KEYS) {
      if (process.env[key] !== undefined) environment[key] = process.env[key];
    }
    return { ...environment, ...explicit };
  }

  buildArguments({ model } = {}) {
    const args = [
      ...this.command.slice(1),
      "--print",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--strict-mcp-config",
      "--mcp-config", "{}",
      "--tools", "",
      "--permission-mode", "dontAsk",
      "--no-chrome",
      "--setting-sources", ""
    ];
    if (model) args.push("--model", model);
    return args;
  }

  async probe({ environment = {} } = {}) {
    try {
      const { stdout } = await execFileAsync(this.command[0], [...this.command.slice(1), "--version"], {
        encoding: "utf8",
        env: this.buildEnvironment(environment),
        windowsHide: true
      });
      const version = parseVersion(stdout)?.join(".");
      if (!version || !supported(version, this.minimumVersion)) {
        return { available: false, version, error: { code: "VES_CLAUDE_VERSION_UNSUPPORTED", message: `requires ${this.minimumVersion} within the same major` } };
      }
      return {
        available: true,
        version,
        capabilities: { streamJson: true, partialMessages: true, noSessionPersistence: true, structuredInput: true }
      };
    } catch (error) {
      return { available: false, error: { code: "VES_CLAUDE_NOT_AVAILABLE", message: error instanceof Error ? error.message : "Claude Code unavailable" } };
    }
  }

  async run({ prompt, model, environment = {}, sensitiveValues = [], signal, maxOutputBytes = 1_048_576 }) {
    const probe = await this.probe({ environment });
    if (!probe.available) return { stopReason: "error", events: [], outputText: "", error: probe.error };

    const redact = redactor(sensitiveValues);
    const args = this.buildArguments({ model });
    const result = {
      runtime: { id: "claude-code", version: probe.version },
      invocation: { arguments: [...args] },
      events: [],
      resolvedModel: undefined,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      outputText: "",
      safeStderr: "",
      stopReason: "error"
    };

    const child = spawn(this.command[0], args, {
      cwd: process.cwd(),
      env: this.buildEnvironment(environment),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    this.onSpawn?.(child.pid);

    let outputBytes = 0;
    let aborted = false;
    let streamError;
    let stderr = "";
    const abort = async () => {
      aborted = true;
      await this.terminateTree(child.pid);
    };
    if (signal?.aborted) await abort();
    else signal?.addEventListener("abort", abort, { once: true });

    child.stderr.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes <= maxOutputBytes) stderr += chunk.toString("utf8");
      else void this.terminateTree(child.pid);
    });
    child.stdin.on("error", (error) => {
      if (!aborted) streamError = { code: "VES_CLAUDE_STDIN_FAILED", message: error.message };
    });

    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      outputBytes += Buffer.byteLength(line) + 1;
      if (outputBytes > maxOutputBytes) {
        streamError = { code: "VES_CLAUDE_OUTPUT_LIMIT", message: "Claude Code output exceeded the configured limit" };
        void this.terminateTree(child.pid);
        return;
      }
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        streamError = { code: "VES_CLAUDE_STREAM_INVALID", message: "Claude Code emitted invalid stream-json" };
        void this.terminateTree(child.pid);
        return;
      }
      if (event.type === "system" && event.subtype === "init") {
        result.resolvedModel = { provider: "anthropic", model: event.model };
        result.events.push({ type: "session.started" });
      } else if (event.type === "stream_event" && event.event?.delta?.type === "text_delta") {
        const text = redact(String(event.event.delta.text ?? ""));
        result.outputText += text;
        result.events.push({ type: "content.delta", text });
      } else if (event.type === "assistant" && Array.isArray(event.message?.content)) {
        for (const content of event.message.content) {
          if (content.type === "tool_use") {
            result.events.push({ type: "tool.requested", id: content.id, name: content.name, input: content.input });
          }
        }
      } else if (event.type === "result") {
        result.usage = {
          inputTokens: Number(event.usage?.input_tokens ?? 0),
          outputTokens: Number(event.usage?.output_tokens ?? 0),
          costUsd: Number(event.total_cost_usd ?? 0)
        };
        result.stopReason = event.is_error ? "error" : "stop";
        if (!result.outputText && !event.is_error) result.outputText = redact(String(event.result ?? ""));
        if (event.is_error) result.error = { code: "VES_CLAUDE_EXECUTION_FAILED", message: redact(String(event.result ?? "Claude Code failed")) };
        result.events.push({ type: "session.closed" });
      }
    });

    child.stdin.end(`${userMessage(prompt)}\n`);
    const exit = await new Promise((resolve) => child.once("close", (code, exitSignal) => resolve({ code, signal: exitSignal })));
    signal?.removeEventListener("abort", abort);
    result.safeStderr = redact(stderr.trim());

    if (aborted) return { ...result, stopReason: "aborted", error: { code: "VES_CLAUDE_ABORTED", message: "aborted by controller" } };
    if (streamError) return { ...result, stopReason: "error", error: streamError };
    if (exit.code !== 0 && !result.error) {
      return { ...result, stopReason: "error", error: { code: "VES_CLAUDE_PROCESS_FAILED", message: `Claude Code exited with ${exit.code ?? exit.signal}` } };
    }
    if (!result.events.some((event) => event.type === "session.closed")) {
      return { ...result, stopReason: "error", error: { code: "VES_CLAUDE_STREAM_INCOMPLETE", message: "Claude Code stream ended without a result event" } };
    }
    return result;
  }
}
