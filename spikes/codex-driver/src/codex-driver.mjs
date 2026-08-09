import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SAFE_ENV_KEYS = ["PATH", "SystemRoot", "ComSpec", "TEMP", "TMP", "HOME", "USERPROFILE", "CODEX_HOME"];

function parseVersion(value) {
  const match = /(?:codex-cli\s+)?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
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
  return (text) => secrets.reduce((safe, secret) => safe.replaceAll(secret, "[REDACTED]"), String(text));
}

function errorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

// An npm global install exposes `codex` on Windows only as a cmd-shim, which
// Node refuses to spawn without a shell (CVE-2024-27980 hardening). The %APPDATA%
// probe below covers the default npm prefix, but CI runners relocate the global
// prefix, so additionally scan PATH for the shim and use the package entry npm
// keeps beside it. Native installs and POSIX platforms keep the bare name, and
// a host without any resolvable installation still fails closed to unavailable.
export function resolveCodexCommand({
  platform = process.platform,
  env = process.env,
  execPath = process.execPath
} = {}) {
  if (platform !== "win32") return ["codex"];
  if (env.APPDATA) {
    const npmEntrypoint = path.join(env.APPDATA, "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
    if (existsSync(npmEntrypoint)) return [execPath, npmEntrypoint];
  }
  for (const directory of (env.PATH ?? "").split(path.delimiter)) {
    if (directory === "") continue;
    const resolved = npmShimTarget(path.join(directory, "codex.cmd"), execPath);
    if (resolved !== undefined) return resolved;
  }
  return ["codex"];
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
  // The captured relative path is Windows-form; split it so the join is
  // correct on every platform (the resolver tests run on POSIX CI too).
  const target = path.join(path.dirname(shimPath), ...match[1].split("\\"));
  if (!existsSync(target)) return undefined;
  return target.toLowerCase().endsWith(".js") ? [execPath, target] : [target];
}

function defaultCommand() {
  return resolveCodexCommand();
}

export class CodexDriver {
  constructor({ command, minimumVersion = "0.115.0", terminateTree, onSpawn, onMessageSent } = {}) {
    this.command = command ?? defaultCommand();
    this.minimumVersion = minimumVersion;
    this.terminateTree = terminateTree ?? (async (pid) => process.kill(pid));
    this.onSpawn = onSpawn;
    this.onMessageSent = onMessageSent;
  }

  buildEnvironment(explicit = {}) {
    const environment = {};
    for (const key of SAFE_ENV_KEYS) {
      if (process.env[key] !== undefined) environment[key] = process.env[key];
    }
    return { ...environment, ...explicit };
  }

  buildArguments() {
    return [...this.command.slice(1), "app-server", "--listen", "stdio://"];
  }

  buildThreadParams({ model, tools = [], cwd = process.cwd() } = {}) {
    return {
      model: model ?? null,
      cwd,
      ephemeral: true,
      sandbox: "read-only",
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      dynamicTools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      baseInstructions: "Operate read-only. Use only the supplied dynamic tools for external effects. Never request filesystem writes, sandbox escape, network escalation, or persistent approval."
    };
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
        return { available: false, version, error: { code: "VES_CODEX_VERSION_UNSUPPORTED", message: `requires ${this.minimumVersion} within the same major` } };
      }
      return {
        available: true,
        version,
        capabilities: {
          appServerJsonl: true,
          ephemeralThreads: true,
          modelDiscovery: true,
          protocolInterrupt: true,
          dynamicToolsExperimental: true,
          projectWrite: false
        }
      };
    } catch (error) {
      return { available: false, error: { code: "VES_CODEX_NOT_AVAILABLE", message: errorMessage(error, "Codex unavailable") } };
    }
  }

  async run({ prompt, model, tools = [], environment = {}, sensitiveValues = [], signal, maxOutputBytes = 1_048_576, cancelGraceMs = 250 } = {}) {
    const probe = await this.probe({ environment });
    if (!probe.available) return { stopReason: "error", events: [], outputText: "", error: probe.error };

    const redact = redactor(sensitiveValues);
    const args = this.buildArguments();
    const result = {
      runtime: { id: "codex-app-server", version: probe.version },
      invocation: { arguments: [...args] },
      events: [],
      resolvedModel: undefined,
      usage: { inputTokens: 0, outputTokens: 0 },
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

    let nextId = 1;
    let outputBytes = 0;
    let stderr = "";
    let streamError;
    let aborted = false;
    let turnId;
    let threadId;
    let interruptSent = false;
    const pending = new Map();
    let finishRun;
    const finished = new Promise((resolve) => { finishRun = resolve; });

    const write = (message) => {
      this.onMessageSent?.(structuredClone(message));
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const notify = (method, params = {}) => write({ method, params });
    const request = (method, params = {}) => {
      const id = nextId;
      nextId += 1;
      write({ method, id, params });
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    };
    const failStream = (code, message) => {
      if (streamError) return;
      streamError = { code, message };
      finishRun();
      child.kill();
    };
    const interrupt = () => {
      if (!aborted || !threadId || !turnId || interruptSent || child.killed) return;
      interruptSent = true;
      void request("turn/interrupt", { threadId, turnId }).catch(() => {});
    };

    child.stderr.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes <= maxOutputBytes) stderr += chunk.toString("utf8");
      else failStream("VES_CODEX_OUTPUT_LIMIT", "Codex output exceeded the configured limit");
    });
    child.stdin.on("error", (error) => {
      if (!aborted) failStream("VES_CODEX_STDIN_FAILED", error.message);
    });

    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      outputBytes += Buffer.byteLength(line) + 1;
      if (outputBytes > maxOutputBytes) {
        failStream("VES_CODEX_OUTPUT_LIMIT", "Codex output exceeded the configured limit");
        return;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        failStream("VES_CODEX_STREAM_INVALID", "Codex app-server emitted invalid JSONL");
        return;
      }

      if (message.id !== undefined && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
        const waiter = pending.get(message.id);
        if (waiter) {
          pending.delete(message.id);
          if (message.error) waiter.reject(new Error(redact(message.error.message ?? "Codex request failed")));
          else waiter.resolve(message.result);
        }
        return;
      }

      if (message.method === "thread/started") {
        result.events.push({ type: "session.started" });
        if (result.resolvedModel) result.events.push({ type: "model.resolved", ...result.resolvedModel });
      } else if (message.method === "item/agentMessage/delta") {
        const text = redact(message.params?.delta ?? "");
        result.outputText += text;
        result.events.push({ type: "content.delta", text });
      } else if (message.method === "item/tool/call" && message.id !== undefined) {
        const params = message.params ?? {};
        result.events.push({ type: "tool.requested", id: params.callId, name: params.tool, input: params.arguments });
        write({ id: message.id, result: { success: false, contentItems: [{ type: "inputText", text: "Execution is controlled by Verchestra; await a controller-authorized tool result." }] } });
      } else if ((message.method === "item/commandExecution/requestApproval" || message.method === "item/fileChange/requestApproval") && message.id !== undefined) {
        result.events.push({ type: "warning", code: "VES_CODEX_BUILTIN_TOOL_DENIED", message: "Codex built-in effect was denied by the read-only Driver" });
        write({ id: message.id, result: { decision: "decline" } });
      } else if (message.method === "error") {
        result.error = { code: "VES_CODEX_EXECUTION_FAILED", message: redact(message.params?.error?.message ?? message.params?.message ?? "Codex failed") };
      } else if (message.method === "turn/completed") {
        const usage = message.params?.usage ?? message.params?.turn?.usage ?? {};
        result.usage = { inputTokens: Number(usage.inputTokens ?? 0), outputTokens: Number(usage.outputTokens ?? 0) };
        const status = message.params?.turn?.status;
        if (status === "failed") {
          result.stopReason = "error";
          result.error ??= { code: "VES_CODEX_EXECUTION_FAILED", message: redact(message.params?.turn?.error?.message ?? "Codex turn failed") };
        } else {
          result.stopReason = "stop";
        }
        result.events.push({ type: "session.closed" });
        finishRun();
      }
    });

    const closed = new Promise((resolve) => child.once("close", (code, exitSignal) => {
      for (const waiter of pending.values()) waiter.reject(new Error(`Codex app-server exited with ${code ?? exitSignal}`));
      pending.clear();
      finishRun();
      resolve({ code, signal: exitSignal });
    }));

    const abort = () => {
      if (aborted) return;
      aborted = true;
      interrupt();
      setTimeout(() => { if (child.exitCode === null && child.signalCode === null) void this.terminateTree(child.pid); }, cancelGraceMs).unref();
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });

    try {
      await request("initialize", { clientInfo: { name: "verchestra", title: "Verchestra", version: "1.0.0" }, capabilities: { experimentalApi: true } });
      notify("initialized");
      const catalog = await request("model/list", {});
      const selected = model ? catalog.data?.find((entry) => entry.model === model || entry.id === model) : catalog.data?.find((entry) => entry.isDefault);
      if (!selected) throw new Error(model ? `requested model is not in Codex catalog: ${model}` : "Codex catalog has no default model");
      result.resolvedModel = { provider: "openai", model: selected.model };
      const thread = await request("thread/start", this.buildThreadParams({ model: selected.model, tools }));
      threadId = thread.thread?.id;
      const turn = await request("turn/start", { threadId, input: [{ type: "text", text: prompt }] });
      turnId = turn.turn?.id;
      interrupt();
      await finished;
    } catch (error) {
      if (!aborted && !streamError) {
        result.error = { code: "VES_CODEX_PROTOCOL_FAILED", message: redact(errorMessage(error, "Codex protocol failed")) };
      }
    }

    if (!child.killed && child.exitCode === null && child.signalCode === null) child.kill();
    const exit = await closed;
    signal?.removeEventListener("abort", abort);
    result.safeStderr = redact(stderr.trim());

    if (aborted) return { ...result, stopReason: "aborted", error: { code: "VES_CODEX_ABORTED", message: "aborted by controller" } };
    if (streamError) return { ...result, stopReason: "error", error: streamError };
    if (exit.code !== 0 && !result.error) return { ...result, stopReason: "error", error: { code: "VES_CODEX_PROCESS_FAILED", message: `Codex app-server exited with ${exit.code ?? exit.signal}` } };
    if (!result.events.some((event) => event.type === "session.closed")) return { ...result, stopReason: "error", error: { code: "VES_CODEX_STREAM_INCOMPLETE", message: "Codex stream ended without turn/completed" } };
    return result;
  }
}
