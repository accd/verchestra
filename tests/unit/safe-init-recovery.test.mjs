import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";

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
    displayName: "Recovery Fixture",
    placementMode: "centralized",
    generatorVersion: "1.0.0"
  });

// Copies the repository just before change `crashIndex` is published: the copy
// holds what a hard crash at that point leaves behind (every earlier change
// published, the rest still staged beside the journal).
async function crashBefore(crashIndex) {
  const root = await scannerRoot();
  await initRepository(root, { ".gitignore": "dist/\n" });
  const before = await byteSnapshot(root);
  const crashed = await scannerRoot();
  const service = new SafeInitService({
    hooks: {
      beforeApplyChange: async ({ index }) => {
        if (index !== crashIndex) return;
        await cp(root, crashed, { recursive: true });
        throw new Error("crash");
      }
    }
  });
  const preview = await service.preview({ controlRoot: root, files: files() });
  await assert.rejects(service.apply(preview), { code: "VES_INIT_APPLY_FAILED" });
  const metadata = join(crashed, ".verchestra");
  const [staging] = (await readdir(metadata)).filter((name) => name.startsWith(".staging-"));
  return { crashed, before, preview, staging: join(metadata, staging) };
}

const target = (root, change) => join(root, ...change.logicalPath.split("/"));

test("the crash fixture publishes the existing gitignore update first", async () => {
  const { preview } = await crashBefore(1);
  assert.equal(preview.changes[0].logicalPath, ".gitignore");
  assert.equal(preview.changes[0].action, "update");
  assert.equal(preview.changes[1].action, "create");
});

test("a non-portable init target is refused before anything is planned", async () => {
  const root = await scannerRoot();
  await initRepository(root);
  await assert.rejects(
    new SafeInitService().preview({ controlRoot: root, files: { ".verchestra/../escape.yaml": "x\n" } }),
    { code: "VES_INIT_INPUT_INVALID", message: "Init target is not portable" }
  );
});

test("recovery refuses an unpublished target that changed after the crash", async () => {
  const { crashed, preview } = await crashBefore(1);
  const change = preview.changes[1];
  await writeFile(target(crashed, change), "written after the crash\n");
  await assert.rejects(new SafeInitService().recover({ controlRoot: crashed }), {
    code: "VES_INIT_RECOVERY_CONFLICT",
    message: "Unapplied init target or staged content changed after interruption"
  });
});

test("recovery refuses a published update whose backup is corrupt", async () => {
  const { crashed, staging } = await crashBefore(1);
  await writeFile(join(staging, "backup-0"), "not the original bytes\n");
  await assert.rejects(new SafeInitService().recover({ controlRoot: crashed }), {
    code: "VES_INIT_RECOVERY_CONFLICT",
    message: "Interrupted init backup is missing or corrupt"
  });
});

test("recovery refuses a published target that changed after the crash", async () => {
  const { crashed, preview } = await crashBefore(1);
  await writeFile(target(crashed, preview.changes[0]), "edited after the crash\n");
  await assert.rejects(new SafeInitService().recover({ controlRoot: crashed }), {
    code: "VES_INIT_RECOVERY_CONFLICT",
    message: "Applied init target changed after interruption"
  });
});

test("recovery leaves an untouched target alone when its staged copy is gone", async () => {
  const { crashed, before, staging } = await crashBefore(1);
  await rm(join(staging, "write-1"));
  const removed = [];
  const recovery = new SafeInitService({ hooks: { afterRecoveryRemove: ({ index }) => removed.push(index) } });
  assert.deepEqual(await recovery.recover({ controlRoot: crashed }), { recoveredTransactions: 1, restoredChanges: 1 });
  assert.deepEqual(removed, [0]);
  assert.deepEqual(await byteSnapshot(crashed), before);
});

test("recovery discards a staging directory that never wrote its journal", async () => {
  const root = await scannerRoot();
  await initRepository(root);
  const staging = join(root, ".verchestra", `.staging-${randomUUID()}`);
  await mkdir(staging, { recursive: true });
  await writeFile(join(staging, "write-0"), "partial\n");
  assert.deepEqual(await new SafeInitService().recover({ controlRoot: root }), {
    recoveredTransactions: 1,
    restoredChanges: 0
  });
  assert.deepEqual(await readdir(join(root, ".verchestra")), []);
});
