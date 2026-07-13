import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  MockSecretAdapter,
  SecretBroker,
  ensureWorkspaceState,
  resolveWorkspaceState
} from "../../packages/platform-node/src/index.ts";

const roots = [];
const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-0123456789ab";
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

test("Workspace state materialization creates every private operational directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-state-"));
  roots.push(root);
  const state = resolveWorkspaceState({ stateRoot: root, workspaceId, platform: process.platform });
  await ensureWorkspaceState(state);
  for (const path of [
    state.runtimeRoot,
    state.memoryRoot,
    state.backupsRoot,
    state.locksRoot,
    state.cacheRoot,
    state.sessionsRoot
  ]) {
    await access(path);
  }
});

test("repeated Workspace state materialization is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-state-"));
  roots.push(root);
  const state = resolveWorkspaceState({ stateRoot: root, workspaceId, platform: process.platform });
  assert.deepEqual(await ensureWorkspaceState(state), await ensureWorkspaceState(state));
});

test("two Workspace roots never overlap", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-state-"));
  roots.push(root);
  const first = resolveWorkspaceState({ stateRoot: root, workspaceId, platform: process.platform });
  const second = resolveWorkspaceState({
    stateRoot: root,
    workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-1123456789ab",
    platform: process.platform
  });
  assert.notEqual(first.workspaceRoot, second.workspaceRoot);
  assert.equal(first.workspaceRoot.startsWith(second.workspaceRoot), false);
  assert.equal(second.workspaceRoot.startsWith(first.workspaceRoot), false);
});

test("two brokers sharing an adapter remain Workspace-isolated", async () => {
  const adapter = new MockSecretAdapter();
  adapter.set(workspaceId, "shared-name", new Uint8Array([1]));
  adapter.set("workspace_018f0b6d-7b1a-7abc-8def-1123456789ab", "shared-name", new Uint8Array([2]));
  const first = new SecretBroker({ adapter, workspaceId });
  const secondWorkspace = "workspace_018f0b6d-7b1a-7abc-8def-1123456789ab";
  const second = new SecretBroker({ adapter, workspaceId: secondWorkspace });
  const descriptor = { logicalName: "shared-name", purpose: "test", blockedCapability: "test", expectedStore: "mock" };
  const firstHandle = await first.bind({ ...descriptor, workspaceId });
  const secondHandle = await second.bind({ ...descriptor, workspaceId: secondWorkspace });
  assert.equal(await first.withSecret(firstHandle, async (bytes) => bytes[0]), 1);
  assert.equal(await second.withSecret(secondHandle, async (bytes) => bytes[0]), 2);
});

test("Workspace materialization rejects a junction escape before creating child state", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-state-"));
  const outside = await mkdtemp(join(tmpdir(), "verchestra-outside-"));
  roots.push(root, outside);
  await mkdir(join(root, "workspaces"));
  await symlink(outside, join(root, "workspaces", workspaceId), process.platform === "win32" ? "junction" : "dir");
  const state = resolveWorkspaceState({ stateRoot: root, workspaceId, platform: process.platform });
  await assert.rejects(ensureWorkspaceState(state), { code: "VES_STATE_ROOT_ESCAPE" });
  assert.deepEqual(await readdir(outside), []);
});
