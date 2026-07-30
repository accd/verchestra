// A denied request that answers only "deny" teaches the caller nothing and
// tempts them to weaken policy until it passes. The explanation layer maps each
// determining policy back to its source statement, and every explanation is
// redacted before it can enter evidence or CLI output - a policy explanation
// must never become a secret-disclosure channel.

import type { PolicyDecision, PolicyView } from "./cedar-policy.ts";

export interface PolicyExplanationEntry {
  readonly policyId: string;
  readonly layer: string;
  readonly statement: string;
}

export interface PolicyExplanation {
  readonly decision: "allow" | "deny";
  readonly code: string;
  readonly summary: string;
  readonly determining: readonly PolicyExplanationEntry[];
  readonly redactions: number;
}

// Conservative secret shapes. Redaction is recorded, never silent, so evidence
// shows that something was withheld and how much.
const SECRET_SHAPES = [
  /\bsk-[A-Za-z0-9]{16,}\b/gu,
  /\bghp_[A-Za-z0-9]{20,}\b/gu,
  /\bBEGIN (?:RSA |OPENSSH )?PRIVATE KEY\b[\s\S]*?$/gu,
  /\b[a-f0-9]{40,64}\b/gu
];

export function redactSecretShapes(value: string): { readonly value: string; readonly redactions: number } {
  let redactions = 0;
  let result = value;
  for (const shape of SECRET_SHAPES) {
    result = result.replace(shape, () => {
      redactions += 1;
      return "[redacted]";
    });
  }
  return { value: result, redactions };
}

export function explainDecision(decision: PolicyDecision, view: PolicyView): PolicyExplanation {
  let redactions = 0;
  const redact = (value: string): string => {
    const outcome = redactSecretShapes(value);
    redactions += outcome.redactions;
    return outcome.value;
  };

  const determining = decision.determiningPolicies.map((policyId) => {
    // Compiled policy ids are `${layer}.${id}` (cedar-policy.ts), so the layer
    // is recoverable from the id itself and cross-checked against the view.
    const separator = policyId.indexOf(".");
    const layer = separator > 0 ? policyId.slice(0, separator) : undefined;
    const id = separator > 0 ? policyId.slice(separator + 1) : policyId;
    const statement = layer === undefined ? undefined : view.layers[layer as keyof typeof view.layers]?.[id];
    if (layer !== undefined && statement !== undefined) {
      return Object.freeze({ policyId, layer, statement: redact(statement) });
    }
    // A determining policy the view cannot name is itself worth surfacing: the
    // decision and the view disagree about what exists.
    return Object.freeze({ policyId, layer: "unknown", statement: "policy source not present in the view" });
  });

  const summary =
    decision.decision === "allow"
      ? `allowed: ${redact(decision.explanation)}${determining.length > 0 ? ` (${determining.map((entry) => entry.policyId).join(", ")})` : ""}`
      : `denied: ${redact(decision.explanation)}${determining.length > 0 ? ` (${determining.map((entry) => `${entry.layer} policy ${entry.policyId}`).join(", ")})` : ""}`;

  return Object.freeze({
    decision: decision.decision,
    code: decision.code,
    summary,
    determining: Object.freeze(determining),
    redactions
  });
}
