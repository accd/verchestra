import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MockConfluenceDeliveryTransport,
  deliverOnce,
  deliveryInput
} from "../helpers/confluence-delivery-fixture.mjs";

test("denied handoff publication authority performs no write or egress", async () => {
  const fixture = (await import("../helpers/confluence-delivery-fixture.mjs")).deliveryFixture();
  fixture.authority.allowed = false;
  await assert.rejects(deliverOnce(deliveryInput(), fixture), { code: "VES_EFFECT_APPLY_FAILED" });
  assert.equal(fixture.transport.createCalls, 0);
  assert.equal(fixture.egress.calls.length, 0);
});

test("denied egress performs no write", async () => {
  const fixture = (await import("../helpers/confluence-delivery-fixture.mjs")).deliveryFixture();
  fixture.egress.allowed = false;
  fixture.egress.code = "VES_EGRESS_CLASSIFICATION_DENIED";
  await assert.rejects(deliverOnce(deliveryInput(), fixture), { code: "VES_EFFECT_APPLY_FAILED" });
  assert.equal(fixture.transport.createCalls, 0);
});

test("execution-shaped approval reference cannot replace handoff publication", async () => {
  await assert.rejects(deliverOnce(deliveryInput({ approvalRef: "approval:execution:001" })), {
    code: "VES_EFFECT_APPLY_FAILED"
  });
});

test("managed projection contains no credential session or machine path", async () => {
  const result = await deliverOnce();
  const body = result.transport.pages.values().next().value.body;
  for (const forbidden of ["token", "password", "session", "C:\\", "/home/", "providerState"]) {
    assert.equal(body.includes(forbidden), false);
  }
});

test("remote payload with unknown credential field is rejected", async () => {
  const transport = new MockConfluenceDeliveryTransport();
  transport.pages.set("DELIVERY:page:verchestra", {
    spaceKey: "DELIVERY",
    pageId: "page:verchestra",
    version: 1,
    title: "Human",
    body: "Human",
    accessToken: "secret"
  });
  await assert.rejects(deliverOnce(deliveryInput({ lastReconciledVersion: 1 }), { transport }), {
    code: "VES_EFFECT_APPLY_FAILED"
  });
  assert.equal(transport.updateCalls, 0);
});

test("foreign page identity cannot receive managed section", async () => {
  const transport = new MockConfluenceDeliveryTransport();
  transport.getDeliveryPage = async () => ({
    page: { spaceKey: "OTHER", pageId: "page:other", version: 1, title: "Human", body: "Human" },
    rate: transport.rate
  });
  await assert.rejects(deliverOnce(deliveryInput({ lastReconciledVersion: 1 }), { transport }), {
    code: "VES_EFFECT_APPLY_FAILED"
  });
  assert.equal(transport.updateCalls, 0);
});
