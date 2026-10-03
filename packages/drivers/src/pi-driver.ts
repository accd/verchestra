import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { usageUpdated } from "@verchestra/domain";

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

const PI_PACKAGE = "@earendil-works/pi-agent-core";
const QUALIFIED_PI_VERSION = "0.87.1";

interface PiModel {
  readonly id: string;
  readonly provider: string;
  readonly api: string;
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly [key: string]: unknown;
}

interface PiTool {
  readonly name: string;
  readonly inputSchemaDigest: string;
  readonly [key: string]: unknown;
}

interface PiAssistantMessage {
  readonly role: "assistant";
  readonly usage: { readonly input: number; readonly output: number };
  readonly stopReason: string;
}

interface PiAgentState {
  readonly messages: readonly ({ readonly role: string } | PiAssistantMessage)[];
}

interface PiAgent {
  readonly state: PiAgentState;
  subscribe(listener: (event: PiAgentEvent) => void): () => void;
  prompt(input: string): Promise<void>;
  abort(): void;
  waitForIdle(): Promise<void>;
  reset(): void;
}

interface PiAgentEvent {
  readonly type: string;
  readonly assistantMessageEvent?: { readonly type: string; readonly delta?: string };
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly args?: unknown;
}

type PiAgentConstructor = new (options: Readonly<Record<string, unknown>>) => PiAgent;

async function loadPiAgentConstructor(): Promise<PiAgentConstructor> {
  try {
    const moduleName: string = PI_PACKAGE;
    const loaded = (await import(moduleName)) as { readonly Agent?: PiAgentConstructor };
    if (typeof loaded.Agent === "function") return loaded.Agent;
  } catch {
    // The public error below deliberately excludes loader and filesystem details.
  }
  throw piError("VES_PI_RUNTIME_UNAVAILABLE", "Pi runtime is unavailable");
}

// The probe has to be able to fail, so it reads the version the host actually
// installed rather than reporting a constant. Pi is an embedded SDK, not a CLI,
// so the observation is its resolved manifest instead of a `--version` spawn;
// the package exports "./package.json", which is what makes this resolvable
// without reaching into node_modules by path.
async function installedPiVersion(resolver: PiVersionResolver): Promise<string | undefined> {
  try {
    const manifest = JSON.parse(await readFile(await resolver(), "utf8")) as { readonly version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : undefined;
  } catch {
    // Absent, unresolvable, or unreadable are one observation: not installed.
    return undefined;
  }
}

export type PiVersionResolver = () => Promise<string> | string;

// invariant: the probe refusals are VES_PI_NOT_AVAILABLE and
// VES_PI_VERSION_UNSUPPORTED.
const PROBE_PROFILE = Object.freeze({
  identity: Object.freeze({ driverId: "pi", package: PI_PACKAGE }),
  errorCodePrefix: "VES_PI",
  noun: "Pi runtime",
  capabilities: Object.freeze(["stream", "tools", "usage", "abort"])
});

const defaultVersionResolver: PiVersionResolver = () =>
  createRequire(import.meta.url).resolve(`${PI_PACKAGE}/package.json`);

export interface PiExecution {
  readonly passport: {
    readonly passportId: string;
    readonly revision: number;
    readonly provider: string;
    readonly api: string;
    readonly resolvedModel: string;
  };
  readonly model: PiModel;
  readonly streamFn: (...args: readonly unknown[]) => unknown;
  readonly prompt: string;
  readonly systemPrompt: string;
  readonly tools: readonly PiTool[];
  readonly authorizeTool: (request: {
    readonly toolCallId: string;
    readonly name: string;
    readonly input: unknown;
  }) => Promise<{ readonly allowed: boolean; readonly reason?: string }>;
}

export interface PiDriverDependencies {
  readonly resolveExecution: (request: DriverStartRequest) => Promise<PiExecution>;
}

interface PiSessionResources {
  readonly agent: PiAgent;
  unsubscribe?: () => void;
}

function piError(code: string, message: string): DriverProtocolError {
  return new DriverProtocolError(code, message);
}

function estimatedTokens(systemPrompt: string, prompt: string): number {
  return Math.ceil((systemPrompt.length + prompt.length) / 4);
}

function textDelta(event: PiAgentEvent): string | undefined {
  if (
    event.type !== "message_update" ||
    event.assistantMessageEvent?.type !== "text_delta" ||
    typeof event.assistantMessageEvent.delta !== "string"
  )
    return undefined;
  return event.assistantMessageEvent.delta;
}

// invariant: how a run that returned reports its end, read from the agent's
// last assistant message, whose usage goes through the usage rule. A stop,
// which the agent reports as the stop reason `aborted`, comes first: a usage
// that is not a count does not turn it into a failure. Otherwise that usage is
// a runtime failure, as a run with no assistant message is.
function reportRunEnd(state: DriverSession<PiSessionResources>, messages: PiAgentState["messages"]): void {
  const finalMessage = [...messages]
    .reverse()
    .find((message): message is PiAssistantMessage => message.role === "assistant");
  const usage =
    finalMessage === undefined
      ? undefined
      : usageUpdated({ inputTokens: finalMessage.usage.input, outputTokens: finalMessage.usage.output });
  if (usage !== undefined) state.emit(usage);
  const stopReason = finalMessage?.stopReason;
  if (stopReason === "aborted") {
    state.outcome = "cancelled";
    state.emit({ type: "error", code: "VES_PI_ABORTED", message: "Pi run was aborted", retryable: true });
  } else if (usage === undefined) {
    state.outcome = "failed";
    state.emit({ type: "error", code: "VES_PI_RUNTIME_FAILED", message: "Pi runtime failed", retryable: false });
  } else if (stopReason === "error") {
    state.outcome = "failed";
    state.emit({ type: "error", code: "VES_PI_PROVIDER_ERROR", message: "Pi provider failed", retryable: true });
  } else if (stopReason === "length") {
    state.outcome = "failed";
    state.emit({ type: "warning", code: "VES_PI_OUTPUT_LIMIT", message: "Pi output reached its verified limit" });
  }
}

export class PiDriver implements Driver {
  readonly #dependencies: PiDriverDependencies;
  readonly #sessions = new DriverSessionLedger<PiSessionResources>({
    noun: "Pi Driver",
    stop: ({ resources }) => {
      resources.agent.abort();
      return resources.agent.waitForIdle();
    },
    release: ({ resources }) => {
      resources.unsubscribe?.();
      resources.agent.reset();
    }
  });
  readonly #resolveVersion: PiVersionResolver;

  constructor(dependencies: PiDriverDependencies, options: { readonly versionResolver?: PiVersionResolver } = {}) {
    this.#dependencies = dependencies;
    this.#resolveVersion = options.versionResolver ?? defaultVersionResolver;
  }

  async probe() {
    // Pi is pinned to an exact qualified version rather than a floor: the driver
    // is written against that SDK's API, and the repository's dependency policy
    // asserts the exact pin, so any drift must surface instead of being accepted.
    return probeDriverVersion(PROBE_PROFILE, { exact: QUALIFIED_PI_VERSION }, () =>
      installedPiVersion(this.#resolveVersion)
    );
  }

  async start(
    request: DriverStartRequest,
    sink: (event: DriverEvent) => void,
    signal: AbortSignal
  ): Promise<DriverSessionRef> {
    if (signal.aborted) throw piError("VES_DRIVER_CANCELLED", "Pi Driver start was cancelled");
    validateDriverStartRequest(request);
    let execution: PiExecution;
    try {
      execution = await this.#dependencies.resolveExecution(request);
    } catch {
      throw piError("VES_PI_RESOLUTION_FAILED", "Pi execution resolution failed");
    }
    this.#validateExecution(request, execution);
    if (
      estimatedTokens(execution.systemPrompt, execution.prompt) + execution.model.maxTokens >
      execution.model.contextWindow
    )
      throw piError("VES_PI_CONTEXT_CAPACITY_EXCEEDED", "Pi context exceeds verified model capacity");

    const sessionId = `pi-session:${randomUUID()}`;
    const Agent = await loadPiAgentConstructor();
    const agent = new Agent({
      initialState: {
        model: execution.model,
        thinkingLevel: "off",
        systemPrompt: execution.systemPrompt,
        tools: [...execution.tools],
        messages: []
      },
      streamFn: execution.streamFn,
      convertToLlm: (messages: readonly unknown[]) => messages,
      beforeToolCall: async ({ toolCall, args }: { toolCall: { id: string; name: string }; args: unknown }) => {
        const verdict = await execution.authorizeTool({ toolCallId: toolCall.id, name: toolCall.name, input: args });
        return verdict.allowed ? undefined : { block: true, reason: verdict.reason ?? "controller denied" };
      }
    });
    const state = this.#sessions.open(sessionId, sink, { agent });
    state.emit({ type: "session.started", sessionId });
    state.emit({
      type: "model.resolved",
      passportRef: request.passportRef,
      provider: execution.model.provider,
      api: execution.model.api,
      resolvedModel: execution.model.id
    });
    state.resources.unsubscribe = agent.subscribe((event) => {
      const delta = textDelta(event);
      if (delta !== undefined) state.emit({ type: "content.delta", text: delta });
      if (
        event.type === "tool_execution_start" &&
        typeof event.toolCallId === "string" &&
        typeof event.toolName === "string"
      )
        state.emit({
          type: "tool.requested",
          toolCallId: event.toolCallId,
          name: event.toolName,
          input: event.args
        });
    });
    const abort = () => agent.abort();
    signal.addEventListener("abort", abort, { once: true });
    // invariant: a cancel releases the agent, and a release resets its
    // transcript. The run reads how it ended from that transcript, so a cancel
    // waits until the run has reported.
    const runEnded = state.runStarted();
    try {
      await agent.prompt(execution.prompt);
      reportRunEnd(state, agent.state.messages);
    } catch {
      state.outcome = signal.aborted ? "cancelled" : "failed";
      state.emit({
        type: "error",
        code: signal.aborted ? "VES_PI_ABORTED" : "VES_PI_RUNTIME_FAILED",
        message: signal.aborted ? "Pi run was aborted" : "Pi runtime failed",
        retryable: signal.aborted
      });
    } finally {
      signal.removeEventListener("abort", abort);
      runEnded();
    }
    return Object.freeze({ sessionId });
  }

  async send(session: DriverSessionRef, input: Readonly<Record<string, unknown>>): Promise<void> {
    const state = this.#sessions.active(session);
    if (input["type"] !== "user.input" || typeof input["text"] !== "string")
      throw piError("VES_DRIVER_INPUT_INVALID", "Pi Driver input is invalid");
    await state.resources.agent.prompt(input["text"]);
  }

  async cancel(session: DriverSessionRef, reason: string): Promise<void> {
    await this.#sessions.cancel(session, reason);
  }

  async close(session: DriverSessionRef) {
    return this.#sessions.close(session);
  }

  #validateExecution(request: DriverStartRequest, execution: PiExecution): void {
    if (
      typeof execution.prompt !== "string" ||
      execution.prompt.length === 0 ||
      execution.systemPrompt !== "" ||
      !Number.isSafeInteger(execution.model.contextWindow) ||
      execution.model.contextWindow < 1 ||
      !Number.isSafeInteger(execution.model.maxTokens) ||
      execution.model.maxTokens < 1
    )
      throw piError("VES_PI_CONTEXT_INVALID", "Pi serialized context is invalid");
    if (
      execution.passport.passportId !== request.passportRef.passportId ||
      execution.passport.revision !== request.passportRef.revision ||
      execution.passport.provider !== execution.model.provider ||
      execution.passport.api !== execution.model.api ||
      execution.passport.resolvedModel !== execution.model.id
    )
      throw piError("VES_PI_IDENTITY_MISMATCH", "Pi resolved identity does not match the selected Passport");
    const declared = request.tools.map((tool) => `${tool.name}:${tool.inputSchemaDigest}`).sort();
    const concrete = execution.tools.map((tool) => `${tool.name}:${tool.inputSchemaDigest}`).sort();
    if (declared.length !== concrete.length || declared.some((entry, index) => entry !== concrete[index]))
      throw piError("VES_PI_TOOLSET_MISMATCH", "Pi concrete tools do not match the authorized manifest");
  }
}
