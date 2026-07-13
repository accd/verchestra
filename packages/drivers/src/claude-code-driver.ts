import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import readline from "node:readline";
import { promisify } from "node:util";
import {
  DriverProtocolError,
  validateDriverStartRequest,
  type Driver,
  type DriverEvent,
  type DriverSessionRef,
  type DriverStartRequest
} from "./index.ts";

const execFileAsync = promisify(execFile);
const SAFE_ENV_KEYS = ["PATH", "SystemRoot", "ComSpec", "TEMP", "TMP", "HOME", "USERPROFILE"] as const;

export interface ClaudeCodeExecution {
  readonly passport: {
    readonly passportId: string;
    readonly revision: number;
    readonly provider: "anthropic";
    readonly resolvedModel: string;
  };
  readonly prompt: string;
  readonly model: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly sensitiveValues?: readonly string[];
  readonly maxOutputBytes?: number;
}

export interface ClaudeCodeDriverDependencies {
  readonly resolveExecution: (request: DriverStartRequest) => Promise<ClaudeCodeExecution>;
  readonly command?: readonly string[];
  readonly minimumVersion?: string;
  readonly probeEnvironment?: Readonly<Record<string, string>>;
  readonly terminateTree?: (pid: number) => Promise<void>;
  readonly onSpawn?: (pid: number) => void;
}

interface ClaudeSession {
  readonly sink: (event: DriverEvent) => void;
  sequence: number;
  outcome: "completed" | "failed" | "cancelled";
  closed: boolean;
  child?: ChildProcessWithoutNullStreams;
}

function claudeError(code: string, message: string): DriverProtocolError {
  return new DriverProtocolError(code, message);
}

function parseVersion(value: string): readonly [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(value.trim());
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function supported(actual: string, minimum: string): boolean {
  const left = parseVersion(actual);
  const right = parseVersion(minimum);
  if (left === undefined || right === undefined || left[0] !== right[0]) return false;
  if (left[1] !== right[1]) return left[1] > right[1];
  return left[2] >= right[2];
}

function redactor(values: readonly string[]): (text: string) => string {
  const secrets = [...new Set(values.filter((value) => value.length > 0))].sort(
    (left, right) => right.length - left.length
  );
  return (text) => secrets.reduce((safe, secret) => safe.replaceAll(secret, "[REDACTED]"), text);
}

function userMessage(prompt: string): string {
  return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } });
}

export class ClaudeCodeDriver implements Driver {
  readonly #dependencies: ClaudeCodeDriverDependencies;
  readonly #command: readonly string[];
  readonly #minimumVersion: string;
  readonly #sessions = new Map<string, ClaudeSession>();
  readonly #closedSessions = new Set<string>();

  constructor(dependencies: ClaudeCodeDriverDependencies) {
    this.#dependencies = dependencies;
    this.#command = dependencies.command ?? ["claude"];
    this.#minimumVersion = dependencies.minimumVersion ?? "2.1.168";
  }

  buildEnvironment(explicit: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    for (const key of SAFE_ENV_KEYS) if (process.env[key] !== undefined) environment[key] = process.env[key];
    const merged = { ...environment, ...explicit };
    delete merged["CLAUDE_CODE_SESSION"];
    delete merged["CLAUDE_SESSION_ID"];
    return merged;
  }

  buildArguments(model?: string): readonly string[] {
    const args = [
      ...this.#command.slice(1),
      "--print",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--strict-mcp-config",
      "--mcp-config",
      "{}",
      "--tools",
      "",
      "--permission-mode",
      "dontAsk",
      "--no-chrome",
      "--setting-sources",
      ""
    ];
    if (model !== undefined) args.push("--model", model);
    return Object.freeze(args);
  }

  async probe() {
    try {
      const { stdout } = await execFileAsync(this.#command[0] as string, [...this.#command.slice(1), "--version"], {
        encoding: "utf8",
        env: this.buildEnvironment(this.#dependencies.probeEnvironment),
        windowsHide: true
      });
      const version = parseVersion(stdout)?.join(".");
      if (version === undefined || !supported(version, this.#minimumVersion))
        return Object.freeze({
          driverId: "claude-code",
          available: false,
          version,
          error: Object.freeze({
            code: "VES_CLAUDE_VERSION_UNSUPPORTED",
            message: "Claude Code version is unsupported"
          })
        });
      return Object.freeze({
        driverId: "claude-code",
        available: true,
        version,
        capabilities: Object.freeze(["stream", "tools", "usage", "abort", "no-session-persistence"])
      });
    } catch {
      return Object.freeze({
        driverId: "claude-code",
        available: false,
        error: Object.freeze({ code: "VES_CLAUDE_NOT_AVAILABLE", message: "Claude Code is unavailable" })
      });
    }
  }

  async start(
    request: DriverStartRequest,
    sink: (event: DriverEvent) => void,
    signal: AbortSignal
  ): Promise<DriverSessionRef> {
    if (signal.aborted) throw claudeError("VES_DRIVER_CANCELLED", "Claude Code start was cancelled");
    validateDriverStartRequest(request);
    const probe = await this.probe();
    if (!probe.available) throw claudeError(probe.error.code, probe.error.message);
    let execution: ClaudeCodeExecution;
    try {
      execution = await this.#dependencies.resolveExecution(request);
    } catch {
      throw claudeError("VES_CLAUDE_RESOLUTION_FAILED", "Claude Code execution resolution failed");
    }
    if (
      execution.passport.passportId !== request.passportRef.passportId ||
      execution.passport.revision !== request.passportRef.revision ||
      execution.passport.provider !== "anthropic" ||
      execution.passport.resolvedModel !== execution.model
    )
      throw claudeError("VES_CLAUDE_IDENTITY_MISMATCH", "Claude Code identity does not match the selected Passport");
    if (typeof execution.prompt !== "string" || execution.prompt.length === 0)
      throw claudeError("VES_CLAUDE_CONTEXT_INVALID", "Claude Code serialized context is invalid");
    if (
      execution.maxOutputBytes !== undefined &&
      (!Number.isSafeInteger(execution.maxOutputBytes) || execution.maxOutputBytes < 1)
    )
      throw claudeError("VES_CLAUDE_OUTPUT_LIMIT_INVALID", "Claude Code output limit is invalid");

    const sessionId = `claude-session:${randomUUID()}`;
    const state: ClaudeSession = { sink, sequence: 0, outcome: "completed", closed: false };
    this.#sessions.set(sessionId, state);
    const redact = redactor(execution.sensitiveValues ?? []);
    const child = spawn(this.#command[0] as string, [...this.buildArguments(execution.model)], {
      cwd: process.cwd(),
      env: this.buildEnvironment(execution.environment),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    state.child = child;
    if (child.pid !== undefined) this.#dependencies.onSpawn?.(child.pid);
    let outputBytes = 0;
    const maximum = execution.maxOutputBytes ?? 1_048_576;
    let streamFailure: string | undefined;
    let initialized = false;
    let resultSeen = false;
    let aborted = false;
    const terminate = async () => {
      aborted = true;
      if (child.pid !== undefined)
        await (this.#dependencies.terminateTree ?? (async (pid) => process.kill(pid)))(child.pid);
    };
    signal.addEventListener("abort", terminate, { once: true });
    child.stderr.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maximum) {
        streamFailure = "VES_CLAUDE_OUTPUT_LIMIT";
        void terminate();
      }
    });
    child.stdin.on("error", () => {
      if (!aborted) streamFailure = "VES_CLAUDE_STDIN_FAILED";
    });
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      outputBytes += Buffer.byteLength(line) + 1;
      if (outputBytes > maximum) {
        streamFailure = "VES_CLAUDE_OUTPUT_LIMIT";
        void terminate();
        return;
      }
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        streamFailure = "VES_CLAUDE_STREAM_INVALID";
        void terminate();
        return;
      }
      if (event["type"] === "system" && event["subtype"] === "init") {
        const model = event["model"];
        if (typeof model !== "string" || model !== execution.model) {
          streamFailure = "VES_CLAUDE_IDENTITY_MISMATCH";
          void terminate();
          return;
        }
        initialized = true;
        this.#emit(state, { type: "session.started", sessionId });
        this.#emit(state, {
          type: "model.resolved",
          passportRef: request.passportRef,
          provider: "anthropic",
          resolvedModel: model
        });
      } else if (event["type"] === "stream_event") {
        const nested = event["event"] as { delta?: { type?: string; text?: unknown } } | undefined;
        if (nested?.delta?.type === "text_delta")
          this.#emit(state, { type: "content.delta", text: redact(String(nested.delta.text ?? "")) });
      } else if (event["type"] === "assistant") {
        const message = event["message"] as { content?: unknown[] } | undefined;
        for (const raw of message?.content ?? []) {
          const content = raw as Record<string, unknown>;
          if (content["type"] === "tool_use") {
            if (typeof content["id"] !== "string" || typeof content["name"] !== "string") {
              streamFailure = "VES_CLAUDE_STREAM_INVALID";
              void terminate();
              return;
            }
            this.#emit(state, {
              type: "tool.requested",
              toolCallId: content["id"],
              name: content["name"],
              input: content["input"]
            });
          }
        }
      } else if (event["type"] === "result") {
        resultSeen = true;
        const usage = event["usage"] as Record<string, unknown> | undefined;
        const inputTokens = Number(usage?.["input_tokens"] ?? 0);
        const outputTokens = Number(usage?.["output_tokens"] ?? 0);
        if (
          !Number.isSafeInteger(inputTokens) ||
          inputTokens < 0 ||
          !Number.isSafeInteger(outputTokens) ||
          outputTokens < 0
        ) {
          streamFailure = "VES_CLAUDE_STREAM_INVALID";
          void terminate();
          return;
        }
        this.#emit(state, {
          type: "usage.updated",
          inputTokens,
          outputTokens
        });
        if (event["is_error"] === true) {
          state.outcome = "failed";
          this.#emit(state, {
            type: "error",
            code: "VES_CLAUDE_EXECUTION_FAILED",
            message: "Claude Code failed",
            retryable: true
          });
        }
      }
    });
    child.stdin.end(`${userMessage(execution.prompt)}\n`);
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.once("close", (code, exitSignal) => resolve({ code, signal: exitSignal }))
    );
    signal.removeEventListener("abort", terminate);
    lines.close();
    if (aborted && streamFailure === undefined) {
      state.outcome = "cancelled";
      this.#emit(state, {
        type: "error",
        code: "VES_CLAUDE_ABORTED",
        message: "Claude Code was aborted",
        retryable: true
      });
    } else if (streamFailure !== undefined) {
      state.outcome = "failed";
      this.#emit(state, { type: "error", code: streamFailure, message: "Claude Code stream failed", retryable: false });
    } else if (!initialized || !resultSeen || exit.code !== 0) {
      state.outcome = "failed";
      this.#emit(state, {
        type: "error",
        code: !resultSeen ? "VES_CLAUDE_STREAM_INCOMPLETE" : "VES_CLAUDE_PROCESS_FAILED",
        message: "Claude Code process failed",
        retryable: false
      });
    }
    delete state.child;
    return Object.freeze({ sessionId });
  }

  async send(session: DriverSessionRef, input: Readonly<Record<string, unknown>>): Promise<void> {
    void session;
    void input;
    throw claudeError("VES_CLAUDE_SEND_UNSUPPORTED", "Claude Code print sessions do not accept follow-up input");
  }

  async cancel(session: DriverSessionRef, reason: string): Promise<void> {
    if (this.#closedSessions.has(session.sessionId)) return;
    const state = this.#known(session);
    if (state.closed) return;
    if (state.child?.pid !== undefined)
      await (this.#dependencies.terminateTree ?? (async (pid) => process.kill(pid)))(state.child.pid);
    state.outcome = "cancelled";
    this.#terminal(state, reason);
  }

  async close(session: DriverSessionRef) {
    if (this.#closedSessions.has(session.sessionId))
      return Object.freeze({ sessionId: session.sessionId, closed: true, alreadyClosed: true });
    const state = this.#known(session);
    this.#terminal(state);
    this.#sessions.delete(session.sessionId);
    this.#closedSessions.add(session.sessionId);
    return Object.freeze({
      sessionId: session.sessionId,
      closed: true,
      outcome: state.outcome,
      finalSequence: state.sequence
    });
  }

  #emit(state: ClaudeSession, event: Readonly<Record<string, unknown>>): void {
    state.sink(Object.freeze({ ...event, sequence: state.sequence }) as DriverEvent);
    state.sequence += 1;
  }

  #terminal(state: ClaudeSession, reason?: string): void {
    if (state.closed) return;
    this.#emit(state, { type: "session.closed", outcome: state.outcome, ...(reason === undefined ? {} : { reason }) });
    state.closed = true;
  }

  #known(session: DriverSessionRef): ClaudeSession {
    const state = this.#sessions.get(session.sessionId);
    if (state === undefined) throw claudeError("VES_DRIVER_SESSION_UNKNOWN", "Claude Code session is unknown");
    return state;
  }
}
