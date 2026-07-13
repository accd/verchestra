import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { EffectBroker, MockEffectAdapter } from "../../packages/effects/src/index.ts";
import { RuntimeStore } from "../../packages/platform-node/src/index.ts";
import { effectIntent } from "../helpers/effect-fixture.mjs";
import { cleanup, now, opened, run } from "../helpers/runtime-store-fixture.mjs";

afterEach(cleanup);

async function setup(options = {}) {
  const fixture = await opened(options);
  fixture.store.createRun(run());
  return fixture;
}

test("crash after durable applying but before adapter call reconciles as not-applied", async () => {
  let crash = true;
  const { store } = await setup({
    hooks: {
      afterEffectStart: () => {
        if (crash) {
          crash = false;
          throw new Error("crash");
        }
      }
    }
  });
  const adapter = new MockEffectAdapter({ inspect: { state: "not-applied" } });
  const broker = new EffectBroker({ repository: store.createEffectRepository(), adapter, now: () => now });
  const planned = await broker.plan(effectIntent());
  await assert.rejects(broker.execute(planned.idempotencyKey));
  assert.equal((await store.createEffectRepository().get(planned.idempotencyKey)).status, "applying");
  assert.equal(adapter.applyCalls, 0);
  assert.equal((await broker.reconcile(planned.idempotencyKey)).state, "not-applied");
  assert.equal((await store.createEffectRepository().get(planned.idempotencyKey)).status, "ready");
  store.close();
});

test("crash before receipt commit reconciles remote applied state exactly once", async () => {
  let fail = true;
  const { store } = await setup({
    hooks: {
      beforeEffectComplete: () => {
        if (fail) {
          fail = false;
          throw new Error("crash");
        }
      }
    }
  });
  const adapter = new MockEffectAdapter({ inspect: { state: "applied", remoteIdentity: "KEY-42" } });
  const broker = new EffectBroker({ repository: store.createEffectRepository(), adapter, now: () => now });
  const planned = await broker.plan(effectIntent());
  await assert.rejects(broker.execute(planned.idempotencyKey), { code: "VES_EFFECT_RECONCILIATION_REQUIRED" });
  assert.equal(await store.createEffectRepository().getReceipt(planned.idempotencyKey), undefined);
  await broker.reconcile(planned.idempotencyKey);
  assert.equal((await store.createEffectRepository().get(planned.idempotencyKey)).status, "completed");
  assert.equal(adapter.applyCalls, 1);
  store.close();
});

test("ack loss after committed receipt returns durable receipt on retry", async () => {
  let fail = true;
  const { store } = await setup({
    hooks: {
      afterEffectComplete: () => {
        if (fail) {
          fail = false;
          throw new Error("ack lost");
        }
      }
    }
  });
  const adapter = new MockEffectAdapter();
  const broker = new EffectBroker({ repository: store.createEffectRepository(), adapter, now: () => now });
  const planned = await broker.plan(effectIntent());
  await assert.rejects(broker.execute(planned.idempotencyKey), { code: "VES_EFFECT_RECONCILIATION_REQUIRED" });
  const receipt = await store.createEffectRepository().getReceipt(planned.idempotencyKey);
  assert.equal(receipt.outcome, "applied");
  assert.deepEqual(await broker.execute(planned.idempotencyKey), receipt);
  assert.equal(adapter.applyCalls, 1);
  store.close();
});

test("unknown remote outcome remains uncertain across process restart", async () => {
  const { dbPath, store } = await setup();
  const broker = new EffectBroker({
    repository: store.createEffectRepository(),
    adapter: new MockEffectAdapter({ applyError: Object.assign(new Error("timeout"), { outcomeUnknown: true }) }),
    now: () => now
  });
  const planned = await broker.plan(effectIntent());
  await assert.rejects(broker.execute(planned.idempotencyKey));
  store.close();
  const reopened = new RuntimeStore({ dbPath, now: () => now });
  reopened.open();
  assert.equal((await reopened.createEffectRepository().get(planned.idempotencyKey)).status, "uncertain");
  reopened.close();
});

test("two runtime connections planning one key converge to one row", async () => {
  const { dbPath, store } = await setup();
  const contender = new RuntimeStore({ dbPath, now: () => now });
  contender.open();
  const first = new EffectBroker({ repository: store.createEffectRepository(), adapter: new MockEffectAdapter() });
  const second = new EffectBroker({ repository: contender.createEffectRepository(), adapter: new MockEffectAdapter() });
  const [planned, duplicate] = await Promise.all([
    first.plan(effectIntent()),
    second.plan(effectIntent({ effectId: "effect_018f0b6d-7b1a-7abc-8def-4123456789ab" }))
  ]);
  assert.equal(duplicate.effectId, planned.effectId);
  contender.close();
  store.close();
});

test("conflicting receipt cannot overwrite durable inbox", async () => {
  const { store } = await setup();
  const repository = store.createEffectRepository();
  const broker = new EffectBroker({ repository, adapter: new MockEffectAdapter(), now: () => now });
  const planned = await broker.plan(effectIntent());
  const receipt = await broker.execute(planned.idempotencyKey);
  await assert.rejects(repository.complete(planned.idempotencyKey, { ...receipt, outcome: "compensated" }), {
    code: "VES_EFFECT_RECEIPT_CONFLICT"
  });
  assert.deepEqual(await repository.getReceipt(planned.idempotencyKey), receipt);
  store.close();
});

test("definite failure remains failed after reopen and is never blindly retried", async () => {
  const { dbPath, store } = await setup();
  const adapter = new MockEffectAdapter({ applyError: Object.assign(new Error("denied"), { outcomeUnknown: false }) });
  const broker = new EffectBroker({ repository: store.createEffectRepository(), adapter, now: () => now });
  const planned = await broker.plan(effectIntent());
  await assert.rejects(broker.execute(planned.idempotencyKey), { code: "VES_EFFECT_APPLY_FAILED" });
  store.close();
  const reopened = new RuntimeStore({ dbPath, now: () => now });
  reopened.open();
  const retryAdapter = new MockEffectAdapter();
  const retry = new EffectBroker({ repository: reopened.createEffectRepository(), adapter: retryAdapter });
  await assert.rejects(retry.execute(planned.idempotencyKey), { code: "VES_EFFECT_APPLY_FAILED" });
  assert.equal(retryAdapter.applyCalls, 0);
  reopened.close();
});

test("not-applied reconciliation permits one explicit subsequent execution", async () => {
  const { store } = await setup();
  const adapter = new MockEffectAdapter({ inspect: { state: "not-applied" } });
  const broker = new EffectBroker({ repository: store.createEffectRepository(), adapter, now: () => now });
  const planned = await broker.plan(effectIntent());
  await store.createEffectRepository().updateStatus(planned.idempotencyKey, "uncertain");
  await broker.reconcile(planned.idempotencyKey);
  assert.equal((await broker.execute(planned.idempotencyKey)).outcome, "applied");
  assert.equal(adapter.applyCalls, 1);
  store.close();
});
