import { randomUUID } from "node:crypto";

import {
  DIGEST,
  ProbeProtocolError,
  digest,
  fail,
  negotiateProbeHandshake,
  terminate,
  terminationIncomplete,
  type ProbePlanView,
  type ProbeWorkerHandshake,
  type ProbeWorkerPort,
  type UnknownRecord
} from "./probe-protocol.ts";
import { isAdmittedWorkspaceTrust, type WorkspaceProbeWorkerTrust } from "./workspace-trust.ts";

export const packageName = "@verchestra/extension-host" as const;
export {
  ProbeFrameDecoder,
  ProbeProtocolError,
  ProbeSequenceGuard,
  encodeProbeFrame,
  negotiateProbeHandshake,
  type ProbeProtocolEnvelope
} from "./probe-protocol.ts";
export { FramedProbeWorker, type ProbeWorkerTransport } from "./framed-probe-worker.ts";
export {
  WorkspaceProbeAdmission,
  authorizeSkillExecution,
  isAdmittedWorkspaceTrust,
  type WorkspaceProbeWorkerApproval,
  type WorkspaceProbeWorkerApprovals,
  type WorkspaceProbeWorkerExtension,
  type WorkspaceProbeWorkerExtensions,
  type WorkspaceProbeWorkerGrant,
  type WorkspaceProbeWorkerRequest,
  type WorkspaceProbeWorkerTrust
} from "./workspace-trust.ts";

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
    /^VES_(?:POSTGRES|MYSQL_FAMILY|SQLSERVER|SAP_ASE|ORACLE|SQLITE|MONGODB)_[A-Z0-9_]+$/u.test(error.code) &&
    /^[A-Za-z0-9 ,.-]+$/u.test(error.message)
  ) {
    return new ProbeProtocolError(error.code, error.message);
  }
  return new ProbeProtocolError("VES_PROBE_WORKER_FAILURE", "Probe worker failed");
}

type ProbeWorkerTrust =
  | { readonly kind: "product"; readonly component: { readonly id: string; readonly digest: string } }
  | WorkspaceProbeWorkerTrust;

// invariant: exactly one trust root per supervisor. The product root pins a
// product-hardcoded component; the workspace root exists only as a value minted
// by WorkspaceProbeAdmission, so it cannot be forged by shape.
function resolveTrust(options: {
  readonly plan: ProbePlanView;
  readonly expectedComponent?: { readonly id: string; readonly digest: string };
  readonly workspaceTrust?: WorkspaceProbeWorkerTrust;
}): ProbeWorkerTrust {
  if ((options.expectedComponent === undefined) === (options.workspaceTrust === undefined))
    fail("VES_PROBE_TRUST_INVALID", "Probe supervisor requires exactly one trust root");
  if (options.expectedComponent !== undefined) return { kind: "product", component: options.expectedComponent };
  if (!isAdmittedWorkspaceTrust(options.workspaceTrust))
    fail("VES_PROBE_WORKSPACE_TRUST_DENIED", "Workspace Probe worker was not admitted");
  if (options.workspaceTrust.workspaceId !== options.plan.workspaceId)
    fail("VES_PROBE_WORKSPACE_TRUST_WORKSPACE", "Workspace Probe worker admission belongs to another Workspace");
  return options.workspaceTrust;
}

// why: worker calls other than execute() take no signal, so a worker that never
// answers its handshake would otherwise outlive the time bound indefinitely.
function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new ProbeProtocolError("VES_PROBE_ABORTED", "Probe execution was aborted"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new ProbeProtocolError("VES_PROBE_ABORTED", "Probe execution was aborted"));
    signal.addEventListener("abort", abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export class ProbeWorkerSupervisor {
  readonly #worker: ProbeWorkerPort;
  readonly #parameters: MemoryProtectedParameterBroker;
  readonly #results: MemoryProbeResultSink;
  readonly #plan: ProbePlanView;
  readonly #trust: ProbeWorkerTrust;
  readonly #maximumMessageBytes: number;
  concurrency = new ProbeConcurrencyGate();

  constructor(options: {
    readonly worker: ProbeWorkerPort;
    readonly parameters: MemoryProtectedParameterBroker;
    readonly results: MemoryProbeResultSink;
    readonly plan: ProbePlanView;
    readonly expectedComponent?: { readonly id: string; readonly digest: string };
    readonly workspaceTrust?: WorkspaceProbeWorkerTrust;
    readonly maximumMessageBytes: number;
  }) {
    this.#worker = options.worker;
    this.#parameters = options.parameters;
    this.#results = options.results;
    this.#plan = options.plan;
    this.#trust = resolveTrust(options);
    this.#maximumMessageBytes = options.maximumMessageBytes;
  }

  #negotiate(handshake: ProbeWorkerHandshake) {
    const trust = this.#trust;
    if (trust.kind === "workspace" && this.#worker.launchedComponentDigest !== trust.componentDigest)
      terminate("VES_PROBE_WORKSPACE_TRUST_DIGEST", "Launched Probe worker does not match its approved digest");
    if (trust.kind === "workspace" && this.#worker.launchDigest !== trust.launchDigest)
      terminate("VES_PROBE_WORKSPACE_TRUST_LAUNCH", "Launched Probe worker does not match its approved launch");
    return negotiateProbeHandshake(
      {
        protocol: "verchestra-probe/1",
        requiredSchemas: ["probe.plan/1", "probe.result/1"],
        expectedComponent:
          trust.kind === "product" ? trust.component : { id: trust.componentId, digest: trust.componentDigest },
        allowedCapabilities: trust.kind === "product" ? ["database-read"] : trust.capabilities,
        maximumMessageBytes: this.#maximumMessageBytes
      },
      handshake
    );
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
      this.#negotiate(await untilAborted(this.#worker.handshake(), controller.signal));
      const identity = await untilAborted(this.#worker.verifyIdentity(plan), controller.signal);
      if (identity === undefined) fail("VES_PROBE_IDENTITY_INVALID", "Probe principal evidence is missing");
      if (identity.databaseId !== plan.databaseId || !DIGEST.test(identity.principalFingerprint)) {
        fail("VES_PROBE_IDENTITY_INVALID", "Probe principal evidence is invalid");
      }
      if (!identity.principalReadOnly) {
        fail("VES_PROBE_IDENTITY_NOT_READ_ONLY", "Database principal is not read-only");
      }
      const session = await untilAborted(this.#worker.configureReadOnlySession(plan), controller.signal);
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
      const ended = await this.#end(timedOut);
      const outlived = outlivedTermination(error) ?? ended;
      if (transactionId !== undefined) await this.#results.rollback(transactionId);
      if (outlived !== undefined) throw outlived;
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

  // invariant: termination stays mandatory after an unavailable cancellation
  // acknowledgement, and the rows still roll back when termination fails. A
  // cancellation may fail for want of an acknowledgement; a termination that
  // fails, for any reason, may have left the worker running.
  async #end(timedOut: boolean): Promise<ProbeProtocolError | undefined> {
    let outlived: ProbeProtocolError | undefined;
    await this.#worker.cancel().catch((error: unknown) => {
      outlived = outlivedTermination(error);
    });
    if (timedOut)
      await this.#worker.terminate().catch((error: unknown) => {
        outlived ??= outlivedTermination(error) ?? terminationIncomplete();
      });
    return outlived;
  }
}

// why: a tree that outlived its termination outranks the probe's own outcome,
// whether that was a timeout, an abort or a failure: the caller must learn that
// a process may still be running (#569, PHC-07).
function outlivedTermination(error: unknown): ProbeProtocolError | undefined {
  return error instanceof ProbeProtocolError && error.code === "VES_PROBE_HOST_TERMINATION_INCOMPLETE"
    ? error
    : undefined;
}
