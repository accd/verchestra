import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { FileRecordStore } from "../../packages/self-test/src/index.ts";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("file records survive a new store instance and preserve immutable identity", async () => {
  const root = await mkdtemp(join(process.cwd(), ".tmp-self-test-records-"));
  roots.push(root);
  const first = new FileRecordStore({ root });
  await first.save("boundary:package", { boundaryId: "full.package.stored", logicalId: "package-1" });

  const restarted = new FileRecordStore({ root });
  assert.deepEqual(await restarted.load("boundary:package"), {
    boundaryId: "full.package.stored",
    logicalId: "package-1"
  });
  await assert.rejects(
    restarted.save("boundary:package", { boundaryId: "full.package.stored", logicalId: "package-2" }),
    /conflicts/u
  );
});

test("mutable checkpoints replace safely and records can be found by identity", async () => {
  const root = await mkdtemp(join(process.cwd(), ".tmp-self-test-records-"));
  roots.push(root);
  const store = new FileRecordStore({ root });
  await store.replace("progress:handoff", { handoffRef: "handoff:1", stage: "prepared" });
  await store.replace("progress:handoff", { handoffRef: "handoff:1", stage: "published" });
  assert.deepEqual(await store.load("progress:handoff"), { handoffRef: "handoff:1", stage: "published" });
  assert.deepEqual(await store.find("handoffRef", "handoff:1"), {
    handoffRef: "handoff:1",
    stage: "published"
  });
});
