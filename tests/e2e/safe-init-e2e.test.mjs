import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { SafeInitService, buildCanonicalInitFiles } from "../../packages/workspace/src/index.ts";
import {
  byteSnapshot,
  cleanupScannerRoots,
  git,
  initRepository,
  scannerRoot
} from "../helpers/workspace-scanner-fixture.mjs";

afterEach(cleanupScannerRoots);

const files = () =>
  buildCanonicalInitFiles({
    workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-0123456789ab",
    displayName: "E2E Workspace",
    placementMode: "centralized",
    generatorVersion: "1.0.0"
  });

async function initialize(root) {
  const service = new SafeInitService();
  const preview = await service.preview({ controlRoot: root, files: files() });
  return { service, preview, receipt: await service.apply(preview) };
}

test("standalone init exposes exactly the canonical tracked candidates to Git", async () => {
  const root = await scannerRoot();
  await initRepository(root);
  await initialize(root);
  assert.deepEqual(git(root, "ls-files", "--others", "--exclude-standard").split("\n"), [
    ".gitignore",
    ".verchestra/generated-manifest.json",
    ".verchestra/integrations.yaml",
    ".verchestra/projects.yaml",
    ".verchestra/skills.lock.json",
    ".verchestra/skills.yaml",
    ".verchestra/workspace.yaml"
  ]);
});

test("centralized init leaves an ignored nested source repository byte-identical", async () => {
  const root = await scannerRoot();
  await initRepository(root, { ".gitignore": "sources/\n", "package.json": '{"private":true}\n' });
  const nested = join(root, "sources", "api");
  await initRepository(nested, { "package.json": '{"name":"api"}\n' });
  const before = await byteSnapshot(nested);
  await initialize(root);
  assert.deepEqual(await byteSnapshot(nested), before);
});

test("committed init followed by another init has no Git diff and no changes", async () => {
  const root = await scannerRoot();
  await initRepository(root);
  const { service } = await initialize(root);
  git(root, "add", ".gitignore", ".verchestra");
  git(root, "commit", "--quiet", "-m", "initialize verchestra");
  const second = await service.preview({ controlRoot: root, files: files() });
  assert.deepEqual(second.changes, []);
  assert.equal(git(root, "status", "--porcelain"), "");
});

test("equivalent clones produce the same content-addressed init plan", async () => {
  const left = await scannerRoot("verchestra-init-left-");
  const right = await scannerRoot("verchestra-init-right-");
  await initRepository(left);
  await initRepository(right);
  const leftPlan = await new SafeInitService().preview({ controlRoot: left, files: files() });
  const rightPlan = await new SafeInitService().preview({ controlRoot: right, files: files() });
  assert.equal(leftPlan.planId, rightPlan.planId);
  assert.deepEqual(leftPlan.changes, rightPlan.changes);
});
