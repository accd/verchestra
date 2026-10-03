import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { isAbsolute, join, posix } from "node:path";
import { promisify } from "node:util";

import { quotaExhausted, usageUpdated } from "@verchestra/domain";

import { processTreeTerminator, type ProcessTreeTerminator } from "./driver-process-tree.ts";
import { sensitiveValueRedactor } from "./driver-redaction.ts";
import { DriverSessionLedger, type DriverSession } from "./driver-session-ledger.ts";
import {
  structuredAnswer,
  structuredOutputPlan,
  type DriverStructuredOutput,
  type StructuredOutputPlan
} from "./driver-structured-output.ts";
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
// why: with `--json-schema` Claude Code answers through this tool, which
// carries the answer and has no effect; a structured session allows it beside
// the bridge tools so the permission mode never decides whether it may answer.
export const CLAUDE_STRUCTURED_OUTPUT_TOOL = "StructuredOutput";
// why: the limit windows a `rate_limit_event` names, as 2.1.282 declares them.
const QUOTA_SCOPES: ReadonlySet<unknown> = new Set([
  "five_hour",
  "seven_day",
  "seven_day_opus",
  "seven_day_sonnet",
  "seven_day_overage_included",
  "overage"
]);

export interface ClaudeCodeMediatedProfile {
  readonly kind: keyof typeof CLAUDE_PROFILE_CREDENTIAL_VARIABLES;
  readonly environment?: Readonly<Record<string, string>>;
  // Parent for the per-run 0700 isolation directory; defaults to the OS temp dir.
  readonly isolationRoot?: string;
  // why: subscription profile only. The machine-wide Claude Code policy
  // locations whose presence refuses the launch; defaults to the documented ones.
  readonly managedPolicyPaths?: readonly string[];
  // why: subscription profile only. The policy registry keys whose presence
  // refuses the launch; defaults to the documented ones, which exist only on
  // Windows.
  readonly managedPolicyRegistryKeys?: readonly string[];
  // why: a driver can read no registry and may not import platform-node, so
  // the composition root injects the reader, as it injects the tree
  // terminator. Without one every documented key counts as present.
  readonly managedPolicyRegistry?: ClaudeManagedPolicyRegistry;
}

// invariant: resolves false only when the key is proven absent; anything else,
// a rejection included, counts as present.
export type ClaudeManagedPolicyRegistry = (key: string) => Promise<boolean>;

export interface ClaudeManagedPolicySources {
  readonly paths: readonly string[];
  readonly registryKeys: readonly string[];
}

// why: the Windows sources Claude Code reads (SSI-74): the managed settings
// directory under Program Files, the machine policy key, and the user policy
// key, each with a `Settings` value; the legacy ProgramData path is not read.
export const CLAUDE_WINDOWS_POLICY_DIRECTORY = "C:\\Program Files\\ClaudeCode";
export const CLAUDE_WINDOWS_POLICY_KEYS: readonly string[] = Object.freeze([
  "HKLM\\SOFTWARE\\Policies\\ClaudeCode",
  "HKCU\\SOFTWARE\\Policies\\ClaudeCode"
]);
const POLICY_KEY = /^HK(?:LM|CU)\\SOFTWARE\\Policies\\[A-Za-z0-9._-]{1,64}$/u;

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
  // invariant: only a mediated profile accepts it. The session then passes
  // `--json-schema` and fails unless its result carries a structured answer
  // within the bound (AD-073).
  readonly structuredOutput?: DriverStructuredOutput;
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

const CLAUDE_NAMING = Object.freeze({ errorCodePrefix: "VES_CLAUDE", noun: "Claude Code" });

// why: a structured invocation allows the structured-output tool beside the
// bridge tools and passes its schema just before the model; any other
// invocation is unchanged.
function allowedTools(schemaText: string | undefined): string {
  const tools =
    schemaText === undefined ? CLAUDE_MEDIATED_TOOLS : [...CLAUDE_MEDIATED_TOOLS, CLAUDE_STRUCTURED_OUTPUT_TOOL];
  return tools.join(",");
}

function schemaArguments(schemaText: string | undefined): readonly string[] {
  return schemaText === undefined ? [] : ["--json-schema", schemaText];
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
// invariant: the child run reports VES_CLAUDE_ABORTED, VES_CLAUDE_OUTPUT_LIMIT,
// VES_CLAUDE_STREAM_INVALID, VES_CLAUDE_STDIN_FAILED, VES_CLAUDE_STREAM_INCOMPLETE
// and VES_CLAUDE_PROCESS_FAILED. Its conversation is one write, which cannot
// reject, so VES_CLAUDE_PROTOCOL_FAILED is never reported.
// why: in print mode Claude Code exits by itself after its result, and its
// exit status is part of that result (AD-054).
const CHILD_PROFILE = Object.freeze({
  errorCodePrefix: "VES_CLAUDE",
  noun: "Claude Code",
  streamName: "stream",
  afterResult: "exits-by-itself"
} as const);

function userMessage(prompt: string): string {
  return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } });
}

interface NormalizedMediatedProfile {
  readonly kind: ProfileKind;
  readonly environment: Readonly<Record<string, string>>;
  readonly isolationRoot?: string;
  readonly managedPolicy: ManagedPolicyCheck;
}

interface ManagedPolicyCheck extends ClaudeManagedPolicySources {
  readonly registry: ClaudeManagedPolicyRegistry;
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
export function documentedManagedPolicySources(platform: NodeJS.Platform): ClaudeManagedPolicySources {
  if (platform === "win32")
    return Object.freeze({
      paths: Object.freeze([CLAUDE_WINDOWS_POLICY_DIRECTORY]),
      registryKeys: CLAUDE_WINDOWS_POLICY_KEYS
    });
  return Object.freeze({
    paths: Object.freeze(documentedManagedPolicyPaths(platform)),
    registryKeys: Object.freeze([])
  });
}

function documentedManagedPolicyPaths(platform: NodeJS.Platform): string[] {
  if (platform !== "darwin") return ["/etc/claude-code"];
  const preferences = "/Library/Managed Preferences";
  const domain = "com.anthropic.claudecode.plist";
  // why: these are macOS paths whatever the host, so a host's separator must
  // not reach them when another platform's sources are described.
  return [
    "/Library/Application Support/ClaudeCode",
    posix.join(preferences, domain),
    posix.join(preferences, accountName(), domain)
  ];
}

function accountName(): string {
  try {
    return userInfo().username;
  } catch {
    return "unknown-account";
  }
}

// hazard: without the composition's reader no key can be proven absent.
const unreadableRegistry: ClaudeManagedPolicyRegistry = async () => true;

function validPolicyOverrides(profile: ClaudeCodeMediatedProfile): boolean {
  return (
    profile.managedPolicyPaths?.every(absolutePath) !== false &&
    profile.managedPolicyRegistryKeys?.every((key) => POLICY_KEY.test(key)) !== false
  );
}

function managedPolicyCheck(profile: ClaudeCodeMediatedProfile): ManagedPolicyCheck {
  const registry = profile.managedPolicyRegistry ?? unreadableRegistry;
  const overridden = profile.managedPolicyPaths !== undefined || profile.managedPolicyRegistryKeys !== undefined;
  if (profile.kind === SUBSCRIPTION_PROFILE ? !validPolicyOverrides(profile) : overridden)
    throw mediationError("Managed policy paths must be absolute and belong to the subscription profile");
  if (profile.kind !== SUBSCRIPTION_PROFILE) return Object.freeze({ paths: [], registryKeys: [], registry });
  const documented = documentedManagedPolicySources(process.platform);
  return Object.freeze({
    paths: Object.freeze([...(profile.managedPolicyPaths ?? documented.paths)]),
    registryKeys: Object.freeze([...(profile.managedPolicyRegistryKeys ?? documented.registryKeys)]),
    registry
  });
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
  const managedPolicy = managedPolicyCheck(profile);
  if (profile.isolationRoot === undefined) return Object.freeze({ kind, environment, managedPolicy });
  if (!absolutePath(profile.isolationRoot)) throw mediationError("The isolation root must be absolute");
  return Object.freeze({ kind, environment, isolationRoot: profile.isolationRoot, managedPolicy });
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

async function registryKeyPresent(registry: ClaudeManagedPolicyRegistry, key: string): Promise<boolean> {
  try {
    return (await registry(key)) !== false;
  } catch {
    return true;
  }
}

export async function managedPolicyPresent(
  sources: ClaudeManagedPolicySources,
  registry: ClaudeManagedPolicyRegistry
): Promise<boolean> {
  for (const path of sources.paths) if (await policyPresent(path)) return true;
  for (const key of sources.registryKeys) if (await registryKeyPresent(registry, key)) return true;
  return false;
}

async function refuseManagedPolicy(check: ManagedPolicyCheck): Promise<void> {
  if (await managedPolicyPresent(check, check.registry))
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

// invariant: a mediated session may advertise only the bridge tools, and a
// structured one also the structured-output tool; the bridge must be
// connected. Anything else means the tool surface is not the one this profile
// was qualified with.
function mediatedSurfaceFailure(event: Record<string, unknown>, structured: boolean): string | undefined {
  const tools = event["tools"];
  const permitted = (tool: unknown) =>
    typeof tool === "string" &&
    (CLAUDE_MEDIATED_TOOLS.includes(tool) || (structured && tool === CLAUDE_STRUCTURED_OUTPUT_TOOL));
  if (!Array.isArray(tools) || !tools.every(permitted)) return "VES_CLAUDE_TOOL_SURFACE_UNEXPECTED";
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

// invariant: the subscription profile authenticates with an OAuth token, which
// is not an API key, so the session must report no API-key source. Any other
// source means a key or a key helper reached the session (SSI-54).
function authSourceFailure(event: Record<string, unknown>, surface: StreamSurface): string | undefined {
  return surface === "bridge-only" && event["apiKeySource"] !== "none" ? "VES_CLAUDE_AUTH_METHOD_MISMATCH" : undefined;
}

function initEventFailure(
  event: Record<string, unknown>,
  conversation: Pick<ClaudeConversation, "execution" | "surface" | "structured">
): string | undefined {
  const { execution, surface, structured } = conversation;
  if (event["model"] !== execution.model) return "VES_CLAUDE_IDENTITY_MISMATCH";
  if (surface === "open") return undefined;
  const failure = authSourceFailure(event, surface) ?? mediatedSurfaceFailure(event, structured !== undefined);
  return failure === undefined && surface === "bridge-only" ? extraServerFailure(event) : failure;
}

function surfaceOf(launch: MediatedLaunch | undefined): StreamSurface {
  return launch === undefined ? "open" : launch.surface;
}

// invariant: with `--include-hook-events` every hook that runs is reported in
// the stream, and the subscription profile disables all of them; one hook
// event therefore means a managed or injected hook ran, and the session ends.
function unexpectedHook(event: Readonly<Record<string, unknown>>, surface: StreamSurface): boolean {
  const subtype = event["subtype"];
  return (
    surface === "bridge-only" &&
    event["type"] === "system" &&
    typeof subtype === "string" &&
    subtype.startsWith("hook_")
  );
}

interface ClaudeConversation {
  readonly request: DriverStartRequest;
  readonly execution: ClaudeCodeExecution;
  readonly session: DriverSession<ProviderChildResources>;
  readonly sessionId: string;
  readonly surface: StreamSurface;
  readonly redact: (value: unknown) => string;
  readonly structured: StructuredOutputPlan | undefined;
}

type Row = Readonly<Record<string, unknown>>;

// invariant: what a result says beyond its usage, for a session that was
// announced. An error result fails the session, a structured session whose
// retries ran out has no answer, and a structured session's answer is bounded
// before it is emitted; a session that asked for no schema adds nothing.
function resultEvent(
  event: Row,
  structured: StructuredOutputPlan | undefined
): ReturnType<typeof structuredAnswer> | undefined {
  if (event["is_error"] === true)
    return structured !== undefined && event["subtype"] === "error_max_structured_output_retries"
      ? { code: "VES_CLAUDE_STRUCTURED_OUTPUT_MISSING" }
      : { code: "VES_CLAUDE_EXECUTION_FAILED" };
  return structured === undefined ? undefined : structuredAnswer(event["structured_output"], structured, "VES_CLAUDE");
}

// invariant: a rejected rate limit is the provider's typed statement that an
// allowance ran out; its window is a scope only when 2.1.282 names it, and its
// reset is carried only when given. Nothing else of the event is read.
function rateLimitStatus(event: Row): { readonly status: unknown; readonly scope: string; readonly resetsAt: unknown } {
  const info = (event["rate_limit_info"] ?? {}) as Row;
  const window = info["rateLimitType"];
  return {
    status: info["status"],
    scope: QUOTA_SCOPES.has(window) ? (window as string) : "unknown",
    resetsAt: info["resetsAt"]
  };
}

// invariant: the stream-json translation of one print session. The prompt is
// the one message written; every event the provider writes back is checked
// against the surface the session is held to and normalized.
function claudeProtocol(channel: ProviderChannel, conversation: ClaudeConversation): ProviderProtocol {
  const { request, execution, session: state, sessionId, surface, redact, structured } = conversation;
  let initialized = false;
  let quotaReported = false;
  let warned = false;
  // why: a tool the model asks for is normalized, never executed here. The
  // structured-output call of a structured session carries its answer, which
  // the result repeats, and has no effect, so it is no tool request.
  const requestTools = (event: Row): void => {
    const message = event["message"] as { content?: unknown[] } | undefined;
    for (const raw of message?.content ?? []) {
      const content = raw as Record<string, unknown>;
      if (content["type"] !== "tool_use") continue;
      if (typeof content["id"] !== "string" || typeof content["name"] !== "string")
        return channel.fail("VES_CLAUDE_STREAM_INVALID");
      if (structured !== undefined && content["name"] === CLAUDE_STRUCTURED_OUTPUT_TOOL) continue;
      state.emit({ type: "tool.requested", toolCallId: content["id"], name: content["name"], input: content["input"] });
    }
  };
  const initialize = (event: Row): void => {
    if (event["subtype"] !== "init") return;
    const initFailure = initEventFailure(event, conversation);
    if (initFailure !== undefined) return channel.fail(initFailure);
    initialized = true;
    state.emit({ type: "session.started", sessionId });
    state.emit({
      type: "model.resolved",
      passportRef: request.passportRef,
      provider: "anthropic",
      resolvedModel: execution.model
    });
  };
  const delta = (event: Row): void => {
    const nested = event["event"] as { delta?: { type?: string; text?: unknown } } | undefined;
    if (nested?.delta?.type === "text_delta")
      state.emit({ type: "content.delta", text: redact(String(nested.delta.text ?? "")) });
  };
  // why: a result counts once the session was announced; a result before
  // that leaves the run without one.
  const finish = (event: Row): void => {
    if (initialized) channel.result();
    const reported = event["usage"] as Row | undefined;
    const usage = usageUpdated({ inputTokens: reported?.["input_tokens"], outputTokens: reported?.["output_tokens"] });
    if (usage === undefined) return channel.fail("VES_CLAUDE_STREAM_INVALID");
    state.emit(usage);
    const outcome = initialized ? resultEvent(event, structured) : resultEvent(event, undefined);
    if (outcome === undefined) return;
    if ("type" in outcome) return state.emit(outcome);
    state.outcome = "failed";
    const retryable = outcome.code === "VES_CLAUDE_EXECUTION_FAILED";
    state.emit({
      type: "error",
      code: outcome.code,
      message: retryable ? "Claude Code failed" : "Claude Code returned no usable structured result",
      retryable
    });
  };
  // invariant: each signal is reported once per session; a warning never stops
  // the session (SSI-58).
  const rateLimit = (event: Row): void => {
    const { status, scope, resetsAt } = rateLimitStatus(event);
    if (status === "rejected" && !quotaReported) {
      quotaReported = true;
      state.emit(quotaExhausted(scope, resetsAt));
    } else if (status === "allowed_warning" && !warned) {
      warned = true;
      state.emit({
        type: "warning",
        code: "VES_CLAUDE_QUOTA_WARNING",
        message: "Claude Code reported that a usage limit is near"
      });
    }
  };
  const handlers = new Map<unknown, (event: Row) => void>([
    ["system", initialize],
    ["stream_event", delta],
    ["assistant", requestTools],
    ["result", finish],
    ["rate_limit_event", rateLimit]
  ]);
  const receive = (event: Row): void => {
    if (unexpectedHook(event, surface)) return channel.fail("VES_CLAUDE_HOOK_UNEXPECTED");
    handlers.get(event["type"])?.(event);
  };
  return { receive, converse: async () => channel.end(userMessage(execution.prompt)) };
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
  readonly #sessions = new DriverSessionLedger<ProviderChildResources>({
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
  buildMediatedArguments(model: string, mcpConfigPath: string, schemaText?: string): readonly string[] {
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
      allowedTools(schemaText),
      "--permission-mode",
      "dontAsk",
      "--permission-prompts",
      "none",
      "--no-chrome",
      "--setting-sources",
      "",
      ...schemaArguments(schemaText),
      "--model",
      model
    ]);
  }

  // why: the subscription profile is the mediated surface without `--bare`,
  // which would discard the subscription token. Hooks and auto memory are
  // switched off by `--settings`, and a hook that still ran is reported.
  buildSubscriptionArguments(model: string, mcpConfigPath: string, schemaText?: string): readonly string[] {
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
      allowedTools(schemaText),
      "--permission-mode",
      "dontAsk",
      "--permission-prompts",
      "none",
      "--no-chrome",
      "--setting-sources",
      "",
      "--settings",
      CLAUDE_SUBSCRIPTION_SETTINGS,
      ...schemaArguments(schemaText),
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

    const structured = this.#structuredPlan(execution);
    const launch = await this.#mediatedLaunch(execution, structured);
    const surface = surfaceOf(launch);
    const sessionId = `claude-session:${randomUUID()}`;
    const state = this.#sessions.open(sessionId, sink, {});
    try {
      const redact = sensitiveValueRedactor(execution.sensitiveValues ?? []);
      const plan = this.#spawnPlan(execution, launch);
      await runProviderChild({
        profile: CHILD_PROFILE,
        launch: {
          command: this.#command[0] as string,
          arguments: plan.arguments,
          cwd: plan.cwd,
          environment: plan.environment,
          maxOutputBytes: execution.maxOutputBytes
        },
        session: state,
        signal,
        terminateTree: this.#terminateTree,
        onSpawn: this.#dependencies.onSpawn,
        protocol: (channel) =>
          claudeProtocol(channel, { request, execution, session: state, sessionId, surface, redact, structured })
      });
      return Object.freeze({ sessionId });
    } finally {
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

  // invariant: a structured result is asked of a mediated profile only; the
  // T03 profile is unchanged.
  #structuredPlan(execution: ClaudeCodeExecution): StructuredOutputPlan | undefined {
    const plan = structuredOutputPlan(execution.structuredOutput, CLAUDE_NAMING);
    if (plan !== undefined && this.#profile === undefined)
      throw claudeError("VES_CLAUDE_OUTPUT_SCHEMA_INVALID", "Structured output requires a mediated profile");
    return plan;
  }

  async #mediatedLaunch(
    execution: ClaudeCodeExecution,
    structured: StructuredOutputPlan | undefined
  ): Promise<MediatedLaunch | undefined> {
    if (this.#profile === undefined) {
      if (execution.mediation !== undefined)
        throw claudeError("VES_CLAUDE_MEDIATION_INVALID", "Mediation requires the mediated-mcp profile");
      return undefined;
    }
    const credential = mediatedCredential(execution, this.#profile.kind);
    const mediation = await validMediation(execution.mediation);
    await refuseManagedPolicy(this.#profile.managedPolicy);
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
        return await this.#subscriptionLaunch(
          { root, home, config, mcpConfigPath },
          { model: execution.model, schemaText: structured?.schemaText },
          { ...this.#profile.environment, [CLAUDE_PROFILE_CREDENTIAL_VARIABLES[SUBSCRIPTION_PROFILE]]: credential }
        );
      return Object.freeze({
        root,
        cwd: mediation.cwd,
        surface: "bridge",
        arguments: this.buildMediatedArguments(execution.model, mcpConfigPath, structured?.schemaText),
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
    invocation: { readonly model: string; readonly schemaText: string | undefined },
    environment: Readonly<Record<string, string>>
  ): Promise<MediatedLaunch> {
    const cwd = join(paths.root, "workspace");
    await mkdir(cwd, { mode: 0o700 });
    return Object.freeze({
      root: paths.root,
      cwd,
      surface: "bridge-only",
      arguments: this.buildSubscriptionArguments(invocation.model, paths.mcpConfigPath, invocation.schemaText),
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
