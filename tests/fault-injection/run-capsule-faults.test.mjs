import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { FileRunCapsuleStore } from "../../packages/evidence/src/index.ts";
import { RuntimeStore } from "../../packages/platform-node/src/index.ts";
import { capsuleHarness, capsuleInput, capsuleNow, recoveryCoordinator } from "../helpers/run-capsule-fixture.mjs";

const statuses = ["COMPLETED", "FAILED", "ABORTED", "INTERRUPTED", "HANDED_OFF", "RECOVERED"];

for (const status of statuses) {
  test(`${status} publication acknowledgement loss converges to one file`, async () => {
    const root = await mkdtemp(join(tmpdir(), "verchestra-capsule-ack-"));
    const { builder } = capsuleHarness();
    const sealed = await builder.build(capsuleInput(status));
    let failOnce = true;
    const store = new FileRunCapsuleStore({
      root,
      afterPublish: () => {
        if (failOnce) {
          failOnce = false;
          throw new Error("injected publication acknowledgement loss");
        }
      }
    });
    await assert.rejects(store.put(sealed), /acknowledgement loss/u);
    assert.equal(await store.put(sealed), "already-published");
    assert.deepEqual(await store.get(sealed.artifactId), sealed);
  });
}

for (const status of statuses) {
  test(`${status} crash after Capsule publication recovers without duplicate seal`, async () => {
    const root = await mkdtemp(join(tmpdir(), "verchestra-capsule-recover-"));
    const runtime = new RuntimeStore({ dbPath: join(root, "runtime.sqlite"), now: () => capsuleNow });
    runtime.open();
    const input = capsuleInput(status);
    runtime.createRun({
      runId: input.runId,
      runKind: input.runKind,
      state: input.status,
      version: input.runVersion,
      repairCycles: 0,
      terminalCapsuleRequired: true,
      ...(input.predecessorRunId === undefined ? {} : { predecessorRunId: input.predecessorRunId }),
      ...(input.successorRunId === undefined ? {} : { successorRunId: input.successorRunId })
    });
    const { builder } = capsuleHarness();
    let failOnce = true;
    const coordinator = recoveryCoordinator({
      journal: runtime,
      resolver: { resolve: () => input },
      builder,
      root: join(root, "capsules"),
      afterStore: () => {
        if (failOnce) {
          failOnce = false;
          throw new Error("injected crash after store");
        }
      }
    });
    await assert.rejects(coordinator.recoverUnsealed(), /injected crash/u);
    const [recovered] = await coordinator.recoverUnsealed();
    assert.equal(recovered.storage, "already-published");
    assert.equal(recovered.journal, "recorded");
    assert.deepEqual(await coordinator.recoverUnsealed(), []);
    runtime.close();
  });
}

test("journal acknowledgement loss converges because the seal commit is durable", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-capsule-journal-ack-"));
  let failOnce = true;
  const runtime = new RuntimeStore({
    dbPath: join(root, "runtime.sqlite"),
    now: () => capsuleNow,
    hooks: {
      afterRunCapsuleSealCommit: () => {
        if (failOnce) {
          failOnce = false;
          throw new Error("injected journal acknowledgement loss");
        }
      }
    }
  });
  runtime.open();
  const input = capsuleInput("FAILED");
  runtime.createRun({
    runId: input.runId,
    runKind: input.runKind,
    state: input.status,
    version: input.runVersion,
    repairCycles: 0,
    terminalCapsuleRequired: true
  });
  const { builder } = capsuleHarness();
  const coordinator = recoveryCoordinator({
    journal: runtime,
    resolver: { resolve: () => input },
    builder,
    root: join(root, "capsules")
  });
  await assert.rejects(coordinator.recoverUnsealed(), /acknowledgement loss/u);
  assert.deepEqual(await coordinator.recoverUnsealed(), []);
  assert.ok(runtime.getRunCapsuleSeal(input.runId));
  runtime.close();
});

test("stale terminal version fails before a Capsule seal record", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-capsule-stale-"));
  const runtime = new RuntimeStore({ dbPath: join(root, "runtime.sqlite"), now: () => capsuleNow });
  runtime.open();
  const input = capsuleInput("ABORTED");
  runtime.createRun({
    runId: input.runId,
    runKind: input.runKind,
    state: input.status,
    version: input.runVersion,
    repairCycles: 0,
    terminalCapsuleRequired: true
  });
  assert.throws(
    () =>
      runtime.recordRunCapsuleSeal({
        runId: input.runId,
        stateVersion: input.runVersion - 1,
        status: input.status,
        capsuleId: "a".repeat(64),
        payloadDigest: "b".repeat(64),
        sealedAt: input.sealedAt
      }),
    { code: "VES_RUNTIME_VERSION_CONFLICT" }
  );
  assert.equal(runtime.getRunCapsuleSeal(input.runId), undefined);
  runtime.close();
});

test("resolved input drift fails before publication or journal mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-capsule-drift-"));
  const input = capsuleInput("FAILED");
  const journal = {
    listUnsealedTerminalRuns: () => [
      { runId: input.runId, runKind: input.runKind, status: input.status, stateVersion: input.runVersion }
    ],
    recordRunCapsuleSeal: () => assert.fail("journal must not mutate")
  };
  const { builder } = capsuleHarness();
  const coordinator = recoveryCoordinator({
    journal,
    resolver: { resolve: () => ({ ...input, runVersion: input.runVersion + 1 }) },
    builder,
    root
  });
  await assert.rejects(coordinator.recoverUnsealed(), { code: "VES_RUN_CAPSULE_RECOVERY_INVALID" });
});

test("a competing target is preserved during retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-capsule-conflict-"));
  const { builder } = capsuleHarness();
  const sealed = await builder.build(capsuleInput());
  await writeFile(join(root, `${sealed.artifactId}.json`), "competing human bytes", "utf8");
  const store = new FileRunCapsuleStore({ root });
  await assert.rejects(store.put(sealed), { code: "VES_RUN_CAPSULE_STORAGE_CONFLICT" });
});
