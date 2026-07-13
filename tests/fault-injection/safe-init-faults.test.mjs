import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import { SafeInitService, buildCanonicalInitFiles } from "../../packages/workspace/src/index.ts";
import {
  byteSnapshot,
  cleanupScannerRoots,
  initRepository,
  scannerRoot
} from "../helpers/workspace-scanner-fixture.mjs";

afterEach(cleanupScannerRoots);

const files = () =>
  buildCanonicalInitFiles({
    workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-0123456789ab",
    displayName: "Fault Fixture",
    placementMode: "centralized",
    generatorVersion: "1.0.0"
  });

async function absent(path) {
  await assert.rejects(access(path), { code: "ENOENT" });
}

test("injected crash after staging preserves every prior byte and removes staging root", async () => {
  const root = await scannerRoot();
  await initRepository(root);
  const before = await byteSnapshot(root);
  const service = new SafeInitService({ hooks: { afterStage: () => Promise.reject(new Error("crash")) } });
  await assert.rejects(service.apply(await service.preview({ controlRoot: root, files: files() })), {
    code: "VES_INIT_APPLY_FAILED"
  });
  assert.deepEqual(await byteSnapshot(root), before);
  await absent(join(root, ".verchestra"));
});

test("injected permission denial before first publication preserves prior state", async () => {
  const root = await scannerRoot();
  await initRepository(root, { ".gitignore": "dist/\n" });
  const before = await byteSnapshot(root);
  const denied = Object.assign(new Error("denied"), { code: "EACCES" });
  const service = new SafeInitService({ hooks: { beforeApplyChange: () => Promise.reject(denied) } });
  await assert.rejects(service.apply(await service.preview({ controlRoot: root, files: files() })), {
    code: "VES_INIT_APPLY_FAILED"
  });
  assert.deepEqual(await byteSnapshot(root), before);
});

test("injected crash after the first publication rolls the created target back", async () => {
  const root = await scannerRoot();
  await initRepository(root);
  const before = await byteSnapshot(root);
  const service = new SafeInitService({
    hooks: { afterApplyChange: ({ index }) => (index === 0 ? Promise.reject(new Error("crash")) : undefined) }
  });
  await assert.rejects(service.apply(await service.preview({ controlRoot: root, files: files() })), {
    code: "VES_INIT_APPLY_FAILED"
  });
  assert.deepEqual(await byteSnapshot(root), before);
});

test("rollback restores an existing CRLF gitignore byte-for-byte", async () => {
  const root = await scannerRoot();
  const original = "# user\r\ndist/\r\n";
  await initRepository(root, { ".gitignore": original });
  const service = new SafeInitService({
    hooks: { afterApplyChange: ({ index }) => (index === 1 ? Promise.reject(new Error("crash")) : undefined) }
  });
  await assert.rejects(service.apply(await service.preview({ controlRoot: root, files: files() })), {
    code: "VES_INIT_APPLY_FAILED"
  });
  assert.equal(await readFile(join(root, ".gitignore"), "utf8"), original);
});

test("retry after a rolled-back failure converges exactly once", async () => {
  const root = await scannerRoot();
  await initRepository(root);
  const failing = new SafeInitService({ hooks: { afterStage: () => Promise.reject(new Error("crash")) } });
  await assert.rejects(failing.apply(await failing.preview({ controlRoot: root, files: files() })), {
    code: "VES_INIT_APPLY_FAILED"
  });
  const retry = new SafeInitService();
  const receipt = await retry.apply(await retry.preview({ controlRoot: root, files: files() }));
  assert.equal(receipt.changed, 7);
  assert.deepEqual((await retry.preview({ controlRoot: root, files: files() })).changes, []);
});

test("failure after multiple publications rolls every target back in reverse order", async () => {
  const root = await scannerRoot();
  await initRepository(root, { ".gitignore": "coverage/\n" });
  const before = await byteSnapshot(root);
  const service = new SafeInitService({
    hooks: { afterApplyChange: ({ index }) => (index === 3 ? Promise.reject(new Error("crash")) : undefined) }
  });
  await assert.rejects(service.apply(await service.preview({ controlRoot: root, files: files() })), {
    code: "VES_INIT_APPLY_FAILED"
  });
  assert.deepEqual(await byteSnapshot(root), before);
});

test("concurrent target change at the publication boundary is preserved", async () => {
  const root = await scannerRoot();
  await initRepository(root, { ".gitignore": "original/\n" });
  const concurrent = "concurrent/\n";
  const service = new SafeInitService({
    hooks: {
      beforeApplyChange: ({ index }) =>
        index === 0 ? writeFile(join(root, ".gitignore"), concurrent, "utf8") : undefined
    }
  });
  await assert.rejects(service.apply(await service.preview({ controlRoot: root, files: files() })), {
    code: "VES_INIT_APPLY_FAILED"
  });
  assert.equal(await readFile(join(root, ".gitignore"), "utf8"), concurrent);
});

test("hard process crash is detected without dry-run writes and recovered to the prior snapshot", async () => {
  const root = await scannerRoot();
  await initRepository(root, { ".gitignore": "original/\n" });
  const before = await byteSnapshot(root);
  const runner = fileURLToPath(new URL("../helpers/safe-init-hard-crash-runner.mjs", import.meta.url));
  const child = spawnSync(process.execPath, [runner, root], { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 77, child.stderr);
  const crashed = await byteSnapshot(root);
  assert.notDeepEqual(crashed, before);

  const service = new SafeInitService();
  await assert.rejects(service.preview({ controlRoot: root, files: files() }), {
    code: "VES_INIT_RECOVERY_REQUIRED"
  });
  assert.deepEqual(await byteSnapshot(root), crashed);
  assert.deepEqual(await service.recover({ controlRoot: root }), { recoveredTransactions: 1, restoredChanges: 1 });
  assert.deepEqual(await byteSnapshot(root), before);

  await service.apply(await service.preview({ controlRoot: root, files: files() }));
  assert.deepEqual((await service.preview({ controlRoot: root, files: files() })).changes, []);
});

test("hard-crash recovery refuses to overwrite a post-crash target change", async () => {
  const root = await scannerRoot();
  await initRepository(root, { ".gitignore": "original/\n" });
  const runner = fileURLToPath(new URL("../helpers/safe-init-hard-crash-runner.mjs", import.meta.url));
  const child = spawnSync(process.execPath, [runner, root], { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 77, child.stderr);
  const concurrent = "changed-after-crash/\n";
  await writeFile(join(root, ".gitignore"), concurrent, "utf8");

  const service = new SafeInitService();
  await assert.rejects(service.recover({ controlRoot: root }), { code: "VES_INIT_RECOVERY_CONFLICT" });
  assert.equal(await readFile(join(root, ".gitignore"), "utf8"), concurrent);
  await assert.rejects(service.preview({ controlRoot: root, files: files() }), {
    code: "VES_INIT_RECOVERY_REQUIRED"
  });
});

test("hard crash during backup restoration resumes idempotently", async () => {
  const root = await scannerRoot();
  await initRepository(root, { ".gitignore": "original/\n" });
  const before = await byteSnapshot(root);
  const runner = fileURLToPath(new URL("../helpers/safe-init-hard-crash-runner.mjs", import.meta.url));
  assert.equal(spawnSync(process.execPath, [runner, root], { windowsHide: true }).status, 77);
  assert.equal(spawnSync(process.execPath, [runner, root, "recover"], { windowsHide: true }).status, 78);
  await assert.rejects(access(join(root, ".gitignore")), { code: "ENOENT" });

  const receipt = await new SafeInitService().recover({ controlRoot: root });
  assert.deepEqual(receipt, { recoveredTransactions: 1, restoredChanges: 1 });
  assert.deepEqual(await byteSnapshot(root), before);
});
