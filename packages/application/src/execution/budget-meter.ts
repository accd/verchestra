// Execution Packages declare maximumCostUsd, maximumTokens, and
// maximumDurationMs, and every qualified driver already emits usage events.
// This meter is the missing consumer: it turns declared ceilings into an
// enforced stop instead of parsed-and-ignored fields.

export type BudgetMeterErrorCode = "VES_BUDGET_MODEL_UNKNOWN" | "VES_BUDGET_USAGE_INVALID" | "VES_BUDGET_INVALID";

export class BudgetMeterError extends Error {
  readonly code: BudgetMeterErrorCode;

  constructor(code: BudgetMeterErrorCode, message: string) {
    super(message);
    this.name = "BudgetMeterError";
    this.code = code;
  }
}

function fail(code: BudgetMeterErrorCode, message: string): never {
  throw new BudgetMeterError(code, message);
}

export interface ModelPriceTable {
  readonly version: string;
  readonly models: Readonly<Record<string, { readonly inputPerMToken: number; readonly outputPerMToken: number }>>;
}

export interface DeclaredBudgets {
  readonly maximumCostUsd: number;
  readonly maximumTokens: number;
  readonly maximumDurationMs: number;
}

export interface UsageEvent {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type BudgetStopReason = "cost-threshold" | "token-threshold" | "duration-threshold";

export interface BudgetSnapshot {
  readonly schemaVersion: 1;
  readonly priceTableVersion: string;
  readonly declared: DeclaredBudgets;
  readonly thresholdPercent: number;
  readonly consumedCostUsd: number;
  readonly consumedTokens: number;
  readonly consumedDurationMs: number;
  readonly usageEvents: number;
  readonly stopReason: BudgetStopReason | null;
}

// The persistable part of a meter. A declared budget is a budget for the whole
// run, so consumption has to outlive both a single executor call and a crash
// between attempts; a meter that cannot be resumed is a meter that resets its
// own ceiling.
export interface BudgetLedger {
  readonly consumedCostUsd: number;
  readonly consumedTokens: number;
  readonly consumedDurationMs: number;
  readonly usageEvents: number;
  readonly stopReason: BudgetStopReason | null;
}

export interface BudgetMeter {
  recordUsage(event: UsageEvent): void;
  consumedDurationMs(): number;
  remainingDurationMs(): number;
  shouldStop(): { readonly stop: boolean; readonly reason?: BudgetStopReason };
  ledger(): BudgetLedger;
  snapshot(): BudgetSnapshot;
}

function positive(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    fail("VES_BUDGET_INVALID", `${label} must be a positive finite number`);
  return value;
}

function tokenCount(value: unknown, label: string): number {
  // A negative or fractional count would let a driver wind the meter backwards,
  // which is a budget bypass rather than a formatting nit.
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail("VES_BUDGET_USAGE_INVALID", `${label} is invalid`);
  return value as number;
}

function ledgerAmount(value: unknown, label: string): number {
  // A resumed ledger is untrusted input like any other persisted state. Winding
  // consumption backwards on resume would buy a fresh ceiling, which is the
  // same bypass as a negative usage count.
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    fail("VES_BUDGET_INVALID", `resumed ${label} is invalid`);
  return value;
}

function normalizeLedger(value: unknown): BudgetLedger {
  if (value === null || typeof value !== "object") fail("VES_BUDGET_INVALID", "resumed ledger is invalid");
  const ledger = value as Record<string, unknown>;
  const stopReason = ledger["stopReason"] ?? null;
  if (
    stopReason !== null &&
    !["cost-threshold", "token-threshold", "duration-threshold"].includes(stopReason as string)
  )
    fail("VES_BUDGET_INVALID", "resumed stop reason is invalid");
  const consumedTokens = ledger["consumedTokens"];
  const usageEvents = ledger["usageEvents"];
  if (!Number.isSafeInteger(consumedTokens) || (consumedTokens as number) < 0)
    fail("VES_BUDGET_INVALID", "resumed consumedTokens is invalid");
  if (!Number.isSafeInteger(usageEvents) || (usageEvents as number) < 0)
    fail("VES_BUDGET_INVALID", "resumed usageEvents is invalid");
  return Object.freeze({
    consumedCostUsd: ledgerAmount(ledger["consumedCostUsd"], "consumedCostUsd"),
    consumedTokens: consumedTokens as number,
    consumedDurationMs: ledgerAmount(ledger["consumedDurationMs"], "consumedDurationMs"),
    usageEvents: usageEvents as number,
    stopReason: stopReason as BudgetStopReason | null
  });
}

export function createBudgetMeter(options: {
  readonly budgets: DeclaredBudgets;
  readonly priceTable: ModelPriceTable;
  readonly thresholdPercent?: number;
  readonly now?: () => number;
  // Prior consumption to continue from, so one declared budget spans every
  // executor call and survives a crash between them.
  readonly resume?: unknown;
}): BudgetMeter {
  const declared = Object.freeze({
    maximumCostUsd: positive(options.budgets?.maximumCostUsd, "maximumCostUsd"),
    maximumTokens: positive(options.budgets?.maximumTokens, "maximumTokens"),
    maximumDurationMs: positive(options.budgets?.maximumDurationMs, "maximumDurationMs")
  });
  const thresholdPercent = options.thresholdPercent ?? 90;
  if (!Number.isFinite(thresholdPercent) || thresholdPercent <= 0 || thresholdPercent > 100)
    fail("VES_BUDGET_INVALID", "thresholdPercent must be within (0, 100]");
  if (typeof options.priceTable?.version !== "string" || options.priceTable.version.length === 0)
    fail("VES_BUDGET_INVALID", "price table version is required");
  const now = options.now ?? (() => Date.now());
  const resumed = options.resume === undefined ? undefined : normalizeLedger(options.resume);
  const threshold = thresholdPercent / 100;
  // Resuming backdates the start so elapsed time continues across attempts and
  // across a crash, rather than restarting the clock at zero.
  const startedAt = now() - (resumed?.consumedDurationMs ?? 0);

  let consumedCostUsd = resumed?.consumedCostUsd ?? 0;
  let consumedTokens = resumed?.consumedTokens ?? 0;
  let usageEvents = resumed?.usageEvents ?? 0;
  let stopReason: BudgetStopReason | null = resumed?.stopReason ?? null;

  const consumedDurationMs = () => Math.max(0, now() - startedAt);
  const durationCeiling = declared.maximumDurationMs * threshold;

  const evaluate = (): { readonly stop: boolean; readonly reason?: BudgetStopReason } => {
    if (stopReason === null) {
      // The threshold stop is deliberately below the hard ceiling: a human can
      // approve continuation with a fresh package before the budget is gone,
      // instead of discovering the run died exactly at its limit.
      if (consumedCostUsd >= declared.maximumCostUsd * threshold) stopReason = "cost-threshold";
      else if (consumedTokens >= declared.maximumTokens * threshold) stopReason = "token-threshold";
      else if (consumedDurationMs() >= durationCeiling) stopReason = "duration-threshold";
    }
    return stopReason === null ? { stop: false } : { stop: true, reason: stopReason };
  };

  return Object.freeze({
    recordUsage(event: UsageEvent): void {
      if (event === null || typeof event !== "object") fail("VES_BUDGET_USAGE_INVALID", "usage event is invalid");
      const inputTokens = tokenCount(event.inputTokens, "inputTokens");
      const outputTokens = tokenCount(event.outputTokens, "outputTokens");
      if (typeof event.model !== "string" || event.model.length === 0)
        fail("VES_BUDGET_USAGE_INVALID", "usage model is invalid");
      const price = options.priceTable.models[event.model];
      // Silent zero-cost for an unpriced model is a budget bypass, so an
      // unknown model stops the run instead of running for free.
      if (price === undefined) fail("VES_BUDGET_MODEL_UNKNOWN", `model ${event.model} has no priced entry`);
      consumedCostUsd += (inputTokens * price.inputPerMToken + outputTokens * price.outputPerMToken) / 1_000_000;
      consumedTokens += inputTokens + outputTokens;
      usageEvents += 1;
      evaluate();
    },
    consumedDurationMs,
    // What is left of the run's duration ceiling, not of a fresh one. An
    // executor call started mid-run must inherit the remaining time.
    remainingDurationMs(): number {
      return Math.max(0, durationCeiling - consumedDurationMs());
    },
    shouldStop: evaluate,
    ledger(): BudgetLedger {
      return Object.freeze({
        consumedCostUsd,
        consumedTokens,
        consumedDurationMs: consumedDurationMs(),
        usageEvents,
        stopReason
      });
    },
    snapshot(): BudgetSnapshot {
      return Object.freeze({
        schemaVersion: 1,
        priceTableVersion: options.priceTable.version,
        declared,
        thresholdPercent,
        consumedCostUsd,
        consumedTokens,
        consumedDurationMs: consumedDurationMs(),
        usageEvents,
        stopReason
      });
    }
  });
}
