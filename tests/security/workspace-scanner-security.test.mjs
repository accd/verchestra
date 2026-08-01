import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { scanWorkspace } from "../../packages/workspace/src/index.ts";
import {
  byteSnapshot,
  cleanupScannerRoots,
  git,
  initRepository,
  scannerRoot
} from "../helpers/workspace-scanner-fixture.mjs";

afterEach(cleanupScannerRoots);

test("scanner performs zero byte mutations including inside Git metadata", async () => {
  const root = await scannerRoot();
  await initRepository(root, { "package.json": '{"name":"root","private":true}\n', ".gitignore": "ignored/*\n" });
  await mkdir(join(root, "ignored", "service"), { recursive: true });
  await writeFile(join(root, "ignored", "service", "package.json"), '{"name":"service"}\n');
  const before = await byteSnapshot(root);
  await scanWorkspace({ controlRoot: root });
  assert.deepEqual(await byteSnapshot(root), before);
});

test("credential-bearing remote contributes only a sanitized fingerprint", async () => {
  const root = await scannerRoot();
  await initRepository(root);
  git(root, "remote", "add", "origin", "https://user:super-secret@example.com/org/repo.git?token=hidden");
  const serialized = JSON.stringify(await scanWorkspace({ controlRoot: root }));
  assert.equal(serialized.includes("super-secret"), false);
  assert.equal(serialized.includes("token=hidden"), false);
  assert.equal(serialized.includes("https://"), false);
  assert.match(JSON.parse(serialized).repositories[0].remoteFingerprint, /^v2:sha256:[a-f0-9]{64}$/u);
});

test("external symlink or junction is recorded but never traversed", async () => {
  const root = await scannerRoot();
  const outside = await scannerRoot("verchestra-outside-");
  await initRepository(root);
  await mkdir(join(outside, "deep"));
  await writeFile(join(outside, "deep", "package.json"), '{"name":"outside"}\n');
  await symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
  const inventory = await scanWorkspace({ controlRoot: root });
  assert.deepEqual(inventory.links, [
    { logicalPath: "linked", kind: process.platform === "win32" ? "junction" : "symlink", boundary: "outside" }
  ]);
  assert.equal(
    inventory.projects.some((project) => project.logicalPath.startsWith("linked/")),
    false
  );
});

test("scanner rejects a repository subdirectory as an ambiguous control root", async () => {
  const root = await scannerRoot();
  await initRepository(root, { "apps/api/package.json": '{"name":"api"}\n' });
  const before = await byteSnapshot(root);
  await assert.rejects(scanWorkspace({ controlRoot: join(root, "apps", "api") }), {
    code: "VES_WORKSPACE_CONTROL_ROOT_INVALID"
  });
  assert.deepEqual(await byteSnapshot(root), before);
});

test("bounded scanner rejects an oversized tree without writes", async () => {
  const root = await scannerRoot();
  await initRepository(root, {
    "package.json": '{"name":"root"}\n',
    "apps/a/package.json": '{"name":"a"}\n',
    "apps/b/package.json": '{"name":"b"}\n'
  });
  const before = await byteSnapshot(root);
  await assert.rejects(
    scanWorkspace({ controlRoot: root, limits: { maxDirectories: 1, maxEntries: 10, maxDepth: 10 } }),
    {
      code: "VES_WORKSPACE_SCAN_LIMIT"
    }
  );
  assert.deepEqual(await byteSnapshot(root), before);
});
