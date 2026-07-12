import { createHash } from "node:crypto";

function failure(code, message, fields = {}) {
  return Object.assign(new Error(message), { code, ...fields });
}

const TERMINATE = Object.freeze({ grantsRevoked: true, terminationRequired: true });

function payloadDigest(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function createEnvelope({
  messageId,
  correlationId,
  workspaceId,
  runId,
  sequence,
  sentAt,
  payloadSchema,
  payload
}) {
  return {
    protocol: "verchestra/1",
    messageId,
    correlationId,
    workspaceId,
    ...(runId === undefined ? {} : { runId }),
    sequence,
    sentAt,
    payloadSchema,
    payloadDigest: payloadDigest(payload),
    payload
  };
}

export function encodeFrame(envelope) {
  const body = Buffer.from(JSON.stringify(envelope), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

function validateEnvelope(envelope, workspaceId) {
  if (!envelope || envelope.protocol !== "verchestra/1" || typeof envelope.messageId !== "string" ||
      typeof envelope.correlationId !== "string" || !Number.isSafeInteger(envelope.sequence) || envelope.sequence < 0 ||
      typeof envelope.payloadSchema !== "string" || Number.isNaN(Date.parse(envelope.sentAt))) {
    throw failure("VES_ENVELOPE_SCHEMA_INVALID", "protocol envelope failed schema validation", TERMINATE);
  }
  if (envelope.workspaceId !== workspaceId) {
    throw failure("VES_ENVELOPE_WORKSPACE_MISMATCH", "protocol envelope belongs to another Workspace", TERMINATE);
  }
  if (envelope.payloadDigest !== payloadDigest(envelope.payload)) {
    throw failure("VES_ENVELOPE_DIGEST_MISMATCH", "protocol envelope payload digest does not match", TERMINATE);
  }
}

export class FrameDecoder {
  constructor({ workspaceId, maxHeaderBytes = 4096, maxMessageBytes = 1024 * 1024 }) {
    this.workspaceId = workspaceId;
    this.maxHeaderBytes = maxHeaderBytes;
    this.maxMessageBytes = maxMessageBytes;
    this.buffer = Buffer.alloc(0);
    this.pendingLength = null;
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    const messages = [];
    while (true) {
      if (this.pendingLength === null) {
        const boundary = this.buffer.indexOf("\r\n\r\n");
        if (boundary < 0) {
          if (this.buffer.length > this.maxHeaderBytes) throw failure("VES_FRAME_HEADER_LIMIT", "frame header exceeds configured limit", TERMINATE);
          break;
        }
        if (boundary > this.maxHeaderBytes) throw failure("VES_FRAME_HEADER_LIMIT", "frame header exceeds configured limit", TERMINATE);
        const header = this.buffer.subarray(0, boundary).toString("ascii");
        const lines = header.split("\r\n");
        const lengthLines = lines.filter((line) => line.toLowerCase().startsWith("content-length:"));
        if (lengthLines.length === 0) throw failure("VES_FRAME_LENGTH_REQUIRED", "Content-Length is required", TERMINATE);
        if (lengthLines.length !== 1 || lines.length !== 1) throw failure("VES_FRAME_HEADER_INVALID", "frame headers are invalid", TERMINATE);
        const rawLength = lengthLines[0].slice(lengthLines[0].indexOf(":") + 1).trim();
        if (!/^(0|[1-9]\d*)$/.test(rawLength)) throw failure("VES_FRAME_LENGTH_INVALID", "Content-Length must be a canonical non-negative integer", TERMINATE);
        this.pendingLength = Number(rawLength);
        if (!Number.isSafeInteger(this.pendingLength)) throw failure("VES_FRAME_LENGTH_INVALID", "Content-Length is not a safe integer", TERMINATE);
        if (this.pendingLength > this.maxMessageBytes) throw failure("VES_FRAME_MESSAGE_LIMIT", "frame body exceeds negotiated maximum", TERMINATE);
        this.buffer = this.buffer.subarray(boundary + 4);
      }
      if (this.buffer.length < this.pendingLength) break;
      const body = this.buffer.subarray(0, this.pendingLength);
      this.buffer = this.buffer.subarray(this.pendingLength);
      this.pendingLength = null;
      let envelope;
      try {
        envelope = JSON.parse(body.toString("utf8"));
      } catch (error) {
        throw failure("VES_FRAME_JSON_INVALID", "frame body is not valid JSON", { cause: error, ...TERMINATE });
      }
      validateEnvelope(envelope, this.workspaceId);
      messages.push(envelope);
    }
    return messages;
  }
}

export class SequenceGuard {
  constructor() {
    this.nextSequence = 0;
    this.messages = new Map();
  }

  accept(envelope) {
    const recorded = this.messages.get(envelope.messageId);
    if (recorded) {
      if (recorded !== envelope.payloadDigest) throw failure("VES_MESSAGE_ID_CONFLICT", "message ID was reused with incompatible content", TERMINATE);
      return { accepted: false, duplicate: true, nextSequence: this.nextSequence };
    }
    if (envelope.sequence !== this.nextSequence) throw failure("VES_SEQUENCE_GAP", "message sequence is not contiguous", TERMINATE);
    this.messages.set(envelope.messageId, envelope.payloadDigest);
    this.nextSequence += 1;
    return { accepted: true, duplicate: false, nextSequence: this.nextSequence };
  }
}

export function negotiateHandshake(controller, worker) {
  const revoked = TERMINATE;
  if (controller.protocol !== "verchestra/1" || worker.protocol !== controller.protocol) {
    throw failure("VES_HANDSHAKE_PROTOCOL_MISMATCH", "worker protocol major does not match", revoked);
  }
  const schemas = controller.supportedSchemas.filter((schema) => worker.supportedSchemas.includes(schema));
  if (controller.requiredSchemas.some((schema) => !schemas.includes(schema))) {
    throw failure("VES_HANDSHAKE_SCHEMA_MISMATCH", "worker is missing a required schema", revoked);
  }
  if (worker.component.id !== controller.expectedComponent.id || worker.component.digest !== controller.expectedComponent.digest) {
    throw failure("VES_HANDSHAKE_IDENTITY_MISMATCH", "worker component identity does not match", revoked);
  }
  if (worker.capabilities.some((capability) => !controller.allowedCapabilities.includes(capability))) {
    throw failure("VES_HANDSHAKE_CAPABILITY_ESCALATION", "worker declared a capability outside its grant", revoked);
  }
  return {
    protocol: controller.protocol,
    schemas,
    component: worker.component,
    capabilities: [...worker.capabilities],
    maxMessageBytes: Math.min(controller.maxMessageBytes, worker.maxMessageBytes),
    grantsRevoked: false
  };
}

export class BoundedEventQueue {
  constructor({ capacity, highWater, lowWater }) {
    if (!(capacity >= highWater && highWater > lowWater && lowWater >= 0)) throw new TypeError("invalid queue bounds");
    this.capacity = capacity;
    this.highWater = highWater;
    this.lowWater = lowWater;
    this.items = [];
    this.paused = false;
  }

  get size() {
    return this.items.length;
  }

  push(value) {
    if (this.items.length === this.capacity) throw failure("VES_BACKPRESSURE_LIMIT", "event queue capacity exceeded", { cancellationRequired: true });
    this.items.push(value);
    if (this.items.length >= this.highWater) this.paused = true;
    return { size: this.items.length, pauseReads: this.paused };
  }

  shift() {
    const value = this.items.shift();
    const resumeReads = this.paused && this.items.length <= this.lowWater;
    if (resumeReads) this.paused = false;
    return { value, size: this.items.length, resumeReads };
  }
}
