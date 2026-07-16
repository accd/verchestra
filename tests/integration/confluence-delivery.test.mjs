import assert from "node:assert/strict";
import { test } from "node:test";

import { buildConfluenceDeliveryPlan, createConfluenceDeliveryIntent } from "../../packages/connectors/src/index.ts";
import { deliverOnce, deliveryInput } from "../helpers/confluence-delivery-fixture.mjs";

test("absent page creates one managed projection", async () => {
  const result = await deliverOnce();
  assert.equal(result.transport.createCalls, 1);
  assert.equal(result.receipt.outcome, "applied");
  assert.equal(result.transport.pages.values().next().value.body, result.plan.ownedSection);
});

test("repeat returns one receipt and one page", async () => {
  const result = await deliverOnce();
  assert.deepEqual(await result.broker.execute(result.intent.idempotencyKey), result.receipt);
  assert.equal(result.transport.createCalls, 1);
});

test("existing human page appends owned section without changing human bytes or title", async () => {
  const input = deliveryInput({ lastReconciledVersion: 4 });
  const result = await deliverOnce(input, {
    transport: Object.assign(
      new (await import("../helpers/confluence-delivery-fixture.mjs")).MockConfluenceDeliveryTransport(),
      {
        pages: new Map([
          [
            "DELIVERY:page:verchestra",
            { spaceKey: "DELIVERY", pageId: "page:verchestra", version: 4, title: "Human title", body: "Human intro\n" }
          ]
        ])
      }
    )
  });
  const page = result.transport.pages.values().next().value;
  assert.equal(page.title, "Human title");
  assert.equal(page.body, `Human intro\n${result.plan.ownedSection}`);
});

test("canonical update replaces only the owned section and preserves surrounding bytes", async () => {
  const first = await deliverOnce();
  const page = first.transport.pages.values().next().value;
  page.body = `PREFIX\r\n${page.body}\r\nSUFFIX`;
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
  await first.broker.execute(intent.idempotencyKey);
  assert.equal(first.transport.pages.values().next().value.body, `PREFIX\r\n${plan.ownedSection}\r\nSUFFIX`);
});

test("valid human edit inside owned section is drift and remains untouched", async () => {
  const first = await deliverOnce();
  const page = first.transport.pages.values().next().value;
  page.body = page.body.replace("EXECUTION_READY", "BLOCKED");
  const before = page.body;
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
  await assert.rejects(first.broker.execute(intent.idempotencyKey), { code: "VES_EFFECT_APPLY_FAILED" });
  assert.equal(page.body, before);
});

test("self-consistent human edit inside owned section is drift and remains untouched", async () => {
  const first = await deliverOnce();
  const page = first.transport.pages.values().next().value;
  const human = buildConfluenceDeliveryPlan(deliveryInput({ status: "BLOCKED" }));
  page.body = human.ownedSection;
  const before = page.body;
  const plan = buildConfluenceDeliveryPlan(
    deliveryInput({
      status: "IMPLEMENTING",
      lastReconciledVersion: 1,
      lastReconciledSectionDigest: first.plan.sectionDigest
    })
  );
  first.adapter.register(plan);
  const intent = createConfluenceDeliveryIntent(plan, {
    effectId: "effect:delivery:003",
    createdAt: "2026-07-16T10:02:00.000Z"
  });
  await first.broker.plan(intent);
  await assert.rejects(first.broker.execute(intent.idempotencyKey), { code: "VES_EFFECT_APPLY_FAILED" });
  assert.equal(page.body, before);
});

test("authority and egress receive exact content before a write", async () => {
  const result = await deliverOnce();
  assert.equal(result.authority.calls[0].action, "handoff-publication");
  assert.equal(result.authority.calls[0].packageDigest, result.plan.package.packageDigest);
  assert.equal(result.egress.calls[0].fragments[0].content, result.plan.ownedSection);
  assert.equal(result.egress.calls[0].destinationId, result.plan.destinationId);
  assert.ok(result.transport.calls.indexOf("create") > result.transport.calls.indexOf("get"));
});
