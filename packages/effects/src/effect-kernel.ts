import {
  createEffectIntent,
  EffectError,
  type EffectAdapter,
  type EffectApplyResult,
  type EffectIntent,
  type EffectRepository,
  type EffectStatus,
  type IdempotencyInput,
  type OperationReceipt,
  type PriorEffectState
} from "@verchestra/application";

export {
  buildIdempotencyKey,
  createEffectIntent,
  EffectError,
  type EffectAdapter,
  type EffectApplyResult,
  type EffectCanonicalizationVersion,
  type EffectIntent,
  type EffectRepository,
  type EffectRiskTier,
  type EffectStatus,
  type IdempotencyInput,
  type OperationReceipt,
  type PriorEffectState,
  type ReceiptOutcome
} from "@verchestra/application";

const freezeIntent = (value: EffectIntent): EffectIntent => Object.freeze({ ...value });

function sameLogicalIntent(left: IdempotencyInput, right: IdempotencyInput): boolean {
  return (
    left.operationKind === right.operationKind &&
    left.workspaceId === right.workspaceId &&
    left.logicalTarget === right.logicalTarget &&
    left.canonicalInputDigest === right.canonicalInputDigest &&
    left.semanticIdentity === right.semanticIdentity
  );
}

export class InMemoryEffectRepository implements EffectRepository {
  readonly #intents = new Map<string, EffectIntent>();
  readonly #receipts = new Map<string, OperationReceipt>();

  get intents(): readonly EffectIntent[] {
    return Object.freeze([...this.#intents.values()]);
  }

  get receipts(): readonly OperationReceipt[] {
    return Object.freeze([...this.#receipts.values()]);
  }

  async insertOrGet(intent: EffectIntent): Promise<EffectIntent> {
    const current = this.#intents.get(intent.idempotencyKey);
    if (current !== undefined) {
      if (!sameLogicalIntent(current, intent)) {
        throw new EffectError("VES_EFFECT_KEY_CONFLICT", "Idempotency key is bound to different content");
      }
      return current;
    }
    const verified = createEffectIntent(intent);
    const existing = this.#findByIdentity(verified);
    if (existing !== undefined) return existing;
    this.#intents.set(verified.idempotencyKey, verified);
    return verified;
  }

  async get(idempotencyKey: string): Promise<EffectIntent | undefined> {
    return this.#intents.get(idempotencyKey);
  }

  async findByIdentity(input: IdempotencyInput): Promise<EffectIntent | undefined> {
    return this.#findByIdentity(input);
  }

  async getReceipt(idempotencyKey: string): Promise<OperationReceipt | undefined> {
    return this.#receipts.get(idempotencyKey);
  }

  async listDispatchable(limit: number): Promise<readonly EffectIntent[]> {
    return [...this.#intents.values()]
      .filter((intent) => intent.status === "planned" || intent.status === "ready")
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.idempotencyKey.localeCompare(right.idempotencyKey)
      )
      .slice(0, limit);
  }

  async updateStatus(idempotencyKey: string, status: EffectStatus): Promise<EffectIntent> {
    const current = this.#require(idempotencyKey);
    const updated = freezeIntent({ ...current, status });
    this.#intents.set(idempotencyKey, updated);
    return updated;
  }

  async startAttempt(idempotencyKey: string): Promise<EffectIntent> {
    const current = this.#require(idempotencyKey);
    if (current.status !== "planned" && current.status !== "ready") {
      throw new EffectError("VES_EFFECT_RECONCILIATION_REQUIRED", "Effect cannot be claimed from its current status");
    }
    const updated = freezeIntent({ ...current, status: "applying", attempt: current.attempt + 1 });
    this.#intents.set(idempotencyKey, updated);
    return updated;
  }

  async complete(idempotencyKey: string, receipt: OperationReceipt): Promise<void> {
    const current = this.#require(idempotencyKey);
    const existing = this.#receipts.get(idempotencyKey);
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(receipt)) {
        throw new EffectError("VES_EFFECT_RECEIPT_CONFLICT", "Receipt already exists with different content");
      }
      return;
    }
    this.#receipts.set(
      idempotencyKey,
      Object.freeze({ ...receipt, safeEvidenceRefs: Object.freeze([...receipt.safeEvidenceRefs]) })
    );
    this.#intents.set(idempotencyKey, freezeIntent({ ...current, status: "completed" }));
  }

  #require(idempotencyKey: string): EffectIntent {
    const current = this.#intents.get(idempotencyKey);
    if (current === undefined) throw new EffectError("VES_EFFECT_NOT_FOUND", "Effect intent was not found");
    return current;
  }

  #findByIdentity(input: IdempotencyInput): EffectIntent | undefined {
    return [...this.#intents.values()].find((intent) => sameLogicalIntent(intent, input));
  }
}

interface MockAdapterOptions {
  readonly apply?: EffectApplyResult;
  readonly inspect?: PriorEffectState;
  readonly applyError?: Error & { readonly outcomeUnknown?: boolean };
}

export class MockEffectAdapter implements EffectAdapter {
  readonly adapterId = "mock-effect-adapter";
  readonly #options: MockAdapterOptions;
  readonly appliedIntents: EffectIntent[] = [];
  readonly inspectedIntents: EffectIntent[] = [];
  applyCalls = 0;
  inspectCalls = 0;

  constructor(options: MockAdapterOptions = {}) {
    this.#options = options;
  }

  async apply(intent: EffectIntent, signal: AbortSignal): Promise<EffectApplyResult> {
    signal.throwIfAborted();
    this.applyCalls += 1;
    this.appliedIntents.push(intent);
    if (this.#options.applyError !== undefined) throw this.#options.applyError;
    return this.#options.apply ?? { outcome: "applied" };
  }

  async inspect(intent: EffectIntent): Promise<PriorEffectState> {
    this.inspectCalls += 1;
    this.inspectedIntents.push(intent);
    return this.#options.inspect ?? { state: "unknown" };
  }
}

interface BrokerOptions {
  readonly repository: EffectRepository;
  readonly adapter: EffectAdapter;
  readonly now?: () => string;
}

export class EffectBroker {
  readonly #repository: EffectRepository;
  readonly #adapter: EffectAdapter;
  readonly #now: () => string;

  constructor(options: BrokerOptions) {
    this.#repository = options.repository;
    this.#adapter = options.adapter;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async plan(intent: EffectIntent): Promise<EffectIntent> {
    const existingByKey = await this.#repository.get(intent.idempotencyKey);
    if (existingByKey !== undefined) return this.#repository.insertOrGet(intent);
    const verified = createEffectIntent(intent);
    const existingByIdentity = await this.#repository.findByIdentity(verified);
    if (existingByIdentity !== undefined) return existingByIdentity;
    return this.#repository.insertOrGet(verified);
  }

  async execute(idempotencyKey: string, signal: AbortSignal = new AbortController().signal): Promise<OperationReceipt> {
    const existingReceipt = await this.#repository.getReceipt(idempotencyKey);
    if (existingReceipt !== undefined) return existingReceipt;
    let intent = await this.#require(idempotencyKey);
    if (intent.status === "uncertain" || intent.status === "applying") {
      throw new EffectError("VES_EFFECT_RECONCILIATION_REQUIRED", "Effect outcome must be reconciled before retry");
    }
    if (intent.status === "failed") {
      throw new EffectError("VES_EFFECT_APPLY_FAILED", "Effect has a definite failed outcome");
    }
    const startedAt = this.#now();
    intent = await this.#repository.startAttempt(idempotencyKey);
    let result: EffectApplyResult;
    try {
      result = await this.#adapter.apply(intent, signal);
    } catch (error) {
      if ((error as { outcomeUnknown?: unknown })?.outcomeUnknown === true) {
        await this.#repository.updateStatus(idempotencyKey, "uncertain");
        throw new EffectError("VES_EFFECT_RECONCILIATION_REQUIRED", "Adapter outcome is unknown", { cause: error });
      }
      await this.#repository.updateStatus(idempotencyKey, "failed");
      throw new EffectError("VES_EFFECT_APPLY_FAILED", "Adapter reported a definite failure", { cause: error });
    }
    const receipt = this.#receipt(intent, result.outcome, startedAt, result);
    try {
      await this.#repository.complete(idempotencyKey, receipt);
    } catch (error) {
      throw new EffectError("VES_EFFECT_RECONCILIATION_REQUIRED", "Remote success could not be durably acknowledged", {
        cause: error
      });
    }
    return receipt;
  }

  async dispatchReady(
    limit: number,
    signal: AbortSignal = new AbortController().signal
  ): Promise<readonly OperationReceipt[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new EffectError(
        "VES_EFFECT_DISPATCH_LIMIT_INVALID",
        "Dispatch limit must be an integer from 1 through 1000"
      );
    }
    const intents = await this.#repository.listDispatchable(limit);
    const receipts: OperationReceipt[] = [];
    for (const intent of intents) {
      if (signal.aborted) throw signal.reason;
      receipts.push(await this.execute(intent.idempotencyKey, signal));
    }
    return Object.freeze(receipts);
  }

  async reconcile(idempotencyKey: string): Promise<PriorEffectState> {
    const intent = await this.#require(idempotencyKey);
    const prior = await this.#adapter.inspect(intent);
    if (prior.state === "applied") {
      const receipt = this.#receipt(intent, "already-applied", this.#now(), prior);
      await this.#repository.complete(idempotencyKey, receipt);
    } else if (prior.state === "not-applied") {
      await this.#repository.updateStatus(idempotencyKey, "ready");
    } else {
      await this.#repository.updateStatus(idempotencyKey, "uncertain");
    }
    return prior;
  }

  async #require(idempotencyKey: string): Promise<EffectIntent> {
    const intent = await this.#repository.get(idempotencyKey);
    if (intent === undefined) throw new EffectError("VES_EFFECT_NOT_FOUND", "Effect intent was not found");
    return intent;
  }

  #receipt(
    intent: EffectIntent,
    outcome: "applied" | "already-applied",
    startedAt: string,
    result: Omit<EffectApplyResult, "outcome"> | Omit<PriorEffectState, "state">
  ): OperationReceipt {
    return Object.freeze({
      receiptId: `receipt_${intent.idempotencyKey.slice("sha256:".length)}`,
      effectId: intent.effectId,
      idempotencyKey: intent.idempotencyKey,
      adapterId: this.#adapter.adapterId,
      attempt: Math.max(intent.attempt, 1),
      outcome,
      ...(result.remoteIdentity === undefined ? {} : { remoteIdentity: result.remoteIdentity }),
      ...(result.remoteVersion === undefined ? {} : { remoteVersion: result.remoteVersion }),
      ...(result.outputDigest === undefined ? {} : { outputDigest: result.outputDigest }),
      safeEvidenceRefs: Object.freeze([...(result.safeEvidenceRefs ?? [])]),
      startedAt,
      completedAt: this.#now()
    });
  }
}
