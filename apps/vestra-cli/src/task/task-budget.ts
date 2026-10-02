import { budgetBilling, type BudgetLedger } from "@verchestra/application";

import { stateInvalid } from "./task-errors.ts";
import { objectRow } from "./task-files.ts";

// invariant: unbilled usage is never given a dollar figure. Status shows this
// text where the cost would be, and the Run Capsule carries no cost at all.
export const NOT_BILLED = "not billed (subscription)";

const STOP_REASONS: readonly unknown[] = Object.freeze(["cost-threshold", "token-threshold", "duration-threshold"]);

function amount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && amount(value);
}

// hazard: unbilled tokens above the consumed total would report billed usage
// as not billed.
function unbilledWithin(value: unknown, consumedTokens: number): boolean {
  return value === undefined || (count(value) && value <= consumedTokens);
}

function isBudgetLedger(
  row: Readonly<Record<string, unknown>>
): row is Readonly<Record<string, unknown>> & BudgetLedger {
  const consumedTokens = row["consumedTokens"];
  return (
    amount(row["consumedCostUsd"]) &&
    count(consumedTokens) &&
    amount(row["consumedDurationMs"]) &&
    count(row["usageEvents"]) &&
    (row["stopReason"] === null || STOP_REASONS.includes(row["stopReason"])) &&
    unbilledWithin(row["unbilledTokens"], consumedTokens)
  );
}

// invariant: the ledger a repair checkpoint carries is read here and nowhere
// else. It is returned as it was stored, so a report of it keeps its members;
// anything that is not a ledger is refused instead of being reported or
// resumed as one.
export function storedBudgetLedger(value: unknown): BudgetLedger | undefined {
  if (value === null || value === undefined) return undefined;
  const row = objectRow(value, "budget ledger");
  if (!isBudgetLedger(row)) throw stateInvalid("VES_TASK_STATE_MALFORMED", "The stored budget ledger is malformed");
  return row;
}

// why: a ledger of billed usage alone is reported exactly as it was stored, so
// the API-key path keeps its output; only unbilled usage changes the report.
export function budgetStatus(ledger: BudgetLedger | undefined): unknown {
  if (ledger === undefined) return null;
  const billing = budgetBilling(ledger);
  if (billing === "per-token") return ledger;
  return billing === "subscription" ? { ...ledger, consumedCostUsd: NOT_BILLED, billing } : { ...ledger, billing };
}

export function capsuleBudgetConsumption(ledger: BudgetLedger) {
  const billing = budgetBilling(ledger);
  const counts = {
    tokens: ledger.consumedTokens,
    durationMs: ledger.consumedDurationMs,
    usageEvents: ledger.usageEvents
  };
  if (billing === "per-token") return { consumed: { costUsd: ledger.consumedCostUsd, ...counts } };
  const unbilledTokens = ledger.unbilledTokens;
  if (billing === "subscription") return { consumed: { ...counts, unbilledTokens }, billing };
  return { consumed: { costUsd: ledger.consumedCostUsd, ...counts, unbilledTokens }, billing };
}
