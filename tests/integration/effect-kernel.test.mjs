import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { EffectBroker, MockEffectAdapter } from "../../packages/effects/src/index.ts";
import { RuntimeStore } from "../../packages/platform-node/src/index.ts";
import { effectBase, effectIntent } from "../helpers/effect-fixture.mjs";
import { cleanup, now, opened, run } from "../helpers/runtime-store-fixture.mjs";

afterEach(cleanup);

async function setup(options = {}) {
  const fixture = await opened(options);
  fixture.store.createRun(run());
  return fixture;
}

test("effect migration creates intent, outbox, receipt, and inbox tables", async () => {
  const { dbPath, store } = await setup();
  const db = new DatabaseSync(dbPath, { readOnly: true, defensive: true });
  const names = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'effect_%' OR name='operation_receipts' ORDER BY name"
    )
    .all()
    .map((row) => row.name);
  assert.deepEqual(names, ["effect_inbox", "effect_intents", "effect_outbox", "operation_receipts"]);
  db.close();
  store.close();
});

test("planned intent survives close and reopen", async () => {
  const { dbPath, store } = await setup();
  const broker = new EffectBroker({ repository: store.createEffectRepository(), adapter: new MockEffectAdapter() });
  const planned = await broker.plan(effectIntent());
  store.close();
  const reopened = new RuntimeStore({ dbPath, now: () => now });
  reopened.open();
  assert.deepEqual(await reopened.createEffectRepository().get(planned.idempotencyKey), planned);
  reopened.close();
});

test("duplicate and reordered planning converges to one durable intent", async () => {
  const { dbPath, store } = await setup();
  const broker = new EffectBroker({ repository: store.createEffectRepository(), adapter: new MockEffectAdapter() });
  const first = await broker.plan(effectIntent());
  const second = await broker.plan(
    effectIntent({ effectId: "effect_018f0b6d-7b1a-7abc-8def-4123456789ab", grantRef: "grant:new" })
  );
  assert.equal(second.effectId, first.effectId);
  const db = new DatabaseSync(dbPath, { readOnly: true, defensive: true });
  assert.equal(db.prepare("SELECT count(*) AS count FROM effect_intents").get().count, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM effect_outbox").get().count, 1);
  db.close();
  store.close();
});

test("successful execution atomically completes outbox and writes receipt plus inbox", async () => {
  const { dbPath, store } = await setup();
  const broker = new EffectBroker({
    repository: store.createEffectRepository(),
    adapter: new MockEffectAdapter({ apply: { outcome: "applied", remoteIdentity: "KEY-42" } }),
    now: () => now
  });
  const planned = await broker.plan(effectIntent());
  const receipt = await broker.execute(planned.idempotencyKey);
  const db = new DatabaseSync(dbPath, { readOnly: true, defensive: true });
  assert.equal(db.prepare("SELECT status FROM effect_intents").get().status, "completed");
  assert.equal(db.prepare("SELECT status FROM effect_outbox").get().status, "completed");
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_receipts").get().count, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM effect_inbox").get().count, 1);
  assert.equal(receipt.remoteIdentity, "KEY-42");
  db.close();
  store.close();
});

test("completed retry after process restart returns durable receipt without apply", async () => {
  const { dbPath, store } = await setup();
  const firstAdapter = new MockEffectAdapter();
  const first = new EffectBroker({ repository: store.createEffectRepository(), adapter: firstAdapter, now: () => now });
  const planned = await first.plan(effectIntent());
  const receipt = await first.execute(planned.idempotencyKey);
  store.close();
  const reopened = new RuntimeStore({ dbPath, now: () => now });
  reopened.open();
  const secondAdapter = new MockEffectAdapter();
  const second = new EffectBroker({
    repository: reopened.createEffectRepository(),
    adapter: secondAdapter,
    now: () => now
  });
  assert.deepEqual(await second.execute(planned.idempotencyKey), receipt);
  assert.equal(secondAdapter.applyCalls, 0);
  reopened.close();
});

test("receipt preserves adapter, attempt, remote, digest, evidence, and times", async () => {
  const { store } = await setup();
  const broker = new EffectBroker({
    repository: store.createEffectRepository(),
    adapter: new MockEffectAdapter({
      apply: {
        outcome: "applied",
        remoteIdentity: "KEY-42",
        remoteVersion: "7",
        outputDigest: `sha256:${"b".repeat(64)}`,
        safeEvidenceRefs: ["evidence:42"]
      }
    }),
    now: () => now
  });
  const planned = await broker.plan(effectIntent());
  const receipt = await broker.execute(planned.idempotencyKey);
  assert.deepEqual(await store.createEffectRepository().getReceipt(planned.idempotencyKey), receipt);
  assert.deepEqual(receipt.safeEvidenceRefs, ["evidence:42"]);
  assert.equal(receipt.attempt, 1);
  store.close();
});

test("forged key is rejected before any durable row", async () => {
  const { dbPath, store } = await setup();
  const broker = new EffectBroker({ repository: store.createEffectRepository(), adapter: new MockEffectAdapter() });
  await assert.rejects(broker.plan({ ...effectIntent(), idempotencyKey: `sha256:${"f".repeat(64)}` }), {
    code: "VES_EFFECT_KEY_FORGED"
  });
  const db = new DatabaseSync(dbPath, { readOnly: true, defensive: true });
  assert.equal(db.prepare("SELECT count(*) AS count FROM effect_intents").get().count, 0);
  db.close();
  store.close();
});

test("effect rows participate in canonical runtime state digest", async () => {
  const { store } = await setup();
  const before = store.stateDigest();
  const broker = new EffectBroker({ repository: store.createEffectRepository(), adapter: new MockEffectAdapter() });
  await broker.plan(effectIntent());
  assert.notEqual(store.stateDigest(), before);
  store.close();
});

test("runtime backup includes pending effect intent and outbox", async () => {
  const { root, store } = await setup();
  const broker = new EffectBroker({ repository: store.createEffectRepository(), adapter: new MockEffectAdapter() });
  const planned = await broker.plan(effectIntent());
  const backup = await store.backupTo(join(root, "effects.sqlite"));
  const copied = new RuntimeStore({ dbPath: backup.path, now: () => now });
  copied.open();
  assert.equal((await copied.createEffectRepository().get(planned.idempotencyKey)).status, "planned");
  assert.equal(copied.stateDigest(), backup.manifest.stateDigest);
  copied.close();
  store.close();
});

test("same key with different semantic content fails without changing durable row", async () => {
  const { store } = await setup();
  const broker = new EffectBroker({ repository: store.createEffectRepository(), adapter: new MockEffectAdapter() });
  const planned = await broker.plan(effectIntent());
  await assert.rejects(broker.plan({ ...planned, logicalTarget: "jira:forged" }), {
    code: "VES_EFFECT_KEY_CONFLICT"
  });
  assert.equal(
    (await store.createEffectRepository().get(planned.idempotencyKey)).logicalTarget,
    effectBase.logicalTarget
  );
  store.close();
});

test("durable dispatcher resumes pending outbox intents in deterministic order after restart", async () => {
  const { dbPath, store } = await setup();
  const planner = new EffectBroker({ repository: store.createEffectRepository(), adapter: new MockEffectAdapter() });
  const later = effectIntent({
    effectId: "effect_018f0b6d-7b1a-7abc-8def-5123456789ab",
    logicalTarget: "jira:later",
    semanticIdentity: "later",
    createdAt: "2026-07-13T12:01:00.000Z"
  });
  const earlier = effectIntent({
    effectId: "effect_018f0b6d-7b1a-7abc-8def-6123456789ab",
    logicalTarget: "jira:earlier",
    semanticIdentity: "earlier",
    createdAt: "2026-07-13T12:00:00.000Z"
  });
  await planner.plan(later);
  await planner.plan(earlier);
  store.close();

  const reopened = new RuntimeStore({ dbPath, now: () => now });
  reopened.open();
  const adapter = new MockEffectAdapter();
  const dispatcher = new EffectBroker({ repository: reopened.createEffectRepository(), adapter, now: () => now });
  const receipts = await dispatcher.dispatchReady(10);
  assert.deepEqual(
    receipts.map((receipt) => receipt.effectId),
    [earlier.effectId, later.effectId]
  );
  assert.equal(adapter.applyCalls, 2);
  assert.deepEqual(await dispatcher.dispatchReady(10), []);
  reopened.close();
});
