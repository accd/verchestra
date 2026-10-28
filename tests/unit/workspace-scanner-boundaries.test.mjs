import assert from "node:assert/strict";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { scanWorkspace } from "../../packages/workspace/src/index.ts";
import { cleanupScannerRoots, git, initRepository, scannerRoot } from "../helpers/workspace-scanner-fixture.mjs";

afterEach(cleanupScannerRoots);

const linkKind = process.platform === "win32" ? "junction" : "dir";
const reportedLinkKind = process.platform === "win32" ? "junction" : "symlink";

test("a nested repository, a linked worktree and a broken gitdir each own their own boundary", async () => {
  const root = await scannerRoot();
  await initRepository(root);
  await initRepository(join(root, "projects", "service"), { "package.json": '{"name":"service","private":true}\n' });
  git(root, "worktree", "add", "--quiet", join(root, "linked-worktree"), "-b", "fixture-worktree");
  const placeholder = join(root, "projects", "missing");
  await mkdir(placeholder, { recursive: true });
  await writeFile(join(placeholder, ".git"), "gitdir: ../../missing-git-dir\n");
  await writeFile(join(placeholder, "package.json"), '{"name":"missing","private":true}\n');

  const inventory = await scanWorkspace({ controlRoot: root });
  const byPath = new Map(inventory.repositories.map((entry) => [entry.logicalPath, entry]));
  assert.deepEqual([...byPath.keys()], [".", "linked-worktree", "projects/missing", "projects/service"]);
  assert.deepEqual(
    [byPath.get("projects/service").relation, byPath.get("projects/service").gitDirKind],
    ["nested", "directory"]
  );
  assert.deepEqual(
    [byPath.get("linked-worktree").relation, byPath.get("linked-worktree").status],
    ["worktree", "active"]
  );
  assert.deepEqual(
    [byPath.get("projects/missing").relation, byPath.get("projects/missing").brokenReason],
    ["placeholder", "gitdir-missing"]
  );
  const owners = new Map(inventory.projects.map((project) => [project.logicalPath, project.gitOwnerId]));
  assert.equal(owners.get("projects/service"), byPath.get("projects/service").repositoryId);
  assert.equal(owners.get("linked-worktree"), byPath.get("linked-worktree").repositoryId);
  // A broken boundary owns nothing: its Project records no Git owner.
  assert.equal(owners.get("projects/missing"), null);
});

test("links are inventoried by boundary and a dangling link is recorded as broken", async () => {
  const root = await scannerRoot();
  await initRepository(root, { "package.json": '{"name":"root","private":true}\n', "inside/keep.txt": "x\n" });
  const outside = await scannerRoot("verchestra-outside-");
  const gone = await scannerRoot("verchestra-gone-");
  await symlink(join(root, "inside"), join(root, "inner-link"), linkKind);
  await symlink(outside, join(root, "outer-link"), linkKind);
  await symlink(gone, join(root, "dangling-link"), linkKind);
  await rm(gone, { recursive: true, force: true });

  const inventory = await scanWorkspace({ controlRoot: root });
  assert.deepEqual(inventory.links, [
    { logicalPath: "dangling-link", kind: reportedLinkKind, boundary: "broken" },
    { logicalPath: "inner-link", kind: reportedLinkKind, boundary: "inside" },
    { logicalPath: "outer-link", kind: reportedLinkKind, boundary: "outside" }
  ]);
});
