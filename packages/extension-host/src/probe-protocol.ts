import { createHash } from "node:crypto";

import { canonicalizeJsonV2, codeUnitCompare } from "@verchestra/domain";

// invariant: ARQ-005 (#597). The probe wire protocol and the worker port: the
// frame codec, the envelope rule, the sequence guard, the handshake, and the
// error every part of the host raises. The framed worker and the workspace
// trust rule import it from here, never from the package index that re-exports
// them, so neither is evaluated through a cycle with the barrel.
export const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u;

export type UnknownRecord = Readonly<Record<string, unknown>>;

// The probe envelope payload digest and the probe result digest are
// canonicalized by the repository's V2 contract (RFC 8785) instead of a
// private recursive serializer whose object keys were ordered by the ambient
// locale (issue #58). Direct swap, not a versioned facade: neither digest is
// stored. `payloadDigest` is written by `encodeProbeFrame` and re-derived by
// `validateEnvelope` on the receiving side of a live frame, and
// `MemoryProbeResultSink`'s `resultDigest` covers rows held in memory for the
// lifetime of one probe transaction -- producer and consumer are always the
// same build, so there is no installed base of V1 bytes for a migration to
// invalidate and the `sha256:` prefix the `DIGEST` guard pins stays as it is.
//
// The V2 guard is stricter than the serializer it replaces: it rejects
// `undefined`, non-finite numbers, and non-plain prototypes rather than
// silently dropping or coercing them. That is the intended direction for a
// worker protocol boundary -- a frame or a result chunk that cannot be
// faithfully canonicalized is refused rather than given a digest that does not
// describe it.
function canonical(value: unknown): string {
  return canonicalizeJsonV2(value);
}

export function digest(value: unknown): string {
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

export function fail(code: string, message: string): never {
  throw new ProbeProtocolError(code, message);
}

export function terminate(code: string, message: string): never {
  throw new ProbeProtocolError(code, message, true, true);
}

// why: whatever a transport or worker threw, a failed termination means a
// process may still be running, which a caller must tell from a worker fault.
export function terminationIncomplete(): ProbeProtocolError {
  return new ProbeProtocolError(
    "VES_PROBE_HOST_TERMINATION_INCOMPLETE",
    "Probe worker process tree outlived its termination",
    true,
    true
  );
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
  const keys = Object.keys(envelope).sort(codeUnitCompare).join(",");
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
    Object.keys(envelope.payloadSchema).sort(codeUnitCompare).join(",") !== "name,version" ||
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
  readonly #rejectDuplicates: boolean;

  // why: an idempotent duplicate is tolerated where a transport may redeliver.
  // A private stdio pipe never redelivers, so the out-of-process channel sets
  // `duplicates: "reject"` and treats any replay as a hostile worker.
  constructor(options: { readonly duplicates?: "idempotent" | "reject" } = {}) {
    this.#rejectDuplicates = options.duplicates === "reject";
  }

  accept(envelope: Pick<ProbeProtocolEnvelope, "messageId" | "sequence" | "payloadDigest">) {
    const recorded = this.#messages.get(envelope.messageId);
    if (recorded !== undefined) {
      if (recorded !== envelope.payloadDigest) {
        terminate("VES_PROBE_MESSAGE_CONFLICT", "Probe message identity was reused incompatibly");
      }
      if (this.#rejectDuplicates) terminate("VES_PROBE_SEQUENCE_REPLAY", "Probe message was replayed");
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

export interface ProbeControllerHandshake {
  readonly protocol: "verchestra-probe/1";
  readonly requiredSchemas: readonly string[];
  readonly expectedComponent: { readonly id: string; readonly digest: string };
  readonly allowedCapabilities: readonly string[];
  readonly maximumMessageBytes: number;
}

export interface ProbeWorkerHandshake {
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

export interface ProbePlanView {
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

export interface ProbeIdentityEvidence {
  readonly databaseId: string;
  readonly principalReadOnly: boolean;
  readonly principalFingerprint: string;
}

export interface ProbeSessionEvidence {
  readonly planDigest: string;
  readonly sessionReadOnly: boolean;
  readonly transactionReadOnly: boolean;
}

export interface ProbeWorkerPort {
  // invariant: for an out-of-process worker this is the digest the host measured
  // over the bytes it executed, not a value the worker reported about itself.
  readonly launchedComponentDigest?: string;
  // invariant: likewise host-measured, over the executable, arguments, environment
  // extras and entry the host started (#569, PHC-01).
  readonly launchDigest?: string;
  handshake(): Promise<ProbeWorkerHandshake>;
  verifyIdentity(plan: ProbePlanView): Promise<ProbeIdentityEvidence | undefined>;
  configureReadOnlySession(plan: ProbePlanView): Promise<ProbeSessionEvidence>;
  execute(plan: ProbePlanView, parameters: Uint8Array, signal: AbortSignal): AsyncIterable<readonly UnknownRecord[]>;
  cancel(): Promise<void>;
  terminate(): Promise<void>;
}
