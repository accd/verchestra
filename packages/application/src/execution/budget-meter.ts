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
  // invariant: SSI-17. The provider whose model the usage was spent on, when
  // the caller reports it; a coordinated node's always names its own. The
  // meter prices by model alone.
  readonly provider?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type BudgetStopReason = "cost-threshold" | "token-threshold" | "duration-threshold";

// why: usage on a subscription is not billed per token, so it has tokens and
// duration but no cost. The share of unbilled tokens says which a ledger holds.
export type BudgetBilling = "per-token" | "subscription" | "mixed";

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
  readonly unbilledTokens?: number;
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
  // invariant: present only when the run was metered with a model that is not
  // billed per token, so a ledger of billed usage alone is byte-identical to
  // one written before.
  readonly unbilledTokens?: number;
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

function ledgerCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail("VES_BUDGET_INVALID", `resumed ${label} is invalid`);
  return value as number;
}

// hazard: unbilled tokens above the consumed total would let a resumed ledger
// report billed usage as not billed.
function resumedUnbilledTokens(value: unknown, consumedTokens: number): { readonly unbilledTokens?: number } {
  if (value === undefined) return {};
  const unbilledTokens = ledgerCount(value, "unbilledTokens");
  if (unbilledTokens > consumedTokens) fail("VES_BUDGET_INVALID", "resumed unbilledTokens is invalid");
  return { unbilledTokens };
}

function unbilledField(reported: boolean, unbilledTokens: number): { readonly unbilledTokens?: number } {
  return reported ? { unbilledTokens } : {};
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
  const consumedTokens = ledgerCount(ledger["consumedTokens"], "consumedTokens");
  return Object.freeze({
    consumedCostUsd: ledgerAmount(ledger["consumedCostUsd"], "consumedCostUsd"),
    consumedTokens,
    consumedDurationMs: ledgerAmount(ledger["consumedDurationMs"], "consumedDurationMs"),
    usageEvents: ledgerCount(ledger["usageEvents"], "usageEvents"),
    stopReason: stopReason as BudgetStopReason | null,
    ...resumedUnbilledTokens(ledger["unbilledTokens"], consumedTokens)
  });
}

function unbilledModelSet(models: unknown): ReadonlySet<string> {
  if (models === undefined) return new Set();
  if (!Array.isArray(models) || models.some((model) => typeof model !== "string" || model.length === 0))
    fail("VES_BUDGET_INVALID", "unbilledModels must name models");
  return new Set(models as readonly string[]);
}

function resumedUnbilled(ledger: BudgetLedger | undefined): number {
  return ledger?.unbilledTokens ?? 0;
}

// why: a run metered with an unbilled model says so even before its first
// usage event, so a subscription run that consumed nothing is not reported
// with a dollar figure of zero.
function unbilledReported(models: ReadonlySet<string>, ledger: BudgetLedger | undefined): boolean {
  return models.size > 0 || ledger?.unbilledTokens !== undefined;
}

// hazard: silent zero-cost for an unpriced model is a budget bypass, so an
// unknown model stops the run instead of running for free.
function pricedCost(table: ModelPriceTable, model: string, inputTokens: number, outputTokens: number): number {
  const price = table.models[model];
  if (price === undefined) fail("VES_BUDGET_MODEL_UNKNOWN", `model ${model} has no priced entry`);
  return (inputTokens * price.inputPerMToken + outputTokens * price.outputPerMToken) / 1_000_000;
}

export function budgetBilling(ledger: Pick<BudgetLedger, "consumedTokens" | "unbilledTokens">): BudgetBilling {
  const unbilledTokens = ledger.unbilledTokens;
  if (unbilledTokens === undefined) return "per-token";
  if (unbilledTokens === ledger.consumedTokens) return "subscription";
  return unbilledTokens === 0 ? "per-token" : "mixed";
}

// invariant: the verdict of one metered usage event. `failure` is present only
// when the meter refused the event itself; `reason` then carries its code.
export type BudgetUsageDecision =
  { readonly stop: false } | { readonly stop: true; readonly reason: string; readonly failure?: BudgetMeterError };

// why: every place that meters a driver's usage (the executor for the
// implementer, the task composition for the verifier) must stop on the same
// conditions, so recording and deciding are one step with one verdict.
// hazard: only the meter's own refusal is a budget stop. Any other error is a
// defect in the caller or the meter and is rethrown, never read as a stop.
export function recordUsageAndDecide(meter: BudgetMeter, event: UsageEvent): BudgetUsageDecision {
  try {
    meter.recordUsage(event);
  } catch (error) {
    if (!(error instanceof BudgetMeterError)) throw error;
    return Object.freeze({ stop: true, reason: error.code, failure: error });
  }
  const verdict = meter.shouldStop();
  return verdict.stop
    ? Object.freeze({ stop: true, reason: verdict.reason ?? "budget" })
    : Object.freeze({ stop: false });
}

export function createBudgetMeter(options: {
  readonly budgets: DeclaredBudgets;
  readonly priceTable: ModelPriceTable;
  readonly thresholdPercent?: number;
  readonly now?: () => number;
  // Prior consumption to continue from, so one declared budget spans every
  // executor call and survives a crash between them.
  readonly resume?: unknown;
  // why: models the caller reaches through a subscription. Their usage counts
  // toward the token and duration ceilings and is never priced; every other
  // model keeps the priced path and still fails closed without a price.
  readonly unbilledModels?: readonly string[];
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
  const unbilledModels = unbilledModelSet(options.unbilledModels);
  const threshold = thresholdPercent / 100;
  // Resuming backdates the start so elapsed time continues across attempts and
  // across a crash, rather than restarting the clock at zero.
  const startedAt = now() - (resumed?.consumedDurationMs ?? 0);

  let consumedCostUsd = resumed?.consumedCostUsd ?? 0;
  let consumedTokens = resumed?.consumedTokens ?? 0;
  let usageEvents = resumed?.usageEvents ?? 0;
  let unbilledTokens = resumedUnbilled(resumed);
  const reportsUnbilled = unbilledReported(unbilledModels, resumed);
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
      if (unbilledModels.has(event.model)) unbilledTokens += inputTokens + outputTokens;
      else consumedCostUsd += pricedCost(options.priceTable, event.model, inputTokens, outputTokens);
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
        stopReason,
        ...unbilledField(reportsUnbilled, unbilledTokens)
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
        stopReason,
        ...unbilledField(reportsUnbilled, unbilledTokens)
      });
    }
  });
}
