import type {
  ProbeIdentityEvidence,
  ProbePlanView,
  ProbeSessionEvidence,
  ProbeWorkerHandshake,
  ProbeWorkerPort,
  UnknownRecord
} from "./probe-protocol.ts";

// invariant: ARQ-006 (#597). The scripted probe worker that the host tests
// drive lives here, never in the package's index.ts, so production code
// reaches a test double only by naming this module.
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
