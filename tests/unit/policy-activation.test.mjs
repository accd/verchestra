import assert from "node:assert/strict";
import { test } from "node:test";

import { CedarPolicyAdapter, PolicyActivationService } from "../../packages/policy/src/index.ts";
import {
  MemoryPolicyViewStore,
  baseLayers,
  cedar,
  lowerForbid,
  lowerPermit,
  view
} from "../helpers/policy-fixture.mjs";

function service(store = new MemoryPolicyViewStore(), adapter = new CedarPolicyAdapter({ engine: cedar })) {
  return { store, service: new PolicyActivationService({ validator: adapter, store }) };
}

test("first valid policy view activates as last-known-good", async () => {
  const context = service();
  const result = await context.service.activate(view());
  assert.equal(result.status, "activated");
  assert.equal(context.store.writes, 1);
  assert.equal(context.store.active.generation, 1);
});

test("same generation and digest is an idempotent no-op", async () => {
  const context = service();
  const first = await context.service.activate(view());
  const second = await context.service.activate(view());
  assert.equal(second.status, "unchanged");
  assert.equal(second.policyViewDigest, first.policyViewDigest);
  assert.equal(context.store.writes, 1);
});

test("same generation with different content is rejected", async () => {
  const context = service();
  await context.service.activate(view());
  const layers = baseLayers();
  layers.organization = { restricted: lowerForbid };
  const result = await context.service.activate(view({ layers }));
  assert.equal(result.code, "VES_POLICY_GENERATION_CONFLICT");
  assert.equal(context.store.writes, 1);
});

test("generation downgrade is rejected before validation or persistence", async () => {
  const store = new MemoryPolicyViewStore();
  store.active = { ...view({ generation: 2 }), policyViewDigest: "sha256:" + "a".repeat(64) };
  let validations = 0;
  const context = service(store, { validateView: () => ((validations += 1), { valid: true }) });
  const result = await context.service.activate(view({ generation: 1 }));
  assert.equal(result.code, "VES_POLICY_GENERATION_DOWNGRADE");
  assert.equal(validations, 0);
  assert.equal(store.writes, 0);
});

for (const [name, mutate, code] of [
  ["invalid schema", (candidate) => (candidate.schema = "invalid"), "VES_POLICY_SCHEMA_INVALID"],
  [
    "invalid policy syntax",
    (candidate) => (candidate.layers.project = { broken: "forbid (" }),
    "VES_POLICY_PARSE_INVALID"
  ],
  ["lower permit", (candidate) => (candidate.layers.project = { expand: lowerPermit }), "VES_POLICY_NON_MONOTONIC"],
  [
    "validation error",
    (candidate) => (candidate.layers.builtIn.bad = `permit(principal, action == Vestra::Action::"missing", resource);`),
    "VES_POLICY_VALIDATION_FAILED"
  ]
]) {
  test(`${name} preserves last-known-good activation`, async () => {
    const context = service();
    await context.service.activate(view());
    const activeDigest = context.store.active.policyViewDigest;
    const candidate = structuredClone(view({ generation: 2 }));
    mutate(candidate);
    const result = await context.service.activate(candidate);
    assert.equal(result.code, code);
    assert.equal(context.store.active.policyViewDigest, activeDigest);
    assert.equal(context.store.writes, 1);
  });
}

for (const layer of ["organization", "workspace", "project", "userPreference", "runOverride"]) {
  test(`${layer} forbid monotonically narrows authority and activates`, async () => {
    const context = service();
    const candidate = view();
    candidate.layers[layer] = { block: lowerForbid };
    const result = await context.service.activate(candidate);
    assert.equal(result.status, "activated");
    assert.match(result.policyViewDigest, /^sha256:[a-f0-9]{64}$/u);
  });
}

test("concurrent activation conflict preserves store winner", async () => {
  const store = new MemoryPolicyViewStore();
  store.save = async (candidate) => {
    store.active = { ...candidate, generation: 99 };
    return { activated: false, conflict: true };
  };
  const result = await service(store).service.activate(view());
  assert.equal(result.code, "VES_POLICY_ACTIVATION_CONFLICT");
  assert.equal(store.active.generation, 99);
});

test("policy digest is independent from insertion order", () => {
  const adapter = new CedarPolicyAdapter({ engine: cedar });
  const left = view();
  const right = view({
    layers: { ...left.layers, builtIn: Object.fromEntries(Object.entries(left.layers.builtIn).toReversed()) }
  });
  assert.equal(adapter.validateView(left).policyViewDigest, adapter.validateView(right).policyViewDigest);
});
