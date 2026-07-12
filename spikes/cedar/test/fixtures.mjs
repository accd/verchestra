export const schema = {
  Vestra: {
    entityTypes: { Principal: {}, Resource: {} },
    actions: {
      invoke: { appliesTo: { principalTypes: ["Principal"], resourceTypes: ["Resource"], context: contextShape() } },
      egress: { appliesTo: { principalTypes: ["Principal"], resourceTypes: ["Resource"], context: contextShape() } }
    }
  }
};

function contextShape() {
  return {
    type: "Record",
    attributes: {
      approved: { type: "Boolean" },
      policyDigestMatches: { type: "Boolean" },
      capabilityGranted: { type: "Boolean" },
      evidenceCurrent: { type: "Boolean" },
      claimValid: { type: "Boolean" },
      egressAllowed: { type: "Boolean" },
      workspace: { type: "String" },
      destination: { type: "String" },
      classification: { type: "String" },
      purpose: { type: "String" },
      retention: { type: "String" },
      risk: { type: "String" }
    }
  };
}

export const builtinPolicies = {
  invoke: `permit(principal, action == Vestra::Action::"invoke", resource) when {
    context.approved && context.policyDigestMatches && context.capabilityGranted &&
    context.evidenceCurrent && context.claimValid && context.workspace == "w1"
  };`,
  egress: `permit(principal, action == Vestra::Action::"egress", resource) when {
    context.egressAllowed && context.classification == "internal" &&
    context.purpose == "validation" && context.destination == "approved-endpoint" &&
    context.retention == "none" && context.workspace == "w1"
  };`,
  workspaceBoundary: `forbid(principal, action, resource) when { context.workspace != "w1" };`
};

export const lowerForbid = `forbid(principal, action, resource) when { context.risk == "blocked" };`;
export const lowerPermit = `permit(principal, action, resource);`;

export function baseRequest(action = "invoke") {
  return {
    principal: { type: "Vestra::Principal", id: "alice" },
    action: { type: "Vestra::Action", id: action },
    resource: { type: "Vestra::Resource", id: "artifact" },
    context: {
      approved: true,
      policyDigestMatches: true,
      capabilityGranted: true,
      evidenceCurrent: true,
      claimValid: true,
      egressAllowed: true,
      workspace: "w1",
      destination: action === "egress" ? "approved-endpoint" : "local",
      classification: "internal",
      purpose: "validation",
      retention: "none",
      risk: "normal"
    }
  };
}

export function baseLayers() {
  return { builtIn: structuredClone(builtinPolicies) };
}
