import { createHash } from "node:crypto";

import { canonicalizeJsonV2, Digest } from "@verchestra/domain";

export type EffectStatus = "planned" | "ready" | "applying" | "uncertain" | "completed" | "failed";
export type EffectRiskTier = "low" | "medium" | "high";
export type ReceiptOutcome = "applied" | "already-applied" | "not-applied" | "unknown" | "compensated";
export type EffectCanonicalizationVersion = 1 | 2;

export interface IdempotencyInput {
  readonly operationKind: string;
  readonly workspaceId: string;
  readonly logicalTarget: string;
  readonly canonicalInputDigest: string;
  readonly semanticIdentity: string;
  readonly canonicalizationVersion?: EffectCanonicalizationVersion;
}

export interface EffectIntent extends Omit<IdempotencyInput, "canonicalizationVersion"> {
  readonly canonicalizationVersion: EffectCanonicalizationVersion;
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
  findByIdentity(input: IdempotencyInput): Promise<EffectIntent | undefined>;
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
  const canonicalizationVersion = effectCanonicalizationVersion(input);
  const identity = {
    schemaVersion: 1,
    operationKind: input.operationKind,
    workspaceId: input.workspaceId,
    logicalTarget: input.logicalTarget,
    canonicalInputDigest: input.canonicalInputDigest,
    semanticIdentity: input.semanticIdentity
  };
  const canonicalIdentity =
    canonicalizationVersion === 1
      ? JSON.stringify(identity)
      : canonicalizeJsonV2({ ...identity, canonicalizationVersion });
  const prefix = canonicalizationVersion === 1 ? "sha256:" : "v2:sha256:";
  return `${prefix}${createHash("sha256").update(canonicalIdentity, "utf8").digest("hex")}`;
}

export function createEffectIntent(
  input: Omit<EffectIntent, "status" | "attempt" | "canonicalizationVersion"> &
    Partial<Pick<EffectIntent, "status" | "attempt" | "canonicalizationVersion">>
): EffectIntent {
  assertNonEmpty(input.effectId, "effectId");
  assertNonEmpty(input.grantRef, "grantRef");
  if (!("low" === input.riskTier || "medium" === input.riskTier || "high" === input.riskTier)) {
    throw new EffectError("VES_EFFECT_INTENT_INVALID", "riskTier is invalid");
  }
  const canonicalizationVersion = effectCanonicalizationVersion(input);
  if (input.idempotencyKey !== buildIdempotencyKey({ ...input, canonicalizationVersion })) {
    throw new EffectError("VES_EFFECT_KEY_FORGED", "Idempotency key does not match canonical effect identity");
  }
  return Object.freeze({
    ...input,
    canonicalizationVersion,
    status: input.status ?? "planned",
    attempt: input.attempt ?? 0
  });
}

function effectCanonicalizationVersion(input: IdempotencyInput): EffectCanonicalizationVersion {
  const version = input.canonicalizationVersion ?? 2;
  if (version !== 1 && version !== 2) {
    throw new EffectError("VES_EFFECT_INTENT_INVALID", "canonicalizationVersion is invalid");
  }
  return version;
}
