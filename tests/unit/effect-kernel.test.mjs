import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  EffectBroker,
  InMemoryEffectRepository,
  MockEffectAdapter,
  buildIdempotencyKey,
  createEffectIntent,
  effectPublicErrorRegistry
} from "../../packages/effects/src/index.ts";
import { SchemaRegistry } from "../../packages/contracts/src/index.ts";

const digest = `sha256:${"a".repeat(64)}`;
const base = Object.freeze({
  effectId: "effect_018f0b6d-7b1a-7abc-8def-0123456789ab",
  operationKind: "jira.issue.upsert",
  workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-1123456789ab",
  runId: "run_018f0b6d-7b1a-7abc-8def-2123456789ab",
  logicalTarget: "jira:project/KEY/issue/external-42",
  canonicalInputDigest: digest,
  semanticIdentity: "project:KEY:external-42",
  riskTier: "high",
  grantRef: "grant_018f0b6d-7b1a-7abc-8def-3123456789ab",
  createdAt: "2026-07-13T12:00:00.000Z"
});

function intent(overrides = {}) {
  const input = { ...base, ...overrides };
  return createEffectIntent({ ...input, idempotencyKey: buildIdempotencyKey(input) });
}

test("idempotency key is deterministic and V2-qualified by default", () => {
  assert.equal(buildIdempotencyKey(base), buildIdempotencyKey({ ...base }));
  assert.match(buildIdempotencyKey(base), /^v2:sha256:[a-f0-9]{64}$/u);
});

test("V1 idempotency bytes remain pinned for records created before the migration", () => {
  const material = JSON.stringify({
    schemaVersion: 1,
    operationKind: base.operationKind,
    workspaceId: base.workspaceId,
    logicalTarget: base.logicalTarget,
    canonicalInputDigest: base.canonicalInputDigest,
    semanticIdentity: base.semanticIdentity
  });
  const expected = `sha256:${createHash("sha256").update(material, "utf8").digest("hex")}`;
  assert.equal(buildIdempotencyKey({ ...base, canonicalizationVersion: 1 }), expected);
  assert.notEqual(buildIdempotencyKey(base), expected);
});

for (const [field, value] of [
  ["operationKind", "confluence.section.upsert"],
  ["workspaceId", "workspace_018f0b6d-7b1a-7abc-8def-4123456789ab"],
  ["logicalTarget", "jira:project/KEY/issue/external-43"],
  ["canonicalInputDigest", `sha256:${"b".repeat(64)}`],
  ["semanticIdentity", "project:KEY:external-43"]
]) {
  test(`idempotency key binds ${field}`, () => {
    assert.notEqual(buildIdempotencyKey(base), buildIdempotencyKey({ ...base, [field]: value }));
  });
}

test("idempotency key ignores effect, run, grant, time, and risk identities", () => {
  assert.equal(
    buildIdempotencyKey(base),
    buildIdempotencyKey({
      ...base,
      effectId: "different",
      runId: "different",
      grantRef: "different",
      createdAt: "2099-01-01T00:00:00.000Z",
      riskTier: "low"
    })
  );
});

test("intent rejects a forged idempotency key", () => {
  assert.throws(() => createEffectIntent({ ...base, idempotencyKey: `sha256:${"f".repeat(64)}` }), {
    code: "VES_EFFECT_KEY_FORGED"
  });
});

test("intent starts planned and is immutable", () => {
  const created = intent();
  assert.equal(created.status, "planned");
  assert.equal(created.canonicalizationVersion, 2);
  assert.equal(Object.isFrozen(created), true);
});

test("intent rejects an unknown canonicalization version", () => {
  const input = { ...base, canonicalizationVersion: 3 };
  assert.throws(() => createEffectIntent({ ...input, idempotencyKey: buildIdempotencyKey(input) }), {
    code: "VES_EFFECT_INTENT_INVALID"
  });
});

test("a V2 planner reuses a completed V1 intent without applying twice", async () => {
  const repository = new InMemoryEffectRepository();
  const adapter = new MockEffectAdapter();
  const broker = new EffectBroker({ repository, adapter });
  const legacyInput = { ...base, canonicalizationVersion: 1 };
  const legacy = createEffectIntent({ ...legacyInput, idempotencyKey: buildIdempotencyKey(legacyInput) });
  const plannedLegacy = await broker.plan(legacy);
  await broker.execute(plannedLegacy.idempotencyKey);
  const v2 = await broker.plan(intent({ effectId: "effect_018f0b6d-7b1a-7abc-8def-4123456789ab" }));
  assert.equal(v2.idempotencyKey, plannedLegacy.idempotencyKey);
  await broker.execute(v2.idempotencyKey);
  assert.equal(repository.intents.length, 1);
  assert.equal(adapter.applyCalls, 1);
});

test("planning the same logical effect returns one intent", async () => {
  const repository = new InMemoryEffectRepository();
  const broker = new EffectBroker({ repository, adapter: new MockEffectAdapter() });
  const first = await broker.plan(intent());
  const second = await broker.plan(intent({ effectId: "effect_018f0b6d-7b1a-7abc-8def-4123456789ab" }));
  assert.equal(second.effectId, first.effectId);
  assert.equal(repository.intents.length, 1);
});

test("same key with different canonical content is rejected", async () => {
  const repository = new InMemoryEffectRepository();
  const broker = new EffectBroker({ repository, adapter: new MockEffectAdapter() });
  const first = intent();
  await broker.plan(first);
  await assert.rejects(broker.plan({ ...first, effectId: "different", logicalTarget: "forged-target" }), {
    code: "VES_EFFECT_KEY_CONFLICT"
  });
});

test("successful execution persists one applied receipt", async () => {
  const repository = new InMemoryEffectRepository();
  const adapter = new MockEffectAdapter({ apply: { outcome: "applied", remoteIdentity: "KEY-42" } });
  const broker = new EffectBroker({ repository, adapter });
  const planned = await broker.plan(intent());
  const receipt = await broker.execute(planned.idempotencyKey);
  assert.equal(receipt.outcome, "applied");
  assert.equal(receipt.remoteIdentity, "KEY-42");
  assert.equal(repository.receipts.length, 1);
  assert.equal(repository.intents[0].status, "completed");
  assert.equal(adapter.applyCalls, 1);
});

test("adapter already-applied outcome is a completed logical success", async () => {
  const repository = new InMemoryEffectRepository();
  const broker = new EffectBroker({
    repository,
    adapter: new MockEffectAdapter({ apply: { outcome: "already-applied", remoteIdentity: "KEY-42" } })
  });
  const planned = await broker.plan(intent());
  assert.equal((await broker.execute(planned.idempotencyKey)).outcome, "already-applied");
  assert.equal(repository.intents[0].status, "completed");
});

test("retry after completion returns the receipt without another apply", async () => {
  const repository = new InMemoryEffectRepository();
  const adapter = new MockEffectAdapter();
  const broker = new EffectBroker({ repository, adapter });
  const planned = await broker.plan(intent());
  const first = await broker.execute(planned.idempotencyKey);
  const second = await broker.execute(planned.idempotencyKey);
  assert.deepEqual(second, first);
  assert.equal(adapter.applyCalls, 1);
});

test("concurrent execution claims one intent before calling the adapter", async () => {
  const repository = new InMemoryEffectRepository();
  let releaseApply;
  const applyGate = new Promise((resolve) => {
    releaseApply = resolve;
  });
  const adapter = new MockEffectAdapter();
  adapter.apply = async () => {
    adapter.applyCalls += 1;
    await applyGate;
    return { outcome: "applied" };
  };
  const broker = new EffectBroker({ repository, adapter });
  const planned = await broker.plan(intent());
  const first = broker.execute(planned.idempotencyKey);
  await new Promise((resolve) => setImmediate(resolve));
  const second = broker.execute(planned.idempotencyKey);
  releaseApply();
  const outcomes = await Promise.allSettled([first, second]);
  assert.equal(outcomes.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((entry) => entry.status === "rejected").length, 1);
  assert.equal(adapter.applyCalls, 1);
});

test("crash after durable applying state but before adapter call requires reconciliation", async () => {
  class CrashAfterStartRepository extends InMemoryEffectRepository {
    async startAttempt(key) {
      await super.startAttempt(key);
      throw new Error("process crashed");
    }
  }
  const repository = new CrashAfterStartRepository();
  const adapter = new MockEffectAdapter();
  const broker = new EffectBroker({ repository, adapter });
  const planned = await broker.plan(intent());
  await assert.rejects(broker.execute(planned.idempotencyKey));
  assert.equal(repository.intents[0].status, "applying");
  assert.equal(adapter.applyCalls, 0);
  await assert.rejects(broker.execute(planned.idempotencyKey), {
    code: "VES_EFFECT_RECONCILIATION_REQUIRED"
  });
});

test("ack loss after remote success remains applying until receipt reconciliation", async () => {
  class AckLossRepository extends InMemoryEffectRepository {
    async complete() {
      throw new Error("receipt acknowledgement lost");
    }
  }
  const repository = new AckLossRepository();
  const adapter = new MockEffectAdapter();
  const broker = new EffectBroker({ repository, adapter });
  const planned = await broker.plan(intent());
  await assert.rejects(broker.execute(planned.idempotencyKey), {
    code: "VES_EFFECT_RECONCILIATION_REQUIRED"
  });
  assert.equal(repository.intents[0].status, "applying");
  assert.equal(adapter.applyCalls, 1);
  assert.equal(repository.receipts.length, 0);
});

test("definite adapter failure marks failed without a receipt", async () => {
  const repository = new InMemoryEffectRepository();
  const broker = new EffectBroker({
    repository,
    adapter: new MockEffectAdapter({ applyError: Object.assign(new Error("denied"), { outcomeUnknown: false }) })
  });
  const planned = await broker.plan(intent());
  await assert.rejects(broker.execute(planned.idempotencyKey), { code: "VES_EFFECT_APPLY_FAILED" });
  assert.equal(repository.intents[0].status, "failed");
  assert.equal(repository.receipts.length, 0);
});

test("unknown adapter outcome becomes reconciliation-required", async () => {
  const repository = new InMemoryEffectRepository();
  const adapter = new MockEffectAdapter({
    applyError: Object.assign(new Error("timeout"), { outcomeUnknown: true })
  });
  const broker = new EffectBroker({ repository, adapter });
  const planned = await broker.plan(intent());
  await assert.rejects(broker.execute(planned.idempotencyKey), {
    code: "VES_EFFECT_RECONCILIATION_REQUIRED"
  });
  assert.equal(repository.intents[0].status, "uncertain");
  assert.equal(repository.receipts.length, 0);
});

test("retry of uncertain high-risk effect never calls apply blindly", async () => {
  const repository = new InMemoryEffectRepository();
  const adapter = new MockEffectAdapter({
    applyError: Object.assign(new Error("timeout"), { outcomeUnknown: true })
  });
  const broker = new EffectBroker({ repository, adapter });
  const planned = await broker.plan(intent());
  await assert.rejects(broker.execute(planned.idempotencyKey));
  await assert.rejects(broker.execute(planned.idempotencyKey), {
    code: "VES_EFFECT_RECONCILIATION_REQUIRED"
  });
  assert.equal(adapter.applyCalls, 1);
});

test("reconcile applied creates a receipt without reapplying", async () => {
  const repository = new InMemoryEffectRepository();
  const adapter = new MockEffectAdapter({ inspect: { state: "applied", remoteIdentity: "KEY-42" } });
  const broker = new EffectBroker({ repository, adapter });
  const planned = await broker.plan(intent());
  await repository.updateStatus(planned.idempotencyKey, "uncertain");
  const result = await broker.reconcile(planned.idempotencyKey);
  assert.equal(result.state, "applied");
  assert.equal(repository.intents[0].status, "completed");
  assert.equal(repository.receipts.length, 1);
  assert.equal(adapter.applyCalls, 0);
});

test("reconcile not-applied returns intent to ready", async () => {
  const repository = new InMemoryEffectRepository();
  const broker = new EffectBroker({
    repository,
    adapter: new MockEffectAdapter({ inspect: { state: "not-applied" } })
  });
  const planned = await broker.plan(intent());
  await repository.updateStatus(planned.idempotencyKey, "uncertain");
  assert.equal((await broker.reconcile(planned.idempotencyKey)).state, "not-applied");
  assert.equal(repository.intents[0].status, "ready");
});

test("reconcile unknown preserves uncertainty and zero receipts", async () => {
  const repository = new InMemoryEffectRepository();
  const broker = new EffectBroker({
    repository,
    adapter: new MockEffectAdapter({ inspect: { state: "unknown" } })
  });
  const planned = await broker.plan(intent());
  await repository.updateStatus(planned.idempotencyKey, "uncertain");
  assert.equal((await broker.reconcile(planned.idempotencyKey)).state, "unknown");
  assert.equal(repository.intents[0].status, "uncertain");
  assert.equal(repository.receipts.length, 0);
});

test("dispatcher applies the oldest ready intents up to its bounded limit", async () => {
  const repository = new InMemoryEffectRepository();
  const adapter = new MockEffectAdapter();
  const broker = new EffectBroker({ repository, adapter });
  const late = intent({
    effectId: "effect_018f0b6d-7b1a-7abc-8def-5123456789ab",
    logicalTarget: "jira:late",
    semanticIdentity: "late",
    createdAt: "2026-07-13T12:02:00.000Z"
  });
  const early = intent({
    effectId: "effect_018f0b6d-7b1a-7abc-8def-6123456789ab",
    logicalTarget: "jira:early",
    semanticIdentity: "early",
    createdAt: "2026-07-13T12:00:00.000Z"
  });
  const middle = intent({
    effectId: "effect_018f0b6d-7b1a-7abc-8def-7123456789ab",
    logicalTarget: "jira:middle",
    semanticIdentity: "middle",
    createdAt: "2026-07-13T12:01:00.000Z"
  });
  await Promise.all([broker.plan(late), broker.plan(early), broker.plan(middle)]);
  const receipts = await broker.dispatchReady(2);
  assert.deepEqual(
    receipts.map((receipt) => receipt.effectId),
    [early.effectId, middle.effectId]
  );
  assert.equal(adapter.applyCalls, 2);
  assert.equal(repository.intents.find((entry) => entry.effectId === late.effectId).status, "planned");
});

test("dispatcher rejects unsafe limits without applying effects", async () => {
  const adapter = new MockEffectAdapter();
  const broker = new EffectBroker({ repository: new InMemoryEffectRepository(), adapter });
  await assert.rejects(broker.dispatchReady(0), { code: "VES_EFFECT_DISPATCH_LIMIT_INVALID" });
  await assert.rejects(broker.dispatchReady(1.5), { code: "VES_EFFECT_DISPATCH_LIMIT_INVALID" });
  assert.equal(adapter.applyCalls, 0);
});

test("effect public errors are stable and schema-valid", async () => {
  assert.deepEqual(effectPublicErrorRegistry.codes, [
    "VES_EFFECT_APPLY_FAILED",
    "VES_EFFECT_DISPATCH_LIMIT_INVALID",
    "VES_EFFECT_INTENT_INVALID",
    "VES_EFFECT_KEY_CONFLICT",
    "VES_EFFECT_KEY_FORGED",
    "VES_EFFECT_NOT_FOUND",
    "VES_EFFECT_RECEIPT_CONFLICT",
    "VES_EFFECT_RECONCILIATION_REQUIRED"
  ]);
  const schemas = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));
  for (const code of effectPublicErrorRegistry.codes) {
    assert.equal(schemas.validate("public-error", "1", effectPublicErrorRegistry.create(code, {})).code, code);
  }
});
