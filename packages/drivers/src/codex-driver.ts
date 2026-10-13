import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { quotaExhausted, usageUpdated, type DriverEventOf } from "@verchestra/domain";

import {
  codexProcessEnvironment,
  snapshotCodexProcessContext,
  type CodexProcessContext
} from "./codex-process-context.ts";
import { processTreeTerminator, type ProcessTreeTerminator } from "./driver-process-tree.ts";
import { sensitiveValueRedactor } from "./driver-redaction.ts";
import { DriverSessionLedger, type DriverSession } from "./driver-session-ledger.ts";
import {
  structuredAnswer,
  structuredOutputPlan,
  type DriverStructuredOutput,
  type StructuredOutputPlan
} from "./driver-structured-output.ts";
import { meetsMinimum, probeDriverVersion } from "./driver-version-probe.ts";
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
  // invariant: the turn carries `outputSchema`, and the session fails unless
  // its final agent message is JSON within the bound (AD-073).
  readonly structuredOutput?: DriverStructuredOutput;
  // invariant: before its turn the session reads the account and its rate
  // limits, and runs only on a ChatGPT login with no credits and ordinary
  // usage allowed (SSI-55, SSI-56). Absent keeps the T04 conversation.
  readonly subscriptionOnly?: true;
  // invariant: the session reads the account (`account/read`) and ends there:
  // no rate limit is read, no model is listed, and no thread or turn starts,
  // so nothing of an allowance is spent. It is how a run learns its plan type.
  readonly accountOnly?: true;
}

// invariant: the plan types `PlanType` names in the App Server protocol of
// 0.159.3, without its catch-all `unknown`. A plan type is only ever one of
// these or `unknown`, never the account's own text (SSI-49, SSI-53).
export const CODEX_PLAN_TYPES = Object.freeze([
  "free",
  "go",
  "plus",
  "pro",
  "prolite",
  "promax",
  "team",
  "self_serve_business_prolite",
  "self_serve_business_usage_based",
  "business",
  "ent26",
  "enterprise_cbp_automation",
  "enterprise_cbp_usage_based",
  "enterprise",
  "edu",
  "edu_plus",
  "edu_pro"
] as const);
export type CodexPlanType = (typeof CODEX_PLAN_TYPES)[number];
const PLAN_TYPES: ReadonlySet<unknown> = new Set(CODEX_PLAN_TYPES);

// invariant: all that is kept of an account: its plan type as a closed value.
// The e-mail address and every other field are read past.
export interface CodexAccountReport {
  readonly planType: CodexPlanType | "unknown";
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
  // why: SSI-52. A session that reads the account reports its plan type here
  // once the account is proven a ChatGPT login, for the caller to compare with
  // the owner's statement.
  readonly onAccount?: (account: CodexAccountReport) => void;
}

function codexError(code: string, message: string): DriverProtocolError {
  return new DriverProtocolError(code, message);
}

// invariant: a version starts a digit run, so the match is tried once per run
// and a long run of digits costs linear time.
const VERSION_PATTERN = /(?:^|\D)(\d+)\.(\d+)\.(\d+)/u;
// why: the build whose generated App Server protocol was read to confirm
// `turn/start` `outputSchema`, `account/read`, and `account/rateLimits/read`
// (docs/qualification/codex-driver-structured-results.md). A session that uses
// them requires it; the T04 conversation keeps its own floor.
export const CODEX_STRUCTURED_MINIMUM_VERSION = "0.159.3";
// invariant: the only App Server methods this client sends (SSI-57). No
// method that logs in or out, or buys, consumes, or advertises credits, is
// listed, so none of them can be written.
export const CODEX_CLIENT_METHODS: readonly string[] = Object.freeze([
  "initialize",
  "initialized",
  "account/read",
  "account/rateLimits/read",
  "model/list",
  "thread/start",
  "turn/start",
  "turn/interrupt"
]);
const CLIENT_METHODS: ReadonlySet<unknown> = new Set(CODEX_CLIENT_METHODS);
// why: the rate-limit kinds 0.159.3 reports that mean an allowance or its
// credits ran out; `rate_limit_reached` is a transient rate limit, not quota.
const QUOTA_REACHED_TYPES: ReadonlySet<unknown> = new Set([
  "workspace_owner_credits_depleted",
  "workspace_member_credits_depleted",
  "workspace_owner_usage_limit_reached",
  "workspace_member_usage_limit_reached"
]);
const CODEX_NAMING = Object.freeze({ errorCodePrefix: "VES_CODEX", noun: "Codex" });
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
  readonly onAccount: ((account: CodexAccountReport) => void) | undefined;
  readonly plan: CodexSessionPlan;
}

interface CodexSessionPlan {
  readonly structured: StructuredOutputPlan | undefined;
  readonly subscriptionOnly: boolean;
  readonly accountOnly: boolean;
}

type Row = Readonly<Record<string, unknown>>;

// invariant: every frame this client writes passes here. A request or a
// notification names a method on the allowlist; a response names none.
export function codexWireFrame(message: Row): string {
  if (Object.hasOwn(message, "method") && !CLIENT_METHODS.has(message["method"]))
    throw codexError("VES_CODEX_METHOD_DENIED", "Codex method is outside the client allowlist");
  return JSON.stringify(message);
}

const row = (value: unknown): Row | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Row) : undefined;

// why: a balance is a decimal text; only an absent or a zero balance is no
// balance. Any other value, a malformed one included, counts as credits.
const ZERO_BALANCE = /^0+(?:\.0+)?$/u;

// invariant: a snapshot reports credits unless its credits are absent, or
// say no credits, not unlimited, and no balance (SSI-56).
function creditsReported(snapshot: unknown): boolean {
  const credits = row(snapshot)?.["credits"];
  if (credits === undefined || credits === null) return false;
  const reported = row(credits);
  if (reported === undefined) return true;
  const balance = reported["balance"];
  const noBalance = balance === null || (typeof balance === "string" && ZERO_BALANCE.test(balance));
  return reported["hasCredits"] !== false || reported["unlimited"] !== false || !noBalance;
}

function anyCredits(limits: Row): boolean {
  const byLimit = row(limits["rateLimitsByLimitId"]);
  return [limits["rateLimits"], ...Object.values(byLimit ?? {})].some(creditsReported);
}

// invariant: the reset of an exhausted allowance is the latest reset among
// the snapshot's windows that are fully used; with none, no reset is known.
function exhaustedReset(snapshot: unknown): number | undefined {
  const resets = ["primary", "secondary"]
    .map((name) => row(row(snapshot)?.[name]))
    .filter((window) => typeof window?.["usedPercent"] === "number" && window["usedPercent"] >= 100)
    .map((window) => window?.["resetsAt"])
    .filter((reset): reset is number => Number.isSafeInteger(reset));
  return resets.length === 0 ? undefined : Math.max(...resets);
}

// invariant: the final agent message of a structured turn is its answer, read
// as JSON and bounded; an absent or unreadable message is a stable code.
function turnAnswer(text: string | undefined, plan: StructuredOutputPlan): ReturnType<typeof structuredAnswer> {
  if (text === undefined) return { code: "VES_CODEX_STRUCTURED_OUTPUT_MISSING" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { code: "VES_CODEX_STRUCTURED_OUTPUT_INVALID" };
  }
  return structuredAnswer(parsed, plan, "VES_CODEX");
}

// invariant: the App Server translation of one ephemeral turn: the JSON-RPC
// handshake, the account checks a subscription-only session makes, the model
// check, one thread and one turn, the dynamic tools and approvals it is asked
// about, the quota signals and structured answer it reports, and the
// interrupt a stop sends.
function codexProtocol(channel: ProviderChannel, conversation: CodexConversation): ProviderProtocol {
  const { request, execution, session: state, sessionId, redact, plan } = conversation;
  let nextId = 1;
  let threadId: string | undefined;
  let turnId: string | undefined;
  let interruptSent = false;
  let quotaReported = false;
  let finalMessage: string | undefined;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

  // invariant: a refused frame is never written; the stream fails with the
  // refusal's code.
  const write = (message: Row) => {
    let frame: string;
    try {
      frame = codexWireFrame(message);
    } catch (error) {
      channel.fail("VES_CODEX_METHOD_DENIED");
      throw error;
    }
    conversation.onMessageSent?.(structuredClone(message));
    channel.write(frame);
  };
  const notify = (method: string, params: Row = {}) => write({ method, params });
  const rpc = (method: string, params: Row = {}) => {
    const id = nextId++;
    write({ method, id, params });
    return new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  // invariant: a refusal of the conversation ends the stream with its code
  // before anything more is asked.
  const refuse = (code: string, message: string): never => {
    channel.fail(code);
    throw codexError(code, message);
  };
  // invariant: one quota signal per session, the first (SSI-58).
  const reportQuota = (event: DriverEventOf<"quota.exhausted">) => {
    if (quotaReported) return;
    quotaReported = true;
    state.emit(event);
  };
  const interrupt = () => {
    if (!channel.stopped() || threadId === undefined || turnId === undefined || interruptSent || channel.ending())
      return;
    interruptSent = true;
    void rpc("turn/interrupt", { threadId, turnId }).catch(() => undefined);
  };
  const respond = (message: Row): void => {
    const waiter = pending.get(message["id"] as number);
    if (waiter === undefined) return;
    pending.delete(message["id"] as number);
    if (message["error"] !== undefined) waiter.reject(codexError("VES_CODEX_RPC_FAILED", "Codex request failed"));
    else waiter.resolve(message["result"]);
  };
  const started = (): void => {
    state.emit({ type: "session.started", sessionId });
    state.emit({
      type: "model.resolved",
      passportRef: request.passportRef,
      provider: "openai",
      resolvedModel: execution.model
    });
  };
  const delta = (_message: Row, params: Row): void => {
    state.emit({ type: "content.delta", text: redact(params["delta"] ?? "") });
  };
  const toolCall = (message: Row, params: Row): void => {
    if (typeof message["id"] !== "number") return;
    if (typeof params["callId"] !== "string" || typeof params["tool"] !== "string")
      return channel.fail("VES_CODEX_STREAM_INVALID");
    if (!execution.tools.some((tool) => tool.name === params["tool"])) return channel.fail("VES_CODEX_TOOL_UNDECLARED");
    state.emit({
      type: "tool.requested",
      toolCallId: params["callId"],
      name: params["tool"],
      input: params["arguments"]
    });
    write({
      id: message["id"],
      result: { success: false, contentItems: [{ type: "inputText", text: "Execution is controlled by Verchestra." }] }
    });
  };
  const approval = (message: Row): void => {
    if (typeof message["id"] !== "number") return;
    state.emit({ type: "warning", code: "VES_CODEX_BUILTIN_TOOL_DENIED", message: "Codex built-in effect was denied" });
    write({ id: message["id"], result: { decision: "decline" } });
  };
  const failed = (_message: Row, params: Row): void => {
    if (row(params["error"])?.["codexErrorInfo"] === "usageLimitExceeded")
      reportQuota(quotaExhausted("usage_limit_exceeded"));
    state.outcome = "failed";
    state.emit({ type: "error", code: "VES_CODEX_EXECUTION_FAILED", message: "Codex failed", retryable: true });
  };
  // why: only a structured turn keeps its last agent message, and only the
  // last, which a line already bounded by the output limit carried.
  const itemCompleted = (_message: Row, params: Row): void => {
    const item = row(params["item"]);
    if (plan.structured !== undefined && item?.["type"] === "agentMessage" && typeof item["text"] === "string")
      finalMessage = item["text"];
  };
  const rateLimitsUpdated = (_message: Row, params: Row): void => {
    const snapshot = row(params["rateLimits"]);
    const reached = snapshot?.["rateLimitReachedType"];
    if (QUOTA_REACHED_TYPES.has(reached)) reportQuota(quotaExhausted(reached as string, exhaustedReset(snapshot)));
  };
  const answer = (turn: Row): void => {
    if (plan.structured === undefined || turn["status"] !== "completed" || state.outcome === "failed") return;
    const outcome = turnAnswer(finalMessage, plan.structured);
    if ("type" in outcome) return state.emit(outcome);
    state.outcome = "failed";
    state.emit({
      type: "error",
      code: outcome.code,
      message: "Codex returned no usable structured result",
      retryable: false
    });
  };
  const completed = (_message: Row, params: Row): void => {
    const turn = (params["turn"] ?? {}) as Row;
    const reported = (params["usage"] ?? turn["usage"] ?? {}) as Row;
    const usage = usageUpdated({ inputTokens: reported["inputTokens"], outputTokens: reported["outputTokens"] });
    if (usage === undefined) return channel.fail("VES_CODEX_STREAM_INVALID");
    state.emit(usage);
    if (turn["status"] === "failed" && state.outcome !== "failed") {
      state.outcome = "failed";
      state.emit({ type: "error", code: "VES_CODEX_EXECUTION_FAILED", message: "Codex failed", retryable: true });
    }
    answer(turn);
    channel.result();
  };
  const handlers = new Map<unknown, (message: Row, params: Row) => void>([
    ["thread/started", started],
    ["item/agentMessage/delta", delta],
    ["item/tool/call", toolCall],
    ["item/commandExecution/requestApproval", approval],
    ["item/fileChange/requestApproval", approval],
    ["error", failed],
    ["item/completed", itemCompleted],
    ["account/rateLimits/updated", rateLimitsUpdated],
    ["turn/completed", completed]
  ]);
  const receive = (message: Row): void => {
    if (typeof message["id"] === "number" && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error")))
      return respond(message);
    handlers.get(message["method"])?.(message, (message["params"] ?? {}) as Row);
  };
  // invariant: the account must be a ChatGPT login; its plan type is reported
  // as a closed value, and the e-mail address and every other account field
  // are read past and never kept.
  const accountRead = async (): Promise<void> => {
    const account = row(row(await rpc("account/read", { refreshToken: false }))?.["account"]);
    if (account?.["type"] !== "chatgpt")
      return refuse("VES_CODEX_AUTH_METHOD_MISMATCH", "Codex is not signed in with a ChatGPT subscription");
    const planType = PLAN_TYPES.has(account["planType"]) ? (account["planType"] as CodexPlanType) : "unknown";
    conversation.onAccount?.(Object.freeze({ planType }));
  };
  // invariant: the snapshots must report no credits, and ordinary usage must
  // not be refused.
  const rateLimitChecks = async (): Promise<void> => {
    const limits = row(await rpc("account/rateLimits/read"));
    if (limits === undefined || row(limits["rateLimits"]) === undefined)
      return refuse("VES_CODEX_PROTOCOL_FAILED", "Codex rate limits are invalid");
    if (anyCredits(limits)) return refuse("VES_CODEX_CREDITS_PRESENT", "Codex reports credits on this account");
    if (limits["ordinaryUsageAllowed"] === false) {
      reportQuota(quotaExhausted("ordinary_usage_disallowed", exhaustedReset(limits["rateLimits"])));
      return refuse("VES_CODEX_QUOTA_EXHAUSTED", "Codex reports that the usage allowance is exhausted");
    }
  };
  // invariant: what a session asks of the account after `initialized`: an
  // account-only session reads the account and is done; a subscription-only
  // one reads the account and its rate limits before anything else.
  const accountSteps = async (): Promise<boolean> => {
    if (plan.subscriptionOnly || plan.accountOnly) await accountRead();
    if (plan.subscriptionOnly) await rateLimitChecks();
    return plan.accountOnly;
  };
  const converse = async () => {
    await rpc("initialize", {
      clientInfo: { name: "verchestra", title: "Verchestra", version: "1.0.0" },
      capabilities: { experimentalApi: true }
    });
    notify("initialized");
    if (await accountSteps()) return channel.result();
    const catalog = (await rpc("model/list")) as { data?: readonly { id?: string; model?: string }[] };
    const selected = catalog.data?.find((entry) => entry.model === execution.model || entry.id === execution.model);
    if (selected?.model !== execution.model)
      throw codexError("VES_CODEX_MODEL_UNAVAILABLE", "Codex model is unavailable");
    const thread = (await rpc("thread/start", conversation.threadParams())) as { thread?: { id?: string } };
    threadId = thread.thread?.id;
    if (typeof threadId !== "string") throw codexError("VES_CODEX_PROTOCOL_FAILED", "Codex thread identity is invalid");
    const outputSchema = plan.structured === undefined ? {} : { outputSchema: JSON.parse(plan.structured.schemaText) };
    const turn = (await rpc("turn/start", {
      threadId,
      input: [{ type: "text", text: execution.prompt }],
      ...outputSchema
    })) as {
      turn?: { id?: string };
    };
    turnId = turn.turn?.id;
    if (typeof turnId !== "string") throw codexError("VES_CODEX_PROTOCOL_FAILED", "Codex turn identity is invalid");
    interrupt();
  };
  // why: a provider that ends before it answers a request is a protocol
  // failure, as the child run reports it; `VES_CODEX_PROCESS_FAILED` is the
  // end of a process that died after its conversation had finished.
  const closed = () => {
    for (const waiter of pending.values())
      waiter.reject(codexError("VES_CODEX_PROTOCOL_FAILED", "Codex process ended"));
    pending.clear();
  };
  return { receive, converse, interrupt, closed };
}

// invariant: an account requirement is `true` or absent; anything else is
// refused before spawn.
function accountFlag(value: unknown): boolean {
  if (value !== undefined && value !== true)
    throw codexError("VES_CODEX_SUBSCRIPTION_INVALID", "Codex subscription requirement is invalid");
  return value === true;
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
    const plan = this.#sessionPlan(execution, probe.version);

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
          onMessageSent: this.#dependencies.onMessageSent,
          onAccount: this.#dependencies.onAccount,
          plan
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

  // invariant: a session that asks for a structured answer or for the account
  // checks is refused before spawn on a build below the floor that has them.
  #sessionPlan(execution: CodexExecution, version: string): CodexSessionPlan {
    const structured = structuredOutputPlan(execution.structuredOutput, CODEX_NAMING);
    const subscriptionOnly = accountFlag(execution.subscriptionOnly);
    const accountOnly = accountFlag(execution.accountOnly);
    // why: a session that only reads the account has no turn to answer for
    // and no rate limit to read, so neither may be asked of it.
    if (accountOnly && (subscriptionOnly || structured !== undefined))
      throw codexError("VES_CODEX_SUBSCRIPTION_INVALID", "Codex account-only session asks for a turn");
    const usesNewProtocol = structured !== undefined || subscriptionOnly || accountOnly;
    if (usesNewProtocol && !meetsMinimum(version, CODEX_STRUCTURED_MINIMUM_VERSION, VERSION_PATTERN))
      throw codexError("VES_CODEX_VERSION_UNSUPPORTED", "Codex version is unsupported");
    return Object.freeze({ structured, subscriptionOnly, accountOnly });
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
