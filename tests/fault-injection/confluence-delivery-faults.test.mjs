import assert from "node:assert/strict";
import { test } from "node:test";

import { buildConfluenceDeliveryPlan, createConfluenceDeliveryIntent } from "../../packages/connectors/src/index.ts";
import {
  MockConfluenceDeliveryTransport,
  deliverOnce,
  deliveryFixture,
  deliveryInput
} from "../helpers/confluence-delivery-fixture.mjs";

test("create acknowledgement loss reconciles without duplicate page", async () => {
  const transport = new MockConfluenceDeliveryTransport();
  transport.failAfterCreate = true;
  const fixture = deliveryFixture({ transport });
  const plan = buildConfluenceDeliveryPlan(deliveryInput());
  fixture.adapter.register(plan);
  const intent = createConfluenceDeliveryIntent(plan, {
    effectId: "effect:delivery:001",
    createdAt: deliveryInput().generatedAt
  });
  await fixture.broker.plan(intent);
  await assert.rejects(fixture.broker.execute(intent.idempotencyKey), { code: "VES_EFFECT_RECONCILIATION_REQUIRED" });
  assert.equal((await fixture.broker.reconcile(intent.idempotencyKey)).state, "applied");
  assert.equal(transport.createCalls, 1);
});

test("update acknowledgement loss reconciles exact section", async () => {
  const first = await deliverOnce();
  first.transport.failAfterUpdate = true;
  const plan = buildConfluenceDeliveryPlan(
    deliveryInput({
      status: "IMPLEMENTING",
      lastReconciledVersion: 1,
      lastReconciledSectionDigest: first.plan.sectionDigest
    })
  );
  first.adapter.register(plan);
  const intent = createConfluenceDeliveryIntent(plan, {
    effectId: "effect:delivery:002",
    createdAt: "2026-07-16T10:01:00.000Z"
  });
  await first.broker.plan(intent);
  await assert.rejects(first.broker.execute(intent.idempotencyKey), { code: "VES_EFFECT_RECONCILIATION_REQUIRED" });
  assert.equal((await first.broker.reconcile(intent.idempotencyKey)).state, "applied");
  assert.equal(first.transport.updateCalls, 1);
});

test("stale canonical version fails without changing page", async () => {
  const first = await deliverOnce();
  const before = structuredClone(first.transport.pages.values().next().value);
  const plan = buildConfluenceDeliveryPlan(
    deliveryInput({
      status: "IMPLEMENTING",
      lastReconciledVersion: 9,
      lastReconciledSectionDigest: first.plan.sectionDigest
    })
  );
  first.adapter.register(plan);
  const intent = createConfluenceDeliveryIntent(plan, {
    effectId: "effect:delivery:002",
    createdAt: "2026-07-16T10:01:00.000Z"
  });
  await first.broker.plan(intent);
  await assert.rejects(first.broker.execute(intent.idempotencyKey), { code: "VES_EFFECT_APPLY_FAILED" });
  assert.deepEqual(first.transport.pages.values().next().value, before);
});

for (const remaining of [0, -1]) {
  test(`rate exhaustion remaining=${remaining} fails before write`, async () => {
    const transport = new MockConfluenceDeliveryTransport();
    transport.rate = { remaining, retryAfterMs: 1000 };
    await assert.rejects(deliverOnce(deliveryInput(), { transport }), { code: "VES_EFFECT_APPLY_FAILED" });
    assert.equal(transport.createCalls, 0);
  });
}

test("partial marker fails closed without append or overwrite", async () => {
  const transport = new MockConfluenceDeliveryTransport();
  transport.pages.set("DELIVERY:page:verchestra", {
    spaceKey: "DELIVERY",
    pageId: "page:verchestra",
    version: 1,
    title: "Human",
    body: "<!-- verchestra:delivery:start"
  });
  const before = transport.pages.values().next().value.body;
  await assert.rejects(deliverOnce(deliveryInput({ lastReconciledVersion: 1 }), { transport }), {
    code: "VES_EFFECT_APPLY_FAILED"
  });
  assert.equal(transport.pages.values().next().value.body, before);
});
