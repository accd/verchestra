import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
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

const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-0123456789ab";

function files() {
  return buildCanonicalInitFiles({
    workspaceId,
    displayName: "Example Workspace",
    placementMode: "centralized",
    generatorVersion: "1.0.0"
  });
}

test("init preview declares every create and managed gitignore update", async () => {
  const root = await scannerRoot();
  await initRepository(root, { "README.md": "fixture\n" });
  const preview = await new SafeInitService().preview({ controlRoot: root, files: files() });
  assert.match(preview.planId, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(
    preview.changes.some((change) => change.logicalPath === ".gitignore" && change.action === "create"),
    true
  );
  assert.equal(
    preview.changes.some((change) => change.logicalPath === ".verchestra/workspace.yaml"),
    true
  );
  assert.equal(
    preview.changes.every((change) => change.action === "create"),
    true
  );
});

test("init preview writes zero bytes", async () => {
  const root = await scannerRoot();
  await initRepository(root);
  const before = await byteSnapshot(root);
  await new SafeInitService().preview({ controlRoot: root, files: files() });
  assert.deepEqual(await byteSnapshot(root), before);
});

test("init apply materializes the reviewed preview", async () => {
  const root = await scannerRoot();
  await initRepository(root, { "README.md": "fixture\n" });
  const service = new SafeInitService();
  const preview = await service.preview({ controlRoot: root, files: files() });
  const receipt = await service.apply(preview);
  assert.equal(receipt.planId, preview.planId);
  assert.equal(receipt.changed, preview.changes.length);
  assert.match(await readFile(join(root, ".gitignore"), "utf8"), /verchestra managed/u);
  assert.match(await readFile(join(root, ".verchestra", "workspace.yaml"), "utf8"), /language: en/u);
});

test("second init preview is an exact no-op", async () => {
  const root = await scannerRoot();
  await initRepository(root);
  const service = new SafeInitService();
  await service.apply(await service.preview({ controlRoot: root, files: files() }));
  const second = await service.preview({ controlRoot: root, files: files() });
  assert.deepEqual(second.changes, []);
});

test("init preserves existing user gitignore bytes before the managed block", async () => {
  const root = await scannerRoot();
  const userRules = "# user rules\r\ndist/\r\n!dist/keep.txt\r\n";
  await initRepository(root, { ".gitignore": userRules });
  const service = new SafeInitService();
  await service.apply(await service.preview({ controlRoot: root, files: files() }));
  assert.equal((await readFile(join(root, ".gitignore"), "utf8")).startsWith(userRules), true);
});

test("tracked skeleton collision fails without overwriting human content", async () => {
  const root = await scannerRoot();
  await initRepository(root, { ".verchestra/workspace.yaml": "human-owned: true\n" });
  const before = await byteSnapshot(root);
  await assert.rejects(new SafeInitService().preview({ controlRoot: root, files: files() }), {
    code: "VES_INIT_TARGET_CONFLICT"
  });
  assert.deepEqual(await byteSnapshot(root), before);
});

test("apply rejects a stale preview before mutation", async () => {
  const root = await scannerRoot();
  await initRepository(root, { ".gitignore": "dist/\n" });
  const service = new SafeInitService();
  const preview = await service.preview({ controlRoot: root, files: files() });
  await writeFile(join(root, ".gitignore"), "changed-after-preview\n");
  const before = await byteSnapshot(root);
  await assert.rejects(service.apply(preview), { code: "VES_INIT_PREVIEW_STALE" });
  assert.deepEqual(await byteSnapshot(root), before);
});

test("ownership manifest closes every generated target over the control Git owner", async () => {
  const root = await scannerRoot();
  await initRepository(root);
  const service = new SafeInitService();
  await service.apply(await service.preview({ controlRoot: root, files: files() }));
  const manifest = JSON.parse(await readFile(join(root, ".verchestra", "generated-manifest.json"), "utf8"));
  assert.equal(manifest.files.length, 7);
  assert.deepEqual(
    manifest.files.map((entry) => entry.logicalPath),
    [
      ".gitignore",
      ".verchestra/generated-manifest.json",
      ".verchestra/integrations.yaml",
      ".verchestra/projects.yaml",
      ".verchestra/skills.lock.json",
      ".verchestra/skills.yaml",
      ".verchestra/workspace.yaml"
    ]
  );
  assert.equal(
    manifest.files.every((entry) => /^v2:sha256:[a-f0-9]{64}$/u.test(entry.gitOwnerId)),
    true
  );
  assert.deepEqual(
    manifest.files.find((entry) => entry.logicalPath === ".verchestra/generated-manifest.json"),
    {
      logicalPath: ".verchestra/generated-manifest.json",
      gitOwnerId: manifest.files[0].gitOwnerId,
      contentDigest: null,
      digestMode: "self-excluded",
      lifecyclePolicy: "tracked"
    }
  );
});

test("broad user ignore of canonical metadata fails before mutation", async () => {
  const root = await scannerRoot();
  await initRepository(root, { ".gitignore": ".verchestra/\n" });
  const before = await byteSnapshot(root);
  await assert.rejects(new SafeInitService().preview({ controlRoot: root, files: files() }), {
    code: "VES_INIT_TARGET_IGNORED"
  });
  assert.deepEqual(await byteSnapshot(root), before);
});

test("successful init removes same-volume staging artifacts", async () => {
  const root = await scannerRoot();
  await initRepository(root);
  const service = new SafeInitService();
  await service.apply(await service.preview({ controlRoot: root, files: files() }));
  assert.equal(
    (await readdir(join(root, ".verchestra"))).some((name) => name.startsWith(".staging-")),
    false
  );
});

test("preview capability cannot be replayed through another service instance", async () => {
  const root = await scannerRoot();
  await initRepository(root);
  const preview = await new SafeInitService().preview({ controlRoot: root, files: files() });
  const before = await byteSnapshot(root);
  await assert.rejects(new SafeInitService().apply(preview), { code: "VES_INIT_PREVIEW_INVALID" });
  assert.deepEqual(await byteSnapshot(root), before);
});
