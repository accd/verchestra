const LAYERS = ["builtIn", "organization", "workspace", "project", "userPreference", "runOverride"];

function result(decision, code, explanation, determiningPolicies = []) {
  return { decision, code, explanation, determiningPolicies: [...determiningPolicies].sort() };
}

function deny(code, explanation, determiningPolicies = []) {
  return result("deny", code, explanation, determiningPolicies);
}

export class CedarPolicyOracle {
  constructor({ engine, expectedEngineVersion = "4.11.2", expectedLanguageVersion = "4.5" }) {
    this.engine = engine;
    this.expectedEngineVersion = expectedEngineVersion;
    this.expectedLanguageVersion = expectedLanguageVersion;
  }

  authorize({ schema, layers = {}, request, entities = [] }) {
    try {
      if (this.engine.getCedarVersion() !== this.expectedEngineVersion || this.engine.getCedarSDKVersion() !== this.expectedEngineVersion) {
        return deny("VES_POLICY_ENGINE_VERSION_MISMATCH", "Cedar engine version does not match the qualified release");
      }
      if (this.engine.getCedarLangVersion() !== this.expectedLanguageVersion) {
        return deny("VES_POLICY_LANGUAGE_VERSION_MISMATCH", "Cedar language version does not match the qualified release");
      }

      const parsedSchema = this.engine.checkParseSchema(schema);
      if (parsedSchema.type !== "success") return deny("VES_POLICY_SCHEMA_INVALID", "Cedar schema failed to parse");

      const combined = {};
      for (const layer of LAYERS) {
        const policies = layers[layer];
        if (!policies) continue;
        const parsedPolicies = this.engine.checkParsePolicySet({ staticPolicies: policies });
        if (parsedPolicies.type !== "success") return deny("VES_POLICY_PARSE_INVALID", `policy layer failed to parse: ${layer}`);

        for (const [policyId, policy] of Object.entries(policies)) {
          const parsedPolicy = this.engine.policyToJson(policy);
          if (parsedPolicy.type !== "success") return deny("VES_POLICY_PARSE_INVALID", `policy failed to parse: ${layer}.${policyId}`);
          if (layer !== "builtIn" && parsedPolicy.json.effect !== "forbid") {
            return deny("VES_POLICY_NON_MONOTONIC", `lower policy layer attempted to expand authority: ${layer}`);
          }
          combined[`${layer}.${policyId}`] = policy;
        }
      }

      const policies = { staticPolicies: combined };
      const validation = this.engine.validate({ schema, policies, validationSettings: { mode: "strict" } });
      if (
        validation.type !== "success" ||
        validation.validationErrors.length > 0 ||
        validation.validationWarnings.length > 0 ||
        validation.otherWarnings.length > 0
      ) {
        return deny("VES_POLICY_VALIDATION_FAILED", "Cedar policy validation failed");
      }

      const answer = this.engine.isAuthorized({ ...request, schema, validateRequest: true, policies, entities });
      if (answer.type !== "success") return deny("VES_POLICY_EVALUATION_FAILED", "Cedar request evaluation failed");
      if (answer.warnings.length > 0 || answer.response.diagnostics.errors.length > 0) {
        return deny("VES_POLICY_DIAGNOSTIC_DENY", "Cedar returned evaluation diagnostics");
      }

      const determiningPolicies = answer.response.diagnostics.reason;
      if (answer.response.decision === "allow") {
        return result("allow", "VES_POLICY_ALLOW", "allowed by validated policy", determiningPolicies);
      }
      if (determiningPolicies.length > 0) {
        return deny("VES_POLICY_FORBID_DENY", "denied by matching forbid policy", determiningPolicies);
      }
      return deny("VES_POLICY_IMPLICIT_DENY", "denied because no permit policy matched");
    } catch {
      return deny("VES_POLICY_ENGINE_FAILURE", "Cedar engine failed closed");
    }
  }
}
