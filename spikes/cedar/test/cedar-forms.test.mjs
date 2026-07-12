import assert from "node:assert/strict";
import { test } from "node:test";
import * as esmCedar from "@cedar-policy/cedar-wasm";
import * as nodeCedar from "@cedar-policy/cedar-wasm/nodejs";
import { selectCedarReleaseForm } from "../src/cedar-form-selection.mjs";
import { baseLayers, baseRequest, schema } from "./fixtures.mjs";

test("official ESM and Node loaders report the exact same engine versions", () => {
  assert.deepEqual(
    [esmCedar.getCedarVersion(), esmCedar.getCedarLangVersion(), esmCedar.getCedarSDKVersion()],
    ["4.11.2", "4.5", "4.11.2"]
  );
  assert.deepEqual(
    [nodeCedar.getCedarVersion(), nodeCedar.getCedarLangVersion(), nodeCedar.getCedarSDKVersion()],
    ["4.11.2", "4.5", "4.11.2"]
  );
});

for (const [name, mutate] of [
  ["allow", () => {}],
  ["implicit deny", (request) => { request.context.approved = false; }],
  ["forbid wins", (request) => { request.context.workspace = "outside"; }],
  ["egress allow", (request) => { request.action.id = "egress"; request.context.destination = "approved-endpoint"; }],
  ["egress deny", (request) => { request.action.id = "egress"; request.context.destination = "unknown"; }]
]) {
  test(`ESM and Node loader differential: ${name}`, () => {
    const request = baseRequest();
    mutate(request);
    const policies = { staticPolicies: Object.fromEntries(Object.entries(baseLayers().builtIn).map(([id, policy]) => [`builtIn.${id}`, policy])) };
    const call = { ...request, schema, validateRequest: true, policies, entities: [] };
    assert.deepEqual(esmCedar.isAuthorized(call), nodeCedar.isAuthorized(call));
  });
}

test("selects the official Node WASM form only when every release condition passes", () => {
  const selected = selectCedarReleaseForm([
    { id: "native", official: true, exactVersion: false, hermetic: false, platformMatrix: false, differential: false },
    { id: "wasm-node", official: true, exactVersion: true, hermetic: true, platformMatrix: true, differential: true }
  ]);
  assert.equal(selected.id, "wasm-node");
});

test("fails selection closed when no Cedar form satisfies the release contract", () => {
  assert.throws(
    () => selectCedarReleaseForm([{ id: "native", official: true, exactVersion: false, hermetic: false, platformMatrix: false, differential: false }]),
    { code: "VES_CEDAR_FORM_UNQUALIFIED" }
  );
});
