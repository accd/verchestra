import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { MachineBootstrapService } from "../../packages/application/src/index.ts";
import {
  MockSecretAdapter,
  RuntimeMachineProfileStore,
  RuntimeStore,
  SecretBroker,
  SecretBrokerBindingInspector,
  ensureWorkspaceState,
  resolveWorkspaceState
} from "../../packages/platform-node/src/index.ts";
import { claude, codex, executeInput, qwen, workspaceId } from "../helpers/machine-bootstrap-fixture.mjs";
import {
  byteSnapshot,
  cleanupScannerRoots,
  initRepository,
  scannerRoot
} from "../helpers/workspace-scanner-fixture.mjs";

const stateRoots = [];
afterEach(async () => {
  await cleanupScannerRoots();
  await Promise.all(stateRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function localBootstrap(candidates) {
  const stateRoot = await mkdtemp(join(tmpdir(), "verchestra-bootstrap-state-"));
  stateRoots.push(stateRoot);
  const layout = resolveWorkspaceState({ stateRoot, workspaceId, platform: process.platform });
  await ensureWorkspaceState(layout);
  const runtime = new RuntimeStore({ dbPath: layout.runtimeDatabase, now: () => "2026-07-13T00:00:00.000Z" });
  runtime.open();
  const secrets = new SecretBrokerBindingInspector({
    broker: new SecretBroker({ adapter: new MockSecretAdapter(), workspaceId }),
    expectedStore: layout.secretsNamespace
  });
  const service = new MachineBootstrapService({
    discovery: { discover: async () => candidates },
    secrets,
    profiles: new RuntimeMachineProfileStore({ runtimeStore: runtime, workspaceId }),
    now: () => "2026-07-13T00:00:00.000Z"
  });
  return { layout, runtime, service };
}

test("Claude plus Codex bootstrap changes only external machine state and leaves Git byte-identical", async () => {
  const root = await scannerRoot();
  await initRepository(root, { ".verchestra/workspace.yaml": `schemaVersion: 1\nworkspaceId: ${workspaceId}\n` });
  const before = await byteSnapshot(root);
  const { runtime, service } = await localBootstrap([claude(), codex()]);
  const result = await service.execute(executeInput());
  assert.equal(result.status, "ready");
  assert.deepEqual(await byteSnapshot(root), before);
  assert.equal(runtime.getMachineProfile(workspaceId).drivers.length, 2);
  runtime.close();
});

test("the same clone bootstraps on OpenCode Qwen-only state with no shared artifact change", async () => {
  const root = await scannerRoot();
  await initRepository(root, { ".verchestra/workspace.yaml": `schemaVersion: 1\nworkspaceId: ${workspaceId}\n` });
  const before = await byteSnapshot(root);
  const { runtime, service } = await localBootstrap([qwen()]);
  const result = await service.execute(executeInput());
  assert.equal(result.status, "degraded");
  assert.deepEqual(await byteSnapshot(root), before);
  assert.equal(runtime.getMachineProfile(workspaceId).drivers[0].passport.modelId, "qwen3-coder");
  runtime.close();
});

test("second bootstrap produces the same profile digest and no runtime profile update", async () => {
  const { runtime, service } = await localBootstrap([claude(), codex()]);
  const first = await service.execute(executeInput());
  const second = await service.execute(executeInput());
  assert.equal(first.profileDigest, second.profileDigest);
  assert.equal(first.profileChanged, true);
  assert.equal(second.profileChanged, false);
  assert.equal(runtime.listMachineProfiles().length, 1);
  runtime.close();
});
