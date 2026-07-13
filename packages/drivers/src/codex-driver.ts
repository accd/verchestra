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
const SAFE_ENV_KEYS = ["PATH", "SystemRoot", "ComSpec", "TEMP", "TMP", "HOME", "USERPROFILE", "CODEX_HOME"] as const;

export interface CodexExecution {
  readonly passport: {
    readonly passportId: string;
    readonly revision: number;
    readonly provider: "openai";
    readonly resolvedModel: string;
  };
  readonly prompt: string;
  readonly model: string;
  readonly tools: readonly {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: Readonly<Record<string, unknown>>;
    readonly inputSchemaDigest: string;
  }[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly sensitiveValues?: readonly string[];
  readonly maxOutputBytes?: number;
  readonly cancelGraceMs?: number;
}

export interface CodexDriverDependencies {
  readonly resolveExecution: (request: DriverStartRequest) => Promise<CodexExecution>;
  readonly command?: readonly string[];
  readonly minimumVersion?: string;
  readonly probeEnvironment?: Readonly<Record<string, string>>;
  readonly terminateTree?: (pid: number) => Promise<void>;
  readonly onSpawn?: (pid: number) => void;
  readonly onMessageSent?: (message: Readonly<Record<string, unknown>>) => void;
}

interface CodexSession {
  readonly sink: (event: DriverEvent) => void;
  sequence: number;
  outcome: "completed" | "failed" | "cancelled";
  closed: boolean;
  child?: ChildProcessWithoutNullStreams;
}

function codexError(code: string, message: string): DriverProtocolError {
  return new DriverProtocolError(code, message);
}

function parseVersion(value: string): readonly [number, number, number] | undefined {
  const match = /(?:codex-cli\s+)?(\d+)\.(\d+)\.(\d+)/u.exec(value.trim());
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function supported(actual: string, minimum: string): boolean {
  const left = parseVersion(actual);
  const right = parseVersion(minimum);
  if (left === undefined || right === undefined || left[0] !== right[0]) return false;
  if (left[1] !== right[1]) return left[1] > right[1];
  return left[2] >= right[2];
}

function redactor(values: readonly string[]): (text: unknown) => string {
  const secrets = [...new Set(values.filter((value) => value.length > 0))].sort(
    (left, right) => right.length - left.length
  );
  return (text) => secrets.reduce((safe, secret) => safe.replaceAll(secret, "[REDACTED]"), String(text));
}

export class CodexDriver implements Driver {
  readonly #dependencies: CodexDriverDependencies;
  readonly #command: readonly string[];
  readonly #minimumVersion: string;
  readonly #sessions = new Map<string, CodexSession>();
  readonly #closedSessions = new Set<string>();

  constructor(dependencies: CodexDriverDependencies) {
    this.#dependencies = dependencies;
    this.#command = dependencies.command ?? ["codex"];
    this.#minimumVersion = dependencies.minimumVersion ?? "0.115.0";
  }

  buildEnvironment(explicit: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    for (const key of SAFE_ENV_KEYS) if (process.env[key] !== undefined) environment[key] = process.env[key];
    const merged = { ...environment, ...explicit };
    delete merged["CODEX_THREAD_ID"];
    delete merged["CODEX_TURN_ID"];
    return merged;
  }

  buildArguments(): readonly string[] {
    return Object.freeze([...this.#command.slice(1), "app-server", "--listen", "stdio://"]);
  }

  buildThreadParams(execution: CodexExecution) {
    return Object.freeze({
      model: execution.model,
      cwd: process.cwd(),
      ephemeral: true,
      sandbox: "read-only",
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      dynamicTools: execution.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      baseInstructions:
        "Operate read-only. Use only supplied dynamic tools for external effects. Never request writes, sandbox escape, network escalation, or persistent approval."
    });
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
          driverId: "codex",
          available: false,
          version,
          error: Object.freeze({ code: "VES_CODEX_VERSION_UNSUPPORTED", message: "Codex version is unsupported" })
        });
      return Object.freeze({
        driverId: "codex",
        available: true,
        version,
        capabilities: Object.freeze([
          "app-server-jsonl",
          "ephemeral-threads",
          "model-discovery",
          "protocol-interrupt",
          "dynamic-tools",
          "read-only"
        ])
      });
    } catch {
      return Object.freeze({
        driverId: "codex",
        available: false,
        error: Object.freeze({ code: "VES_CODEX_NOT_AVAILABLE", message: "Codex is unavailable" })
      });
    }
  }

  async start(
    request: DriverStartRequest,
    sink: (event: DriverEvent) => void,
    signal: AbortSignal
  ): Promise<DriverSessionRef> {
    if (signal.aborted) throw codexError("VES_DRIVER_CANCELLED", "Codex start was cancelled");
    validateDriverStartRequest(request);
    const probe = await this.probe();
    if (!probe.available) throw codexError(probe.error.code, probe.error.message);
    let execution: CodexExecution;
    try {
      execution = await this.#dependencies.resolveExecution(request);
    } catch {
      throw codexError("VES_CODEX_RESOLUTION_FAILED", "Codex execution resolution failed");
    }
    this.#validateExecution(request, execution);

    const sessionId = `codex-session:${randomUUID()}`;
    const state: CodexSession = { sink, sequence: 0, outcome: "completed", closed: false };
    this.#sessions.set(sessionId, state);
    const redact = redactor(execution.sensitiveValues ?? []);
    const child = spawn(this.#command[0] as string, [...this.buildArguments()], {
      cwd: process.cwd(),
      env: this.buildEnvironment(execution.environment),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    state.child = child;
    if (child.pid !== undefined) this.#dependencies.onSpawn?.(child.pid);

    let nextId = 1;
    let outputBytes = 0;
    const maximum = execution.maxOutputBytes ?? 1_048_576;
    const grace = execution.cancelGraceMs ?? 250;
    let streamFailure: string | undefined;
    let aborted = false;
    let threadId: string | undefined;
    let turnId: string | undefined;
    let interruptSent = false;
    let resultSeen = false;
    const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
    let finishRun!: () => void;
    const finished = new Promise<void>((resolve) => (finishRun = resolve));

    const write = (message: Readonly<Record<string, unknown>>) => {
      this.#dependencies.onMessageSent?.(structuredClone(message));
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const notify = (method: string, params: Readonly<Record<string, unknown>> = {}) => write({ method, params });
    const rpc = (method: string, params: Readonly<Record<string, unknown>> = {}) => {
      const id = nextId++;
      write({ method, id, params });
      return new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }));
    };
    const fail = (code: string) => {
      if (streamFailure !== undefined) return;
      streamFailure = code;
      finishRun();
      child.kill();
    };
    const interrupt = () => {
      if (!aborted || threadId === undefined || turnId === undefined || interruptSent || child.killed) return;
      interruptSent = true;
      void rpc("turn/interrupt", { threadId, turnId }).catch(() => undefined);
    };
    child.stderr.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maximum) fail("VES_CODEX_OUTPUT_LIMIT");
    });
    child.stdin.on("error", () => {
      if (!aborted) fail("VES_CODEX_STDIN_FAILED");
    });
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      outputBytes += Buffer.byteLength(line) + 1;
      if (outputBytes > maximum) return fail("VES_CODEX_OUTPUT_LIMIT");
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return fail("VES_CODEX_STREAM_INVALID");
      }
      if (typeof message["id"] === "number" && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
        const waiter = pending.get(message["id"]);
        if (waiter !== undefined) {
          pending.delete(message["id"]);
          if (message["error"] !== undefined) waiter.reject(codexError("VES_CODEX_RPC_FAILED", "Codex request failed"));
          else waiter.resolve(message["result"]);
        }
        return;
      }
      const method = message["method"];
      const params = (message["params"] ?? {}) as Record<string, unknown>;
      if (method === "thread/started") {
        this.#emit(state, { type: "session.started", sessionId });
        this.#emit(state, {
          type: "model.resolved",
          passportRef: request.passportRef,
          provider: "openai",
          resolvedModel: execution.model
        });
      } else if (method === "item/agentMessage/delta") {
        this.#emit(state, { type: "content.delta", text: redact(params["delta"] ?? "") });
      } else if (method === "item/tool/call" && typeof message["id"] === "number") {
        if (typeof params["callId"] !== "string" || typeof params["tool"] !== "string")
          return fail("VES_CODEX_STREAM_INVALID");
        if (!execution.tools.some((tool) => tool.name === params["tool"])) return fail("VES_CODEX_TOOL_UNDECLARED");
        this.#emit(state, {
          type: "tool.requested",
          toolCallId: params["callId"],
          name: params["tool"],
          input: params["arguments"]
        });
        write({
          id: message["id"],
          result: {
            success: false,
            contentItems: [{ type: "inputText", text: "Execution is controlled by Verchestra." }]
          }
        });
      } else if (
        (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") &&
        typeof message["id"] === "number"
      ) {
        this.#emit(state, {
          type: "warning",
          code: "VES_CODEX_BUILTIN_TOOL_DENIED",
          message: "Codex built-in effect was denied"
        });
        write({ id: message["id"], result: { decision: "decline" } });
      } else if (method === "error") {
        state.outcome = "failed";
        this.#emit(state, {
          type: "error",
          code: "VES_CODEX_EXECUTION_FAILED",
          message: "Codex failed",
          retryable: true
        });
      } else if (method === "turn/completed") {
        resultSeen = true;
        const turn = (params["turn"] ?? {}) as Record<string, unknown>;
        const usage = (params["usage"] ?? turn["usage"] ?? {}) as Record<string, unknown>;
        const inputTokens = Number(usage["inputTokens"] ?? 0);
        const outputTokens = Number(usage["outputTokens"] ?? 0);
        if (
          !Number.isSafeInteger(inputTokens) ||
          inputTokens < 0 ||
          !Number.isSafeInteger(outputTokens) ||
          outputTokens < 0
        )
          return fail("VES_CODEX_STREAM_INVALID");
        this.#emit(state, { type: "usage.updated", inputTokens, outputTokens });
        if (turn["status"] === "failed" && state.outcome !== "failed") {
          state.outcome = "failed";
          this.#emit(state, {
            type: "error",
            code: "VES_CODEX_EXECUTION_FAILED",
            message: "Codex failed",
            retryable: true
          });
        }
        finishRun();
      }
    });
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.once("close", (code, exitSignal) => {
        for (const waiter of pending.values())
          waiter.reject(codexError("VES_CODEX_PROCESS_FAILED", "Codex process ended"));
        pending.clear();
        finishRun();
        resolve({ code, signal: exitSignal });
      })
    );
    const abort = () => {
      if (aborted) return;
      aborted = true;
      interrupt();
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null && child.pid !== undefined)
          void (this.#dependencies.terminateTree ?? (async (pid) => process.kill(pid)))(child.pid);
      }, grace);
      timer.unref();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      await rpc("initialize", {
        clientInfo: { name: "verchestra", title: "Verchestra", version: "1.0.0" },
        capabilities: { experimentalApi: true }
      });
      notify("initialized");
      const catalog = (await rpc("model/list")) as { data?: readonly { id?: string; model?: string }[] };
      const selected = catalog.data?.find((entry) => entry.model === execution.model || entry.id === execution.model);
      if (selected?.model !== execution.model)
        throw codexError("VES_CODEX_IDENTITY_MISMATCH", "Codex model is unavailable");
      const thread = (await rpc("thread/start", this.buildThreadParams(execution))) as { thread?: { id?: string } };
      threadId = thread.thread?.id;
      if (typeof threadId !== "string")
        throw codexError("VES_CODEX_PROTOCOL_FAILED", "Codex thread identity is invalid");
      const turn = (await rpc("turn/start", { threadId, input: [{ type: "text", text: execution.prompt }] })) as {
        turn?: { id?: string };
      };
      turnId = turn.turn?.id;
      if (typeof turnId !== "string") throw codexError("VES_CODEX_PROTOCOL_FAILED", "Codex turn identity is invalid");
      interrupt();
      await finished;
    } catch {
      if (!aborted && streamFailure === undefined) streamFailure = "VES_CODEX_PROTOCOL_FAILED";
    }
    if (!child.killed && child.exitCode === null && child.signalCode === null) child.kill();
    const exit = await closed;
    signal.removeEventListener("abort", abort);
    lines.close();
    if (aborted) {
      state.outcome = "cancelled";
      this.#emit(state, { type: "error", code: "VES_CODEX_ABORTED", message: "Codex was aborted", retryable: true });
    } else if (streamFailure !== undefined) {
      state.outcome = "failed";
      this.#emit(state, { type: "error", code: streamFailure, message: "Codex protocol failed", retryable: false });
    } else if (!resultSeen) {
      state.outcome = "failed";
      this.#emit(state, {
        type: "error",
        code: exit.code !== 0 || exit.signal !== null ? "VES_CODEX_PROCESS_FAILED" : "VES_CODEX_STREAM_INCOMPLETE",
        message: "Codex process failed",
        retryable: false
      });
    }
    delete state.child;
    return Object.freeze({ sessionId });
  }

  async send(session: DriverSessionRef, input: Readonly<Record<string, unknown>>): Promise<void> {
    void session;
    void input;
    throw codexError("VES_CODEX_SEND_UNSUPPORTED", "Codex ephemeral turns do not accept follow-up input");
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

  #validateExecution(request: DriverStartRequest, execution: CodexExecution): void {
    if (
      execution.passport.passportId !== request.passportRef.passportId ||
      execution.passport.revision !== request.passportRef.revision ||
      execution.passport.provider !== "openai" ||
      execution.passport.resolvedModel !== execution.model
    )
      throw codexError("VES_CODEX_IDENTITY_MISMATCH", "Codex identity does not match the selected Passport");
    if (typeof execution.prompt !== "string" || execution.prompt.length === 0)
      throw codexError("VES_CODEX_CONTEXT_INVALID", "Codex serialized context is invalid");
    const declared = request.tools.map((tool) => `${tool.name}:${tool.inputSchemaDigest}`).sort();
    const concrete = execution.tools.map((tool) => `${tool.name}:${tool.inputSchemaDigest}`).sort();
    if (declared.length !== concrete.length || declared.some((entry, index) => entry !== concrete[index]))
      throw codexError("VES_CODEX_TOOLSET_MISMATCH", "Codex tools do not match the authorized manifest");
    for (const value of [execution.maxOutputBytes ?? 1, execution.cancelGraceMs ?? 0])
      if (!Number.isSafeInteger(value) || value < 0)
        throw codexError("VES_CODEX_LIMIT_INVALID", "Codex execution limit is invalid");
  }

  #emit(state: CodexSession, event: Readonly<Record<string, unknown>>): void {
    state.sink(Object.freeze({ ...event, sequence: state.sequence }) as DriverEvent);
    state.sequence += 1;
  }

  #terminal(state: CodexSession, reason?: string): void {
    if (state.closed) return;
    this.#emit(state, { type: "session.closed", outcome: state.outcome, ...(reason === undefined ? {} : { reason }) });
    state.closed = true;
  }

  #known(session: DriverSessionRef): CodexSession {
    const state = this.#sessions.get(session.sessionId);
    if (state === undefined) throw codexError("VES_DRIVER_SESSION_UNKNOWN", "Codex session is unknown");
    return state;
  }
}
