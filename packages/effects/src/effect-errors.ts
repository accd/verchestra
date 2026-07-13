import { PublicErrorRegistry, type PublicErrorDefinition } from "@verchestra/domain";

const define = (
  code: string,
  category: PublicErrorDefinition["category"],
  retryability: PublicErrorDefinition["retryability"],
  recovery: string
): PublicErrorDefinition =>
  Object.freeze({
    code,
    category,
    component: "effect-broker",
    retryability,
    recovery,
    documentationVersion: "1",
    safeDetails: Object.freeze({})
  });

export const EFFECT_PUBLIC_ERROR_DEFINITIONS = Object.freeze([
  define(
    "VES_EFFECT_APPLY_FAILED",
    "external",
    "after-change",
    "Inspect the definite adapter failure before replanning."
  ),
  define(
    "VES_EFFECT_DISPATCH_LIMIT_INVALID",
    "validation",
    "never",
    "Use an integer dispatch limit from 1 through 1000."
  ),
  define("VES_EFFECT_INTENT_INVALID", "validation", "never", "Correct the canonical effect intent fields."),
  define("VES_EFFECT_KEY_CONFLICT", "integrity", "never", "Use a new semantic identity for different logical content."),
  define("VES_EFFECT_KEY_FORGED", "security", "never", "Rebuild the key from the canonical effect identity."),
  define("VES_EFFECT_NOT_FOUND", "state", "after-change", "Refresh the durable outbox and use an existing effect key."),
  define(
    "VES_EFFECT_RECEIPT_CONFLICT",
    "integrity",
    "never",
    "Stop dispatch and inspect the durable receipt collision."
  ),
  define(
    "VES_EFFECT_RECONCILIATION_REQUIRED",
    "external",
    "after-change",
    "Inspect remote state and reconcile the effect before any retry."
  )
]);

export const effectPublicErrorRegistry = new PublicErrorRegistry(EFFECT_PUBLIC_ERROR_DEFINITIONS);
