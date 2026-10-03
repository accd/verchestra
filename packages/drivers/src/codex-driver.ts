import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { usageUpdated } from "@verchestra/domain";

import {
  codexProcessEnvironment,
  snapshotCodexProcessContext,
  type CodexProcessContext
} from "./codex-process-context.ts";
import { processTreeTerminator, type ProcessTreeTerminator } from "./driver-process-tree.ts";
import { sensitiveValueRedactor } from "./driver-redaction.ts";
import { DriverSessionLedger, type DriverSession } from "./driver-session-ledger.ts";
import { probeDriverVersion } from "./driver-version-probe.ts";
import {
  DriverProtocolError,
  validateDriverStartRequest,
  type Driver,
  type DriverEvent,
  type DriverSessionRef,
  type DriverStartRequest
} from "./index.ts";
import {
  runProviderChild,
  type ProviderChannel,
  type ProviderChildResources,
  type ProviderProtocol
} from "./provider-child-run.ts";

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
  readonly processContext?: CodexProcessContext;
  readonly terminateTree?: ProcessTreeTerminator;
  readonly onSpawn?: (pid: number) => void;
  readonly onMessageSent?: (message: Readonly<Record<string, unknown>>) => void;
}

function codexError(code: string, message: string): DriverProtocolError {
  return new DriverProtocolError(code, message);
}

// invariant: a version starts a digit run, so the match is tried once per run
// and a long run of digits costs linear time.
const VERSION_PATTERN = /(?:^|\D)(\d+)\.(\d+)\.(\d+)/u;
// invariant: the probe refusals are VES_CODEX_NOT_AVAILABLE and
// VES_CODEX_VERSION_UNSUPPORTED.
const PROBE_PROFILE = Object.freeze({
  identity: Object.freeze({ driverId: "codex" }),
  errorCodePrefix: "VES_CODEX",
  noun: "Codex",
  capabilities: Object.freeze([
    "app-server-jsonl",
    "ephemeral-threads",
    "model-discovery",
    "protocol-interrupt",
    "dynamic-tools",
    "read-only"
  ])
});
// invariant: the child run reports VES_CODEX_ABORTED, VES_CODEX_OUTPUT_LIMIT,
// VES_CODEX_STREAM_INVALID, VES_CODEX_STDIN_FAILED, VES_CODEX_PROTOCOL_FAILED,
// VES_CODEX_STREAM_INCOMPLETE and VES_CODEX_PROCESS_FAILED.
// why: the App Server keeps serving after a completed turn, so the driver ends
// it, and the exit status that follows is the driver's own doing (AD-054).
const CHILD_PROFILE = Object.freeze({
  errorCodePrefix: "VES_CODEX",
  noun: "Codex",
  streamName: "protocol",
  afterResult: "ended-by-the-driver"
} as const);

interface CodexConversation {
  readonly request: DriverStartRequest;
  readonly execution: CodexExecution;
  readonly session: DriverSession<ProviderChildResources>;
  readonly sessionId: string;
  readonly redact: (value: unknown) => string;
  readonly threadParams: () => Readonly<Record<string, unknown>>;
  readonly onMessageSent: ((message: Readonly<Record<string, unknown>>) => void) | undefined;
}

// invariant: the App Server translation of one ephemeral turn: the JSON-RPC
// handshake, the model check, one thread and one turn, the dynamic tools and
// approvals it is asked about, and the interrupt a stop sends.
function codexProtocol(channel: ProviderChannel, conversation: CodexConversation): ProviderProtocol {
  const { request, execution, session: state, sessionId, redact } = conversation;
  let nextId = 1;
  let threadId: string | undefined;
  let turnId: string | undefined;
  let interruptSent = false;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

  const write = (message: Readonly<Record<string, unknown>>) => {
    conversation.onMessageSent?.(structuredClone(message));
    channel.write(JSON.stringify(message));
  };
  const notify = (method: string, params: Readonly<Record<string, unknown>> = {}) => write({ method, params });
  const rpc = (method: string, params: Readonly<Record<string, unknown>> = {}) => {
    const id = nextId++;
    write({ method, id, params });
    return new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const interrupt = () => {
    if (!channel.stopped() || threadId === undefined || turnId === undefined || interruptSent || channel.ending())
      return;
    interruptSent = true;
    void rpc("turn/interrupt", { threadId, turnId }).catch(() => undefined);
  };
  const receive = (message: Readonly<Record<string, unknown>>): void => {
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
      state.emit({ type: "session.started", sessionId });
      state.emit({
        type: "model.resolved",
        passportRef: request.passportRef,
        provider: "openai",
        resolvedModel: execution.model
      });
    } else if (method === "item/agentMessage/delta") {
      state.emit({ type: "content.delta", text: redact(params["delta"] ?? "") });
    } else if (method === "item/tool/call" && typeof message["id"] === "number") {
      if (typeof params["callId"] !== "string" || typeof params["tool"] !== "string")
        return channel.fail("VES_CODEX_STREAM_INVALID");
      if (!execution.tools.some((tool) => tool.name === params["tool"]))
        return channel.fail("VES_CODEX_TOOL_UNDECLARED");
      state.emit({
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
      state.emit({
        type: "warning",
        code: "VES_CODEX_BUILTIN_TOOL_DENIED",
        message: "Codex built-in effect was denied"
      });
      write({ id: message["id"], result: { decision: "decline" } });
    } else if (method === "error") {
      state.outcome = "failed";
      state.emit({
        type: "error",
        code: "VES_CODEX_EXECUTION_FAILED",
        message: "Codex failed",
        retryable: true
      });
    } else if (method === "turn/completed") {
      const turn = (params["turn"] ?? {}) as Record<string, unknown>;
      const reported = (params["usage"] ?? turn["usage"] ?? {}) as Readonly<Record<string, unknown>>;
      const usage = usageUpdated({ inputTokens: reported["inputTokens"], outputTokens: reported["outputTokens"] });
      if (usage === undefined) return channel.fail("VES_CODEX_STREAM_INVALID");
      state.emit(usage);
      if (turn["status"] === "failed" && state.outcome !== "failed") {
        state.outcome = "failed";
        state.emit({
          type: "error",
          code: "VES_CODEX_EXECUTION_FAILED",
          message: "Codex failed",
          retryable: true
        });
      }
      channel.result();
    }
  };
  const converse = async () => {
    await rpc("initialize", {
      clientInfo: { name: "verchestra", title: "Verchestra", version: "1.0.0" },
      capabilities: { experimentalApi: true }
    });
    notify("initialized");
    const catalog = (await rpc("model/list")) as { data?: readonly { id?: string; model?: string }[] };
    const selected = catalog.data?.find((entry) => entry.model === execution.model || entry.id === execution.model);
    if (selected?.model !== execution.model)
      throw codexError("VES_CODEX_IDENTITY_MISMATCH", "Codex model is unavailable");
    const thread = (await rpc("thread/start", conversation.threadParams())) as { thread?: { id?: string } };
    threadId = thread.thread?.id;
    if (typeof threadId !== "string") throw codexError("VES_CODEX_PROTOCOL_FAILED", "Codex thread identity is invalid");
    const turn = (await rpc("turn/start", { threadId, input: [{ type: "text", text: execution.prompt }] })) as {
      turn?: { id?: string };
    };
    turnId = turn.turn?.id;
    if (typeof turnId !== "string") throw codexError("VES_CODEX_PROTOCOL_FAILED", "Codex turn identity is invalid");
    interrupt();
  };
  const closed = () => {
    for (const waiter of pending.values()) waiter.reject(codexError("VES_CODEX_PROCESS_FAILED", "Codex process ended"));
    pending.clear();
  };
  return { receive, converse, interrupt, closed };
}

export class CodexDriver implements Driver {
  readonly #dependencies: CodexDriverDependencies;
  readonly #command: readonly string[];
  readonly #minimumVersion: string;
  readonly #processContext: CodexProcessContext | undefined;
  readonly #terminateTree: ProcessTreeTerminator;
  readonly #sessions = new DriverSessionLedger<ProviderChildResources>({
    noun: "Codex",
    stop: ({ resources }) => resources.stop?.()
  });

  constructor(dependencies: CodexDriverDependencies) {
    this.#dependencies = dependencies;
    this.#command = Object.freeze([...(dependencies.command ?? ["codex"])]);
    this.#minimumVersion = dependencies.minimumVersion ?? "0.115.0";
    this.#terminateTree = processTreeTerminator(dependencies.terminateTree);
    this.#processContext =
      dependencies.processContext === undefined
        ? undefined
        : snapshotCodexProcessContext(dependencies.processContext, this.#command[0]);
  }

  buildEnvironment(explicit: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    if (this.#processContext === undefined) {
      for (const key of SAFE_ENV_KEYS) if (process.env[key] !== undefined) environment[key] = process.env[key];
    }
    const merged =
      this.#processContext === undefined
        ? { ...environment, ...explicit }
        : codexProcessEnvironment(this.#processContext, explicit);
    for (const key of Object.keys(merged)) {
      if (["CODEX_THREAD_ID", "CODEX_TURN_ID"].includes(key.toUpperCase())) delete merged[key];
    }
    return merged;
  }

  buildArguments(): readonly string[] {
    return Object.freeze([...this.#command.slice(1), "app-server", "--listen", "stdio://"]);
  }

  #workingDirectory(): string {
    return this.#processContext?.cwd ?? process.cwd();
  }

  buildThreadParams(execution: CodexExecution) {
    return Object.freeze({
      model: execution.model,
      cwd: this.#workingDirectory(),
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
    const requirement = { minimum: this.#minimumVersion, pattern: VERSION_PATTERN };
    return probeDriverVersion(PROBE_PROFILE, requirement, async () => {
      const { stdout } = await execFileAsync(this.#command[0] as string, [...this.#command.slice(1), "--version"], {
        encoding: "utf8",
        cwd: this.#workingDirectory(),
        env: this.buildEnvironment(this.#dependencies.probeEnvironment),
        windowsHide: true
      });
      return stdout;
    });
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
    const state = this.#sessions.open(sessionId, sink, {});
    const redact = sensitiveValueRedactor(execution.sensitiveValues ?? []);
    await runProviderChild({
      profile: CHILD_PROFILE,
      launch: {
        command: this.#command[0] as string,
        arguments: this.buildArguments(),
        cwd: this.#workingDirectory(),
        environment: this.buildEnvironment(execution.environment),
        maxOutputBytes: execution.maxOutputBytes,
        abortGraceMs: execution.cancelGraceMs ?? 250
      },
      session: state,
      signal,
      terminateTree: this.#terminateTree,
      onSpawn: this.#dependencies.onSpawn,
      protocol: (channel) =>
        codexProtocol(channel, {
          request,
          execution,
          session: state,
          sessionId,
          redact,
          threadParams: () => this.buildThreadParams(execution),
          onMessageSent: this.#dependencies.onMessageSent
        })
    });
    return Object.freeze({ sessionId });
  }

  async send(session: DriverSessionRef, input: Readonly<Record<string, unknown>>): Promise<void> {
    void session;
    void input;
    throw codexError("VES_CODEX_SEND_UNSUPPORTED", "Codex ephemeral turns do not accept follow-up input");
  }

  async cancel(session: DriverSessionRef, reason: string): Promise<void> {
    await this.#sessions.cancel(session, reason);
  }

  async close(session: DriverSessionRef) {
    return this.#sessions.close(session);
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
}
