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

const assertNonEmpty = (value: string, name: string): void => {
  if (value.trim().length === 0) throw new EffectError("VES_EFFECT_INTENT_INVALID", `${name} must not be empty`);
};

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

export function createEffectIntent(
  input: Omit<EffectIntent, "status" | "attempt"> & Partial<Pick<EffectIntent, "status" | "attempt">>
): EffectIntent {
  assertNonEmpty(input.effectId, "effectId");
  assertNonEmpty(input.grantRef, "grantRef");
  if (!("low" === input.riskTier || "medium" === input.riskTier || "high" === input.riskTier)) {
    throw new EffectError("VES_EFFECT_INTENT_INVALID", "riskTier is invalid");
  }
  if (input.idempotencyKey !== buildIdempotencyKey(input)) {
    throw new EffectError("VES_EFFECT_KEY_FORGED", "Idempotency key does not match canonical effect identity");
  }
  return Object.freeze({ ...input, status: input.status ?? "planned", attempt: input.attempt ?? 0 });
}
