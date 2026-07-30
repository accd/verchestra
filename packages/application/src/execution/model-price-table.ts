import type { ModelPriceTable } from "./budget-meter.ts";

// HUMAN REVIEW REQUIRED: per-model rates are externally verified data, seeded
// from provider list prices in USD per million tokens on 2026-07-29. Changes
// are reviewed like code. The version and the exact rates in force are sealed
// into every Run Capsule, so historical runs stay auditable after updates.
// An absent model fails closed with VES_BUDGET_MODEL_UNKNOWN; never add a
// wildcard entry.
export const modelPriceTable: ModelPriceTable = Object.freeze({
  version: "2026.7.0",
  models: Object.freeze({
    "claude-opus-5": Object.freeze({ inputPerMToken: 15, outputPerMToken: 75 }),
    "claude-sonnet-5": Object.freeze({ inputPerMToken: 3, outputPerMToken: 15 }),
    "claude-fable-5": Object.freeze({ inputPerMToken: 3, outputPerMToken: 15 }),
    "claude-haiku-4-5-20251001": Object.freeze({ inputPerMToken: 1, outputPerMToken: 5 }),
    "gpt-5.2-codex": Object.freeze({ inputPerMToken: 1.75, outputPerMToken: 14 }),
    "qwen3-coder-480b": Object.freeze({ inputPerMToken: 0.45, outputPerMToken: 1.8 })
  })
});
