import { createHash } from "node:crypto";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,511}$/u;
const EVENT_TYPES = [
  "session.started",
  "model.resolved",
  "content.delta",
  "tool.requested",
  "usage.updated",
  "warning",
  "error",
  "session.closed"
] as const;

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

export interface DriverProtocolEnvelope {
  readonly protocol: "verchestra/1";
  readonly messageId: string;
  readonly correlationId: string;
  readonly workspaceId: string;
  readonly runId?: string;
  readonly sequence: number;
  readonly sentAt: string;
  readonly payloadSchema: { readonly name: string; readonly version: number };
  readonly payloadDigest: string;
  readonly payload: unknown;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(typeof value === "string" ? value : canonicalJson(value))
    .digest("hex")}`;
}

function terminate(code: string, message: string): never {
  throw new DriverProtocolError(code, message, { terminateHost: true, revokeGrants: true });
}

function completeEnvelope(
  input: Omit<DriverProtocolEnvelope, "payloadDigest"> & { readonly payloadDigest?: string }
): DriverProtocolEnvelope {
  return Object.freeze({ ...input, payloadDigest: input.payloadDigest ?? sha256(input.payload) });
}

export function encodeDriverFrame(
  input: Omit<DriverProtocolEnvelope, "payloadDigest"> & { readonly payloadDigest?: string }
): Buffer {
  const envelope = completeEnvelope(input);
  const body = Buffer.from(JSON.stringify(envelope), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

function validateEnvelope(value: unknown, workspaceId: string): DriverProtocolEnvelope {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    terminate("VES_DRIVER_ENVELOPE_INVALID", "Driver envelope is invalid");
  const envelope = value as DriverProtocolEnvelope;
  const envelopeKeys = Object.keys(envelope).sort();
  const requiredKeys = [
    "correlationId",
    "messageId",
    "payload",
    "payloadDigest",
    "payloadSchema",
    "protocol",
    "sentAt",
    "sequence",
    "workspaceId"
  ];
  if ("runId" in envelope) requiredKeys.push("runId");
  requiredKeys.sort();
  const sentAt = typeof envelope.sentAt === "string" ? new Date(envelope.sentAt) : undefined;
  if (
    envelopeKeys.length !== requiredKeys.length ||
    envelopeKeys.some((key, index) => key !== requiredKeys[index]) ||
    envelope.protocol !== "verchestra/1" ||
    typeof envelope.messageId !== "string" ||
    !SAFE.test(envelope.messageId) ||
    typeof envelope.correlationId !== "string" ||
    !SAFE.test(envelope.correlationId) ||
    !Number.isSafeInteger(envelope.sequence) ||
    envelope.sequence < 0 ||
    typeof envelope.sentAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(envelope.sentAt) ||
    sentAt === undefined ||
    Number.isNaN(sentAt.valueOf()) ||
    sentAt.toISOString() !== envelope.sentAt ||
    envelope.payloadSchema === null ||
    typeof envelope.payloadSchema !== "object" ||
    Array.isArray(envelope.payloadSchema) ||
    Object.keys(envelope.payloadSchema).sort().join(",") !== "name,version" ||
    !SAFE.test(envelope.payloadSchema.name) ||
    !Number.isSafeInteger(envelope.payloadSchema.version) ||
    envelope.payloadSchema.version < 1 ||
    !DIGEST.test(envelope.payloadDigest)
  )
    terminate("VES_DRIVER_ENVELOPE_INVALID", "Driver envelope schema is invalid");
  if ("runId" in envelope && (typeof envelope.runId !== "string" || !SAFE.test(envelope.runId)))
    terminate("VES_DRIVER_ENVELOPE_INVALID", "Driver envelope Run identity is invalid");
  if (envelope.workspaceId !== workspaceId)
    terminate("VES_DRIVER_ENVELOPE_WORKSPACE", "Driver envelope belongs to another Workspace");
  if (envelope.payloadDigest !== sha256(envelope.payload))
    terminate("VES_DRIVER_ENVELOPE_DIGEST", "Driver envelope payload digest is invalid");
  return Object.freeze(envelope);
}

export class DriverFrameDecoder {
  readonly #workspaceId: string;
  readonly #maximumHeaderBytes: number;
  readonly #maximumMessageBytes: number;
  #buffer = Buffer.alloc(0);
  #pendingLength: number | undefined;
  lastPayloadDigest = "";

  constructor(options: {
    readonly workspaceId: string;
    readonly maximumHeaderBytes: number;
    readonly maximumMessageBytes: number;
  }) {
    this.#workspaceId = options.workspaceId;
    this.#maximumHeaderBytes = options.maximumHeaderBytes;
    this.#maximumMessageBytes = options.maximumMessageBytes;
  }

  push(chunk: Uint8Array): readonly DriverProtocolEnvelope[] {
    this.#buffer = Buffer.concat([this.#buffer, Buffer.from(chunk)]);
    const messages: DriverProtocolEnvelope[] = [];
    while (true) {
      if (this.#pendingLength === undefined) {
        const boundary = this.#buffer.indexOf("\r\n\r\n");
        if (boundary < 0) {
          if (this.#buffer.length > this.#maximumHeaderBytes)
            terminate("VES_DRIVER_FRAME_HEADER_LIMIT", "Driver frame header exceeds its limit");
          break;
        }
        if (boundary > this.#maximumHeaderBytes)
          terminate("VES_DRIVER_FRAME_HEADER_LIMIT", "Driver frame header exceeds its limit");
        const lines = this.#buffer.subarray(0, boundary).toString("ascii").split("\r\n");
        const lengthLines = lines.filter((line) => line.toLowerCase().startsWith("content-length:"));
        if (lengthLines.length === 0)
          terminate("VES_DRIVER_FRAME_LENGTH_REQUIRED", "Driver frame requires Content-Length");
        if (lines.length !== 1 || lengthLines.length !== 1)
          terminate("VES_DRIVER_FRAME_HEADER_INVALID", "Driver frame headers are invalid");
        const line = lengthLines[0] as string;
        const raw = line.slice(line.indexOf(":") + 1).trim();
        if (!/^(0|[1-9]\d*)$/u.test(raw))
          terminate("VES_DRIVER_FRAME_LENGTH_INVALID", "Driver frame length is invalid");
        const length = Number(raw);
        if (!Number.isSafeInteger(length))
          terminate("VES_DRIVER_FRAME_LENGTH_INVALID", "Driver frame length is not safe");
        if (length > this.#maximumMessageBytes)
          terminate("VES_DRIVER_FRAME_MESSAGE_LIMIT", "Driver frame body exceeds its limit");
        this.#pendingLength = length;
        this.#buffer = this.#buffer.subarray(boundary + 4);
      }
      if (this.#buffer.length < this.#pendingLength) break;
      const body = this.#buffer.subarray(0, this.#pendingLength);
      this.#buffer = this.#buffer.subarray(this.#pendingLength);
      this.#pendingLength = undefined;
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        terminate("VES_DRIVER_FRAME_JSON_INVALID", "Driver frame body is invalid JSON");
      }
      const envelope = validateEnvelope(parsed, this.#workspaceId);
      this.lastPayloadDigest = envelope.payloadDigest;
      messages.push(envelope);
    }
    return Object.freeze(messages);
  }
}

export class DriverSequenceGuard {
  #nextSequence = 0;
  readonly #messages = new Map<string, string>();

  accept(envelope: Pick<DriverProtocolEnvelope, "messageId" | "sequence" | "payloadDigest">) {
    const recorded = this.#messages.get(envelope.messageId);
    if (recorded !== undefined) {
      if (recorded !== envelope.payloadDigest)
        terminate("VES_DRIVER_MESSAGE_CONFLICT", "Driver message identity was reused incompatibly");
      return Object.freeze({ accepted: false, duplicate: true, nextSequence: this.#nextSequence });
    }
    if (envelope.sequence !== this.#nextSequence)
      terminate("VES_DRIVER_SEQUENCE_GAP", "Driver message sequence is not contiguous");
    this.#messages.set(envelope.messageId, envelope.payloadDigest);
    this.#nextSequence += 1;
    return Object.freeze({ accepted: true, duplicate: false, nextSequence: this.#nextSequence });
  }
}

interface ControllerHandshake {
  readonly protocol: "verchestra/1";
  readonly requiredSchemas: readonly string[];
  readonly supportedSchemas: readonly string[];
  readonly expectedComponent: { readonly id: string; readonly digest: string };
  readonly allowedCapabilities: readonly string[];
  readonly maxMessageBytes: number;
}

interface WorkerHandshake {
  readonly protocol: string;
  readonly supportedSchemas: readonly string[];
  readonly component: { readonly id: string; readonly digest: string };
  readonly capabilities: readonly string[];
  readonly maxMessageBytes: number;
}

function handshakeFailure(code: string, message: string): never {
  throw new DriverProtocolError(code, message, { terminateHost: true, revokeGrants: true });
}

export function negotiateDriverHandshake(controller: ControllerHandshake, worker: WorkerHandshake) {
  if (controller.protocol !== "verchestra/1" || worker.protocol !== controller.protocol)
    handshakeFailure("VES_DRIVER_HANDSHAKE_PROTOCOL", "Driver protocol is incompatible");
  const schemas = controller.supportedSchemas.filter((entry) => worker.supportedSchemas.includes(entry));
  if (controller.requiredSchemas.some((entry) => !schemas.includes(entry)))
    handshakeFailure("VES_DRIVER_HANDSHAKE_SCHEMA", "Driver required schemas are unavailable");
  if (
    worker.component.id !== controller.expectedComponent.id ||
    worker.component.digest !== controller.expectedComponent.digest
  )
    handshakeFailure("VES_DRIVER_HANDSHAKE_IDENTITY", "Driver component identity is incompatible");
  if (worker.capabilities.some((entry) => !controller.allowedCapabilities.includes(entry)))
    handshakeFailure("VES_DRIVER_HANDSHAKE_CAPABILITY", "Driver capability exceeds its grant");
  return Object.freeze({
    protocol: controller.protocol,
    schemas: Object.freeze(schemas),
    component: Object.freeze({ ...worker.component }),
    capabilities: Object.freeze([...worker.capabilities]),
    maximumMessageBytes: Math.min(controller.maxMessageBytes, worker.maxMessageBytes)
  });
}

export class BoundedDriverEventQueue<T = unknown> {
  readonly #capacity: number;
  readonly #highWater: number;
  readonly #lowWater: number;
  readonly #items: T[] = [];
  #paused = false;

  constructor(options: { readonly capacity: number; readonly highWater: number; readonly lowWater: number }) {
    if (
      !Number.isSafeInteger(options.capacity) ||
      !Number.isSafeInteger(options.highWater) ||
      !Number.isSafeInteger(options.lowWater) ||
      options.capacity < options.highWater ||
      options.highWater <= options.lowWater ||
      options.lowWater < 0
    )
      throw new TypeError("Driver queue bounds are invalid");
    this.#capacity = options.capacity;
    this.#highWater = options.highWater;
    this.#lowWater = options.lowWater;
  }

  push(value: T) {
    if (this.#items.length === this.#capacity)
      throw new DriverProtocolError("VES_DRIVER_BACKPRESSURE_LIMIT", "Driver event queue is full", {
        cancellationRequired: true
      });
    this.#items.push(value);
    if (this.#items.length >= this.#highWater) this.#paused = true;
    return Object.freeze({ size: this.#items.length, pauseReads: this.#paused });
  }

  shift() {
    const value = this.#items.shift();
    const resumeReads = this.#paused && this.#items.length <= this.#lowWater;
    if (resumeReads) this.#paused = false;
    return Object.freeze({ value, size: this.#items.length, resumeReads });
  }
}

export async function escalateDriverCancellation(ports: {
  readonly protocolCancel: () => Promise<unknown>;
  readonly waitForExit: () => Promise<boolean>;
  readonly signalProcess: () => Promise<unknown>;
  readonly killTree: () => Promise<unknown>;
}) {
  const evidence = ["protocol-cancel"];
  await ports.protocolCancel();
  if (await ports.waitForExit())
    return Object.freeze({
      terminated: true,
      stage: "protocol-cancel",
      evidence: Object.freeze([...evidence, "protocol-exit"])
    });
  evidence.push("grace-expired", "process-signal");
  await ports.signalProcess();
  if (await ports.waitForExit())
    return Object.freeze({
      terminated: true,
      stage: "process-signal",
      evidence: Object.freeze([...evidence, "signal-exit"])
    });
  evidence.push("signal-grace-expired", "process-tree-kill");
  await ports.killTree();
  return Object.freeze({ terminated: true, stage: "process-tree-kill", evidence: Object.freeze(evidence) });
}

type DriverEventType = (typeof EVENT_TYPES)[number];
export type DriverEvent = Readonly<Record<string, unknown>> & {
  readonly type: DriverEventType;
  readonly sequence: number;
};

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

function validateScriptEvent(event: Readonly<Record<string, unknown>>): void {
  if (
    !EVENT_TYPES.includes(event["type"] as DriverEventType) ||
    event["type"] === "session.started" ||
    event["type"] === "model.resolved" ||
    event["type"] === "session.closed"
  )
    throw new DriverProtocolError("VES_DRIVER_EVENT_INVALID", "Mock Driver scenario event is invalid");
  const expectedKeys: Readonly<Record<string, readonly string[]>> = {
    "content.delta": ["text", "type"],
    "tool.requested": ["input", "name", "toolCallId", "type"],
    "usage.updated": ["inputTokens", "outputTokens", "type"],
    warning: ["code", "message", "type"],
    error: ["code", "message", "retryable", "type"]
  };
  if (Object.keys(event).sort().join(",") !== expectedKeys[event["type"] as string]?.join(","))
    throw new DriverProtocolError("VES_DRIVER_EVENT_INVALID", "Mock Driver scenario event fields are invalid");
  if (event["type"] === "content.delta" && typeof event["text"] !== "string")
    throw new DriverProtocolError("VES_DRIVER_EVENT_INVALID", "Mock content event is invalid");
  if (
    event["type"] === "tool.requested" &&
    (typeof event["toolCallId"] !== "string" || typeof event["name"] !== "string")
  )
    throw new DriverProtocolError("VES_DRIVER_EVENT_INVALID", "Mock tool event is invalid");
  if (
    event["type"] === "usage.updated" &&
    (!Number.isSafeInteger(event["inputTokens"]) || !Number.isSafeInteger(event["outputTokens"]))
  )
    throw new DriverProtocolError("VES_DRIVER_EVENT_INVALID", "Mock usage event is invalid");
  if (
    (event["type"] === "warning" || event["type"] === "error") &&
    (typeof event["code"] !== "string" || typeof event["message"] !== "string")
  )
    throw new DriverProtocolError("VES_DRIVER_EVENT_INVALID", "Mock diagnostic event is invalid");
  if (event["type"] === "error" && typeof event["retryable"] !== "boolean")
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
  readonly #scenario: readonly Readonly<Record<string, unknown>>[];
  readonly #sessions = new Map<string, { sink: (event: DriverEvent) => void; sequence: number; closed: boolean }>();

  constructor(options: { readonly scenario: readonly Readonly<Record<string, unknown>>[] }) {
    for (const event of options.scenario) validateScriptEvent(event);
    this.#scenario = Object.freeze(options.scenario.map((entry) => Object.freeze({ ...entry })));
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
    const sessionId = `mock-session:${sha256(request).slice(7, 31)}`;
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

  #emit(
    state: { sink: (event: DriverEvent) => void; sequence: number },
    event: Readonly<Record<string, unknown>>
  ): void {
    const emitted = Object.freeze({ ...event, sequence: state.sequence }) as DriverEvent;
    state.sequence += 1;
    state.sink(emitted);
  }
}

export class FramedDriverHostAdapter {
  readonly #decoder: DriverFrameDecoder;
  readonly #sequence = new DriverSequenceGuard();

  constructor(options: {
    readonly workspaceId: string;
    readonly maximumHeaderBytes: number;
    readonly maximumMessageBytes: number;
  }) {
    this.#decoder = new DriverFrameDecoder(options);
  }

  push(chunk: Uint8Array): readonly DriverProtocolEnvelope[] {
    return Object.freeze(this.#decoder.push(chunk).filter((entry) => this.#sequence.accept(entry).accepted));
  }
}

export class DriverSupervisor {
  readonly #queue: BoundedDriverEventQueue<DriverEvent>;
  readonly #cancellation: Parameters<typeof escalateDriverCancellation>[0];
  #nextSequence = 0;

  constructor(options: {
    readonly queue: { readonly capacity: number; readonly highWater: number; readonly lowWater: number };
    readonly cancellation: Parameters<typeof escalateDriverCancellation>[0];
  }) {
    this.#queue = new BoundedDriverEventQueue(options.queue);
    this.#cancellation = options.cancellation;
  }

  accept(event: DriverEvent) {
    if (!EVENT_TYPES.includes(event.type) || !Number.isSafeInteger(event.sequence) || event.sequence < 0)
      throw new DriverProtocolError("VES_DRIVER_EVENT_INVALID", "Driver event is invalid", {
        cancellationRequired: true
      });
    if (event.sequence !== this.#nextSequence)
      throw new DriverProtocolError("VES_DRIVER_EVENT_SEQUENCE", "Driver event sequence is not contiguous", {
        cancellationRequired: true
      });
    this.#nextSequence += 1;
    return this.#queue.push(event);
  }

  next() {
    return this.#queue.shift();
  }

  async cancel() {
    return escalateDriverCancellation(this.#cancellation);
  }
}

export { PiDriver } from "./pi-driver.ts";
export type { PiDriverDependencies, PiExecution } from "./pi-driver.ts";
export { ClaudeCodeDriver } from "./claude-code-driver.ts";
export type { ClaudeCodeDriverDependencies, ClaudeCodeExecution } from "./claude-code-driver.ts";
