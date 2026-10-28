import { createHash } from "node:crypto";

import { canonicalizeJsonV2 } from "@verchestra/domain";

export const POLICY_LAYERS = Object.freeze([
  "builtIn",
  "organization",
  "workspace",
  "project",
  "userPreference",
  "runOverride"
] as const);

export type PolicyLayer = (typeof POLICY_LAYERS)[number];

export interface PolicyView {
  readonly schemaVersion: 1;
  readonly generation: number;
  readonly schema: unknown;
  readonly layers: Partial<Readonly<Record<PolicyLayer, Readonly<Record<string, string>>>>>;
}

export interface CedarRequest {
  readonly principal: { readonly type: string; readonly id: string };
  readonly action: { readonly type: string; readonly id: string };
  readonly resource: { readonly type: string; readonly id: string };
  readonly context: Readonly<Record<string, unknown>>;
}

export interface CedarEnginePort {
  getCedarVersion(): string;
  getCedarSDKVersion(): string;
  getCedarLangVersion(): string;
  checkParseSchema(schema: unknown): unknown;
  checkParsePolicySet(input: unknown): unknown;
  policyToJson(policy: string): unknown;
  validate(input: unknown): unknown;
  isAuthorized(input: unknown): unknown;
}

export interface PolicyValidation {
  readonly valid: boolean;
  readonly code: string;
  readonly explanation: string;
  readonly policyViewDigest: string;
}

export interface PolicyDecision {
  readonly decision: "allow" | "deny";
  readonly code: string;
  readonly explanation: string;
  readonly determiningPolicies: readonly string[];
  readonly policyViewDigest: string;
  readonly requestDigest: string;
  readonly engineVersion: string;
  readonly languageVersion: string;
  readonly evidenceDigest: string;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : {};
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalizeJsonV2(value)).digest("hex")}`;
}

// Code-unit comparison, not localeCompare: this ordering fixes the iteration
// order #compile's validation loop walks a layer's policies in, which
// determines which policy's failure is reported first when more than one is
// invalid -- a real, observable behavior, not just digest input order
// (issue #58).
function codeUnitCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizedView(view: PolicyView): PolicyView {
  const layers: Partial<Record<PolicyLayer, Readonly<Record<string, string>>>> = {};
  for (const layer of POLICY_LAYERS) {
    const policies = view.layers[layer];
    if (policies === undefined) continue;
    layers[layer] = Object.freeze(
      Object.fromEntries(Object.entries(policies).sort(([left], [right]) => codeUnitCompare(left, right)))
    );
  }
  return Object.freeze({
    schemaVersion: view.schemaVersion,
    generation: view.generation,
    schema: view.schema,
    layers: Object.freeze(layers)
  });
}

function validationFailure(code: string, explanation: string, policyViewDigest: string): PolicyValidation {
  return Object.freeze({ valid: false, code, explanation, policyViewDigest });
}

// Pure and computable without a CedarEnginePort (DDL-07, #207): a live
// cedar-policy doctor probe needs the same digest CedarPolicyAdapter.#compile
// reports without constructing an engine to get it. Exported under an alias
// (see the bottom of this file) rather than declared with this name directly,
// because #compile's own local variable is also named policyViewDigest and a
// same-name self-reference at that call site would hit the temporal dead
// zone.
function computePolicyViewDigest(view: PolicyView): string {
  try {
    return digest(normalizedView(view));
  } catch {
    return digest({ invalidPolicyView: true });
  }
}

export { computePolicyViewDigest as policyViewDigest };

function arrays(value: unknown, key: string): readonly unknown[] {
  const candidate = record(value)[key];
  return Array.isArray(candidate) ? candidate : [];
}

interface CompiledView {
  readonly validation: PolicyValidation;
  readonly normalized: PolicyView;
  readonly policies: { readonly staticPolicies: Readonly<Record<string, string>> };
}

interface PolicyRejection {
  readonly code: string;
  readonly explanation: string;
}

function validationRejected(checked: unknown): boolean {
  return (
    record(checked)["type"] !== "success" ||
    arrays(checked, "validationErrors").length > 0 ||
    arrays(checked, "validationWarnings").length > 0 ||
    arrays(checked, "otherWarnings").length > 0
  );
}

export class CedarPolicyAdapter {
  readonly #engine: CedarEnginePort;
  readonly #expectedEngineVersion: string;
  readonly #expectedLanguageVersion: string;

  constructor(options: {
    readonly engine: CedarEnginePort;
    readonly expectedEngineVersion?: string;
    readonly expectedLanguageVersion?: string;
  }) {
    this.#engine = options.engine;
    this.#expectedEngineVersion = options.expectedEngineVersion ?? "4.14.0";
    this.#expectedLanguageVersion = options.expectedLanguageVersion ?? "4.6";
  }

  #compile(view: PolicyView): CompiledView {
    let normalized: PolicyView = Object.freeze({
      schemaVersion: 1,
      generation: 1,
      schema: null,
      layers: Object.freeze({})
    });
    const policyViewDigest = computePolicyViewDigest(view);
    const policies: Record<string, string> = {};
    const rejected = (rejection: PolicyRejection, compiledPolicies?: CompiledView["policies"]): CompiledView => ({
      validation: validationFailure(rejection.code, rejection.explanation, policyViewDigest),
      normalized,
      policies: compiledPolicies ?? { staticPolicies: policies }
    });
    try {
      normalized = normalizedView(view);
      const rejection = this.#releaseRejection(view, normalized) ?? this.#layersRejection(normalized, policies);
      if (rejection !== undefined) return rejected(rejection);
      const compiledPolicies = { staticPolicies: Object.freeze({ ...policies }) };
      const checked = this.#engine.validate({
        schema: normalized.schema,
        policies: compiledPolicies,
        validationSettings: { mode: "strict" }
      });
      if (validationRejected(checked))
        return rejected(
          { code: "VES_POLICY_VALIDATION_FAILED", explanation: "Cedar policy validation failed" },
          compiledPolicies
        );
      return {
        validation: Object.freeze({
          valid: true,
          code: "VES_POLICY_VIEW_VALID",
          explanation: "Policy view is valid and monotonic",
          policyViewDigest
        }),
        normalized,
        policies: compiledPolicies
      };
    } catch {
      return rejected({ code: "VES_POLICY_ENGINE_FAILURE", explanation: "Cedar engine failed closed" });
    }
  }

  // invariant: the engine identity is checked before the view, and the view's
  // own shape before its schema is parsed; the first failing check is reported.
  #releaseRejection(view: PolicyView, normalized: PolicyView): PolicyRejection | undefined {
    if (
      this.#engine.getCedarVersion() !== this.#expectedEngineVersion ||
      this.#engine.getCedarSDKVersion() !== this.#expectedEngineVersion
    )
      return {
        code: "VES_POLICY_ENGINE_VERSION_MISMATCH",
        explanation: "Cedar engine version does not match the qualified release"
      };
    if (this.#engine.getCedarLangVersion() !== this.#expectedLanguageVersion)
      return {
        code: "VES_POLICY_LANGUAGE_VERSION_MISMATCH",
        explanation: "Cedar language version does not match the qualified release"
      };
    if (view.schemaVersion !== 1 || !Number.isSafeInteger(view.generation) || view.generation < 1)
      return { code: "VES_POLICY_VIEW_INVALID", explanation: "Policy view schema or generation is invalid" };
    if (record(this.#engine.checkParseSchema(normalized.schema))["type"] !== "success")
      return { code: "VES_POLICY_SCHEMA_INVALID", explanation: "Cedar schema failed to parse" };
    return undefined;
  }

  #layersRejection(normalized: PolicyView, policies: Record<string, string>): PolicyRejection | undefined {
    for (const layer of POLICY_LAYERS) {
      const layerPolicies = normalized.layers[layer];
      if (layerPolicies === undefined) continue;
      const rejection = this.#layerRejection(layer, layerPolicies, policies);
      if (rejection !== undefined) return rejection;
    }
    return undefined;
  }

  #layerRejection(
    layer: PolicyLayer,
    layerPolicies: Readonly<Record<string, string>>,
    policies: Record<string, string>
  ): PolicyRejection | undefined {
    if (record(this.#engine.checkParsePolicySet({ staticPolicies: layerPolicies }))["type"] !== "success")
      return { code: "VES_POLICY_PARSE_INVALID", explanation: `Policy layer failed to parse: ${layer}` };
    for (const [policyId, policy] of Object.entries(layerPolicies)) {
      const rejection = this.#policyRejection(layer, policyId, policy);
      if (rejection !== undefined) return rejection;
      policies[`${layer}.${policyId}`] = policy;
    }
    return undefined;
  }

  #policyRejection(layer: PolicyLayer, policyId: string, policy: string): PolicyRejection | undefined {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(policyId))
      return { code: "VES_POLICY_VIEW_INVALID", explanation: "Policy ID is not canonical" };
    const parsed = record(this.#engine.policyToJson(policy));
    if (parsed["type"] !== "success")
      return { code: "VES_POLICY_PARSE_INVALID", explanation: `Policy failed to parse: ${layer}.${policyId}` };
    if (layer !== "builtIn" && record(parsed["json"])["effect"] !== "forbid")
      return {
        code: "VES_POLICY_NON_MONOTONIC",
        explanation: `Lower policy layer attempted to expand authority: ${layer}`
      };
    return undefined;
  }

  validateView(view: PolicyView): PolicyValidation {
    return this.#compile(view).validation;
  }

  authorize(input: {
    readonly view: PolicyView;
    readonly request: CedarRequest;
    readonly entities?: readonly unknown[];
    readonly untrustedContent?: unknown;
  }): PolicyDecision {
    // invariant: input.untrustedContent is accepted and never consulted; only the
    // view, the request and the entities decide.
    const compiled = this.#compile(input.view);
    const request: CedarRequest = Object.freeze({
      principal: Object.freeze({ type: input.request.principal.type, id: input.request.principal.id }),
      action: Object.freeze({ type: input.request.action.type, id: input.request.action.id }),
      resource: Object.freeze({ type: input.request.resource.type, id: input.request.resource.id }),
      context: Object.freeze({ ...input.request.context })
    });
    const requestDigest = digest(request);
    const engineVersion = this.#expectedEngineVersion;
    const languageVersion = this.#expectedLanguageVersion;
    const finish = (
      decision: "allow" | "deny",
      code: string,
      explanation: string,
      determiningPolicies: readonly string[] = []
    ): PolicyDecision => {
      const material = Object.freeze({
        decision,
        code,
        explanation,
        determiningPolicies: Object.freeze([...determiningPolicies].sort(codeUnitCompare)),
        policyViewDigest: compiled.validation.policyViewDigest,
        requestDigest,
        engineVersion,
        languageVersion
      });
      return Object.freeze({ ...material, evidenceDigest: digest(material) });
    };
    if (!compiled.validation.valid) {
      return finish("deny", compiled.validation.code, compiled.validation.explanation);
    }
    try {
      const answer = this.#engine.isAuthorized({
        ...request,
        schema: compiled.normalized.schema,
        validateRequest: true,
        policies: compiled.policies,
        entities: input.entities ?? []
      });
      const answerRecord = record(answer);
      if (answerRecord["type"] !== "success") {
        return finish("deny", "VES_POLICY_EVALUATION_FAILED", "Cedar request evaluation failed");
      }
      const response = record(answerRecord["response"]);
      const diagnostics = record(response["diagnostics"]);
      if (arrays(answer, "warnings").length > 0 || arrays(diagnostics, "errors").length > 0) {
        return finish("deny", "VES_POLICY_DIAGNOSTIC_DENY", "Cedar returned evaluation diagnostics");
      }
      const determiningPolicies = arrays(diagnostics, "reason").map(String);
      if (response["decision"] === "allow") {
        return finish("allow", "VES_POLICY_ALLOW", "allowed by validated policy", determiningPolicies);
      }
      if (determiningPolicies.length > 0) {
        return finish("deny", "VES_POLICY_FORBID_DENY", "denied by matching forbid policy", determiningPolicies);
      }
      return finish("deny", "VES_POLICY_IMPLICIT_DENY", "denied because no permit policy matched");
    } catch {
      return finish("deny", "VES_POLICY_ENGINE_FAILURE", "Cedar engine failed closed");
    }
  }
}
