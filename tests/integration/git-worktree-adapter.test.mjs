import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { GitWorktreeError, NodeGitWorktreeAdapter } from "../../packages/platform-node/src/index.ts";

const roots = [];

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-executor-git-"));
  roots.push(root);
  const repositoryRoot = join(root, "repository");
  const worktreesRoot = join(root, "worktrees");
  await mkdir(join(repositoryRoot, "packages", "app"), { recursive: true });
  await writeFile(join(repositoryRoot, "packages", "app", "value.txt"), "base\n");
  git(repositoryRoot, "init", "--quiet");
  git(repositoryRoot, "config", "user.email", "qualification@verchestra.invalid");
  git(repositoryRoot, "config", "user.name", "Verchestra Qualification");
  git(repositoryRoot, "add", ".");
  git(repositoryRoot, "commit", "--quiet", "-m", "fixture base");
  const sourceRevision = git(repositoryRoot, "rev-parse", "HEAD");
  const adapter = new NodeGitWorktreeAdapter({ repositoryRoot, worktreesRoot });
  const input = {
    workspaceId: "workspace:qualification",
    runId: "run:qualification",
    taskId: "T58.1",
    sourceStateDigest: "sha256:" + "2".repeat(64),
    sourceRevision,
    changeScope: ["packages/app"],
    protectedPaths: [".git", ".verchestra/policy"]
  };
  return { adapter, input, repositoryRoot, sourceRevision, worktreesRoot };
}

function targetFor(worktreesRoot, worktreeRef) {
  return join(worktreesRoot, worktreeRef.split(":")[1]);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("real adapter creates a detached worktree pinned to the authorized revision", async () => {
  const { adapter, input, sourceRevision, worktreesRoot } = await fixture();
  const handle = await adapter.create(input);
  const target = targetFor(worktreesRoot, handle.worktreeRef);
  assert.equal(handle.baseCommit, sourceRevision);
  assert.equal(git(target, "rev-parse", "HEAD"), sourceRevision);
  assert.equal(git(target, "rev-parse", "--abbrev-ref", "HEAD"), "HEAD");
});

test("real adapter creation is idempotent for the same authorized task binding", async () => {
  const { adapter, input } = await fixture();
  const first = await adapter.create(input);
  const second = await adapter.create(input);
  assert.deepEqual(second, first);
});

test("real inspection reports tracked and untracked content deterministically", async () => {
  const { adapter, input, worktreesRoot } = await fixture();
  const handle = await adapter.create(input);
  const target = targetFor(worktreesRoot, handle.worktreeRef);
  await writeFile(join(target, "packages", "app", "value.txt"), "changed\n");
  await writeFile(join(target, "packages", "app", "new.txt"), "new\n");
  const first = await adapter.inspect(handle);
  const second = await adapter.inspect(handle);
  assert.deepEqual(first.changedPaths, ["packages/app/new.txt", "packages/app/value.txt"]);
  assert.match(first.changeDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(first.changeDigest, second.changeDigest);
  assert.equal(first.commitCountSinceBase, 0);
});

test("real inspection exposes Driver-created commits for fail-closed enforcement", async () => {
  const { adapter, input, worktreesRoot } = await fixture();
  const handle = await adapter.create(input);
  const target = targetFor(worktreesRoot, handle.worktreeRef);
  await writeFile(join(target, "packages", "app", "value.txt"), "committed\n");
  git(target, "add", ".");
  git(target, "commit", "--quiet", "-m", "forbidden driver commit");
  const inspection = await adapter.inspect(handle);
  assert.equal(inspection.commitCountSinceBase, 1);
});

test("real cleanup removes only the authorized linked worktree", async () => {
  const { adapter, input, repositoryRoot, worktreesRoot } = await fixture();
  const handle = await adapter.create(input);
  const target = targetFor(worktreesRoot, handle.worktreeRef);
  await adapter.cleanup(handle);
  await assert.rejects(access(target));
  assert.equal(await readFile(join(repositoryRoot, "packages", "app", "value.txt"), "utf8"), "base\n");
  await adapter.cleanup(handle);
});

test("unknown full source revision fails without creating a worktree", async () => {
  const { adapter, input, worktreesRoot } = await fixture();
  await assert.rejects(
    adapter.create({ ...input, sourceRevision: "b".repeat(40) }),
    (error) => error instanceof GitWorktreeError && error.code === "VES_GIT_WORKTREE_COMMAND_FAILED"
  );
  assert.deepEqual(await readdir(worktreesRoot), []);
});

// Regression for the platform matrix's first non-Linux failure: macOS temp dirs
// resolve /var -> /private/var and Windows returns 8.3 short names such as
// RUNNER~1 -> runneradmin, so the adapter is routinely handed roots whose
// realpath differs from the path it was given. A directory link reproduces that
// canonicalization on every platform (a junction on Windows, a symlink on POSIX),
// and the adapter must operate through it rather than refusing it as an escape.
test("operates through roots reached by a canonicalizing directory link", async () => {
  const real = await mkdtemp(join(tmpdir(), "verchestra-git-real-"));
  roots.push(real);
  const repositoryRoot = join(real, "repository");
  await mkdir(join(repositoryRoot, "packages", "app"), { recursive: true });
  await writeFile(join(repositoryRoot, "packages", "app", "value.txt"), "base\n");
  git(repositoryRoot, "init", "--quiet");
  git(repositoryRoot, "config", "user.email", "qualification@verchestra.invalid");
  git(repositoryRoot, "config", "user.name", "Verchestra Qualification");
  git(repositoryRoot, "add", ".");
  git(repositoryRoot, "commit", "--quiet", "-m", "fixture base");
  const sourceRevision = git(repositoryRoot, "rev-parse", "HEAD");

  const linkParent = await mkdtemp(join(tmpdir(), "verchestra-git-alias-"));
  roots.push(linkParent);
  const alias = join(linkParent, "alias");
  await symlink(real, alias, "junction");
  assert.notEqual(alias, await realpath(alias), "the alias must actually canonicalize to a different path");

  const adapter = new NodeGitWorktreeAdapter({
    repositoryRoot: join(alias, "repository"),
    worktreesRoot: join(alias, "worktrees")
  });
  const input = {
    workspaceId: "workspace:qualification",
    runId: "run:qualification",
    taskId: "T75.F3",
    sourceStateDigest: "sha256:" + "2".repeat(64),
    sourceRevision,
    changeScope: ["packages/app"],
    protectedPaths: [".git"]
  };
  const handle = await adapter.create(input);
  assert.match(handle.worktreeRef, /^worktree:[a-f0-9]{32}:[a-f0-9]{40}$/u);
  assert.equal(handle.baseCommit, sourceRevision);
  // The worktree materializes under the real location and inspection/cleanup
  // operate on it without a spurious escape.
  assert.equal((await adapter.inspect(handle)).commitCountSinceBase, 0);
  await adapter.cleanup(handle);
  assert.deepEqual(await readdir(join(real, "worktrees")), []);
});

// The escape guard is unchanged in substance: a worktrees root whose own final
// entry is a link (not a benign parent alias) is still refused, so tolerating
// canonicalization above did not open a symlinked-root escape.
test("still refuses a worktrees root whose own entry is a link", async () => {
  const { input, repositoryRoot } = await fixture();
  const realWorktrees = await mkdtemp(join(tmpdir(), "verchestra-git-realwt-"));
  roots.push(realWorktrees);
  const linkParent = await mkdtemp(join(tmpdir(), "verchestra-git-wtlink-"));
  roots.push(linkParent);
  const worktreesRoot = join(linkParent, "worktrees");
  await symlink(realWorktrees, worktreesRoot, "junction");
  const adapter = new NodeGitWorktreeAdapter({ repositoryRoot, worktreesRoot });
  await assert.rejects(
    adapter.create(input),
    (error) => error instanceof GitWorktreeError && error.code === "VES_GIT_WORKTREE_ESCAPE"
  );
});
