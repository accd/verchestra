import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";

import { MemoryPromotionLifecycle } from "../../packages/memory/src/index.ts";

import {
  disposeLifecycleRoots,
  now,
  objectInput,
  openLifecycle,
  projectId,
  workspaceId
} from "../helpers/memory-lifecycle-fixture.mjs";

after(disposeLifecycleRoots);

const scope = { workspaceId, projectId };
const sensitiveObject = () => objectInput(1, { classification: "confidential", encryptionKeyRef: "key:memory-1" });
const forgetRequest = (objectId) => ({ schemaVersion: 1, workspaceId, objectId });
const gcRequest = { schemaVersion: 1, workspaceId, evaluatedAt: now, quotaBytes: 0 };
const objectPath = (objectRoot, objectId) => join(objectRoot, workspaceId, "objects", `${objectId.slice(7)}.blob`);
const quarantinePath = (objectRoot, objectId) =>
  join(objectRoot, workspaceId, "quarantine", `${objectId.slice(7)}.blob`);

test("an applied garbage collection replays its stored receipt without moving anything again", async () => {
  const { lifecycle } = await openLifecycle();
  const object = await lifecycle.registerObject(objectInput(1));
  const plan = lifecycle.planGarbageCollection(gcRequest);
  const receipt = await lifecycle.applyGarbageCollection(plan);
  assert.deepEqual(receipt, { planId: plan.planId, quarantinedObjectIds: [object.objectId] });
  const state = lifecycle.stateDigest();
  assert.deepEqual(await lifecycle.applyGarbageCollection(plan), receipt);
  assert.equal(lifecycle.stateDigest(), state);
  lifecycle.close();
});

test("a stored garbage collection receipt that conflicts with its plan is reported as corruption", async () => {
  const { dbPath, lifecycle } = await openLifecycle();
  await lifecycle.registerObject(objectInput(1));
  const plan = lifecycle.planGarbageCollection(gcRequest);
  await lifecycle.applyGarbageCollection(plan);
  const tamper = new DatabaseSync(dbPath);
  tamper.prepare("UPDATE memory_gc_runs SET receipt_json=? WHERE plan_id=?").run("{}", plan.planId);
  tamper.close();
  await assert.rejects(lifecycle.applyGarbageCollection(plan), {
    code: "VES_MEMORY_LIFECYCLE_CORRUPT",
    message: "Stored garbage collection receipt conflicts with its plan"
  });
  lifecycle.close();
});

test("a garbage collection whose acknowledgement is lost stays committed and reports the outcome unknown", async () => {
  const { lifecycle } = await openLifecycle({
    hooks: {
      afterGarbageCollectionCommit: () => {
        throw new Error("acknowledgement lost");
      }
    }
  });
  await lifecycle.registerObject(objectInput(1));
  const plan = lifecycle.planGarbageCollection(gcRequest);
  await assert.rejects(lifecycle.applyGarbageCollection(plan), {
    code: "VES_MEMORY_GC_OUTCOME_UNKNOWN",
    message: "Garbage collection committed but acknowledgement was lost"
  });
  assert.equal(lifecycle.listObjects(scope)[0].state, "quarantined");
  lifecycle.close();
});

test("a garbage collection that fails after moving objects restores every moved object", async () => {
  let moves = 0;
  const { lifecycle, objectRoot } = await openLifecycle({
    hooks: {
      afterQuarantineMove: () => {
        moves += 1;
        if (moves === 2) throw new Error("second move crashed");
      }
    }
  });
  const first = await lifecycle.registerObject(objectInput(1));
  const second = await lifecycle.registerObject(objectInput(2));
  const before = lifecycle.stateDigest();
  const plan = lifecycle.planGarbageCollection(gcRequest);
  await assert.rejects(lifecycle.applyGarbageCollection(plan), { message: "second move crashed" });
  assert.equal(lifecycle.stateDigest(), before);
  assert.equal(await readFile(objectPath(objectRoot, first.objectId), "utf8"), "managed object 1");
  assert.equal(await readFile(objectPath(objectRoot, second.objectId), "utf8"), "managed object 2");
  lifecycle.close();
});

test("forgetting a nonsensitive object quarantines it, and a replay reports the same outcome", async () => {
  const { lifecycle } = await openLifecycle();
  const object = await lifecycle.registerObject(objectInput(1));
  const receipt = await lifecycle.forget(forgetRequest(object.objectId));
  assert.deepEqual(receipt, { objectId: object.objectId, cryptoShredded: false });
  assert.equal(lifecycle.listObjects(scope)[0].lifecycleReason, "forget");
  assert.deepEqual(await lifecycle.forget(forgetRequest(object.objectId)), receipt);
  lifecycle.close();
});

test("forgetting a sensitive object without a crypto-shred adapter restores it and refuses", async () => {
  const { lifecycle, objectRoot } = await openLifecycle();
  const object = await lifecycle.registerObject(sensitiveObject());
  const before = lifecycle.stateDigest();
  await assert.rejects(lifecycle.forget(forgetRequest(object.objectId)), {
    code: "VES_MEMORY_CRYPTO_SHRED_UNAVAILABLE",
    message: "Crypto-shred adapter is unavailable"
  });
  assert.equal(lifecycle.stateDigest(), before);
  assert.equal(await readFile(objectPath(objectRoot, object.objectId), "utf8"), "managed object 1");
  lifecycle.close();
});

test("a failed key destruction restores the object and surfaces the adapter failure", async () => {
  const { lifecycle } = await openLifecycle({
    cryptoShred: {
      destroy: async () => {
        throw new Error("KMS outage");
      }
    }
  });
  const object = await lifecycle.registerObject(sensitiveObject());
  await assert.rejects(lifecycle.forget(forgetRequest(object.objectId)), { message: "KMS outage" });
  assert.equal(lifecycle.listObjects(scope)[0].state, "active");
  lifecycle.close();
});

test("a failed key destruction whose restoration also fails reports the outcome unknown", async () => {
  let objectRoot;
  let objectId;
  const opened = await openLifecycle({
    cryptoShred: {
      destroy: async () => {
        await rm(quarantinePath(objectRoot, objectId));
        throw new Error("KMS outage");
      }
    }
  });
  objectRoot = opened.objectRoot;
  const { lifecycle } = opened;
  objectId = (await lifecycle.registerObject(sensitiveObject())).objectId;
  await assert.rejects(lifecycle.forget(forgetRequest(objectId)), {
    code: "VES_MEMORY_FORGET_OUTCOME_UNKNOWN",
    message: "Crypto-shred failed and filesystem restoration is incomplete"
  });
  lifecycle.close();
});

test("a lost crypto-shred acknowledgement is reported, and a replay converges without a second destruction", async () => {
  const shredded = [];
  let acknowledge = false;
  const { lifecycle } = await openLifecycle({
    cryptoShred: { destroy: async (keyRef) => shredded.push(keyRef) },
    hooks: {
      afterCryptoShred: () => {
        if (!acknowledge) throw new Error("acknowledgement lost");
      }
    }
  });
  const object = await lifecycle.registerObject(sensitiveObject());
  await assert.rejects(lifecycle.forget(forgetRequest(object.objectId)), {
    code: "VES_MEMORY_FORGET_OUTCOME_UNKNOWN",
    message: "Crypto-shred committed but acknowledgement was lost"
  });
  acknowledge = true;
  assert.deepEqual(await lifecycle.forget(forgetRequest(object.objectId)), {
    objectId: object.objectId,
    cryptoShredded: true
  });
  assert.deepEqual(shredded, ["key:memory-1"]);
  lifecycle.close();
});

// A forget interrupted after quarantine, with its key still held, is resumed
// by the next forget. The interruption is produced by a key destruction that
// fails while another writer holds the database, so restoration cannot run.
async function interruptedForget() {
  let blocker;
  const opened = await openLifecycle({
    timeoutMs: 10,
    cryptoShred: {
      destroy: async () => {
        blocker = new DatabaseSync(opened.dbPath);
        blocker.exec("BEGIN EXCLUSIVE");
        throw new Error("KMS outage");
      }
    }
  });
  const object = await opened.lifecycle.registerObject(sensitiveObject());
  await assert.rejects(opened.lifecycle.forget(forgetRequest(object.objectId)), {
    code: "VES_MEMORY_FORGET_OUTCOME_UNKNOWN"
  });
  blocker.exec("ROLLBACK");
  blocker.close();
  opened.lifecycle.close();
  const inspector = openLifecycleOn(opened);
  const stored = inspector.listObjects(scope)[0];
  inspector.close();
  assert.equal(stored.state, "quarantined");
  assert.equal(stored.encryptionKeyRef, "key:memory-1");
  return { ...opened, objectId: object.objectId };
}

function openLifecycleOn(paths, options = {}) {
  const lifecycle = new MemoryPromotionLifecycle({
    dbPath: paths.dbPath,
    objectRoot: paths.objectRoot,
    ownerRoots: paths.ownerRoots,
    artifactPlanner: paths.artifactPlanner,
    now: () => now,
    ...options
  });
  lifecycle.open();
  return lifecycle;
}

test("resuming an interrupted forget without an adapter refuses", async () => {
  const interrupted = await interruptedForget();
  const lifecycle = openLifecycleOn(interrupted);
  await assert.rejects(lifecycle.forget(forgetRequest(interrupted.objectId)), {
    code: "VES_MEMORY_CRYPTO_SHRED_UNAVAILABLE"
  });
  lifecycle.close();
});

test("resuming an interrupted forget destroys the key once and reports it shredded", async () => {
  const interrupted = await interruptedForget();
  const shredded = [];
  const lifecycle = openLifecycleOn(interrupted, {
    cryptoShred: { destroy: async (keyRef) => shredded.push(keyRef) }
  });
  assert.deepEqual(await lifecycle.forget(forgetRequest(interrupted.objectId)), {
    objectId: interrupted.objectId,
    cryptoShredded: true
  });
  assert.deepEqual(shredded, ["key:memory-1"]);
  assert.equal(lifecycle.listObjects(scope)[0].encryptionKeyRef, null);
  lifecycle.close();
});

test("a resumed forget whose key destruction fails keeps the key and surfaces the failure", async () => {
  const interrupted = await interruptedForget();
  const lifecycle = openLifecycleOn(interrupted, {
    cryptoShred: {
      destroy: async () => {
        throw new Error("KMS outage");
      }
    }
  });
  await assert.rejects(lifecycle.forget(forgetRequest(interrupted.objectId)), { message: "KMS outage" });
  assert.equal(lifecycle.listObjects(scope)[0].encryptionKeyRef, "key:memory-1");
  lifecycle.close();
});

test("a resumed forget whose acknowledgement is lost after the key is cleared reports the outcome unknown", async () => {
  const interrupted = await interruptedForget();
  const lifecycle = openLifecycleOn(interrupted, {
    cryptoShred: { destroy: async () => undefined },
    hooks: {
      afterCryptoShred: () => {
        throw new Error("acknowledgement lost");
      }
    }
  });
  await assert.rejects(lifecycle.forget(forgetRequest(interrupted.objectId)), {
    code: "VES_MEMORY_FORGET_OUTCOME_UNKNOWN",
    message: "Crypto-shred committed but acknowledgement was lost"
  });
  assert.equal(lifecycle.listObjects(scope)[0].encryptionKeyRef, null);
  lifecycle.close();
});
