import { randomUUID } from "node:crypto";

import { ProbeFrameDecoder, ProbeProtocolError, ProbeSequenceGuard, encodeProbeFrame } from "./index.ts";
import type { ProbeProtocolEnvelope } from "./index.ts";

type UnknownRecord = Readonly<Record<string, unknown>>;

// invariant: the byte channel an out-of-process worker is reached through. It carries only
// opaque stdout bytes in and frame bytes out; every protocol rule lives on this
// side of it, so the transport adapter stays language- and protocol-agnostic.
export interface ProbeWorkerTransport {
  readonly launchedComponentDigest: string;
  attach(listener: {
    data(chunk: Uint8Array): void;
    fault(fault: { readonly code: string; readonly message: string }): void;
    exit(): void;
  }): void;
  send(frame: Uint8Array): Promise<void>;
  withhold(material: Uint8Array): void;
  terminate(): Promise<void>;
}

interface Waiter {
  readonly resolve: (envelope: ProbeProtocolEnvelope) => void;
  readonly reject: (error: ProbeProtocolError) => void;
}

interface PlanView {
  readonly planDigest: string;
}

const SCHEMA_VERSION = 1;

function exactKeys(value: unknown, keys: string): value is UnknownRecord {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === keys
  );
}

function stringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function protocolViolation(code: string, message: string): ProbeProtocolError {
  return new ProbeProtocolError(code, message, true, true);
}

function handshakeFrom(payload: unknown) {
  if (!exactKeys(payload, "capabilities,component,maximumMessageBytes,protocol,supportedSchemas"))
    throw protocolViolation("VES_PROBE_HANDSHAKE_INVALID", "Probe worker handshake is invalid");
  const component = payload["component"];
  if (
    typeof payload["protocol"] !== "string" ||
    !stringList(payload["supportedSchemas"]) ||
    !stringList(payload["capabilities"]) ||
    !Number.isSafeInteger(payload["maximumMessageBytes"]) ||
    !exactKeys(component, "digest,id") ||
    typeof component["id"] !== "string" ||
    typeof component["digest"] !== "string"
  )
    throw protocolViolation("VES_PROBE_HANDSHAKE_INVALID", "Probe worker handshake is invalid");
  return {
    protocol: payload["protocol"],
    supportedSchemas: payload["supportedSchemas"],
    component: { id: component["id"], digest: component["digest"] },
    capabilities: payload["capabilities"],
    maximumMessageBytes: payload["maximumMessageBytes"] as number
  };
}

function identityFrom(payload: unknown) {
  if (!exactKeys(payload, "evidence")) throw protocolViolation("VES_PROBE_IDENTITY_INVALID", "Identity is invalid");
  const evidence = payload["evidence"];
  if (evidence === null) return undefined;
  if (
    !exactKeys(evidence, "databaseId,principalFingerprint,principalReadOnly") ||
    typeof evidence["databaseId"] !== "string" ||
    typeof evidence["principalFingerprint"] !== "string" ||
    typeof evidence["principalReadOnly"] !== "boolean"
  )
    throw protocolViolation("VES_PROBE_IDENTITY_INVALID", "Probe principal evidence is invalid");
  return {
    databaseId: evidence["databaseId"],
    principalFingerprint: evidence["principalFingerprint"],
    principalReadOnly: evidence["principalReadOnly"]
  };
}

function sessionFrom(payload: unknown) {
  if (
    !exactKeys(payload, "planDigest,sessionReadOnly,transactionReadOnly") ||
    typeof payload["planDigest"] !== "string" ||
    typeof payload["sessionReadOnly"] !== "boolean" ||
    typeof payload["transactionReadOnly"] !== "boolean"
  )
    throw protocolViolation("VES_PROBE_SESSION_INVALID", "Probe session evidence is invalid");
  return {
    planDigest: payload["planDigest"],
    sessionReadOnly: payload["sessionReadOnly"],
    transactionReadOnly: payload["transactionReadOnly"]
  };
}

// invariant: this adapter puts `verchestra-probe/1` on the execution path. Every
// inbound byte passes the bounded frame decoder (size, JSON, 9-key envelope,
// Workspace binding, payload digest) and a strict sequence guard before any
// payload is interpreted; any violation terminates the worker's process tree.
export class FramedProbeWorker {
  readonly #transport: ProbeWorkerTransport;
  readonly #workspaceId: string;
  readonly #correlationId: string;
  readonly #maximumMessageBytes: number;
  readonly #decoder: ProbeFrameDecoder;
  readonly #guard = new ProbeSequenceGuard({ duplicates: "reject" });
  readonly #inbox: ProbeProtocolEnvelope[] = [];
  #waiter: Waiter | undefined;
  #fatal: ProbeProtocolError | undefined;
  #exited = false;
  #sequence = 0;
  #disposal: Promise<void> | undefined;
  #parameterFrame: Buffer | undefined;
  cancelled = false;
  terminated = false;

  constructor(options: {
    readonly transport: ProbeWorkerTransport;
    readonly workspaceId: string;
    readonly maximumMessageBytes: number;
    readonly maximumHeaderBytes?: number;
    readonly correlationId?: string;
  }) {
    this.#transport = options.transport;
    this.#workspaceId = options.workspaceId;
    this.#correlationId = options.correlationId ?? `probe-channel:${randomUUID()}`;
    this.#maximumMessageBytes = options.maximumMessageBytes;
    this.#decoder = new ProbeFrameDecoder({
      workspaceId: options.workspaceId,
      maximumHeaderBytes: options.maximumHeaderBytes ?? 64,
      maximumMessageBytes: options.maximumMessageBytes
    });
    options.transport.attach({
      data: (chunk) => this.#receive(chunk),
      fault: (fault) => this.#fail(protocolViolation(fault.code, fault.message)),
      exit: () => this.#exit()
    });
  }

  get launchedComponentDigest(): string {
    return this.#transport.launchedComponentDigest;
  }

  // why: exposed so zeroization of the protected parameter frame is observable
  // evidence rather than an unverifiable claim.
  get parameterFrameZeroized(): boolean {
    return this.#parameterFrame === undefined || this.#parameterFrame.every((byte) => byte === 0);
  }

  async handshake() {
    await this.#send("probe.hello", { maximumMessageBytes: this.#maximumMessageBytes });
    return handshakeFrom(await this.#expect("probe.handshake"));
  }

  async verifyIdentity(plan: PlanView) {
    await this.#send("probe.identity.request", { plan });
    return identityFrom(await this.#expect("probe.identity"));
  }

  async configureReadOnlySession(plan: PlanView) {
    await this.#send("probe.session.request", { plan });
    return sessionFrom(await this.#expect("probe.session"));
  }

  async *execute(plan: PlanView, parameters: Uint8Array, signal: AbortSignal): AsyncIterable<readonly UnknownRecord[]> {
    // hazard: the base64 string is an immutable JavaScript string the runtime
    // cannot zeroize. The frame buffer and the caller's bytes are zeroized; the
    // string is unreachable once this call returns and is left to the collector.
    const frame = await this.#send("probe.execute", {
      planDigest: plan.planDigest,
      parameters: Buffer.from(parameters).toString("base64")
    });
    this.#parameterFrame = frame;
    try {
      let chunks = 0;
      while (true) {
        const envelope = await this.#next(signal);
        const payload = envelope.payload;
        if (envelope.payloadSchema.name === "probe.result.chunk" && exactKeys(payload, "rows")) {
          if (!Array.isArray(payload["rows"]))
            throw this.#fail(protocolViolation("VES_PROBE_RESULT_INVALID", "Probe result chunk is invalid"));
          chunks += 1;
          yield payload["rows"] as readonly UnknownRecord[];
        } else if (envelope.payloadSchema.name === "probe.result.end" && exactKeys(payload, "chunkCount")) {
          if (payload["chunkCount"] !== chunks)
            throw this.#fail(protocolViolation("VES_PROBE_RESULT_INVALID", "Probe result stream is incomplete"));
          return;
        } else {
          throw this.#unexpected(envelope);
        }
      }
    } finally {
      // invariant: the worker never outlives its stream, and its process tree is
      // gone before stderr is scrubbed, so nothing can be written after the scrub.
      await this.#dispose();
      this.#transport.withhold(parameters);
      frame.fill(0);
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    if (this.#fatal === undefined && this.#disposal === undefined) {
      await this.#send("probe.cancel", {}).catch(() => undefined);
    }
    // hazard: cooperative cancellation is a courtesy to the worker, not a bound.
    // An out-of-process worker is killed with its whole process group regardless.
    await this.#dispose();
  }

  async terminate(): Promise<void> {
    this.terminated = true;
    await this.#dispose();
  }

  #dispose(): Promise<void> {
    this.#disposal ??= this.#transport.terminate();
    return this.#disposal;
  }

  async #send(name: string, payload: unknown): Promise<Buffer> {
    if (this.#fatal !== undefined) throw this.#fatal;
    const frame = encodeProbeFrame({
      protocol: "verchestra-probe/1",
      messageId: `controller:${this.#sequence}`,
      correlationId: this.#correlationId,
      workspaceId: this.#workspaceId,
      sequence: this.#sequence,
      sentAt: new Date().toISOString(),
      payloadSchema: { name, version: SCHEMA_VERSION },
      payload
    });
    this.#sequence += 1;
    try {
      await this.#transport.send(frame);
    } catch {
      throw this.#fatal ?? this.#fail(this.#exitError());
    }
    return frame;
  }

  async #expect(name: string): Promise<unknown> {
    const envelope = await this.#next();
    if (envelope.payloadSchema.name !== name) throw this.#unexpected(envelope);
    return envelope.payload;
  }

  #unexpected(envelope: ProbeProtocolEnvelope): ProbeProtocolError {
    // invariant: a worker-reported error is never relayed. Its text is untrusted
    // and may carry protected material, so only a fixed code crosses the boundary.
    if (envelope.payloadSchema.name === "probe.error")
      return this.#fail(new ProbeProtocolError("VES_PROBE_WORKER_FAILURE", "Probe worker failed", true, false));
    return this.#fail(protocolViolation("VES_PROBE_MESSAGE_UNEXPECTED", "Probe worker message is unexpected"));
  }

  // invariant: a protocol violation outranks anything already queued, while a
  // plain exit does not: a worker that wrote its final frame and exited has
  // still delivered a complete stream.
  #next(signal?: AbortSignal): Promise<ProbeProtocolEnvelope> {
    if (this.#fatal !== undefined) return Promise.reject(this.#fatal);
    const queued = this.#inbox.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.#exited) return Promise.reject(this.#exitError());
    if (signal?.aborted)
      return Promise.reject(new ProbeProtocolError("VES_PROBE_ABORTED", "Probe execution was aborted"));
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.#waiter = undefined;
        reject(new ProbeProtocolError("VES_PROBE_ABORTED", "Probe execution was aborted"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.#waiter = {
        resolve: (envelope) => {
          signal?.removeEventListener("abort", abort);
          resolve(envelope);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", abort);
          reject(error);
        }
      };
    });
  }

  #receive(chunk: Uint8Array): void {
    if (this.#fatal !== undefined) return;
    try {
      for (const envelope of this.#decoder.push(chunk)) {
        this.#guard.accept(envelope);
        this.#inbox.push(envelope);
      }
    } catch (error) {
      this.#fail(
        error instanceof ProbeProtocolError
          ? error
          : protocolViolation("VES_PROBE_ENVELOPE_INVALID", "Probe envelope is invalid")
      );
      return;
    }
    const waiter = this.#waiter;
    if (waiter === undefined || this.#inbox.length === 0) return;
    this.#waiter = undefined;
    waiter.resolve(this.#inbox.shift() as ProbeProtocolEnvelope);
  }

  #exit(): void {
    this.#exited = true;
    const waiter = this.#waiter;
    if (waiter === undefined || this.#fatal !== undefined) return;
    this.#waiter = undefined;
    waiter.reject(this.#exitError());
    void this.#dispose().catch(() => undefined);
  }

  #exitError(): ProbeProtocolError {
    return protocolViolation("VES_PROBE_WORKER_EXITED", "Probe worker exited");
  }

  #fail(error: ProbeProtocolError): ProbeProtocolError {
    if (this.#fatal !== undefined) return this.#fatal;
    this.#fatal = error;
    const waiter = this.#waiter;
    this.#waiter = undefined;
    waiter?.reject(error);
    void this.#dispose().catch(() => undefined);
    return error;
  }
}
