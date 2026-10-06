import type { ModelPriceTable } from "./budget-meter.ts";

export type SubscriptionDriverId = "claude-code" | "codex";

// invariant: a model an account offers on a subscription is listed here by the
// driver that runs it, with no price: nothing is billed per token for it, so
// nothing is priced. It is never a priced model's alias, and it never stands
// in for one on an API key (the run refuses that before any effect).
export interface ModelCatalog extends ModelPriceTable {
  readonly subscriptionModels: Readonly<Record<SubscriptionDriverId, readonly string[]>>;
}

// why: the subscription-only lists were read from the accounts of the
// 2026-10-06 pilot (AD-084). No price is invented for a model whose price is
// not documented; a model that has one belongs in `models` instead.

// HUMAN REVIEW REQUIRED: per-model rates are externally verified data, seeded
// from provider list prices in USD per million tokens on 2026-07-29. Changes
// are reviewed like code. The version and the exact rates in force are sealed
// into every Run Capsule, so historical runs stay auditable after updates.
// An absent model fails closed with VES_BUDGET_MODEL_UNKNOWN; never add a
// wildcard entry.
export const modelPriceTable: ModelCatalog = Object.freeze({
  version: "2026.10.0",
  models: Object.freeze({
    "claude-opus-5": Object.freeze({ inputPerMToken: 15, outputPerMToken: 75 }),
    "claude-sonnet-5": Object.freeze({ inputPerMToken: 3, outputPerMToken: 15 }),
    "claude-fable-5": Object.freeze({ inputPerMToken: 3, outputPerMToken: 15 }),
    "claude-haiku-4-5-20251001": Object.freeze({ inputPerMToken: 1, outputPerMToken: 5 }),
    "gpt-5.2-codex": Object.freeze({ inputPerMToken: 1.75, outputPerMToken: 14 }),
    "qwen3-coder-480b": Object.freeze({ inputPerMToken: 0.45, outputPerMToken: 1.8 })
  }),
  subscriptionModels: Object.freeze({
    "claude-code": Object.freeze(["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5"]),
    codex: Object.freeze([
      "gpt-5.5",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-6-sol",
      "gpt-6-astra",
      "gpt-6-luna",
      "gpt-6.1-sol"
    ])
  })
});

export function isPricedModel(model: string): boolean {
  return Object.hasOwn(modelPriceTable.models, model);
}

// invariant: only a model with no price is subscription-only; a priced model
// is billed per token on an API key and is not listed twice.
export function isSubscriptionOnlyModel(driverId: SubscriptionDriverId, model: string): boolean {
  return !isPricedModel(model) && modelPriceTable.subscriptionModels[driverId].includes(model);
}

export function isKnownModel(driverId: SubscriptionDriverId, model: string): boolean {
  return isPricedModel(model) || isSubscriptionOnlyModel(driverId, model);
}
