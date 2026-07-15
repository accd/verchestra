import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ConsistentSnapshotCoordinator, FileRecoveryBundleStore } from "../../packages/evidence/src/index.ts";
import {
  recipient,
  recoveryHarness,
  recoveryNow,
  recoveryWorkspace,
  restoreCoordinator,
  restorePorts
} from "../helpers/recovery-bundle-fixture.mjs";

test("General JWE opens the same signed closure for each explicit recipient", async () => {
  const alice = await recipient("alice");
  const bob = await recipient("bob");
  const { builder, bundle, trust } = await recoveryHarness({ recipients: [alice, bob] });
  for (const receiver of [alice, bob]) {
    const opened = await builder.open(bundle, trust, receiver, { workspaceId: recoveryWorkspace, now: recoveryNow });
    assert.equal(opened.objects.length, 3);
    const memory = opened.objects.find((entry) => entry.objectId === "memory.sqlite");
    assert.equal(new TextDecoder().decode(memory.bytes), "memory-safe-snapshot");
  }
});

test("inspection exposes signed closure metadata without decrypting object bytes", async () => {
  const { builder, bundle, trust } = await recoveryHarness();
  const inspection = await builder.inspect(bundle, trust, { workspaceId: recoveryWorkspace, now: recoveryNow });
  assert.equal(inspection.objectCount, 3);
  assert.deepEqual(inspection.excludedClasses, [
    "credential-values",
    "machine-authentication",
    "provider-sessions",
    "secret-values",
    "vector-indexes"
  ]);
  assert.equal(JSON.stringify(inspection).includes("runtime-safe-snapshot"), false);
});

test("consistent snapshot barrier captures stable sources in canonical order", async () => {
  let runtime = "r1";
  let memory = "m1";
  const coordinator = new ConsistentSnapshotCoordinator({ barrier: { run: async (_workspace, work) => work() } });
  const result = await coordinator.capture(recoveryWorkspace, [
    { sourceId: "runtime", stateDigest: async () => runtime, snapshot: async () => ({ digest: runtime }) },
    { sourceId: "memory", stateDigest: async () => memory, snapshot: async () => ({ digest: memory }) }
  ]);
  assert.deepEqual(
    result.map((entry) => entry.sourceId),
    ["memory", "runtime"]
  );
  runtime = "r2";
  assert.equal(result[1].beforeDigest, "r1");
});

test("consistent snapshot barrier rejects state movement while snapshots are captured", async () => {
  let runtime = "r1";
  const coordinator = new ConsistentSnapshotCoordinator({ barrier: { run: async (_workspace, work) => work() } });
  await assert.rejects(
    coordinator.capture(recoveryWorkspace, [
      {
        sourceId: "runtime",
        stateDigest: async () => runtime,
        snapshot: async () => {
          runtime = "r2";
          return { digest: "snapshot:r1" };
        }
      }
    ]),
    { code: "VES_RECOVERY_SNAPSHOT_MOVED" }
  );
});

test("staged restore validates, rebinds, reconciles, then activates", async () => {
  const { builder, bundle, trust, recipients } = await recoveryHarness();
  const { state, ports } = restorePorts();
  const result = await restoreCoordinator(builder, ports).restore(bundle, trust, recipients[0], {
    workspaceId: recoveryWorkspace,
    now: recoveryNow
  });
  assert.deepEqual(state.calls, [
    "stage",
    "validate",
    "secret:database.primary",
    "secret:jira.delivery",
    "authority",
    "effect:effect:remote-001",
    "activate"
  ]);
  assert.equal(state.active, "restored");
  assert.deepEqual(result, { status: "activated", reconciledEffects: ["effect:remote-001"] });
});

test("bundle manifest records complete inclusion and exclusion decisions", async () => {
  const { plan } = await recoveryHarness();
  assert.deepEqual(plan.manifest.includedClasses, ["evidence", "memory", "runtime"]);
  assert.equal(
    plan.manifest.objects.every((entry) => entry.required === true),
    true
  );
  assert.equal(plan.manifest.excludedClasses.includes("secret-values"), true);
});

test("recovery publication converges after acknowledgement loss", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-recovery-"));
  try {
    const { bundle, plan } = await recoveryHarness();
    const store = new FileRecoveryBundleStore({ root });
    assert.equal(await store.put(bundle), "published");
    assert.equal(await store.put(bundle), "already-published");
    assert.equal((await store.get(plan.planId)).artifactId, bundle.artifactId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recovery publication rejects different ciphertext for the same immutable plan", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-recovery-"));
  try {
    const fixture = await recoveryHarness();
    const second = await fixture.builder.build(
      fixture.plan,
      fixture.objects,
      fixture.recipients.map(({ recipientId, publicKey }) => ({ recipientId, publicKey }))
    );
    const store = new FileRecoveryBundleStore({ root });
    await store.put(fixture.bundle);
    await assert.rejects(store.put(second), { code: "VES_RECOVERY_STORAGE_CONFLICT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recovery store rejects noncanonical or corrupt persisted bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-recovery-"));
  try {
    const { plan } = await recoveryHarness();
    const store = new FileRecoveryBundleStore({ root });
    await writeFile(join(root, `${plan.planId}.json`), "{}", "utf8");
    await assert.rejects(store.get(plan.planId), { code: "VES_RECOVERY_STORAGE_INTEGRITY" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
