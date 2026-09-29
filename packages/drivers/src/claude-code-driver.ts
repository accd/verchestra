import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
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
// The mediated profile passes only these ambient-free locale/search values
// through; identity directories are created per run and the credential comes
// from resolveExecution alone.
const MEDIATED_ENV_KEYS: readonly string[] = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR"];
const MEDIATED_CREDENTIAL = "ANTHROPIC_API_KEY";
const ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]{0,63}$/u;
// invariant: identical to MCP_BRIDGE_QUALIFIED_TOOLS in agent-runtime; a
// contract test pins the two lists together.
export const CLAUDE_MEDIATED_TOOLS: readonly string[] = Object.freeze([
  "mcp__verchestra__read_file",
  "mcp__verchestra__list_dir",
  "mcp__verchestra__search",
  "mcp__verchestra__write_file",
  "mcp__verchestra__delete_file"
]);
// The build whose `--help` was read to confirm every mediated flag
// (docs/qualification/claude-code-driver-mediated.md).
export const CLAUDE_MEDIATED_MINIMUM_VERSION = "2.1.282";

export interface ClaudeCodeMediatedProfile {
  readonly kind: "mediated-mcp";
  readonly environment?: Readonly<Record<string, string>>;
  // Parent for the per-run 0700 isolation directory; defaults to the OS temp dir.
  readonly isolationRoot?: string;
}

export interface ClaudeCodeMediation {
  // The run worktree's real path; Claude Code runs there.
  readonly cwd: string;
  readonly bridge: {
    readonly command: readonly string[];
    readonly environment: Readonly<Record<string, string>>;
  };
}

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
  // Required by, and only accepted by, the mediated-mcp profile.
  readonly mediation?: ClaudeCodeMediation;
}

export interface ClaudeCodeDriverDependencies {
  readonly resolveExecution: (request: DriverStartRequest) => Promise<ClaudeCodeExecution>;
  readonly command?: readonly string[];
  readonly minimumVersion?: string;
  readonly probeEnvironment?: Readonly<Record<string, string>>;
  readonly terminateTree?: (pid: number) => Promise<void>;
  readonly onSpawn?: (pid: number) => void;
  // Absent: the T03 profile, unchanged. Present: the qualified mediated-mcp
  // profile (AD-0XX), which requires an absolute executable.
  readonly profile?: ClaudeCodeMediatedProfile;
}

interface MediatedLaunch {
  readonly root: string;
  readonly arguments: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd: string;
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

interface NormalizedMediatedProfile {
  readonly environment: Readonly<Record<string, string>>;
  readonly isolationRoot?: string;
}

function safeValue(value: unknown): value is string {
  return typeof value === "string" && !/[\0\r\n]/u.test(value);
}

function absolutePath(value: unknown): value is string {
  return safeValue(value) && isAbsolute(value);
}

function mediationError(message: string): DriverProtocolError {
  return claudeError("VES_CLAUDE_MEDIATION_INVALID", message);
}

function allowlistedEnvironment(environment: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  for (const [key, value] of Object.entries(environment))
    if (!MEDIATED_ENV_KEYS.includes(key) || !safeValue(value))
      throw claudeError("VES_CLAUDE_ENVIRONMENT_DENIED", "The mediated profile environment is not allowlisted");
  return Object.freeze({ ...environment });
}

function mediatedProfile(profile: ClaudeCodeMediatedProfile, command: readonly string[]): NormalizedMediatedProfile {
  if (process.platform === "win32")
    throw claudeError(
      "VES_CLAUDE_MEDIATION_UNSUPPORTED",
      "The mediated Claude Code profile is not configured on Windows"
    );
  if (profile.kind !== "mediated-mcp") throw mediationError("Claude Code profile is unknown");
  if (!absolutePath(command[0]))
    throw mediationError("The mediated profile requires an absolute Claude Code executable");
  const environment = allowlistedEnvironment(profile.environment ?? {});
  if (profile.isolationRoot === undefined) return Object.freeze({ environment });
  if (!absolutePath(profile.isolationRoot)) throw mediationError("The isolation root must be absolute");
  return Object.freeze({ environment, isolationRoot: profile.isolationRoot });
}

// The only credential the mediated child sees, and it must be redactable.
function mediatedCredential(execution: ClaudeCodeExecution): string {
  const environment = execution.environment ?? {};
  const keys = Object.keys(environment);
  if (keys.some((key) => key !== MEDIATED_CREDENTIAL))
    throw claudeError("VES_CLAUDE_ENVIRONMENT_DENIED", "Only the brokered Anthropic credential may be supplied");
  const credential = environment[MEDIATED_CREDENTIAL];
  if (credential === undefined || credential.length === 0 || !safeValue(credential))
    throw claudeError("VES_CLAUDE_CREDENTIAL_MISSING", "The Anthropic credential is not configured");
  if (!(execution.sensitiveValues ?? []).includes(credential))
    throw claudeError("VES_CLAUDE_CREDENTIAL_UNREDACTED", "The Anthropic credential must be a sensitive value");
  return credential;
}

function validBridge(bridge: ClaudeCodeMediation["bridge"] | undefined): boolean {
  const command: unknown = bridge?.command;
  if (!Array.isArray(command) || !command.every(safeValue) || !absolutePath(command[0])) return false;
  const entries = Object.entries(bridge?.environment ?? {});
  return entries.length <= 16 && entries.every(([key, value]) => ENVIRONMENT_NAME.test(key) && safeValue(value));
}

async function validMediation(mediation: ClaudeCodeMediation | undefined): Promise<ClaudeCodeMediation> {
  if (mediation === undefined) throw mediationError("The mediated profile requires a mediation block");
  const directory = absolutePath(mediation.cwd) ? await stat(mediation.cwd).catch(() => undefined) : undefined;
  if (directory?.isDirectory() !== true)
    throw mediationError("The mediated working directory must be an absolute directory");
  if (!validBridge(mediation.bridge)) throw mediationError("The bridge command or environment is invalid");
  return mediation;
}

// invariant: a mediated session may advertise only the bridge tools, and the
// bridge must be connected; anything else means the tool surface is not the
// one this profile was qualified with.
function mediatedSurfaceFailure(event: Record<string, unknown>): string | undefined {
  const tools = event["tools"];
  if (!Array.isArray(tools) || tools.some((tool) => typeof tool !== "string" || !CLAUDE_MEDIATED_TOOLS.includes(tool)))
    return "VES_CLAUDE_TOOL_SURFACE_UNEXPECTED";
  const servers = event["mcp_servers"];
  const connected =
    Array.isArray(servers) &&
    servers.some(
      (server) =>
        server !== null &&
        typeof server === "object" &&
        (server as Record<string, unknown>)["name"] === "verchestra" &&
        (server as Record<string, unknown>)["status"] === "connected"
    );
  return connected ? undefined : "VES_CLAUDE_BRIDGE_UNAVAILABLE";
}

function initEventFailure(event: Record<string, unknown>, model: string, mediated: boolean): string | undefined {
  if (event["model"] !== model) return "VES_CLAUDE_IDENTITY_MISMATCH";
  return mediated ? mediatedSurfaceFailure(event) : undefined;
}

// The per-run isolation directory holds the bridge token; it is removed as
// soon as the child has exited.
async function releaseLaunch(launch: MediatedLaunch | undefined): Promise<void> {
  if (launch !== undefined) await rm(launch.root, { recursive: true, force: true, maxRetries: 3 });
}

export class ClaudeCodeDriver implements Driver {
  readonly #dependencies: ClaudeCodeDriverDependencies;
  readonly #command: readonly string[];
  readonly #minimumVersion: string;
  readonly #sessions = new Map<string, ClaudeSession>();
  readonly #closedSessions = new Set<string>();

  readonly #profile: NormalizedMediatedProfile | undefined;

  constructor(dependencies: ClaudeCodeDriverDependencies) {
    this.#dependencies = dependencies;
    this.#command = Object.freeze([...(dependencies.command ?? ["claude"])]);
    this.#profile =
      dependencies.profile === undefined ? undefined : mediatedProfile(dependencies.profile, this.#command);
    this.#minimumVersion =
      dependencies.minimumVersion ?? (this.#profile === undefined ? "2.1.168" : CLAUDE_MEDIATED_MINIMUM_VERSION);
  }

  buildEnvironment(explicit: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    for (const key of SAFE_ENV_KEYS) if (process.env[key] !== undefined) environment[key] = process.env[key];
    const merged = { ...environment, ...explicit };
    delete merged["CLAUDE_CODE_SESSION"];
    delete merged["CLAUDE_SESSION_ID"];
    return merged;
  }

  // The mediated profile: no built-in tool, only the five bridge tools, no
  // settings, no keychain or OAuth (`--bare`), and nothing that can prompt.
  buildMediatedArguments(model: string, mcpConfigPath: string): readonly string[] {
    return Object.freeze([
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
      "--bare",
      "--strict-mcp-config",
      "--mcp-config",
      mcpConfigPath,
      "--tools",
      "",
      "--allowedTools",
      CLAUDE_MEDIATED_TOOLS.join(","),
      "--permission-mode",
      "dontAsk",
      "--permission-prompts",
      "none",
      "--no-chrome",
      "--setting-sources",
      "",
      "--model",
      model
    ]);
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
        env:
          this.#profile === undefined
            ? this.buildEnvironment(this.#dependencies.probeEnvironment)
            : { ...this.#profile.environment },
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

    const launch = await this.#mediatedLaunch(execution);
    try {
      const sessionId = `claude-session:${randomUUID()}`;
      const state: ClaudeSession = { sink, sequence: 0, outcome: "completed", closed: false };
      this.#sessions.set(sessionId, state);
      const redact = redactor(execution.sensitiveValues ?? []);
      const plan = this.#spawnPlan(execution, launch);
      const child = spawn(this.#command[0] as string, [...plan.arguments], {
        cwd: plan.cwd,
        env: plan.environment,
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
          const initFailure = initEventFailure(event, execution.model, launch !== undefined);
          if (initFailure !== undefined) {
            streamFailure = initFailure;
            void terminate();
            return;
          }
          const model = execution.model;
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
        this.#emit(state, {
          type: "error",
          code: streamFailure,
          message: "Claude Code stream failed",
          retryable: false
        });
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
    } finally {
      await releaseLaunch(launch);
    }
  }

  #spawnPlan(execution: ClaudeCodeExecution, launch: MediatedLaunch | undefined): Omit<MediatedLaunch, "root"> {
    if (launch !== undefined) return launch;
    return {
      arguments: this.buildArguments(execution.model),
      cwd: process.cwd(),
      environment: this.buildEnvironment(execution.environment)
    };
  }

  async #mediatedLaunch(execution: ClaudeCodeExecution): Promise<MediatedLaunch | undefined> {
    if (this.#profile === undefined) {
      if (execution.mediation !== undefined)
        throw claudeError("VES_CLAUDE_MEDIATION_INVALID", "Mediation requires the mediated-mcp profile");
      return undefined;
    }
    const credential = mediatedCredential(execution);
    const mediation = await validMediation(execution.mediation);
    const root = await mkdtemp(join(this.#profile.isolationRoot ?? tmpdir(), "verchestra-claude-"));
    try {
      await chmod(root, 0o700);
      const home = join(root, "home");
      const config = join(root, "config");
      await mkdir(home, { mode: 0o700 });
      await mkdir(config, { mode: 0o700 });
      const mcpConfigPath = join(config, "mcp.json");
      const [bridgeCommand, ...bridgeArgs] = mediation.bridge.command;
      await writeFile(
        mcpConfigPath,
        JSON.stringify({
          mcpServers: {
            verchestra: {
              type: "stdio",
              command: bridgeCommand,
              args: bridgeArgs,
              env: { ...mediation.bridge.environment }
            }
          }
        }),
        { mode: 0o600, flag: "wx" }
      );
      return Object.freeze({
        root,
        cwd: mediation.cwd,
        arguments: this.buildMediatedArguments(execution.model, mcpConfigPath),
        environment: {
          ...this.#profile.environment,
          HOME: home,
          CLAUDE_CONFIG_DIR: config,
          DISABLE_AUTOUPDATER: "1",
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
          [MEDIATED_CREDENTIAL]: credential
        }
      });
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }
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
