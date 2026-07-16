import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ConfluenceDeliveryError,
  buildConfluenceDeliveryPlan,
  createConfluenceDeliveryIntent,
  inspectConfluenceOwnedSection
} from "../../packages/connectors/src/index.ts";
import { deliveryInput, sha } from "../helpers/confluence-delivery-fixture.mjs";

test("delivery plan renders one closed owned section with package and handoff links", () => {
  const plan = buildConfluenceDeliveryPlan(deliveryInput());
  const inspected = inspectConfluenceOwnedSection(plan.ownedSection, plan.correlationId);
  assert.equal(inspected.state, "valid");
  assert.equal(inspected.sectionDigest, plan.sectionDigest);
  assert.match(plan.ownedSection, /execution-package:001/u);
  assert.match(plan.ownedSection, new RegExp(sha("package"), "u"));
  assert.match(plan.ownedSection, /handoff:001/u);
});

test("delivery plan is canonical across task input order", () => {
  const left = buildConfluenceDeliveryPlan(deliveryInput());
  const right = buildConfluenceDeliveryPlan(deliveryInput({ pendingTaskIds: ["T66", "T65"] }));
  assert.equal(left.sectionDigest, right.sectionDigest);
  assert.equal(left.idempotencyKey, right.idempotencyKey);
});

test("effect intent binds high-risk handoff publication authority", () => {
  const plan = buildConfluenceDeliveryPlan(deliveryInput());
  const intent = createConfluenceDeliveryIntent(plan, {
    effectId: "effect:delivery:001",
    createdAt: "2026-07-16T10:00:00.000Z"
  });
  assert.equal(intent.riskTier, "high");
  assert.equal(intent.grantRef, plan.capabilityRef);
  assert.equal(intent.canonicalInputDigest, plan.sectionDigest);
});

test("owned-section inspector distinguishes absent partial valid and drifted markers", () => {
  const plan = buildConfluenceDeliveryPlan(deliveryInput());
  assert.equal(inspectConfluenceOwnedSection("human text", plan.correlationId).state, "absent");
  assert.equal(inspectConfluenceOwnedSection(plan.ownedSection.slice(0, -10), plan.correlationId).state, "invalid");
  assert.equal(inspectConfluenceOwnedSection(plan.ownedSection, plan.correlationId).state, "valid");
  assert.equal(
    inspectConfluenceOwnedSection(plan.ownedSection.replace("Verchestra delivery", "Human edit"), plan.correlationId)
      .state,
    "drifted"
  );
});

for (const [field, value] of [
  ["schemaVersion", 2],
  ["classification", "secretish"],
  ["lastReconciledVersion", -1],
  ["lastReconciledSectionDigest", "sha256:bad"],
  ["currentTaskIds", []],
  ["pendingTaskIds", ["T65", "T65"]],
  ["package", { packageRef: "execution-package:001", packageDigest: "bad" }],
  ["generatedAt", "not-a-time"]
]) {
  test(`delivery plan rejects invalid ${field}`, () => {
    assert.throws(() => buildConfluenceDeliveryPlan(deliveryInput({ [field]: value })), ConfluenceDeliveryError);
  });
}

test("delivery plan rejects unknown or raw provider fields", () => {
  assert.throws(() => buildConfluenceDeliveryPlan({ ...deliveryInput(), confluenceToken: "secret" }), {
    code: "VES_CONFLUENCE_DELIVERY_INVALID"
  });
});
