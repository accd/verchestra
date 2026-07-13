import * as cedar from "@cedar-policy/cedar-wasm/nodejs";

import { baseLayers, baseRequest, lowerForbid, lowerPermit, schema } from "../../spikes/cedar/test/fixtures.mjs";

export { baseLayers, baseRequest, cedar, lowerForbid, lowerPermit, schema };

export const view = (overrides = {}) => ({
  schemaVersion: 1,
  generation: 1,
  schema: structuredClone(schema),
  layers: baseLayers(),
  ...overrides
});

export class MemoryPolicyViewStore {
  active;
  reads = 0;
  writes = 0;

  async load() {
    this.reads += 1;
    return this.active;
  }

  async save(candidate, expectedGeneration) {
    if ((this.active?.generation ?? 0) !== expectedGeneration) {
      return { activated: false, conflict: true };
    }
    this.active = candidate;
    this.writes += 1;
    return { activated: true, conflict: false };
  }
}

export function inputFor(entry) {
  let activeSchema = structuredClone(schema);
  const layers = baseLayers();
  const request = baseRequest(entry.scenario === "egress" ? "egress" : "invoke");
  Object.assign(request.context, entry.context ?? {});
  Object.assign(request, entry.request ?? {});
  let engine = cedar;
  let expectedEngineVersion = "4.11.2";
  let expectedLanguageVersion = "4.5";

  if (entry.scenario === "layer-forbid") {
    layers[entry.layer] = { blockRisk: lowerForbid };
    request.context.risk = "blocked";
  } else if (entry.scenario === "layer-permit") layers[entry.layer] = { escalation: lowerPermit };
  else if (entry.scenario === "policy-parse") layers.project = { broken: "forbid (" };
  else if (entry.scenario === "schema-parse") activeSchema = "not a cedar schema";
  else if (entry.scenario === "validation-action")
    layers.builtIn.bad = `permit(principal, action == Vestra::Action::"missing", resource);`;
  else if (entry.scenario === "validation-attribute")
    layers.builtIn.bad = `permit(principal, action, resource) when { context.notDeclared };`;
  else if (entry.scenario === "request-principal") request.principal = { type: "Vestra::Resource", id: "alice" };
  else if (entry.scenario === "request-resource") request.resource = { type: "Vestra::Principal", id: "artifact" };
  else if (entry.scenario === "request-context-missing") delete request.context.approved;
  else if (entry.scenario === "request-context-type") request.context.approved = "yes";
  else if (entry.scenario === "engine-version") expectedEngineVersion = "4.11.1";
  else if (entry.scenario === "language-version") expectedLanguageVersion = "4.4";
  else if (entry.scenario === "engine-throws")
    engine = {
      ...cedar,
      isAuthorized: () => {
        throw new Error("unsafe internal detail");
      }
    };
  else if (entry.scenario === "engine-failure")
    engine = { ...cedar, isAuthorized: () => ({ type: "failure", errors: [], warnings: [] }) };
  else if (entry.scenario === "engine-diagnostics")
    engine = {
      ...cedar,
      isAuthorized: () => ({
        type: "success",
        response: { decision: "allow", diagnostics: { reason: ["builtIn.invoke"], errors: [{}] } },
        warnings: []
      })
    };
  else if (entry.scenario === "engine-warning")
    engine = {
      ...cedar,
      isAuthorized: () => ({
        type: "success",
        response: { decision: "allow", diagnostics: { reason: ["builtIn.invoke"], errors: [] } },
        warnings: [{}]
      })
    };

  return {
    engine,
    expectedEngineVersion,
    expectedLanguageVersion,
    call: {
      view: view({ schema: activeSchema, layers }),
      request,
      entities: [],
      untrustedContent: entry.scenario === "untrusted-content" ? "permit(principal, action, resource);" : undefined
    }
  };
}
