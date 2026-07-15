import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { MemoryPromotionLifecycle } from "../../packages/memory/src/index.ts";
import {
  approval,
  lifecycleRoot,
  now,
  objectInput,
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

for (const [name, hook] of [
  ["after stage", "afterPromotionStage"],
  ["before publish", "beforePromotionPublish"]
]) {
  test(`promotion crash ${name} publishes no target`, async () => {
    const { controlRoot, lifecycle } = await opened({
      hooks: {
        [hook]: () => {
          throw new Error("crash");
        }
      }
    });
    const plan = lifecycle.proposePromotion(promotionInput());
    await assert.rejects(lifecycle.applyPromotion(plan, approval(plan)));
    await assert.rejects(access(join(controlRoot, ...plan.writePlan.writes[0].logicalPath.split("/"))));
    lifecycle.close();
  });
}

test("promotion acknowledgement loss converges from the published bytes", async () => {
  let fail = true;
  const paths = await lifecycleRoot();
  const first = new MemoryPromotionLifecycle({
    ...paths,
    now: () => now,
    hooks: {
      afterPromotionPublish: () => {
        if (fail) {
          fail = false;
          throw new Error("ack loss");
        }
      }
    }
  });
  first.open();
  const plan = first.proposePromotion(promotionInput());
  await assert.rejects(first.applyPromotion(plan, approval(plan)));
  first.close();
  const second = new MemoryPromotionLifecycle({ ...paths, now: () => now });
  second.open();
  assert.equal((await second.applyPromotion(plan, approval(plan))).outcome, "already-published");
  second.close();
});

test("target race at publication boundary preserves competing bytes", async () => {
  let target;
  const { controlRoot, lifecycle } = await opened({
    hooks: {
      beforePromotionPublish: async () => {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, "concurrent human write", "utf8");
      }
    }
  });
  const plan = lifecycle.proposePromotion(promotionInput());
  target = join(controlRoot, ...plan.writePlan.writes[0].logicalPath.split("/"));
  await assert.rejects(lifecycle.applyPromotion(plan, approval(plan)), { code: "VES_MEMORY_PROMOTION_CONFLICT" });
  assert.equal(await readFile(target, "utf8"), "concurrent human write");
  lifecycle.close();
});

test("failure before first quarantine move preserves file and state", async () => {
  const { lifecycle } = await opened({
    hooks: {
      beforeQuarantineMove: () => {
        throw new Error("move denied");
      }
    }
  });
  await lifecycle.registerObject(objectInput(1));
  const before = lifecycle.stateDigest();
  const plan = lifecycle.planGarbageCollection({ schemaVersion: 1, workspaceId, evaluatedAt: now, quotaBytes: 0 });
  await assert.rejects(lifecycle.applyGarbageCollection(plan));
  assert.equal(lifecycle.stateDigest(), before);
  assert.equal(lifecycle.listObjects({ workspaceId, projectId })[0].state, "active");
  lifecycle.close();
});

test("failure after one quarantine move restores every moved object", async () => {
  let calls = 0;
  const { lifecycle } = await opened({
    hooks: {
      beforeQuarantineMove: () => {
        calls += 1;
        if (calls === 2) throw new Error("second move denied");
      }
    }
  });
  await lifecycle.registerObject(objectInput(1));
  await lifecycle.registerObject(objectInput(2));
  const before = lifecycle.stateDigest();
  const plan = lifecycle.planGarbageCollection({ schemaVersion: 1, workspaceId, evaluatedAt: now, quotaBytes: 0 });
  await assert.rejects(lifecycle.applyGarbageCollection(plan));
  assert.equal(lifecycle.stateDigest(), before);
  assert.ok(lifecycle.listObjects({ workspaceId, projectId }).every((entry) => entry.state === "active"));
  lifecycle.close();
});

test("failure after a quarantine move restores its original path", async () => {
  const { lifecycle, objectRoot } = await opened({
    hooks: {
      afterQuarantineMove: () => {
        throw new Error("post-move crash");
      }
    }
  });
  const object = await lifecycle.registerObject(objectInput(1));
  const before = lifecycle.stateDigest();
  const plan = lifecycle.planGarbageCollection({ schemaVersion: 1, workspaceId, evaluatedAt: now, quotaBytes: 0 });
  await assert.rejects(lifecycle.applyGarbageCollection(plan));
  assert.equal(lifecycle.stateDigest(), before);
  assert.equal(
    await readFile(join(objectRoot, workspaceId, "objects", `${object.objectId.slice(7)}.blob`), "utf8"),
    "managed object 1"
  );
  lifecycle.close();
});

test("garbage collection plan becomes stale after a new managed object", async () => {
  const { lifecycle } = await opened();
  await lifecycle.registerObject(objectInput(1));
  const plan = lifecycle.planGarbageCollection({ schemaVersion: 1, workspaceId, evaluatedAt: now, quotaBytes: 0 });
  await lifecycle.registerObject(objectInput(2));
  await assert.rejects(lifecycle.applyGarbageCollection(plan), { code: "VES_MEMORY_GC_PLAN_STALE" });
  lifecycle.close();
});

test("garbage collection plan becomes stale when a legal hold appears", async () => {
  const { lifecycle } = await opened();
  const object = await lifecycle.registerObject(objectInput(1));
  const plan = lifecycle.planGarbageCollection({ schemaVersion: 1, workspaceId, evaluatedAt: now, quotaBytes: 0 });
  lifecycle.setLegalHold({ schemaVersion: 1, workspaceId, objectId: object.objectId, holdId: "hold:late" });
  await assert.rejects(lifecycle.applyGarbageCollection(plan), { code: "VES_MEMORY_GC_PLAN_STALE" });
  assert.equal(lifecycle.listObjects({ workspaceId, projectId })[0].state, "active");
  lifecycle.close();
});

test("crypto-shred failure preserves active object metadata and bytes", async () => {
  const { lifecycle } = await opened({
    cryptoShred: {
      destroy: async () => {
        throw new Error("KMS outage");
      }
    }
  });
  const object = await lifecycle.registerObject(
    objectInput(1, { classification: "confidential", encryptionKeyRef: "key:memory-1" })
  );
  const before = lifecycle.stateDigest();
  await assert.rejects(lifecycle.forget({ schemaVersion: 1, workspaceId, objectId: object.objectId }));
  assert.equal(lifecycle.stateDigest(), before);
  assert.equal(lifecycle.listObjects({ workspaceId, projectId })[0].state, "active");
  lifecycle.close();
});

test("crypto-shred acknowledgement loss converges without a second key destruction", async () => {
  const shredded = [];
  const { lifecycle } = await opened({
    cryptoShred: { destroy: async (keyRef) => shredded.push(keyRef) },
    hooks: {
      afterCryptoShred: () => {
        throw new Error("ack loss");
      }
    }
  });
  const object = await lifecycle.registerObject(
    objectInput(1, { classification: "confidential", encryptionKeyRef: "key:memory-1" })
  );
  await assert.rejects(lifecycle.forget({ schemaVersion: 1, workspaceId, objectId: object.objectId }), {
    code: "VES_MEMORY_FORGET_OUTCOME_UNKNOWN"
  });
  const stored = lifecycle.listObjects({ workspaceId, projectId })[0];
  assert.equal(stored.state, "quarantined");
  assert.equal(stored.encryptionKeyRef, null);
  assert.deepEqual(await lifecycle.forget({ schemaVersion: 1, workspaceId, objectId: object.objectId }), {
    objectId: object.objectId,
    cryptoShredded: true
  });
  assert.deepEqual(shredded, ["key:memory-1"]);
  lifecycle.close();
});

test("real SQLite writer lock maps registration to a recoverable busy failure", async () => {
  const { dbPath, lifecycle } = await opened();
  const blocker = new DatabaseSync(dbPath);
  blocker.exec("BEGIN EXCLUSIVE");
  await assert.rejects(
    lifecycle.registerObject(objectInput(1)),
    (error) => error.code === "VES_MEMORY_LIFECYCLE_BUSY" && error.recoverable === true
  );
  blocker.exec("ROLLBACK");
  blocker.close();
  lifecycle.close();
});

test("corrupt lifecycle database fails closed on open", async () => {
  const paths = await lifecycleRoot();
  await writeFile(paths.dbPath, "not sqlite", "utf8");
  const lifecycle = new MemoryPromotionLifecycle({ ...paths, now: () => now });
  assert.throws(() => lifecycle.open());
});

test("post-commit acknowledgement loss keeps quarantine state convergent", async () => {
  const { lifecycle } = await opened({
    hooks: {
      afterGarbageCollectionCommit: () => {
        throw new Error("ack loss");
      }
    }
  });
  const object = await lifecycle.registerObject(objectInput(1));
  const plan = lifecycle.planGarbageCollection({ schemaVersion: 1, workspaceId, evaluatedAt: now, quotaBytes: 0 });
  await assert.rejects(lifecycle.applyGarbageCollection(plan), { code: "VES_MEMORY_GC_OUTCOME_UNKNOWN" });
  assert.equal(lifecycle.listObjects({ workspaceId, projectId })[0].state, "quarantined");
  assert.equal(object.objectId, plan.candidates[0].objectId);
  assert.deepEqual((await lifecycle.applyGarbageCollection(plan)).quarantinedObjectIds, [object.objectId]);
  lifecycle.close();
});
