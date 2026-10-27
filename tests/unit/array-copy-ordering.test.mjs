import assert from "node:assert/strict";
import { cp, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { after, afterEach, test } from "node:test";

import { MachineBootstrapService, TaskScheduleCoordinator } from "../../packages/application/src/index.ts";
import { MemoryPromotionLifecycle, MemoryStore, MemoryVectorIndex } from "../../packages/memory/src/index.ts";
import { SafeInitService, buildCanonicalInitFiles } from "../../packages/workspace/src/index.ts";
import { canonicalConfig, claude, executeInput, serviceOptions } from "../helpers/machine-bootstrap-fixture.mjs";
import {
  approval,
  disposeLifecycleRoots,
  openLifecycle,
  promotionInput
} from "../helpers/memory-lifecycle-fixture.mjs";
import { batch, cleanup as cleanupMemoryStores, opened, source } from "../helpers/memory-store-fixture.mjs";
import { flush, scheduleInput, scheduleTask, schedulerPorts } from "../helpers/task-scheduler-fixture.mjs";
import {
  byteSnapshot,
  cleanupScannerRoots,
  initRepository,
  scannerRoot
} from "../helpers/workspace-scanner-fixture.mjs";

// SonarCloud S4043 (T8): each of these sites sorted or reversed an array inside
// the expression that consumed it, mutating the receiver as a side effect. They
// now read a sorted or reversed copy. These tests pin the order each one
// produces, so the copy is proven to carry the order the mutation did.

after(disposeLifecycleRoots);
afterEach(cleanupMemoryStores);
afterEach(cleanupScannerRoots);

const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-7123456789ab";

test("a role's failed requirements are reported in code-unit order", async () => {
  // No candidate holds any of these, so every capability fails; the declared
  // order is deliberately the reverse of code-unit order.
  const roles = [
    { roleId: "orchestrator", requiredCapabilities: ["review", "plan-review", "plan"], independence: "none" }
  ];
  const { service } = serviceOptions(MachineBootstrapService, [claude()]);
  const result = await service.execute(executeInput(canonicalConfig({ roles })));
  assert.deepEqual(result.roles[0].failedRequirements, [
    "capability:plan",
    "capability:plan-review",
    "capability:review"
  ]);
  assert.deepEqual(roles[0].requiredCapabilities, ["review", "plan-review", "plan"]);
});

test("a scheduling round lists its deferrals by task id, not by the order they arose", async () => {
  const { ports, release } = schedulerPorts();
  const coordinator = new TaskScheduleCoordinator(ports);
  // The dependency wait (T3) is recorded before the scope conflict (T2) and the
  // concurrency limit (T5), so only the sort puts T2 first.
  const pending = coordinator.execute(
    scheduleInput(
      [
        scheduleTask("T1", { scope: ["packages/application/src/T1", "packages/application/src/T2"] }),
        scheduleTask("T2"),
        scheduleTask("T3", { dependencies: ["T1"] }),
        scheduleTask("T4"),
        scheduleTask("T5")
      ],
      { maxConcurrentTasks: 2, budgets: { maximumCostUsd: 100, maximumTokens: 1000, maximumDurationMs: 3_600_000 } }
    )
  );
  await flush();
  release("T1");
  release("T4");
  await flush();
  release("T2");
  release("T3");
  await flush();
  release("T5");
  const report = await pending;
  assert.deepEqual(report.rounds[0].deferred, [
    { taskId: "T2", reason: "scope-conflict:T1" },
    { taskId: "T3", reason: "dependency-wait" },
    { taskId: "T5", reason: "concurrency-limit" }
  ]);
});

test("rebuild applies batches in Workspace/Project order and leaves its input untouched", async () => {
  const { store } = await opened();
  // "project_billing" sorts before "project_orders"; the input lists it second.
  const orders = batch([source("source:orders")]);
  const billing = batch([source("source:a"), source("source:b")], { projectId: "project_billing" });
  const input = [orders, billing];
  const results = store.rebuild(input);
  assert.deepEqual(
    results.map((entry) => entry.sourceCount),
    [2, 1]
  );
  assert.equal(input[0], orders);
  assert.equal(input[1], billing);
  store.close();
});

const unsupported = { workspaceId, projectId: "project_orders", zeta: 1, Alpha: 2, beta: 3 };

test("the memory store names unsupported fields in code-unit order", () => {
  const store = new MemoryStore({ dbPath: "unused.sqlite" });
  assert.throws(() => store.listSources(unsupported), {
    code: "VES_MEMORY_INPUT_INVALID",
    message: "source scope contains unsupported fields: Alpha, beta, zeta"
  });
});

test("the vector index names unsupported fields in code-unit order", () => {
  const index = new MemoryVectorIndex({ dbPath: "unused.sqlite", mode: "disabled" });
  assert.throws(() => index.listGenerations(unsupported), {
    code: "VES_VECTOR_INPUT_INVALID",
    message: "vector scope contains unsupported fields: Alpha, beta, zeta"
  });
});

test("the promotion lifecycle names unsupported fields in code-unit order", () => {
  const lifecycle = new MemoryPromotionLifecycle({
    dbPath: "unused.sqlite",
    objectRoot: "unused",
    ownerRoots: {},
    artifactPlanner: { createWritePlan: () => assert.fail("not reached") }
  });
  assert.throws(() => lifecycle.listObjects(unsupported), {
    code: "VES_MEMORY_LIFECYCLE_INVALID",
    message: "object query contains unsupported fields: Alpha, beta, zeta"
  });
});

test("promotion walks the target's ancestry from the owner root outward", async () => {
  const { lifecycle } = await openLifecycle();
  const plan = lifecycle.proposePromotion(promotionInput());
  assert.equal((await lifecycle.applyPromotion(plan, approval(plan))).outcome, "published");
  lifecycle.close();
});

test("a linked ancestor is refused even when the directories beneath it do not exist", async () => {
  // The walk must start at the root: `.verchestra/context` is a link to an empty
  // directory, so a leaf-first walk would stop at the missing `promoted` and
  // never reach the link.
  const { root, controlRoot, lifecycle } = await openLifecycle();
  const outside = join(root, "outside");
  await mkdir(outside, { recursive: true });
  await mkdir(join(controlRoot, ".verchestra"), { recursive: true });
  await symlink(outside, join(controlRoot, ".verchestra", "context"), "junction");
  const plan = lifecycle.proposePromotion(promotionInput());
  await assert.rejects(lifecycle.applyPromotion(plan, approval(plan)), {
    code: "VES_MEMORY_PROMOTION_TARGET_INVALID",
    message: "Target ancestry contains a link"
  });
  lifecycle.close();
});

const initFiles = () =>
  buildCanonicalInitFiles({
    workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-0123456789ab",
    displayName: "Ordering Fixture",
    placementMode: "centralized",
    generatorVersion: "1.0.0"
  });

test("init rollback and recovery both undo published changes newest first", async () => {
  const root = await scannerRoot();
  await initRepository(root, { ".gitignore": "original/\n" });
  const before = await byteSnapshot(root);
  const crashed = await scannerRoot();
  // After the third publication, copy the whole repository: the copy holds what
  // a hard crash at that point would leave behind (three published targets and
  // the staging journal). The original then fails and rolls back in process.
  const service = new SafeInitService({
    hooks: {
      afterApplyChange: async ({ index }) => {
        if (index !== 2) return;
        await cp(root, crashed, { recursive: true });
        throw new Error("crash");
      }
    }
  });
  await assert.rejects(service.apply(await service.preview({ controlRoot: root, files: initFiles() })), {
    code: "VES_INIT_APPLY_FAILED"
  });
  assert.deepEqual(await byteSnapshot(root), before);

  const removed = [];
  const recovery = new SafeInitService({ hooks: { afterRecoveryRemove: ({ index }) => removed.push(index) } });
  assert.deepEqual(await recovery.recover({ controlRoot: crashed }), { recoveredTransactions: 1, restoredChanges: 3 });
  assert.deepEqual(removed, [2, 1, 0]);
  assert.deepEqual(await byteSnapshot(crashed), before);
});
