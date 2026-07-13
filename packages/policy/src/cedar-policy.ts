import { createHash } from "node:crypto";

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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as UnknownRecord)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function normalizedView(view: PolicyView): PolicyView {
  const layers: Partial<Record<PolicyLayer, Readonly<Record<string, string>>>> = {};
  for (const layer of POLICY_LAYERS) {
    const policies = view.layers[layer];
    if (policies === undefined) continue;
    layers[layer] = Object.freeze(
      Object.fromEntries(Object.entries(policies).sort(([left], [right]) => left.localeCompare(right)))
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

function arrays(value: unknown, key: string): readonly unknown[] {
  const candidate = record(value)[key];
  return Array.isArray(candidate) ? candidate : [];
}

interface CompiledView {
  readonly validation: PolicyValidation;
  readonly normalized: PolicyView;
  readonly policies: { readonly staticPolicies: Readonly<Record<string, string>> };
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
    this.#expectedEngineVersion = options.expectedEngineVersion ?? "4.11.2";
    this.#expectedLanguageVersion = options.expectedLanguageVersion ?? "4.5";
  }

  #compile(view: PolicyView): CompiledView {
    let normalized: PolicyView = Object.freeze({
      schemaVersion: 1,
      generation: 1,
      schema: null,
      layers: Object.freeze({})
    });
    let policyViewDigest = digest({ invalidPolicyView: true });
    const policies: Record<string, string> = {};
    try {
      normalized = normalizedView(view);
      policyViewDigest = digest(normalized);
      if (
        this.#engine.getCedarVersion() !== this.#expectedEngineVersion ||
        this.#engine.getCedarSDKVersion() !== this.#expectedEngineVersion
      ) {
        return {
          validation: validationFailure(
            "VES_POLICY_ENGINE_VERSION_MISMATCH",
            "Cedar engine version does not match the qualified release",
            policyViewDigest
          ),
          normalized,
          policies: { staticPolicies: policies }
        };
      }
      if (this.#engine.getCedarLangVersion() !== this.#expectedLanguageVersion) {
        return {
          validation: validationFailure(
            "VES_POLICY_LANGUAGE_VERSION_MISMATCH",
            "Cedar language version does not match the qualified release",
            policyViewDigest
          ),
          normalized,
          policies: { staticPolicies: policies }
        };
      }
      if (view.schemaVersion !== 1 || !Number.isSafeInteger(view.generation) || view.generation < 1) {
        return {
          validation: validationFailure(
            "VES_POLICY_VIEW_INVALID",
            "Policy view schema or generation is invalid",
            policyViewDigest
          ),
          normalized,
          policies: { staticPolicies: policies }
        };
      }
      if (record(this.#engine.checkParseSchema(normalized.schema))["type"] !== "success") {
        return {
          validation: validationFailure("VES_POLICY_SCHEMA_INVALID", "Cedar schema failed to parse", policyViewDigest),
          normalized,
          policies: { staticPolicies: policies }
        };
      }
      for (const layer of POLICY_LAYERS) {
        const layerPolicies = normalized.layers[layer];
        if (layerPolicies === undefined) continue;
        if (record(this.#engine.checkParsePolicySet({ staticPolicies: layerPolicies }))["type"] !== "success") {
          return {
            validation: validationFailure(
              "VES_POLICY_PARSE_INVALID",
              `Policy layer failed to parse: ${layer}`,
              policyViewDigest
            ),
            normalized,
            policies: { staticPolicies: policies }
          };
        }
        for (const [policyId, policy] of Object.entries(layerPolicies)) {
          if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(policyId)) {
            return {
              validation: validationFailure("VES_POLICY_VIEW_INVALID", "Policy ID is not canonical", policyViewDigest),
              normalized,
              policies: { staticPolicies: policies }
            };
          }
          const parsed = record(this.#engine.policyToJson(policy));
          if (parsed["type"] !== "success") {
            return {
              validation: validationFailure(
                "VES_POLICY_PARSE_INVALID",
                `Policy failed to parse: ${layer}.${policyId}`,
                policyViewDigest
              ),
              normalized,
              policies: { staticPolicies: policies }
            };
          }
          if (layer !== "builtIn" && record(parsed["json"])["effect"] !== "forbid") {
            return {
              validation: validationFailure(
                "VES_POLICY_NON_MONOTONIC",
                `Lower policy layer attempted to expand authority: ${layer}`,
                policyViewDigest
              ),
              normalized,
              policies: { staticPolicies: policies }
            };
          }
          policies[`${layer}.${policyId}`] = policy;
        }
      }
      const compiledPolicies = { staticPolicies: Object.freeze({ ...policies }) };
      const checked = this.#engine.validate({
        schema: normalized.schema,
        policies: compiledPolicies,
        validationSettings: { mode: "strict" }
      });
      if (
        record(checked)["type"] !== "success" ||
        arrays(checked, "validationErrors").length > 0 ||
        arrays(checked, "validationWarnings").length > 0 ||
        arrays(checked, "otherWarnings").length > 0
      ) {
        return {
          validation: validationFailure(
            "VES_POLICY_VALIDATION_FAILED",
            "Cedar policy validation failed",
            policyViewDigest
          ),
          normalized,
          policies: compiledPolicies
        };
      }
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
      return {
        validation: validationFailure("VES_POLICY_ENGINE_FAILURE", "Cedar engine failed closed", policyViewDigest),
        normalized,
        policies: { staticPolicies: policies }
      };
    }
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
    void input.untrustedContent;
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
        determiningPolicies: Object.freeze([...determiningPolicies].sort()),
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
