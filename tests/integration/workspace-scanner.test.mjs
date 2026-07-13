import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { scanWorkspace } from "../../packages/workspace/src/index.ts";
import { cleanupScannerRoots, git, initRepository, scannerRoot } from "../helpers/workspace-scanner-fixture.mjs";

afterEach(cleanupScannerRoots);

test("standalone repository produces one control owner and one root Project", async () => {
  const root = await scannerRoot();
  await initRepository(root);
  const inventory = await scanWorkspace({ controlRoot: root });
  assert.equal(inventory.repositories.length, 1);
  assert.equal(inventory.repositories[0].logicalPath, ".");
  assert.equal(inventory.repositories[0].relation, "control");
  assert.equal(inventory.projects.length, 1);
  assert.equal(inventory.projects[0].logicalPath, ".");
  assert.equal(inventory.projects[0].gitOwnerId, inventory.repositories[0].repositoryId);
});

test("single-root monorepo discovers Projects with one Git owner", async () => {
  const root = await scannerRoot();
  await initRepository(root, {
    "package.json": '{"name":"root","private":true}\n',
    "apps/api/package.json": '{"name":"api","private":true}\n',
    "packages/math/go.mod": "module example.invalid/math\n"
  });
  const inventory = await scanWorkspace({ controlRoot: root });
  assert.deepEqual(
    inventory.projects.map((project) => project.logicalPath),
    [".", "apps/api", "packages/math"]
  );
  assert.equal(new Set(inventory.projects.map((project) => project.gitOwnerId)).size, 1);
});

test("independently cloned nested repository becomes a separate Git owner", async () => {
  const root = await scannerRoot();
  await initRepository(root);
  const nested = join(root, "projects", "service");
  await initRepository(nested, { "package.json": '{"name":"service","private":true}\n' });
  const inventory = await scanWorkspace({ controlRoot: root });
  assert.deepEqual(
    inventory.repositories.map((repository) => repository.logicalPath),
    [".", "projects/service"]
  );
  assert.equal(inventory.repositories[1].relation, "nested");
  assert.equal(
    inventory.projects.find((project) => project.logicalPath === "projects/service").gitOwnerId,
    inventory.repositories[1].repositoryId
  );
});

test("control-ignored nested repository remains visible and separately owned", async () => {
  const root = await scannerRoot();
  await initRepository(root, {
    "package.json": '{"name":"control","private":true}\n',
    ".gitignore": "projects/*\n"
  });
  const nested = join(root, "projects", "service");
  await initRepository(nested, { "package.json": '{"name":"service","private":true}\n' });
  const inventory = await scanWorkspace({ controlRoot: root });
  const repository = inventory.repositories.find((entry) => entry.logicalPath === "projects/service");
  assert.equal(repository.ignoredByControl, true);
  assert.equal(inventory.projects.find((project) => project.logicalPath === "projects/service").ignoredByControl, true);
});

test("broken gitfile placeholder is reported without being treated as the control owner", async () => {
  const root = await scannerRoot();
  await initRepository(root);
  const placeholder = join(root, "projects", "missing");
  await mkdir(placeholder, { recursive: true });
  await writeFile(join(placeholder, ".git"), "gitdir: ../../missing-git-dir\n");
  await writeFile(join(placeholder, "package.json"), '{"name":"missing","private":true}\n');
  const inventory = await scanWorkspace({ controlRoot: root });
  const boundary = inventory.repositories.find((entry) => entry.logicalPath === "projects/missing");
  assert.equal(boundary.status, "broken");
  assert.equal(boundary.relation, "placeholder");
  assert.equal(inventory.projects.find((project) => project.logicalPath === "projects/missing").gitOwnerId, null);
});

test("repeated scan produces the exact same portable fingerprint", async () => {
  const root = await scannerRoot();
  await initRepository(root, { "apps/api/package.json": '{"name":"api","private":true}\n' });
  const first = await scanWorkspace({ controlRoot: root });
  const second = await scanWorkspace({ controlRoot: root });
  assert.equal(second.fingerprint, first.fingerprint);
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(first).includes(root), false);
});

test("real Git submodule is classified as a separate submodule owner", async () => {
  const source = await scannerRoot("verchestra-submodule-source-");
  await initRepository(source, { "package.json": '{"name":"submodule","private":true}\n' });
  const root = await scannerRoot();
  await initRepository(root);
  git(root, "-c", "protocol.file.allow=always", "submodule", "add", "--quiet", source, "vendor/submodule");
  git(root, "commit", "--quiet", "-am", "add submodule");
  const inventory = await scanWorkspace({ controlRoot: root });
  const repository = inventory.repositories.find((entry) => entry.logicalPath === "vendor/submodule");
  assert.equal(repository.relation, "submodule");
  assert.equal(repository.gitDirKind, "file");
  assert.equal(
    inventory.projects.find((project) => project.logicalPath === "vendor/submodule").gitOwnerId,
    repository.repositoryId
  );
});

test("real linked worktree is classified as a separate worktree owner", async () => {
  const root = await scannerRoot();
  await initRepository(root);
  git(root, "worktree", "add", "--quiet", join(root, "linked-worktree"), "-b", "fixture-worktree");
  const inventory = await scanWorkspace({ controlRoot: root });
  const repository = inventory.repositories.find((entry) => entry.logicalPath === "linked-worktree");
  assert.equal(repository.relation, "worktree");
  assert.equal(repository.gitDirKind, "file");
  assert.equal(
    inventory.projects.find((project) => project.logicalPath === "linked-worktree").gitOwnerId,
    repository.repositoryId
  );
});

test("real sparse checkout state is visible in the repository inventory", async () => {
  const root = await scannerRoot();
  await initRepository(root, {
    "package.json": '{"name":"root","private":true}\n',
    "apps/api/package.json": '{"name":"api","private":true}\n',
    "packages/hidden/package.json": '{"name":"hidden","private":true}\n'
  });
  git(root, "sparse-checkout", "init", "--cone");
  git(root, "sparse-checkout", "set", "apps");
  const inventory = await scanWorkspace({ controlRoot: root });
  assert.equal(inventory.repositories[0].sparseCheckout, true);
  assert.deepEqual(
    inventory.projects.map((project) => project.logicalPath),
    [".", "apps/api"]
  );
});
