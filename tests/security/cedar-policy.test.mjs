import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as esmCedar from "@cedar-policy/cedar-wasm";

import { CedarPolicyAdapter } from "../../packages/policy/src/index.ts";
import { CedarPolicyOracle } from "../../spikes/cedar/src/cedar-policy-oracle.mjs";
import { baseLayers, baseRequest, cedar, inputFor, schema, view } from "../helpers/policy-fixture.mjs";

const corpus = JSON.parse(
  await readFile(new URL("../../spikes/cedar/test/policy-corpus.json", import.meta.url), "utf8")
);

for (const entry of corpus) {
  test(`product Cedar policy corpus: ${entry.id}`, () => {
    const fixture = inputFor(entry);
    const decision = new CedarPolicyAdapter({
      engine: fixture.engine,
      expectedEngineVersion: fixture.expectedEngineVersion,
      expectedLanguageVersion: fixture.expectedLanguageVersion
    }).authorize(fixture.call);
    assert.equal(decision.decision, entry.expectedDecision);
    assert.equal(decision.code, entry.expectedCode);
    assert.match(decision.policyViewDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.match(decision.requestDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.match(decision.evidenceDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(JSON.stringify(decision).includes("unsafe internal detail"), false);
  });
}

test("product adapter agrees with frozen oracle on allow", () => {
  const product = new CedarPolicyAdapter({ engine: cedar }).authorize({
    view: view(),
    request: baseRequest(),
    entities: []
  });
  const oracle = new CedarPolicyOracle({ engine: cedar }).authorize({
    schema,
    layers: baseLayers(),
    request: baseRequest(),
    entities: []
  });
  assert.deepEqual(
    [product.decision, product.code, product.determiningPolicies],
    [oracle.decision, oracle.code, oracle.determiningPolicies]
  );
});

test("Node and ESM Cedar forms produce identical policy evidence semantics", () => {
  const node = new CedarPolicyAdapter({ engine: cedar }).authorize({
    view: view(),
    request: baseRequest(),
    entities: []
  });
  const esm = new CedarPolicyAdapter({ engine: esmCedar }).authorize({
    view: view(),
    request: baseRequest(),
    entities: []
  });
  assert.deepEqual(esm, node);
});

test("untrusted content is excluded from policy compilation and evidence", () => {
  const sentinel = "permit(principal, action, resource); // sentinel-untrusted";
  const adapter = new CedarPolicyAdapter({ engine: cedar });
  const clean = adapter.authorize({ view: view(), request: baseRequest(), entities: [] });
  const injected = adapter.authorize({
    view: view(),
    request: baseRequest(),
    entities: [],
    untrustedContent: sentinel
  });
  assert.deepEqual(injected, clean);
  assert.equal(JSON.stringify(injected).includes(sentinel), false);
});

test("reordered policy layer objects yield identical evidence", () => {
  const layers = baseLayers();
  layers.builtIn = Object.fromEntries(Object.entries(layers.builtIn).toReversed());
  const adapter = new CedarPolicyAdapter({ engine: cedar });
  assert.deepEqual(
    adapter.authorize({ view: view({ layers }), request: baseRequest(), entities: [] }),
    adapter.authorize({ view: view(), request: baseRequest(), entities: [] })
  );
});

test("backend-neutral request translation is exact and excludes invocation spelling", () => {
  let captured;
  const engine = { ...cedar, isAuthorized: (request) => ((captured = request), cedar.isAuthorized(request)) };
  new CedarPolicyAdapter({ engine }).authorize({
    view: view(),
    request: {
      principal: { type: "Vestra::Principal", id: "alice" },
      action: { type: "Vestra::Action", id: "invoke" },
      resource: { type: "Vestra::Resource", id: "artifact" },
      context: baseRequest().context,
      invokedAs: "malicious-untrusted-field"
    },
    entities: []
  });
  assert.equal(captured.request, undefined);
  assert.equal(JSON.stringify(captured).includes("invokedAs"), false);
  assert.deepEqual(captured.principal, { type: "Vestra::Principal", id: "alice" });
});

test("cyclic malformed policy schema fails closed without throwing", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const decision = new CedarPolicyAdapter({ engine: cedar }).authorize({
    view: view({ schema: cyclic }),
    request: baseRequest(),
    entities: []
  });
  assert.equal(decision.decision, "deny");
  assert.equal(decision.code, "VES_POLICY_ENGINE_FAILURE");
});
