import { createHash, randomUUID } from "node:crypto";

export const packageName = "@verchestra/extension-host" as const;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,511}$/u;

type UnknownRecord = Readonly<Record<string, unknown>>;

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as UnknownRecord)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

export class ProbeProtocolError extends Error {
  readonly code: string;
  readonly terminateWorker: boolean;
  readonly revokeGrant: boolean;

  constructor(code: string, message: string, terminateWorker = false, revokeGrant = false) {
    super(message);
    this.name = "ProbeProtocolError";
    this.code = code;
    this.terminateWorker = terminateWorker;
    this.revokeGrant = revokeGrant;
  }
}

function fail(code: string, message: string): never {
  throw new ProbeProtocolError(code, message);
}

function terminate(code: string, message: string): never {
  throw new ProbeProtocolError(code, message, true, true);
}

export interface ProbeProtocolEnvelope {
  readonly protocol: "verchestra-probe/1";
  readonly messageId: string;
  readonly correlationId: string;
  readonly workspaceId: string;
  readonly sequence: number;
  readonly sentAt: string;
  readonly payloadSchema: { readonly name: string; readonly version: number };
  readonly payloadDigest: string;
  readonly payload: unknown;
}

type ProbeEnvelopeInput = Omit<ProbeProtocolEnvelope, "sentAt" | "payloadDigest"> & {
  readonly sentAt?: string;
  readonly payloadDigest?: string;
};

export function encodeProbeFrame(input: ProbeEnvelopeInput): Buffer {
  const envelope: ProbeProtocolEnvelope = Object.freeze({
    ...input,
    sentAt: input.sentAt ?? "1970-01-01T00:00:00.000Z",
    payloadDigest: input.payloadDigest ?? digest(input.payload)
  });
  const body = Buffer.from(JSON.stringify(envelope), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

function validateEnvelope(value: unknown, workspaceId: string): ProbeProtocolEnvelope {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    terminate("VES_PROBE_ENVELOPE_INVALID", "Probe envelope is invalid");
  }
  const envelope = value as ProbeProtocolEnvelope;
  const keys = Object.keys(envelope).sort().join(",");
  const sentAt = typeof envelope.sentAt === "string" ? new Date(envelope.sentAt) : undefined;
  if (
    keys !== "correlationId,messageId,payload,payloadDigest,payloadSchema,protocol,sentAt,sequence,workspaceId" ||
    envelope.protocol !== "verchestra-probe/1" ||
    typeof envelope.messageId !== "string" ||
    !SAFE.test(envelope.messageId) ||
    typeof envelope.correlationId !== "string" ||
    !SAFE.test(envelope.correlationId) ||
    !Number.isSafeInteger(envelope.sequence) ||
    envelope.sequence < 0 ||
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
  ) {
    terminate("VES_PROBE_ENVELOPE_INVALID", "Probe envelope schema is invalid");
  }
  if (envelope.workspaceId !== workspaceId) {
    terminate("VES_PROBE_ENVELOPE_WORKSPACE", "Probe envelope belongs to another Workspace");
  }
  if (envelope.payloadDigest !== digest(envelope.payload)) {
    terminate("VES_PROBE_ENVELOPE_DIGEST", "Probe envelope payload digest is invalid");
  }
  return Object.freeze(envelope);
}

export class ProbeFrameDecoder {
  readonly #workspaceId: string;
  readonly #maximumHeaderBytes: number;
  readonly #maximumMessageBytes: number;
  #buffer = Buffer.alloc(0);
  #pendingLength: number | undefined;

  constructor(options: {
    readonly workspaceId: string;
    readonly maximumHeaderBytes: number;
    readonly maximumMessageBytes: number;
  }) {
    this.#workspaceId = options.workspaceId;
    this.#maximumHeaderBytes = options.maximumHeaderBytes;
    this.#maximumMessageBytes = options.maximumMessageBytes;
  }

  push(chunk: Uint8Array): readonly ProbeProtocolEnvelope[] {
    this.#buffer = Buffer.concat([this.#buffer, Buffer.from(chunk)]);
    const messages: ProbeProtocolEnvelope[] = [];
    while (true) {
      if (this.#pendingLength === undefined) {
        const boundary = this.#buffer.indexOf("\r\n\r\n");
        if (boundary < 0) {
          if (this.#buffer.length > this.#maximumHeaderBytes) {
            terminate("VES_PROBE_FRAME_HEADER_LIMIT", "Probe frame header exceeds its limit");
          }
          break;
        }
        if (boundary > this.#maximumHeaderBytes) {
          terminate("VES_PROBE_FRAME_HEADER_LIMIT", "Probe frame header exceeds its limit");
        }
        const lines = this.#buffer.subarray(0, boundary).toString("ascii").split("\r\n");
        const lengths = lines.filter((line) => line.toLowerCase().startsWith("content-length:"));
        if (lengths.length === 0) terminate("VES_PROBE_FRAME_LENGTH_REQUIRED", "Probe frame requires Content-Length");
        if (lines.length !== 1 || lengths.length !== 1) {
          terminate("VES_PROBE_FRAME_HEADER_INVALID", "Probe frame headers are invalid");
        }
        const line = lengths[0] as string;
        const raw = line.slice(line.indexOf(":") + 1).trim();
        if (!/^(0|[1-9]\d*)$/u.test(raw)) {
          terminate("VES_PROBE_FRAME_LENGTH_INVALID", "Probe frame length is invalid");
        }
        const length = Number(raw);
        if (!Number.isSafeInteger(length)) terminate("VES_PROBE_FRAME_LENGTH_INVALID", "Probe frame length is unsafe");
        if (length > this.#maximumMessageBytes) {
          terminate("VES_PROBE_FRAME_MESSAGE_LIMIT", "Probe frame body exceeds its limit");
        }
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
        terminate("VES_PROBE_FRAME_JSON_INVALID", "Probe frame body is invalid JSON");
      }
      messages.push(validateEnvelope(parsed, this.#workspaceId));
    }
    return Object.freeze(messages);
  }
}

export class ProbeSequenceGuard {
  #nextSequence = 0;
  readonly #messages = new Map<string, string>();

  accept(envelope: Pick<ProbeProtocolEnvelope, "messageId" | "sequence" | "payloadDigest">) {
    const recorded = this.#messages.get(envelope.messageId);
    if (recorded !== undefined) {
      if (recorded !== envelope.payloadDigest) {
        terminate("VES_PROBE_MESSAGE_CONFLICT", "Probe message identity was reused incompatibly");
      }
      return Object.freeze({ accepted: false, duplicate: true, nextSequence: this.#nextSequence });
    }
    if (envelope.sequence !== this.#nextSequence) {
      terminate("VES_PROBE_SEQUENCE_GAP", "Probe message sequence is not contiguous");
    }
    this.#messages.set(envelope.messageId, envelope.payloadDigest);
    this.#nextSequence += 1;
    return Object.freeze({ accepted: true, duplicate: false, nextSequence: this.#nextSequence });
  }
}

interface ProbeControllerHandshake {
  readonly protocol: "verchestra-probe/1";
  readonly requiredSchemas: readonly string[];
  readonly expectedComponent: { readonly id: string; readonly digest: string };
  readonly allowedCapabilities: readonly string[];
  readonly maximumMessageBytes: number;
}

interface ProbeWorkerHandshake {
  readonly protocol: string;
  readonly supportedSchemas: readonly string[];
  readonly component: { readonly id: string; readonly digest: string };
  readonly capabilities: readonly string[];
  readonly maximumMessageBytes: number;
}

export function negotiateProbeHandshake(controller: ProbeControllerHandshake, worker: ProbeWorkerHandshake) {
  if (worker.protocol !== controller.protocol) {
    terminate("VES_PROBE_HANDSHAKE_PROTOCOL", "Probe worker protocol is incompatible");
  }
  if (controller.requiredSchemas.some((schema) => !worker.supportedSchemas.includes(schema))) {
    terminate("VES_PROBE_HANDSHAKE_SCHEMA", "Probe worker schemas are incompatible");
  }
  if (
    worker.component.id !== controller.expectedComponent.id ||
    worker.component.digest !== controller.expectedComponent.digest
  ) {
    terminate("VES_PROBE_HANDSHAKE_COMPONENT", "Probe worker component identity is incompatible");
  }
  if (worker.capabilities.some((capability) => !controller.allowedCapabilities.includes(capability))) {
    terminate("VES_PROBE_HANDSHAKE_CAPABILITY", "Probe worker capability is not permitted");
  }
  return Object.freeze({
    protocol: controller.protocol,
    component: Object.freeze({ ...worker.component }),
    schemas: Object.freeze([...worker.supportedSchemas]),
    capabilities: Object.freeze([...worker.capabilities]),
    maximumMessageBytes: Math.min(controller.maximumMessageBytes, worker.maximumMessageBytes)
  });
}

interface ProbePlanView {
  readonly workspaceId: string;
  readonly databaseId: string;
  readonly registrationDigest: string;
  readonly engine: string;
  readonly classification: string;
  readonly purpose: string;
  readonly policyRef: string;
  readonly logicalCredentialName: string;
  readonly operation: {
    readonly protectedRequestRef: string;
    readonly parameterClassifications: readonly string[];
  };
  readonly statementFingerprint: string;
  readonly bounds: {
    readonly timeoutMs: number;
    readonly rowLimit: number;
    readonly byteLimit: number;
    readonly concurrencyLimit: number;
  };
  readonly concurrencyKey: string;
  readonly grantRef: string;
  readonly planDigest: string;
}

interface ProbeIdentityEvidence {
  readonly databaseId: string;
  readonly principalReadOnly: boolean;
  readonly principalFingerprint: string;
}

interface ProbeSessionEvidence {
  readonly planDigest: string;
  readonly sessionReadOnly: boolean;
  readonly transactionReadOnly: boolean;
}

interface ProbeWorkerPort {
  handshake(): Promise<ProbeWorkerHandshake>;
  verifyIdentity(plan: ProbePlanView): Promise<ProbeIdentityEvidence | undefined>;
  configureReadOnlySession(plan: ProbePlanView): Promise<ProbeSessionEvidence>;
  execute(plan: ProbePlanView, parameters: Uint8Array, signal: AbortSignal): AsyncIterable<readonly UnknownRecord[]>;
  cancel(): Promise<void>;
  terminate(): Promise<void>;
}

export class MemoryProtectedParameterBroker {
  readonly #values = new Map<string, Uint8Array>();
  lastDelivered = new Uint8Array();

  set(reference: string, value: Uint8Array): void {
    this.#values.set(reference, Uint8Array.from(value));
  }

  async withParameters<T>(reference: string, consumer: (bytes: Uint8Array) => Promise<T>): Promise<T> {
    const stored = this.#values.get(reference);
    if (stored === undefined) fail("VES_PROBE_PARAMETERS_MISSING", "Protected Probe parameters are unavailable");
    const ephemeral = Uint8Array.from(stored);
    this.lastDelivered = ephemeral;
    try {
      return await consumer(ephemeral);
    } finally {
      ephemeral.fill(0);
    }
  }
}

interface ResultTransaction {
  readonly id: string;
  readonly chunks: UnknownRecord[][];
}

let resultSequence = 0;

export class MemoryProbeResultSink {
  readonly #transactions = new Map<string, ResultTransaction>();
  commits = 0;
  rollbacks = 0;
  failAppend = false;

  async begin(): Promise<string> {
    const id = `result-transaction-${randomUUID()}`;
    this.#transactions.set(id, { id, chunks: [] });
    return id;
  }

  async append(transactionId: string, rows: readonly UnknownRecord[]): Promise<void> {
    if (this.failAppend) throw new Error("injected result sink failure");
    const transaction = this.#transactions.get(transactionId);
    if (transaction === undefined) throw new Error("unknown result transaction");
    transaction.chunks.push(rows.map((row) => structuredClone(row)));
  }

  async commit(transactionId: string): Promise<{ readonly protectedResultRef: string; readonly resultDigest: string }> {
    const transaction = this.#transactions.get(transactionId);
    if (transaction === undefined) throw new Error("unknown result transaction");
    const rows = transaction.chunks.flat();
    this.#transactions.delete(transactionId);
    this.commits += 1;
    resultSequence += 1;
    return Object.freeze({
      protectedResultRef: `protected-result:${resultSequence.toString().padStart(16, "0")}`,
      resultDigest: digest(rows)
    });
  }

  async rollback(transactionId: string): Promise<void> {
    if (this.#transactions.delete(transactionId)) this.rollbacks += 1;
  }
}

export class ProbeConcurrencyGate {
  readonly #active = new Map<string, number>();

  acquire(key: string, limit: number): () => void {
    const active = this.#active.get(key) ?? 0;
    if (active >= limit) fail("VES_PROBE_CONCURRENCY_LIMIT", "Probe concurrency budget is exhausted");
    this.#active.set(key, active + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.#active.get(key) ?? 1;
      if (current <= 1) this.#active.delete(key);
      else this.#active.set(key, current - 1);
    };
  }
}

interface ProbeResultEnvelope {
  readonly schemaVersion: 1;
  readonly status: "complete";
  readonly workspaceId: string;
  readonly databaseId: string;
  readonly registrationDigest: string;
  readonly planDigest: string;
  readonly queryFingerprint: string;
  readonly grantRef: string;
  readonly purpose: string;
  readonly classification: string;
  readonly parameterClassifications: readonly string[];
  readonly bounds: ProbePlanView["bounds"];
  readonly rowCount: number;
  readonly byteCount: number;
  readonly protectedResultRef: string;
  readonly resultDigest: string;
  readonly principalFingerprint: string;
  readonly identityReadOnly: true;
  readonly sessionReadOnly: true;
  readonly producedAt: string;
}

function probeFailure(error: unknown): ProbeProtocolError {
  if (error instanceof ProbeProtocolError) return error;
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    /^VES_(?:POSTGRES|MYSQL_FAMILY)_[A-Z0-9_]+$/u.test(error.code) &&
    /^[A-Za-z0-9 ,.\-]+$/u.test(error.message)
  ) {
    return new ProbeProtocolError(error.code, error.message);
  }
  return new ProbeProtocolError("VES_PROBE_WORKER_FAILURE", "Probe worker failed");
}

export class ProbeWorkerSupervisor {
  readonly #worker: ProbeWorkerPort;
  readonly #parameters: MemoryProtectedParameterBroker;
  readonly #results: MemoryProbeResultSink;
  readonly #plan: ProbePlanView;
  readonly #expectedComponent: { readonly id: string; readonly digest: string };
  readonly #maximumMessageBytes: number;
  concurrency = new ProbeConcurrencyGate();

  constructor(options: {
    readonly worker: ProbeWorkerPort;
    readonly parameters: MemoryProtectedParameterBroker;
    readonly results: MemoryProbeResultSink;
    readonly plan: ProbePlanView;
    readonly expectedComponent: { readonly id: string; readonly digest: string };
    readonly maximumMessageBytes: number;
  }) {
    this.#worker = options.worker;
    this.#parameters = options.parameters;
    this.#results = options.results;
    this.#plan = options.plan;
    this.#expectedComponent = options.expectedComponent;
    this.#maximumMessageBytes = options.maximumMessageBytes;
  }

  async execute(signal?: AbortSignal): Promise<ProbeResultEnvelope> {
    const plan = this.#plan;
    if (plan === undefined) fail("VES_PROBE_PLAN_MISSING", "Probe plan is unavailable");
    const release = this.concurrency.acquire(plan.concurrencyKey, plan.bounds.concurrencyLimit);
    const controller = new AbortController();
    let transactionId: string | undefined;
    let timedOut = false;
    let externallyAborted = signal?.aborted ?? false;
    const abort = () => {
      externallyAborted = true;
      controller.abort();
    };
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, plan.bounds.timeoutMs);
    try {
      negotiateProbeHandshake(
        {
          protocol: "verchestra-probe/1",
          requiredSchemas: ["probe.plan/1", "probe.result/1"],
          expectedComponent: this.#expectedComponent,
          allowedCapabilities: ["database-read"],
          maximumMessageBytes: this.#maximumMessageBytes
        },
        await this.#worker.handshake()
      );
      const identity = await this.#worker.verifyIdentity(plan);
      if (identity === undefined) fail("VES_PROBE_IDENTITY_INVALID", "Probe principal evidence is missing");
      if (identity.databaseId !== plan.databaseId || !DIGEST.test(identity.principalFingerprint)) {
        fail("VES_PROBE_IDENTITY_INVALID", "Probe principal evidence is invalid");
      }
      if (!identity.principalReadOnly) {
        fail("VES_PROBE_IDENTITY_NOT_READ_ONLY", "Database principal is not read-only");
      }
      const session = await this.#worker.configureReadOnlySession(plan);
      if (session.planDigest !== plan.planDigest)
        fail("VES_PROBE_SESSION_INVALID", "Probe session evidence is invalid");
      if (!session.sessionReadOnly || !session.transactionReadOnly) {
        fail("VES_PROBE_SESSION_NOT_READ_ONLY", "Database session and transaction must be read-only");
      }
      transactionId = await this.#results.begin();
      let rowCount = 0;
      let byteCount = 0;
      await this.#parameters.withParameters(plan.operation.protectedRequestRef, async (parameters) => {
        const secret = new TextDecoder().decode(parameters);
        for await (const rows of this.#worker.execute(plan, parameters, controller.signal)) {
          if (controller.signal.aborted) break;
          if (!Array.isArray(rows)) fail("VES_PROBE_RESULT_INVALID", "Probe result chunk is invalid");
          const serialized = JSON.stringify(rows);
          if (secret.length > 0 && serialized.includes(secret)) {
            fail("VES_PROBE_SECRET_LEAK", "Probe result contains protected parameter material");
          }
          rowCount += rows.length;
          byteCount += Buffer.byteLength(serialized, "utf8");
          if (rowCount > plan.bounds.rowLimit) fail("VES_PROBE_ROW_LIMIT", "Probe row limit was exceeded");
          if (byteCount > plan.bounds.byteLimit) fail("VES_PROBE_BYTE_LIMIT", "Probe byte limit was exceeded");
          await this.#results.append(transactionId as string, rows);
        }
      });
      if (timedOut) fail("VES_PROBE_TIMEOUT", "Probe statement timed out");
      if (externallyAborted) fail("VES_PROBE_ABORTED", "Probe execution was aborted");
      const committed = await this.#results.commit(transactionId);
      transactionId = undefined;
      return Object.freeze({
        schemaVersion: 1,
        status: "complete",
        workspaceId: plan.workspaceId,
        databaseId: plan.databaseId,
        registrationDigest: plan.registrationDigest,
        planDigest: plan.planDigest,
        queryFingerprint: plan.statementFingerprint,
        grantRef: plan.grantRef,
        purpose: plan.purpose,
        classification: plan.classification,
        parameterClassifications: Object.freeze([...plan.operation.parameterClassifications]),
        bounds: Object.freeze({ ...plan.bounds }),
        rowCount,
        byteCount,
        ...committed,
        principalFingerprint: identity.principalFingerprint,
        identityReadOnly: true,
        sessionReadOnly: true,
        producedAt: new Date().toISOString()
      });
    } catch (error) {
      controller.abort();
      try {
        await this.#worker.cancel();
      } catch {
        // Termination below remains mandatory after an unavailable cancellation acknowledgement.
      }
      if (timedOut) await this.#worker.terminate();
      if (transactionId !== undefined) await this.#results.rollback(transactionId);
      if (timedOut) throw new ProbeProtocolError("VES_PROBE_TIMEOUT", "Probe statement timed out");
      if (externallyAborted) throw new ProbeProtocolError("VES_PROBE_ABORTED", "Probe execution was aborted");
      if (error instanceof Error && error.message === "injected result sink failure") {
        throw new ProbeProtocolError("VES_PROBE_RESULT_FAILURE", "Protected Probe result storage failed");
      }
      throw probeFailure(error);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      release();
    }
  }
}

interface MockProbeWorkerOptions {
  readonly chunks?: readonly (readonly UnknownRecord[])[];
  readonly principalReadOnly?: boolean;
  readonly omitIdentity?: boolean;
  readonly identityDatabaseId?: string;
  readonly sessionReadOnly?: boolean;
  readonly transactionReadOnly?: boolean;
  readonly sessionPlanDigest?: string;
  readonly failAfterChunks?: number;
  readonly errorMessage?: string;
  readonly delayMs?: number;
  readonly cancelFails?: boolean;
}

export class MockProbeWorker implements ProbeWorkerPort {
  readonly #options: MockProbeWorkerOptions;
  readonly calls: string[] = [];
  cancelled = false;
  terminated = false;

  constructor(options: MockProbeWorkerOptions = {}) {
    this.#options = options;
  }

  async handshake(): Promise<ProbeWorkerHandshake> {
    this.calls.push("handshake");
    return {
      protocol: "verchestra-probe/1",
      supportedSchemas: ["probe.plan/1", "probe.result/1"],
      component: { id: "probe-worker:mock", digest: `sha256:${"1".repeat(64)}` },
      capabilities: ["database-read"],
      maximumMessageBytes: 65_536
    };
  }

  async verifyIdentity(plan: ProbePlanView): Promise<ProbeIdentityEvidence | undefined> {
    this.calls.push("identity");
    if (this.#options.omitIdentity) return undefined;
    return {
      databaseId: this.#options.identityDatabaseId ?? plan.databaseId,
      principalReadOnly: this.#options.principalReadOnly ?? true,
      principalFingerprint: `sha256:${"2".repeat(64)}`
    };
  }

  async configureReadOnlySession(plan: ProbePlanView): Promise<ProbeSessionEvidence> {
    this.calls.push("session");
    return {
      planDigest: this.#options.sessionPlanDigest ?? plan.planDigest,
      sessionReadOnly: this.#options.sessionReadOnly ?? true,
      transactionReadOnly: this.#options.transactionReadOnly ?? true
    };
  }

  async *execute(
    _plan: ProbePlanView,
    _parameters: Uint8Array,
    signal: AbortSignal
  ): AsyncIterable<readonly UnknownRecord[]> {
    this.calls.push("execute");
    if (signal.aborted) return;
    if ((this.#options.delayMs ?? 0) > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.#options.delayMs);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true }
        );
      });
    }
    if (signal.aborted) return;
    const chunks = this.#options.chunks ?? [[{ id: 1 }]];
    if (this.#options.failAfterChunks === 0) throw new Error(this.#options.errorMessage ?? "worker crashed");
    let emitted = 0;
    for (const chunk of chunks) {
      yield chunk;
      emitted += 1;
      if (this.#options.failAfterChunks === emitted) {
        throw new Error(this.#options.errorMessage ?? "worker crashed");
      }
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    if (this.#options.cancelFails) throw new Error("cancel failed");
  }

  async terminate(): Promise<void> {
    this.terminated = true;
  }
}
