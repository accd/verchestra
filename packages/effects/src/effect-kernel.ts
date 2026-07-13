import { createHash } from "node:crypto";

import { Digest } from "@verchestra/domain";

export type EffectStatus = "planned" | "ready" | "applying" | "uncertain" | "completed" | "failed";
export type EffectRiskTier = "low" | "medium" | "high";
export type ReceiptOutcome = "applied" | "already-applied" | "not-applied" | "unknown" | "compensated";

export interface IdempotencyInput {
  readonly operationKind: string;
  readonly workspaceId: string;
  readonly logicalTarget: string;
  readonly canonicalInputDigest: string;
  readonly semanticIdentity: string;
}

export interface EffectIntent extends IdempotencyInput {
  readonly effectId: string;
  readonly idempotencyKey: string;
  readonly runId?: string;
  readonly riskTier: EffectRiskTier;
  readonly grantRef: string;
  readonly expectedRemoteVersion?: string;
  readonly status: EffectStatus;
  readonly attempt: number;
  readonly createdAt: string;
}

export interface OperationReceipt {
  readonly receiptId: string;
  readonly effectId: string;
  readonly idempotencyKey: string;
  readonly adapterId: string;
  readonly attempt: number;
  readonly outcome: ReceiptOutcome;
  readonly remoteIdentity?: string;
  readonly remoteVersion?: string;
  readonly outputDigest?: string;
  readonly safeEvidenceRefs: readonly string[];
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface EffectApplyResult {
  readonly outcome: "applied" | "already-applied";
  readonly remoteIdentity?: string;
  readonly remoteVersion?: string;
  readonly outputDigest?: string;
  readonly safeEvidenceRefs?: readonly string[];
}

export interface PriorEffectState {
  readonly state: "applied" | "not-applied" | "unknown";
  readonly remoteIdentity?: string;
  readonly remoteVersion?: string;
  readonly outputDigest?: string;
  readonly safeEvidenceRefs?: readonly string[];
}

export interface EffectAdapter {
  readonly adapterId: string;
  inspect(intent: EffectIntent): Promise<PriorEffectState>;
  apply(intent: EffectIntent, signal: AbortSignal): Promise<EffectApplyResult>;
}

export interface EffectRepository {
  insertOrGet(intent: EffectIntent): Promise<EffectIntent>;
  get(idempotencyKey: string): Promise<EffectIntent | undefined>;
  getReceipt(idempotencyKey: string): Promise<OperationReceipt | undefined>;
  listDispatchable(limit: number): Promise<readonly EffectIntent[]>;
  updateStatus(idempotencyKey: string, status: EffectStatus): Promise<EffectIntent>;
  startAttempt(idempotencyKey: string): Promise<EffectIntent>;
  complete(idempotencyKey: string, receipt: OperationReceipt): Promise<void>;
}

export class EffectError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EffectError";
    this.code = code;
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) throw new EffectError("VES_EFFECT_INTENT_INVALID", `${name} must not be empty`);
}

export function buildIdempotencyKey(input: IdempotencyInput): string {
  assertNonEmpty(input.operationKind, "operationKind");
  assertNonEmpty(input.workspaceId, "workspaceId");
  assertNonEmpty(input.logicalTarget, "logicalTarget");
  assertNonEmpty(input.semanticIdentity, "semanticIdentity");
  Digest.parse(input.canonicalInputDigest);
  const canonicalIdentity = JSON.stringify({
    schemaVersion: 1,
    operationKind: input.operationKind,
    workspaceId: input.workspaceId,
    logicalTarget: input.logicalTarget,
    canonicalInputDigest: input.canonicalInputDigest,
    semanticIdentity: input.semanticIdentity
  });
  return `sha256:${createHash("sha256").update(canonicalIdentity, "utf8").digest("hex")}`;
}

function freezeIntent(value: EffectIntent): EffectIntent {
  return Object.freeze({ ...value });
}

export function createEffectIntent(
  input: Omit<EffectIntent, "status" | "attempt"> & Partial<Pick<EffectIntent, "status" | "attempt">>
): EffectIntent {
  assertNonEmpty(input.effectId, "effectId");
  assertNonEmpty(input.grantRef, "grantRef");
  if (!(["low", "medium", "high"] as const).includes(input.riskTier)) {
    throw new EffectError("VES_EFFECT_INTENT_INVALID", "riskTier is invalid");
  }
  if (input.idempotencyKey !== buildIdempotencyKey(input)) {
    throw new EffectError("VES_EFFECT_KEY_FORGED", "Idempotency key does not match canonical effect identity");
  }
  return freezeIntent({ ...input, status: input.status ?? "planned", attempt: input.attempt ?? 0 });
}

function sameLogicalIntent(left: EffectIntent, right: EffectIntent): boolean {
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
    this.#intents.set(verified.idempotencyKey, verified);
    return verified;
  }

  async get(idempotencyKey: string): Promise<EffectIntent | undefined> {
    return this.#intents.get(idempotencyKey);
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
    const existing = await this.#repository.get(intent.idempotencyKey);
    return this.#repository.insertOrGet(existing === undefined ? createEffectIntent(intent) : intent);
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
