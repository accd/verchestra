import { budgetBilling, type BudgetLedger } from "@verchestra/application";

// invariant: unbilled usage is never given a dollar figure. Status shows this
// text where the cost would be, and the Run Capsule carries no cost at all.
export const NOT_BILLED = "not billed (subscription)";

type Row = Readonly<Record<string, unknown>>;

function ledgerRow(value: unknown): (Row & BudgetLedger) | undefined {
  return value === null || typeof value !== "object" || Array.isArray(value)
    ? undefined
    : (value as Row & BudgetLedger);
}

// why: a ledger of billed usage alone is reported exactly as it was stored, so
// the API-key path keeps its output; only unbilled usage changes the report.
export function budgetStatus(value: unknown): unknown {
  const ledger = ledgerRow(value);
  if (ledger === undefined) return null;
  const billing = budgetBilling(ledger);
  if (billing === "per-token") return ledger;
  return billing === "subscription" ? { ...ledger, consumedCostUsd: NOT_BILLED, billing } : { ...ledger, billing };
}

export function capsuleBudgetConsumption(ledger: Row) {
  const billing = budgetBilling(ledger as unknown as BudgetLedger);
  const counts = {
    tokens: ledger["consumedTokens"],
    durationMs: ledger["consumedDurationMs"],
    usageEvents: ledger["usageEvents"]
  };
  if (billing === "per-token") return { consumed: { costUsd: ledger["consumedCostUsd"], ...counts } };
  const unbilledTokens = ledger["unbilledTokens"];
  if (billing === "subscription") return { consumed: { ...counts, unbilledTokens }, billing };
  return { consumed: { costUsd: ledger["consumedCostUsd"], ...counts, unbilledTokens }, billing };
}
