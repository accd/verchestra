import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ConfluenceDeliveryError,
  buildConfluenceDeliveryPlan,
  createConfluenceDeliveryIntent,
  inspectConfluenceOwnedSection
} from "../../packages/connectors/src/index.ts";
import { deliveryFixture, deliveryInput, sha } from "../helpers/confluence-delivery-fixture.mjs";

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

// Issue #58 (T4k): this file's only ambient-locale ordering lived in a private
// recursive serializer used for one purpose -- comparing a re-registered plan
// against the stored one. Both operands were encoded by the same call, so the
// collation cancelled out and no digest ever diverged; the migration removed a
// latent V1 serializer rather than a live defect, and every digest below has
// always hashed rendered page text rather than structured JSON. These two
// tests are therefore regression guards: they pin that neither the published
// identity nor plan-conflict detection can start depending on ambient
// collation. Mocking localeCompare with a comparator that reverses code-unit
// order simulates a divergent locale without depending on any particular
// installed ICU locale disagreeing today.
async function withHostileLocaleCompare(fn) {
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = function hostileLocaleCompare(other) {
    const left = String(this);
    return left < other ? 1 : left > other ? -1 : 0;
  };
  try {
    return await fn();
  } finally {
    String.prototype.localeCompare = original;
  }
}

test("delivery plan identity is byte-identical under a hostile ambient collation", async () => {
  const baseline = buildConfluenceDeliveryPlan(deliveryInput());
  const hostile = await withHostileLocaleCompare(() => buildConfluenceDeliveryPlan(deliveryInput()));
  assert.equal(hostile.sectionDigest, baseline.sectionDigest);
  assert.equal(hostile.idempotencyKey, baseline.idempotencyKey);
  assert.equal(hostile.egressFragment.fragmentId, baseline.egressFragment.fragmentId);
  assert.equal(hostile.egressFragment.contentDigest, baseline.egressFragment.contentDigest);
  assert.deepEqual(hostile.pendingTaskIds, ["T65", "T66"]);
});

test("registered plan equality is decided by canonical bytes rather than ambient collation", async () => {
  await withHostileLocaleCompare(() => {
    const { adapter } = deliveryFixture();
    const plan = buildConfluenceDeliveryPlan(deliveryInput());
    adapter.register(plan);
    adapter.register(buildConfluenceDeliveryPlan(deliveryInput()));
    assert.throws(() => adapter.register({ ...plan, sectionDigest: sha("other-section") }), {
      code: "VES_CONFLUENCE_DELIVERY_PLAN_CONFLICT"
    });
  });
});
