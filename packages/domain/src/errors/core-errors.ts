import {
  PublicErrorRegistry,
  type ErrorCategory,
  type PublicErrorDefinition,
  type Retryability
} from "./public-error.ts";

function definition(
  code: string,
  category: ErrorCategory,
  retryability: Retryability,
  recovery: string
): PublicErrorDefinition {
  return Object.freeze({
    code,
    category,
    component: "domain",
    retryability,
    recovery,
    documentationVersion: "1",
    safeDetails: Object.freeze({})
  });
}

export const CORE_PUBLIC_ERROR_DEFINITIONS = Object.freeze([
  definition("VES_ACTOR_INVALID", "validation", "never", "Use a supported actor kind and canonical actor ID."),
  definition("VES_CLASSIFICATION_INVALID", "validation", "never", "Use a declared data-classification label."),
  definition("VES_DIGEST_INVALID", "integrity", "never", "Recompute and supply a canonical SHA-256 digest."),
  definition(
    "VES_ERROR_CODE_UNKNOWN",
    "internal",
    "after-change",
    "Upgrade or correct the component that emitted the unknown error code."
  ),
  definition(
    "VES_ERROR_DEFINITION_INVALID",
    "internal",
    "never",
    "Correct the public error catalog before starting the component."
  ),
  definition(
    "VES_ERROR_DETAILS_INVALID",
    "security",
    "never",
    "Emit only the allowlisted safe detail fields and types."
  ),
  definition("VES_ID_INVALID", "validation", "never", "Use a canonical kind-prefixed UUID v4 or v7."),
  definition("VES_ID_KIND_MISMATCH", "validation", "never", "Use an ID whose kind matches the requested resource."),
  definition(
    "VES_INSTANT_INVALID",
    "validation",
    "never",
    "Use a real UTC instant with exactly millisecond precision."
  ),
  definition(
    "VES_LOGICAL_PATH_INVALID",
    "security",
    "never",
    "Use a portable repository-relative logical path without traversal."
  ),
  definition(
    "VES_REQUIREMENT_ID_INVALID",
    "validation",
    "never",
    "Use the canonical VES-AAA-000 requirement ID format."
  )
]);

export const corePublicErrorRegistry = new PublicErrorRegistry(CORE_PUBLIC_ERROR_DEFINITIONS);
