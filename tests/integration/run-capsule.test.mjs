import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { FileRunCapsuleStore } from "../../packages/evidence/src/index.ts";
import { RuntimeStore as NodeRuntimeStore } from "../../packages/platform-node/src/index.ts";
import {
  capsuleDigest,
  capsuleExpectation,
  capsuleHarness,
  capsuleInput,
  capsuleNow,
  capsuleRun,
  recoveryCoordinator
} from "../helpers/run-capsule-fixture.mjs";

for (const status of ["COMPLETED", "FAILED", "ABORTED", "INTERRUPTED", "HANDED_OFF", "RECOVERED"]) {
  test(`${status} terminal fixture seals and verifies once`, async () => {
    const input = capsuleInput(status);
    const { builder, trust } = capsuleHarness();
    const sealed = await builder.build(input);
    assert.equal(sealed.issuedAt, input.sealedAt);
    assert.deepEqual(await builder.verify(sealed, trust, capsuleExpectation(input)), {
      ok: true,
      capsuleId: sealed.artifactId,
      status
    });
  });
}

for (const risk of ["low", "medium", "high", "critical"]) {
  test(`${risk} risk fixture carries its required evidence closure`, async () => {
    const { builder } = capsuleHarness();
    const sealed = await builder.build(capsuleInput("COMPLETED", risk));
    assert.equal(sealed.payload.riskTier, risk);
    assert.ok(Object.values(sealed.payload.evidence).flat().length >= 2);
  });
}

test("clean-process rebuild is byte-identical despite a different wall clock", async () => {
  const input = capsuleInput();
  const first = capsuleHarness();
  const second = new first.sealer.constructor({
    signer: first.signer,
    now: () => new Date("2040-01-01T00:00:00.000Z")
  });
  const left = await first.builder.build(input);
  const right = await new first.builder.constructor({ sealer: second }).build(input);
  assert.deepEqual(right, left);
});

test("source and policy sets are canonical under permutation", async () => {
  const input = capsuleInput();
  const permuted = structuredClone(input);
  permuted.sourceStateRefs.reverse();
  permuted.policyDigests.reverse();
  const { builder } = capsuleHarness();
  assert.deepEqual(await builder.build(permuted), await builder.build(input));
});

test("file store publishes immutable canonical bytes idempotently", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-capsule-"));
  const { builder } = capsuleHarness();
  const sealed = await builder.build(capsuleInput());
  const store = new FileRunCapsuleStore({ root });
  assert.equal(await store.put(sealed), "published");
  assert.equal(await store.put(sealed), "already-published");
  const loaded = await store.get(sealed.artifactId);
  assert.deepEqual(loaded, sealed);
  assert.equal(Object.isFrozen(loaded.payload.evidence), true);
});

test("concurrent stores converge to one Capsule", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-capsule-"));
  const { builder } = capsuleHarness();
  const sealed = await builder.build(capsuleInput());
  const stores = [new FileRunCapsuleStore({ root }), new FileRunCapsuleStore({ root })];
  assert.deepEqual((await Promise.all(stores.map((store) => store.put(sealed)))).sort(), [
    "already-published",
    "published"
  ]);
});

test("runtime journal lists and records one unsealed terminal intent", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-capsule-runtime-"));
  const store = new NodeRuntimeStore({ dbPath: join(root, "runtime.sqlite"), now: () => capsuleNow });
  store.open();
  store.createRun({
    runId: capsuleRun,
    runKind: "feature",
    state: "FAILED",
    version: 7,
    repairCycles: 0,
    terminalCapsuleRequired: true
  });
  assert.equal(store.listUnsealedTerminalRuns().length, 1);
  const record = {
    runId: capsuleRun,
    stateVersion: 7,
    status: "FAILED",
    capsuleId: "a".repeat(64),
    payloadDigest: "b".repeat(64),
    sealedAt: capsuleNow
  };
  assert.equal(store.recordRunCapsuleSeal(record), "recorded");
  assert.equal(store.recordRunCapsuleSeal(record), "already-recorded");
  assert.equal(store.listUnsealedTerminalRuns().length, 0);
  assert.equal(store.getRunCapsuleSeal(capsuleRun).capsuleId, record.capsuleId);
  store.close();
});

test("startup recovery publishes then journals an unsealed terminal run", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-capsule-recovery-"));
  const runtime = new NodeRuntimeStore({ dbPath: join(root, "runtime.sqlite"), now: () => capsuleNow });
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
  const [result] = await coordinator.recoverUnsealed();
  assert.equal(result.storage, "published");
  assert.equal(result.journal, "recorded");
  assert.deepEqual(await coordinator.recoverUnsealed(), []);
  runtime.close();
});

test("runtime state digest includes Capsule seal authority", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-capsule-digest-"));
  const runtime = new NodeRuntimeStore({ dbPath: join(root, "runtime.sqlite"), now: () => capsuleNow });
  runtime.open();
  runtime.createRun({
    runId: capsuleRun,
    runKind: "feature",
    state: "ABORTED",
    version: 7,
    repairCycles: 0,
    terminalCapsuleRequired: true
  });
  const before = runtime.stateDigest();
  runtime.recordRunCapsuleSeal({
    runId: capsuleRun,
    stateVersion: 7,
    status: "ABORTED",
    capsuleId: "c".repeat(64),
    payloadDigest: capsuleDigest("payload").slice(7),
    sealedAt: capsuleNow
  });
  assert.notEqual(runtime.stateDigest(), before);
  runtime.close();
});
