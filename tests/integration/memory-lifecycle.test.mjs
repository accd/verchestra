import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { MemoryPromotionLifecycle } from "../../packages/memory/src/index.ts";
import {
  approval,
  digest,
  lifecycleRoot,
  memoryHit,
  now,
  objectInput,
  placementSnapshot,
  promotionInput,
  projectId,
  workspaceId
} from "../helpers/memory-lifecycle-fixture.mjs";

async function opened(options = {}) {
  const paths = await lifecycleRoot();
  const lifecycle = new MemoryPromotionLifecycle({
    dbPath: paths.dbPath,
    objectRoot: paths.objectRoot,
    ownerRoots: paths.ownerRoots,
    artifactPlanner: paths.artifactPlanner,
    now: () => now,
    ...options
  });
  lifecycle.open();
  return { ...paths, lifecycle };
}

test("promotion proposal is reviewable and performs zero filesystem writes", async () => {
  const { controlRoot, lifecycle } = await opened();
  const plan = lifecycle.proposePromotion(promotionInput());
  assert.equal(plan.status, "review-required");
  assert.equal(plan.writePlan.writes[0].logicalPath, ".verchestra/context/promoted/refund-policy.json");
  await assert.rejects(access(join(controlRoot, plan.writePlan.writes[0].logicalPath)));
  lifecycle.close();
});

test("promotion artifact contains reviewed content and exact source links", async () => {
  const { lifecycle } = await opened();
  const plan = lifecycle.proposePromotion(promotionInput());
  const artifact = JSON.parse(plan.artifactContent);
  assert.equal(artifact.artifactKind, "promoted-memory");
  assert.deepEqual(
    artifact.fragments.map((entry) => entry.source.sourceId),
    ["source-1", "source-2"]
  );
  assert.deepEqual(
    artifact.fragments.map((entry) => entry.source.manifestRef),
    ["manifest:1", "manifest:2"]
  );
  assert.deepEqual(
    artifact.fragments.map((entry) => entry.content),
    ["Reviewed memory 1", "Reviewed memory 2"]
  );
  assert.equal(plan.artifactDigest, digest(plan.artifactContent));
  lifecycle.close();
});

test("centralized placement keeps the promoted artifact in the control repository", async () => {
  const { lifecycle } = await opened();
  const plan = lifecycle.proposePromotion(
    promotionInput({ placement: placementSnapshot({ placementMode: "external-control" }) })
  );
  assert.equal(plan.writePlan.writes[0].logicalPath, ".verchestra/projects/api/context/promoted/refund-policy.json");
  lifecycle.close();
});

test("approved promotion atomically publishes the canonical artifact", async () => {
  const { controlRoot, lifecycle } = await opened();
  const plan = lifecycle.proposePromotion(promotionInput());
  const receipt = await lifecycle.applyPromotion(plan, approval(plan));
  const target = join(controlRoot, ...plan.writePlan.writes[0].logicalPath.split("/"));
  assert.equal(await readFile(target, "utf8"), plan.artifactContent);
  assert.equal(receipt.outcome, "published");
  assert.equal(receipt.artifactDigest, plan.artifactDigest);
  lifecycle.close();
});

test("repeating an approved promotion converges without rewriting", async () => {
  const { lifecycle } = await opened();
  const plan = lifecycle.proposePromotion(promotionInput());
  assert.equal((await lifecycle.applyPromotion(plan, approval(plan))).outcome, "published");
  assert.equal((await lifecycle.applyPromotion(plan, approval(plan))).outcome, "already-published");
  lifecycle.close();
});

test("different existing canonical content is never overwritten", async () => {
  const { controlRoot, lifecycle } = await opened();
  const plan = lifecycle.proposePromotion(promotionInput());
  const target = join(controlRoot, ...plan.writePlan.writes[0].logicalPath.split("/"));
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, "human content", { encoding: "utf8", flag: "wx" });
  await assert.rejects(lifecycle.applyPromotion(plan, approval(plan)), { code: "VES_MEMORY_PROMOTION_CONFLICT" });
  assert.equal(await readFile(target, "utf8"), "human content");
  lifecycle.close();
});

test("managed object registration is durable across restart", async () => {
  const paths = await lifecycleRoot();
  const first = new MemoryPromotionLifecycle({ ...paths, now: () => now });
  first.open();
  const object = await first.registerObject(objectInput(1));
  first.close();
  const second = new MemoryPromotionLifecycle({ ...paths, now: () => now });
  second.open();
  assert.equal(second.listObjects({ workspaceId, projectId })[0].objectId, object.objectId);
  second.close();
});

test("object identity cannot silently retain conflicting lifecycle metadata", async () => {
  const { lifecycle } = await opened();
  await lifecycle.registerObject(objectInput(1));
  await assert.rejects(lifecycle.registerObject(objectInput(1, { retainUntil: "2027-07-14T12:00:00.000Z" })), {
    code: "VES_MEMORY_OBJECT_CONFLICT"
  });
  lifecycle.close();
});

test("reference graph marks the complete protected closure", async () => {
  const { lifecycle } = await opened();
  const root = await lifecycle.registerObject(objectInput(1, { protection: "canonical" }));
  const child = await lifecycle.registerObject(objectInput(2));
  lifecycle.addReference({ schemaVersion: 1, workspaceId, fromObjectId: root.objectId, toObjectId: child.objectId });
  const plan = lifecycle.planGarbageCollection({ schemaVersion: 1, workspaceId, evaluatedAt: now, quotaBytes: 1 });
  assert.deepEqual(plan.candidates, []);
  assert.deepEqual(plan.protectedObjectIds, [root.objectId, child.objectId].sort());
  lifecycle.close();
});

test("garbage collection dry run changes neither files nor relational state", async () => {
  const { lifecycle } = await opened();
  const object = await lifecycle.registerObject(objectInput(1));
  const before = lifecycle.stateDigest();
  const plan = lifecycle.planGarbageCollection({ schemaVersion: 1, workspaceId, evaluatedAt: now, quotaBytes: 0 });
  assert.equal(plan.candidates[0].objectId, object.objectId);
  assert.equal(lifecycle.stateDigest(), before);
  assert.equal(lifecycle.listObjects({ workspaceId, projectId })[0].state, "active");
  lifecycle.close();
});

test("garbage collection apply moves only planned managed objects to quarantine", async () => {
  const { lifecycle } = await opened();
  const object = await lifecycle.registerObject(objectInput(1));
  const plan = lifecycle.planGarbageCollection({ schemaVersion: 1, workspaceId, evaluatedAt: now, quotaBytes: 0 });
  const receipt = await lifecycle.applyGarbageCollection(plan);
  assert.deepEqual(receipt.quarantinedObjectIds, [object.objectId]);
  assert.equal(lifecycle.listObjects({ workspaceId, projectId })[0].state, "quarantined");
  lifecycle.close();
});

test("garbage collection apply is idempotent by its content-bound plan", async () => {
  const { lifecycle } = await opened();
  await lifecycle.registerObject(objectInput(1));
  const plan = lifecycle.planGarbageCollection({ schemaVersion: 1, workspaceId, evaluatedAt: now, quotaBytes: 0 });
  const first = await lifecycle.applyGarbageCollection(plan);
  const second = await lifecycle.applyGarbageCollection(plan);
  assert.deepEqual(second, first);
  lifecycle.close();
});

test("legal hold protects an otherwise expired object", async () => {
  const { lifecycle } = await opened();
  const object = await lifecycle.registerObject(objectInput(1));
  lifecycle.setLegalHold({ schemaVersion: 1, workspaceId, objectId: object.objectId, holdId: "hold:incident-1" });
  const plan = lifecycle.planGarbageCollection({ schemaVersion: 1, workspaceId, evaluatedAt: now, quotaBytes: 0 });
  assert.deepEqual(plan.candidates, []);
  assert.deepEqual(plan.legalHoldObjectIds, [object.objectId]);
  lifecycle.close();
});

test("quota collection chooses oldest unprotected objects first", async () => {
  const { lifecycle } = await opened();
  const oldest = await lifecycle.registerObject(
    objectInput(1, { retainUntil: null, createdAt: "2026-07-10T12:00:00.000Z" })
  );
  await lifecycle.registerObject(objectInput(2, { retainUntil: null, createdAt: "2026-07-14T12:00:00.000Z" }));
  const plan = lifecycle.planGarbageCollection({ schemaVersion: 1, workspaceId, evaluatedAt: now, quotaBytes: 20 });
  assert.equal(plan.candidates[0].objectId, oldest.objectId);
  assert.equal(plan.candidates[0].reason, "quota");
  lifecycle.close();
});

test("retention expiry is explicit even while quota has capacity", async () => {
  const { lifecycle } = await opened();
  const expired = await lifecycle.registerObject(objectInput(1));
  const plan = lifecycle.planGarbageCollection({
    schemaVersion: 1,
    workspaceId,
    evaluatedAt: now,
    quotaBytes: 1_000_000
  });
  assert.deepEqual(plan.candidates, [
    { objectId: expired.objectId, reason: "retention-expired", bytes: expired.bytes }
  ]);
  lifecycle.close();
});

test("forget quarantines an unprotected nonsensitive object", async () => {
  const { lifecycle } = await opened();
  const object = await lifecycle.registerObject(objectInput(1));
  const receipt = await lifecycle.forget({ schemaVersion: 1, workspaceId, objectId: object.objectId });
  assert.equal(receipt.cryptoShredded, false);
  assert.equal(lifecycle.listObjects({ workspaceId, projectId })[0].state, "quarantined");
  lifecycle.close();
});

test("invalidation quarantines eligible bytes and records its bounded reason", async () => {
  const { lifecycle } = await opened();
  const object = await lifecycle.registerObject(objectInput(1));
  const receipt = await lifecycle.invalidateObject({
    schemaVersion: 1,
    workspaceId,
    objectId: object.objectId,
    reason: "source-revision-superseded"
  });
  const stored = lifecycle.listObjects({ workspaceId, projectId })[0];
  assert.equal(receipt.objectId, object.objectId);
  assert.equal(stored.state, "quarantined");
  assert.equal(stored.lifecycleReason, "source-revision-superseded");
  assert.deepEqual(
    await lifecycle.invalidateObject({
      schemaVersion: 1,
      workspaceId,
      objectId: object.objectId,
      reason: "source-revision-superseded"
    }),
    receipt
  );
  lifecycle.close();
});

test("forget uses only the logical key handle to crypto-shred sensitive content", async () => {
  const shredded = [];
  const { lifecycle } = await opened({ cryptoShred: { destroy: async (keyRef) => shredded.push(keyRef) } });
  const object = await lifecycle.registerObject(
    objectInput(1, { classification: "confidential", encryptionKeyRef: "key:memory-1" })
  );
  const receipt = await lifecycle.forget({ schemaVersion: 1, workspaceId, objectId: object.objectId });
  assert.deepEqual(shredded, ["key:memory-1"]);
  assert.equal(receipt.cryptoShredded, true);
  assert.deepEqual(await lifecycle.forget({ schemaVersion: 1, workspaceId, objectId: object.objectId }), receipt);
  assert.deepEqual(shredded, ["key:memory-1"]);
  lifecycle.close();
});

test("promotion source ordering is canonical", async () => {
  const { lifecycle } = await opened();
  const one = lifecycle.proposePromotion(promotionInput());
  const two = lifecycle.proposePromotion({ ...promotionInput(), fragments: [memoryHit(2), memoryHit(1)] });
  assert.equal(one.planId, two.planId);
  assert.equal(one.artifactContent, two.artifactContent);
  lifecycle.close();
});
