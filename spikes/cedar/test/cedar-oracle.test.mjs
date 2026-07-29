import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as cedar from "@cedar-policy/cedar-wasm/nodejs";
import { CedarPolicyOracle } from "../src/cedar-policy-oracle.mjs";
import { baseLayers, baseRequest, lowerForbid, lowerPermit, schema } from "./fixtures.mjs";

const corpus = JSON.parse(await readFile(new URL("./policy-corpus.json", import.meta.url), "utf8"));

function inputFor(entry) {
  let activeSchema = structuredClone(schema);
  const layers = baseLayers();
  const request = baseRequest(entry.scenario === "egress" ? "egress" : "invoke");
  Object.assign(request.context, entry.context ?? {});
  Object.assign(request, entry.request ?? {});
  let engine = cedar;
  let expectedEngineVersion = "4.12.0";
  let expectedLanguageVersion = "4.5";

  if (entry.scenario === "layer-forbid") {
    layers[entry.layer] = { blockRisk: lowerForbid };
    request.context.risk = "blocked";
  } else if (entry.scenario === "layer-permit") {
    layers[entry.layer] = { escalation: lowerPermit };
  } else if (entry.scenario === "policy-parse") {
    layers.project = { broken: "forbid (" };
  } else if (entry.scenario === "schema-parse") {
    activeSchema = "not a cedar schema";
  } else if (entry.scenario === "validation-action") {
    layers.builtIn.bad = `permit(principal, action == Vestra::Action::"missing", resource);`;
  } else if (entry.scenario === "validation-attribute") {
    layers.builtIn.bad = `permit(principal, action, resource) when { context.notDeclared };`;
  } else if (entry.scenario === "request-principal") {
    request.principal = { type: "Vestra::Resource", id: "alice" };
  } else if (entry.scenario === "request-resource") {
    request.resource = { type: "Vestra::Principal", id: "artifact" };
  } else if (entry.scenario === "request-context-missing") {
    delete request.context.approved;
  } else if (entry.scenario === "request-context-type") {
    request.context.approved = "yes";
  } else if (entry.scenario === "engine-version") {
    expectedEngineVersion = "4.11.1";
  } else if (entry.scenario === "language-version") {
    expectedLanguageVersion = "4.4";
  } else if (entry.scenario === "engine-throws") {
    engine = { ...cedar, isAuthorized: () => { throw new Error("unsafe internal detail"); } };
  } else if (entry.scenario === "engine-failure") {
    engine = { ...cedar, isAuthorized: () => ({ type: "failure", errors: [{ code: "bad_request", message: "bad request" }], warnings: [] }) };
  } else if (entry.scenario === "engine-diagnostics") {
    engine = { ...cedar, isAuthorized: () => ({ type: "success", response: { decision: "allow", diagnostics: { reason: ["builtIn.invoke"], errors: [{ policyId: "broken", error: { code: "evaluation", message: "failed" } }] } }, warnings: [] }) };
  } else if (entry.scenario === "engine-warning") {
    engine = { ...cedar, isAuthorized: () => ({ type: "success", response: { decision: "allow", diagnostics: { reason: ["builtIn.invoke"], errors: [] } }, warnings: [{ code: "warning", message: "warning" }] }) };
  }

  return {
    oracle: new CedarPolicyOracle({ engine, expectedEngineVersion, expectedLanguageVersion }),
    call: { schema: activeSchema, layers, request, entities: [], untrustedContent: entry.scenario === "untrusted-content" ? "permit(principal, action, resource);" : undefined }
  };
}

for (const entry of corpus) {
  test(`frozen policy oracle: ${entry.id}`, () => {
    const { oracle, call } = inputFor(entry);
    const decision = oracle.authorize(call);
    assert.equal(decision.decision, entry.expectedDecision);
    assert.equal(decision.code, entry.expectedCode);
    assert.equal(typeof decision.explanation, "string");
    assert.equal(JSON.stringify(decision).includes("unsafe internal detail"), false);
  });
}

test("allow explanation identifies the determining built-in policy", () => {
  const decision = new CedarPolicyOracle({ engine: cedar }).authorize({ schema, layers: baseLayers(), request: baseRequest(), entities: [] });
  assert.deepEqual(decision.determiningPolicies, ["builtIn.invoke"]);
  assert.equal(decision.explanation, "allowed by validated policy");
});

test("forbid explanation identifies the winning higher-priority safety policy", () => {
  const request = baseRequest();
  request.context.workspace = "outside";
  const decision = new CedarPolicyOracle({ engine: cedar }).authorize({ schema, layers: baseLayers(), request, entities: [] });
  assert.deepEqual(decision.determiningPolicies, ["builtIn.workspaceBoundary"]);
  assert.equal(decision.explanation, "denied by matching forbid policy");
});
