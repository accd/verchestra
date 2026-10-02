import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { isAbsolute, join } from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";
import {
  OWN_PROCESS_GROUP,
  processTreeTerminator,
  singleTermination,
  unawaitedTermination,
  type ProcessTreeTerminator
} from "./driver-process-tree.ts";
import { sensitiveValueRedactor } from "./driver-redaction.ts";
import { DriverSessionLedger } from "./driver-session-ledger.ts";
import { probeDriverVersion } from "./driver-version-probe.ts";
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
const MEDIATED_ENV_KEYS: ReadonlySet<string> = new Set(["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR"]);
const SUBSCRIPTION_PROFILE = "mediated-mcp-subscription";
// invariant: each mediated profile accepts exactly one credential variable; the
// composition names it from here instead of spelling it a second time.
export const CLAUDE_PROFILE_CREDENTIAL_VARIABLES = Object.freeze({
  "mediated-mcp": "ANTHROPIC_API_KEY",
  [SUBSCRIPTION_PROFILE]: "CLAUDE_CODE_OAUTH_TOKEN"
} as const);
const CREDENTIAL_LABELS = Object.freeze({
  "mediated-mcp": "Anthropic credential",
  [SUBSCRIPTION_PROFILE]: "Claude Code subscription token"
} as const);
// why: `--bare` never reads `CLAUDE_CODE_OAUTH_TOKEN`, so the subscription
// profile reproduces its isolation with these documented switches instead:
// no CLAUDE.md or auto memory, no background work, no plugin marketplace
// registration, and no title, update, telemetry, or feature-flag request.
const SUBSCRIPTION_SWITCHES = Object.freeze({
  DISABLE_AUTOUPDATER: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
  CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: "1",
  CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1"
});
// why: `--settings` outranks every user, project, and local file, so hooks and
// auto memory stay off whatever a settings file would say. A settings value
// that fails validation is ignored whole in print mode, so only these two
// documented keys are passed.
export const CLAUDE_SUBSCRIPTION_SETTINGS = '{"disableAllHooks":true,"autoMemoryEnabled":false}';
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
  readonly kind: keyof typeof CLAUDE_PROFILE_CREDENTIAL_VARIABLES;
  readonly environment?: Readonly<Record<string, string>>;
  // Parent for the per-run 0700 isolation directory; defaults to the OS temp dir.
  readonly isolationRoot?: string;
  // why: subscription profile only. The machine-wide Claude Code policy
  // locations whose presence refuses the launch; defaults to the documented ones.
  readonly managedPolicyPaths?: readonly string[];
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
  // invariant: required by, and only accepted by, a mediated profile.
  readonly mediation?: ClaudeCodeMediation;
}

export interface ClaudeCodeDriverDependencies {
  readonly resolveExecution: (request: DriverStartRequest) => Promise<ClaudeCodeExecution>;
  readonly command?: readonly string[];
  readonly minimumVersion?: string;
  readonly probeEnvironment?: Readonly<Record<string, string>>;
  readonly terminateTree?: ProcessTreeTerminator;
  readonly onSpawn?: (pid: number) => void;
  // invariant: absent is the T03 profile, unchanged; present is a qualified
  // mediated profile (AD-039), which requires an absolute executable.
  readonly profile?: ClaudeCodeMediatedProfile;
}

type ProfileKind = ClaudeCodeMediatedProfile["kind"];
// invariant: the stream checks a session is held to. `open` is T03, `bridge`
// requires the bridge tools and a connected bridge, and `bridge-only` also
// refuses any other MCP server and any hook event.
type StreamSurface = "open" | "bridge" | "bridge-only";

interface MediatedLaunch {
  readonly root: string;
  readonly arguments: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly surface: StreamSurface;
}

interface ClaudeSessionResources {
  child?: ChildProcessWithoutNullStreams;
  stop?: () => Promise<void>;
}

function claudeError(code: string, message: string): DriverProtocolError {
  return new DriverProtocolError(code, message);
}

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)/u;
// invariant: the probe refusals are VES_CLAUDE_NOT_AVAILABLE and
// VES_CLAUDE_VERSION_UNSUPPORTED.
const PROBE_PROFILE = Object.freeze({
  identity: Object.freeze({ driverId: "claude-code" }),
  errorCodePrefix: "VES_CLAUDE",
  noun: "Claude Code",
  capabilities: Object.freeze(["stream", "tools", "usage", "abort", "no-session-persistence"])
});

function userMessage(prompt: string): string {
  return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } });
}

interface NormalizedMediatedProfile {
  readonly kind: ProfileKind;
  readonly environment: Readonly<Record<string, string>>;
  readonly isolationRoot?: string;
  readonly managedPolicyPaths: readonly string[];
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
    if (!MEDIATED_ENV_KEYS.has(key) || !safeValue(value))
      throw claudeError("VES_CLAUDE_ENVIRONMENT_DENIED", "The mediated profile environment is not allowlisted");
  return Object.freeze({ ...environment });
}

// why: managed settings outrank `--settings` and are the one source of hooks,
// instructions, and credential helpers the subscription profile cannot switch
// off, so their documented machine-wide locations are refused, never ignored.
function documentedManagedPolicyPaths(): readonly string[] {
  if (process.platform !== "darwin") return ["/etc/claude-code"];
  const preferences = "/Library/Managed Preferences";
  const domain = "com.anthropic.claudecode.plist";
  return [
    "/Library/Application Support/ClaudeCode",
    join(preferences, domain),
    join(preferences, accountName(), domain)
  ];
}

function accountName(): string {
  try {
    return userInfo().username;
  } catch {
    return "unknown-account";
  }
}

function managedPolicyPaths(profile: ClaudeCodeMediatedProfile): readonly string[] {
  if (profile.managedPolicyPaths === undefined)
    return profile.kind === SUBSCRIPTION_PROFILE ? documentedManagedPolicyPaths() : [];
  if (profile.kind !== SUBSCRIPTION_PROFILE || !profile.managedPolicyPaths.every(absolutePath))
    throw mediationError("Managed policy paths must be absolute and belong to the subscription profile");
  return [...profile.managedPolicyPaths];
}

function mediatedProfile(profile: ClaudeCodeMediatedProfile, command: readonly string[]): NormalizedMediatedProfile {
  if (process.platform === "win32")
    throw claudeError(
      "VES_CLAUDE_MEDIATION_UNSUPPORTED",
      "The mediated Claude Code profile is not configured on Windows"
    );
  if (!Object.hasOwn(CLAUDE_PROFILE_CREDENTIAL_VARIABLES, profile.kind))
    throw mediationError("Claude Code profile is unknown");
  if (!absolutePath(command[0]))
    throw mediationError("The mediated profile requires an absolute Claude Code executable");
  const kind = profile.kind;
  const environment = allowlistedEnvironment(profile.environment ?? {});
  const managed = managedPolicyPaths(profile);
  if (profile.isolationRoot === undefined) return Object.freeze({ kind, environment, managedPolicyPaths: managed });
  if (!absolutePath(profile.isolationRoot)) throw mediationError("The isolation root must be absolute");
  return Object.freeze({ kind, environment, isolationRoot: profile.isolationRoot, managedPolicyPaths: managed });
}

// The only credential the mediated child sees, and it must be redactable.
function mediatedCredential(execution: ClaudeCodeExecution, kind: ProfileKind): string {
  const variable = CLAUDE_PROFILE_CREDENTIAL_VARIABLES[kind];
  const label = CREDENTIAL_LABELS[kind];
  const environment = execution.environment ?? {};
  const keys = Object.keys(environment);
  if (keys.some((key) => key !== variable))
    throw claudeError("VES_CLAUDE_ENVIRONMENT_DENIED", `Only the brokered ${label} may be supplied`);
  const credential = environment[variable];
  if (credential === undefined || credential.length === 0 || !safeValue(credential))
    throw claudeError("VES_CLAUDE_CREDENTIAL_MISSING", `The ${label} is not configured`);
  if (!(execution.sensitiveValues ?? []).includes(credential))
    throw claudeError("VES_CLAUDE_CREDENTIAL_UNREDACTED", `The ${label} must be a sensitive value`);
  return credential;
}

// hazard: a location that exists but cannot be inspected or listed still
// counts as present; only a path that is not there at all is absent.
async function policyPresent(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return !metadata.isDirectory() || (await readdir(path)).length > 0;
  } catch (error) {
    return !["ENOENT", "ENOTDIR"].includes(String((error as { readonly code?: unknown }).code));
  }
}

async function refuseManagedPolicy(paths: readonly string[]): Promise<void> {
  for (const path of paths)
    if (await policyPresent(path))
      throw claudeError(
        "VES_CLAUDE_MANAGED_POLICY_PRESENT",
        "A machine-wide Claude Code policy is present, so the subscription profile cannot prove its isolation"
      );
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

// invariant: the subscription profile runs without `--bare`, so a second MCP
// server (a claude.ai connector, a project or plugin server) would mean
// `--strict-mcp-config` did not hold.
function extraServerFailure(event: Record<string, unknown>): string | undefined {
  return (event["mcp_servers"] as readonly unknown[]).length === 1 ? undefined : "VES_CLAUDE_TOOL_SURFACE_UNEXPECTED";
}

function initEventFailure(event: Record<string, unknown>, model: string, surface: StreamSurface): string | undefined {
  if (event["model"] !== model) return "VES_CLAUDE_IDENTITY_MISMATCH";
  if (surface === "open") return undefined;
  const failure = mediatedSurfaceFailure(event);
  return failure === undefined && surface === "bridge-only" ? extraServerFailure(event) : failure;
}

function surfaceOf(launch: MediatedLaunch | undefined): StreamSurface {
  return launch === undefined ? "open" : launch.surface;
}

function hookEvent(event: unknown): boolean {
  const row = event as { readonly type?: unknown; readonly subtype?: unknown } | null;
  return row?.type === "system" && typeof row.subtype === "string" && row.subtype.startsWith("hook_");
}

// invariant: with `--include-hook-events` every hook that runs is reported in
// the stream, and the subscription profile disables all of them; one hook
// event therefore means a managed or injected hook ran, and the session ends.
function streamEvent(line: string, surface: StreamSurface): Record<string, unknown> | string {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return "VES_CLAUDE_STREAM_INVALID";
  }
  return surface === "bridge-only" && hookEvent(event) ? "VES_CLAUDE_HOOK_UNEXPECTED" : event;
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
  readonly #terminateTree: ProcessTreeTerminator;
  readonly #sessions = new DriverSessionLedger<ClaudeSessionResources>({
    noun: "Claude Code",
    stop: ({ resources }) => resources.stop?.()
  });

  readonly #profile: NormalizedMediatedProfile | undefined;

  constructor(dependencies: ClaudeCodeDriverDependencies) {
    this.#dependencies = dependencies;
    this.#command = Object.freeze([...(dependencies.command ?? ["claude"])]);
    this.#terminateTree = processTreeTerminator(dependencies.terminateTree);
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

  // why: the subscription profile is the mediated surface without `--bare`,
  // which would discard the subscription token. Hooks and auto memory are
  // switched off by `--settings`, and a hook that still ran is reported.
  buildSubscriptionArguments(model: string, mcpConfigPath: string): readonly string[] {
    return Object.freeze([
      ...this.#command.slice(1),
      "--print",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--include-hook-events",
      "--no-session-persistence",
      "--disable-slash-commands",
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
      "--settings",
      CLAUDE_SUBSCRIPTION_SETTINGS,
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
    const requirement = { minimum: this.#minimumVersion, pattern: VERSION_PATTERN };
    return probeDriverVersion(PROBE_PROFILE, requirement, async () => {
      const { stdout } = await execFileAsync(this.#command[0] as string, [...this.#command.slice(1), "--version"], {
        encoding: "utf8",
        env:
          this.#profile === undefined
            ? this.buildEnvironment(this.#dependencies.probeEnvironment)
            : { ...this.#profile.environment },
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
    const surface = surfaceOf(launch);
    const sessionId = `claude-session:${randomUUID()}`;
    const state = this.#sessions.open(sessionId, sink, {});
    const runEnded = state.runStarted();
    try {
      const redact = sensitiveValueRedactor(execution.sensitiveValues ?? []);
      const plan = this.#spawnPlan(execution, launch);
      const child = spawn(this.#command[0] as string, [...plan.arguments], {
        cwd: plan.cwd,
        env: plan.environment,
        stdio: ["pipe", "pipe", "pipe"],
        detached: OWN_PROCESS_GROUP,
        windowsHide: true
      });
      state.resources.child = child;
      let aborted = false;
      let stopChild: (() => Promise<void>) | undefined;
      // invariant: one termination per child. A stream that keeps failing asks
      // again for every line still in the pipe, a tree terminator reads the
      // process table each time it is asked, and a cancel asks once more.
      // invariant: a cancel stops the run through this same request, so the
      // run it interrupts ends as aborted and not as a process that died.
      const terminate = async () => {
        aborted = true;
        await stopChild?.();
      };
      const endChild = unawaitedTermination(terminate);
      if (child.pid !== undefined) {
        stopChild = singleTermination(this.#terminateTree, child.pid);
        state.resources.stop = terminate;
        this.#dependencies.onSpawn?.(child.pid);
      }
      let outputBytes = 0;
      const maximum = execution.maxOutputBytes ?? 1_048_576;
      let streamFailure: string | undefined;
      let initialized = false;
      let resultSeen = false;
      signal.addEventListener("abort", terminate, { once: true });
      child.stderr.on("data", (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > maximum) {
          streamFailure = "VES_CLAUDE_OUTPUT_LIMIT";
          endChild();
        }
      });
      // invariant: a provider that no longer reads its input cannot be given
      // its prompt, so it is ended like any stream that failed.
      child.stdin.on("error", () => {
        if (aborted) return;
        streamFailure = "VES_CLAUDE_STDIN_FAILED";
        endChild();
      });
      const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      lines.on("line", (line) => {
        outputBytes += Buffer.byteLength(line) + 1;
        if (outputBytes > maximum) {
          streamFailure = "VES_CLAUDE_OUTPUT_LIMIT";
          endChild();
          return;
        }
        const event = streamEvent(line, surface);
        if (typeof event === "string") {
          streamFailure = event;
          endChild();
          return;
        }
        if (event["type"] === "system" && event["subtype"] === "init") {
          const initFailure = initEventFailure(event, execution.model, surface);
          if (initFailure !== undefined) {
            streamFailure = initFailure;
            endChild();
            return;
          }
          const model = execution.model;
          initialized = true;
          state.emit({ type: "session.started", sessionId });
          state.emit({
            type: "model.resolved",
            passportRef: request.passportRef,
            provider: "anthropic",
            resolvedModel: model
          });
        } else if (event["type"] === "stream_event") {
          const nested = event["event"] as { delta?: { type?: string; text?: unknown } } | undefined;
          if (nested?.delta?.type === "text_delta")
            state.emit({ type: "content.delta", text: redact(String(nested.delta.text ?? "")) });
        } else if (event["type"] === "assistant") {
          const message = event["message"] as { content?: unknown[] } | undefined;
          for (const raw of message?.content ?? []) {
            const content = raw as Record<string, unknown>;
            if (content["type"] === "tool_use") {
              if (typeof content["id"] !== "string" || typeof content["name"] !== "string") {
                streamFailure = "VES_CLAUDE_STREAM_INVALID";
                endChild();
                return;
              }
              state.emit({
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
            endChild();
            return;
          }
          state.emit({
            type: "usage.updated",
            inputTokens,
            outputTokens
          });
          if (event["is_error"] === true) {
            state.outcome = "failed";
            state.emit({
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
        state.emit({
          type: "error",
          code: "VES_CLAUDE_ABORTED",
          message: "Claude Code was aborted",
          retryable: true
        });
      } else if (streamFailure !== undefined) {
        state.outcome = "failed";
        state.emit({
          type: "error",
          code: streamFailure,
          message: "Claude Code stream failed",
          retryable: false
        });
      } else if (!initialized || !resultSeen || exit.code !== 0) {
        state.outcome = "failed";
        state.emit({
          type: "error",
          code: !resultSeen ? "VES_CLAUDE_STREAM_INCOMPLETE" : "VES_CLAUDE_PROCESS_FAILED",
          message: "Claude Code process failed",
          retryable: false
        });
      }
      delete state.resources.child;
      delete state.resources.stop;
      return Object.freeze({ sessionId });
    } finally {
      runEnded();
      await releaseLaunch(launch);
    }
  }

  #spawnPlan(
    execution: ClaudeCodeExecution,
    launch: MediatedLaunch | undefined
  ): Pick<MediatedLaunch, "arguments" | "cwd" | "environment"> {
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
    const credential = mediatedCredential(execution, this.#profile.kind);
    const mediation = await validMediation(execution.mediation);
    await refuseManagedPolicy(this.#profile.managedPolicyPaths);
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
      if (this.#profile.kind === SUBSCRIPTION_PROFILE)
        return await this.#subscriptionLaunch({ root, home, config, mcpConfigPath }, execution.model, {
          ...this.#profile.environment,
          [CLAUDE_PROFILE_CREDENTIAL_VARIABLES[SUBSCRIPTION_PROFILE]]: credential
        });
      return Object.freeze({
        root,
        cwd: mediation.cwd,
        surface: "bridge",
        arguments: this.buildMediatedArguments(execution.model, mcpConfigPath),
        environment: {
          ...this.#profile.environment,
          HOME: home,
          CLAUDE_CONFIG_DIR: config,
          DISABLE_AUTOUPDATER: "1",
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
          [CLAUDE_PROFILE_CREDENTIAL_VARIABLES["mediated-mcp"]]: credential
        }
      });
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }

  // why: the model reaches the worktree only through the bridge, so the
  // subscription child runs in an empty per-run directory. Nothing the
  // repository carries (CLAUDE.md, AGENTS.md, `.claude/`, `.mcp.json`) is then
  // in its working directory to be discovered, whatever a switch covers.
  async #subscriptionLaunch(
    paths: { readonly root: string; readonly home: string; readonly config: string; readonly mcpConfigPath: string },
    model: string,
    environment: Readonly<Record<string, string>>
  ): Promise<MediatedLaunch> {
    const cwd = join(paths.root, "workspace");
    await mkdir(cwd, { mode: 0o700 });
    return Object.freeze({
      root: paths.root,
      cwd,
      surface: "bridge-only",
      arguments: this.buildSubscriptionArguments(model, paths.mcpConfigPath),
      environment: { ...environment, HOME: paths.home, CLAUDE_CONFIG_DIR: paths.config, ...SUBSCRIPTION_SWITCHES }
    });
  }

  async send(session: DriverSessionRef, input: Readonly<Record<string, unknown>>): Promise<void> {
    void session;
    void input;
    throw claudeError("VES_CLAUDE_SEND_UNSUPPORTED", "Claude Code print sessions do not accept follow-up input");
  }

  async cancel(session: DriverSessionRef, reason: string): Promise<void> {
    await this.#sessions.cancel(session, reason);
  }

  async close(session: DriverSessionRef) {
    return this.#sessions.close(session);
  }
}
