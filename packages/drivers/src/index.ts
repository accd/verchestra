import { createHash } from "node:crypto";

import {
  DRIVER_EVENT_FIELDS,
  canonicalizeJsonV2,
  isDriverEventType,
  usageCount,
  type DriverEvent,
  type DriverEventBody
} from "@verchestra/domain";

export type { DriverEvent, DriverEventBody, DriverEventOf, DriverEventType } from "@verchestra/domain";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,511}$/u;

export const packageName = "@verchestra/drivers" as const;

export class DriverProtocolError extends Error {
  readonly code: string;
  readonly terminateHost: boolean;
  readonly revokeGrants: boolean;
  readonly cancellationRequired: boolean;

  constructor(
    code: string,
    message: string,
    flags: {
      readonly terminateHost?: boolean;
      readonly revokeGrants?: boolean;
      readonly cancellationRequired?: boolean;
    } = {}
  ) {
    super(message);
    this.name = "DriverProtocolError";
    this.code = code;
    this.terminateHost = flags.terminateHost ?? false;
    this.revokeGrants = flags.revokeGrants ?? false;
    this.cancellationRequired = flags.cancellationRequired ?? false;
  }
}

export interface DriverSessionRef {
  readonly sessionId: string;
}

export interface DriverStartRequest {
  readonly workspaceId: string;
  readonly runId: string;
  readonly passportRef: { readonly passportId: string; readonly revision: number };
  readonly serializedContextRef: { readonly manifestId: string; readonly target: string };
  readonly tools: readonly { readonly name: string; readonly inputSchemaDigest: string }[];
}

export interface Driver {
  probe(): Promise<Readonly<Record<string, unknown>>>;
  start(
    request: DriverStartRequest,
    sink: (event: DriverEvent) => void,
    signal: AbortSignal
  ): Promise<DriverSessionRef>;
  send(session: DriverSessionRef, input: Readonly<Record<string, unknown>>): Promise<void>;
  cancel(session: DriverSessionRef, reason: string): Promise<void>;
  close(session: DriverSessionRef): Promise<Readonly<Record<string, unknown>>>;
}

const byName = (left: string, right: string) => Number(left > right) - Number(left < right);

// invariant: a scripted event carries exactly the fields its type always has
// in the field table, and its type is one a driver emits during a session.
function scriptedFields(event: Readonly<Record<string, unknown>>): DriverEventBody["type"] {
  const type = event["type"];
  if (!isDriverEventType(type) || type === "session.started" || type === "model.resolved" || type === "session.closed")
    throw new DriverProtocolError("VES_DRIVER_EVENT_INVALID", "Mock Driver scenario event is invalid");
  const always = Object.entries(DRIVER_EVENT_FIELDS[type])
    .filter(([, kind]) => !kind.endsWith("?"))
    .map(([field]) => field);
  if (Object.keys(event).sort(byName).join(",") !== [...always, "type"].sort(byName).join(","))
    throw new DriverProtocolError("VES_DRIVER_EVENT_INVALID", "Mock Driver scenario event fields are invalid");
  return type;
}

// why: a scripted count is one the usage rule reads as itself, so the mock
// emits no usage that a driver could not.
const isCount = (value: unknown) => usageCount(value) === value;

function validateScriptEvent(event: Readonly<Record<string, unknown>>): asserts event is DriverEventBody {
  const type = scriptedFields(event);
  if (type === "content.delta" && typeof event["text"] !== "string")
    throw new DriverProtocolError("VES_DRIVER_EVENT_INVALID", "Mock content event is invalid");
  if (type === "tool.requested" && (typeof event["toolCallId"] !== "string" || typeof event["name"] !== "string"))
    throw new DriverProtocolError("VES_DRIVER_EVENT_INVALID", "Mock tool event is invalid");
  if (type === "usage.updated" && (!isCount(event["inputTokens"]) || !isCount(event["outputTokens"])))
    throw new DriverProtocolError("VES_DRIVER_EVENT_INVALID", "Mock usage event is invalid");
  if (
    (type === "warning" || type === "error") &&
    (typeof event["code"] !== "string" || typeof event["message"] !== "string")
  )
    throw new DriverProtocolError("VES_DRIVER_EVENT_INVALID", "Mock diagnostic event is invalid");
  if (type === "error" && typeof event["retryable"] !== "boolean")
    throw new DriverProtocolError("VES_DRIVER_EVENT_INVALID", "Mock error event is invalid");
}

export function validateDriverStartRequest(request: DriverStartRequest): void {
  if (request === null || typeof request !== "object")
    throw new DriverProtocolError("VES_DRIVER_START_INVALID", "Driver start request is invalid");
  const tools = Array.isArray(request.tools) ? request.tools : [];
  const toolNames = new Set<string>();
  const validTools =
    tools.length === request.tools?.length &&
    tools.every((tool) => {
      const valid =
        tool !== null &&
        typeof tool === "object" &&
        Object.keys(tool).sort().join(",") === "inputSchemaDigest,name" &&
        typeof tool.name === "string" &&
        SAFE.test(tool.name) &&
        DIGEST.test(tool.inputSchemaDigest) &&
        !toolNames.has(tool.name);
      if (valid) toolNames.add(tool.name);
      return valid;
    });
  if (
    Object.keys(request).sort().join(",") !== "passportRef,runId,serializedContextRef,tools,workspaceId" ||
    typeof request.workspaceId !== "string" ||
    !request.workspaceId.startsWith("workspace_") ||
    !SAFE.test(request.workspaceId) ||
    typeof request.runId !== "string" ||
    !request.runId.startsWith("run_") ||
    !SAFE.test(request.runId) ||
    request.passportRef === null ||
    typeof request.passportRef !== "object" ||
    Object.keys(request.passportRef).sort().join(",") !== "passportId,revision" ||
    typeof request.passportRef.passportId !== "string" ||
    !request.passportRef.passportId.startsWith("passport_") ||
    !SAFE.test(request.passportRef.passportId) ||
    !Number.isSafeInteger(request.passportRef.revision) ||
    request.passportRef.revision < 1 ||
    request.serializedContextRef === null ||
    typeof request.serializedContextRef !== "object" ||
    Object.keys(request.serializedContextRef).sort().join(",") !== "manifestId,target" ||
    !DIGEST.test(request.serializedContextRef.manifestId) ||
    !SAFE.test(request.serializedContextRef.target) ||
    !validTools
  )
    throw new DriverProtocolError("VES_DRIVER_START_INVALID", "Driver start request is invalid");
}

export class DeterministicMockDriver implements Driver {
  readonly #scenario: readonly DriverEventBody[];
  readonly #sessions = new Map<string, { sink: (event: DriverEvent) => void; sequence: number; closed: boolean }>();

  constructor(options: { readonly scenario: readonly Readonly<Record<string, unknown>>[] }) {
    const scenario: DriverEventBody[] = [];
    for (const event of options.scenario) {
      validateScriptEvent(event);
      scenario.push(event);
    }
    this.#scenario = Object.freeze(scenario.map((entry) => Object.freeze({ ...entry })));
  }

  async probe() {
    return Object.freeze({ driverId: "mock", capabilities: Object.freeze(["stream", "tools", "usage"]) });
  }

  async start(
    request: DriverStartRequest,
    sink: (event: DriverEvent) => void,
    signal: AbortSignal
  ): Promise<DriverSessionRef> {
    if (signal.aborted) throw new DriverProtocolError("VES_DRIVER_CANCELLED", "Mock Driver start was cancelled");
    validateDriverStartRequest(request);
    const sessionId = `mock-session:${createHash("sha256").update(canonicalizeJsonV2(request)).digest("hex").slice(0, 24)}`;
    const state = { sink, sequence: 0, closed: false };
    this.#sessions.set(sessionId, state);
    this.#emit(state, { type: "session.started", sessionId });
    this.#emit(state, { type: "model.resolved", passportRef: request.passportRef });
    for (const event of this.#scenario) this.#emit(state, event);
    return Object.freeze({ sessionId });
  }

  async send(session: DriverSessionRef, input: Readonly<Record<string, unknown>>): Promise<void> {
    const state = this.#active(session);
    if (input["type"] !== "user.input" || typeof input["text"] !== "string")
      throw new DriverProtocolError("VES_DRIVER_INPUT_INVALID", "Driver input is invalid");
    this.#emit(state, { type: "content.delta", text: input["text"] });
  }

  async cancel(session: DriverSessionRef, reason: string): Promise<void> {
    const state = this.#sessions.get(session.sessionId);
    if (state === undefined) throw new DriverProtocolError("VES_DRIVER_SESSION_UNKNOWN", "Driver session is unknown");
    if (!state.closed) {
      this.#emit(state, { type: "session.closed", outcome: "cancelled", reason });
      state.closed = true;
    }
  }

  async close(session: DriverSessionRef) {
    const state = this.#sessions.get(session.sessionId);
    if (state === undefined) throw new DriverProtocolError("VES_DRIVER_SESSION_UNKNOWN", "Driver session is unknown");
    if (!state.closed) {
      this.#emit(state, { type: "session.closed", outcome: "completed" });
      state.closed = true;
    }
    return Object.freeze({ sessionId: session.sessionId, closed: true, finalSequence: state.sequence });
  }

  #active(session: DriverSessionRef) {
    const state = this.#sessions.get(session.sessionId);
    if (state === undefined) throw new DriverProtocolError("VES_DRIVER_SESSION_UNKNOWN", "Driver session is unknown");
    if (state.closed) throw new DriverProtocolError("VES_DRIVER_SESSION_CLOSED", "Driver session is closed");
    return state;
  }

  #emit(state: { sink: (event: DriverEvent) => void; sequence: number }, event: DriverEventBody): void {
    const emitted: DriverEvent = Object.freeze({ ...event, sequence: state.sequence });
    state.sequence += 1;
    state.sink(emitted);
  }
}

export { PiDriver } from "./pi-driver.ts";
export type { PiDriverDependencies, PiExecution } from "./pi-driver.ts";
export {
  CLAUDE_MEDIATED_MINIMUM_VERSION,
  CLAUDE_MEDIATED_TOOLS,
  CLAUDE_PROFILE_CREDENTIAL_VARIABLES,
  CLAUDE_SUBSCRIPTION_SETTINGS,
  ClaudeCodeDriver
} from "./claude-code-driver.ts";
export type {
  ClaudeCodeDriverDependencies,
  ClaudeCodeExecution,
  ClaudeCodeMediatedProfile,
  ClaudeCodeMediation
} from "./claude-code-driver.ts";
export { CodexDriver } from "./codex-driver.ts";
export type { CodexDriverDependencies, CodexExecution } from "./codex-driver.ts";
export type { CodexProcessContext } from "./codex-process-context.ts";
export { OpenCodeDriver } from "./opencode-driver.ts";
export type { OpenCodeDriverDependencies, OpenCodeExecution } from "./opencode-driver.ts";
