// invariant: the operations the CLI used to perform by hand on a worktree
// handle (ADP-1) are operations of the worktree module: cleanup from the handle
// alone, cleanup of the worktree that holds a given commit, and a handle for a
// scratch checkout. Each runs on real git in the SHA-1 and SHA-256 object
// formats, so none of them can assume a 40-digit object ID.
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { NodeGateProcessRunner, scratchWorktreeHandle } from "../../packages/platform-node/src/index.ts";
import {
  OBJECT_FORMATS,
  cleanupObjectFormatRepositories,
  commitFixtureTask,
  git,
  objectFormatRepository,
  registeredWorktreeCount,
  taskBranches,
  taskWorktreeFixture
} from "../helpers/git-object-format-fixture.mjs";

const links = [];

afterEach(async () => {
  await cleanupObjectFormatRepositories();
  await Promise.all(links.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const TASK_BRANCH = "refs/heads/vestra/run_c1/T1";

for (const format of OBJECT_FORMATS) {
  const { objectFormat } = format;

  test(`cleanup from the handle alone removes a ${objectFormat} worktree`, async () => {
    const fixture = await taskWorktreeFixture(format);
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 2);
    await fixture.worktrees.cleanupHandle(fixture.handle.worktreeRef);
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 1);
    await assert.rejects(access(fixture.worktreePath), { code: "ENOENT" });
    assert.equal(taskBranches(fixture.repositoryRoot), "");
    await fixture.worktrees.cleanupHandle(fixture.handle.worktreeRef);
  });

  test(`cleanup from the handle alone anchors a verified ${objectFormat} task commit first`, async () => {
    const fixture = await taskWorktreeFixture(format);
    const { commitId } = await commitFixtureTask(fixture);
    assert.equal(commitId.length, format.objectIdLength);
    await fixture.worktrees.cleanupHandle(fixture.handle.worktreeRef);
    assert.equal(taskBranches(fixture.repositoryRoot), `${TASK_BRANCH} ${commitId}`);
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 1);
  });

  test(`cleanup from the handle alone refuses unexplained ${objectFormat} history and keeps the worktree`, async () => {
    const fixture = await taskWorktreeFixture(format);
    await writeFile(join(fixture.worktreePath, "src", "value.txt"), "unexplained\n");
    git(fixture.worktreePath, "commit", "--quiet", "-am", "an unexplained commit");
    await assert.rejects(fixture.worktrees.cleanupHandle(fixture.handle.worktreeRef), {
      code: "VES_GIT_WORKTREE_CONFLICT"
    });
    await access(fixture.worktreePath);
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 2);
  });

  test(`cleanup from the handle alone refuses text that is not a ${objectFormat} handle`, async () => {
    const fixture = await taskWorktreeFixture(format);
    const { worktreeRef } = fixture.handle;
    for (const invalid of [worktreeRef.slice(0, -1), `${worktreeRef}0`, "worktree:self-test", ""])
      await assert.rejects(fixture.worktrees.cleanupHandle(invalid), { code: "VES_GIT_WORKTREE_INPUT_INVALID" });
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 2);
  });

  test(`a registered ${objectFormat} worktree whose directory was deleted is reported as not found`, async () => {
    const fixture = await taskWorktreeFixture(format);
    await rm(fixture.worktreePath, { recursive: true, force: true });
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 2, "git still lists the worktree");
    await assert.rejects(fixture.worktrees.cleanupHandle(fixture.handle.worktreeRef), {
      code: "VES_GIT_WORKTREE_NOT_FOUND"
    });
    await assert.rejects(fixture.worktrees.cleanup(fixture.handle), { code: "VES_GIT_WORKTREE_NOT_FOUND" });
  });

  test(`cleanup at a commit anchors and removes the ${objectFormat} worktree that holds it`, async () => {
    const fixture = await taskWorktreeFixture(format);
    const { commitId } = await commitFixtureTask(fixture);
    const commit = { commitId, baseCommit: fixture.baseCommit };
    assert.equal(await fixture.worktrees.cleanupAtCommit(commit), true);
    assert.equal(taskBranches(fixture.repositoryRoot), `${TASK_BRANCH} ${commitId}`);
    await assert.rejects(access(fixture.worktreePath), { code: "ENOENT" });
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 1);
    assert.equal(await fixture.worktrees.cleanupAtCommit(commit), false, "nothing holds the commit any more");
    assert.equal(taskBranches(fixture.repositoryRoot), `${TASK_BRANCH} ${commitId}`);
  });

  test(`cleanup at a commit leaves ${objectFormat} worktrees at another commit or outside its root alone`, async () => {
    const fixture = await taskWorktreeFixture(format);
    const { commitId } = await commitFixtureTask(fixture);
    const elsewhere = join(fixture.root, "elsewhere", "0123456789abcdef0123456789abcdef");
    git(fixture.repositoryRoot, "worktree", "add", "--quiet", "--detach", "--", elsewhere, commitId);
    const unnamed = join(fixture.worktreesRoot, "review");
    git(fixture.repositoryRoot, "worktree", "add", "--quiet", "--detach", "--", unnamed, commitId);
    assert.equal(
      await fixture.worktrees.cleanupAtCommit({ commitId: fixture.baseCommit, baseCommit: fixture.baseCommit }),
      false
    );
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 4);
    assert.equal(await fixture.worktrees.cleanupAtCommit({ commitId, baseCommit: fixture.baseCommit }), true);
    await access(elsewhere);
    await access(unnamed);
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 3);
    await assert.rejects(
      fixture.worktrees.cleanupAtCommit({ commitId: commitId.slice(-40).slice(1), baseCommit: "" }),
      {
        code: "VES_GIT_WORKTREE_INPUT_INVALID"
      }
    );
  });

  // why: a state root reached through a link (a linked home directory, macOS
  // /var, a Windows short name) lists its worktrees under the real path. The
  // comparison the CLI used to make by hand kept the linked path, found no
  // worktree, and silently skipped anchoring.
  test(`cleanup at a commit finds the ${objectFormat} worktree through a linked state root`, async () => {
    const linkParent = await mkdtemp(join(tmpdir(), "verchestra-git-link-"));
    links.push(linkParent);
    const fixture = await taskWorktreeFixture(format, {
      worktreesRoot: async (repository) => {
        await mkdir(join(repository.root, "real-state"), { recursive: true });
        await symlink(join(repository.root, "real-state"), join(linkParent, "state"), "junction");
        return join(linkParent, "state", "worktrees");
      }
    });
    assert.notEqual(fixture.worktreePath, join(fixture.worktreesRoot, fixture.handle.worktreeRef.split(":")[1]));
    const { commitId } = await commitFixtureTask(fixture);
    assert.equal(await fixture.worktrees.cleanupAtCommit({ commitId, baseCommit: fixture.baseCommit }), true);
    assert.equal(taskBranches(fixture.repositoryRoot), `${TASK_BRANCH} ${commitId}`);
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 1);
  });

  test(`a scratch checkout of a ${objectFormat} commit gets a handle the gate runner accepts`, async () => {
    const { root, repositoryRoot, baseCommit } = await objectFormatRepository(format);
    const scratchRoot = join(root, "verification", "mutations");
    const id = "0123456789abcdef0123456789abcdef";
    await mkdir(scratchRoot, { recursive: true });
    git(repositoryRoot, "worktree", "add", "--quiet", "--detach", "--", join(scratchRoot, id), baseCommit);
    const worktreeRef = scratchWorktreeHandle({ id, commitId: baseCommit });
    const runner = new NodeGateProcessRunner({
      repositoryRoot,
      worktreesRoot: scratchRoot,
      commands: { node: { executable: process.execPath, protocols: ["exit-code"] } }
    });
    const result = await runner.run({
      gateId: "gate:value",
      commandRef: "node",
      args: ["-e", 'process.exit(require("node:fs").readFileSync("src/value.txt", "utf8") === "base\\n" ? 0 : 1)'],
      cwd: ".",
      timeoutMs: 60_000,
      outputLimitBytes: 1_000_000,
      resultProtocol: "exit-code",
      worktreeRef
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
  });
}

test("a scratch checkout whose directory name or commit cannot form a handle is refused", () => {
  for (const checkout of [
    { id: "review", commitId: "a".repeat(40) },
    { id: "0123456789abcdef0123456789abcdef", commitId: "a".repeat(41) },
    { id: "../0123456789abcdef0123456789abcd", commitId: "a".repeat(64) }
  ])
    assert.throws(() => scratchWorktreeHandle(checkout), { code: "VES_GIT_WORKTREE_INPUT_INVALID" });
});

// invariant: the defect this replaces. A 64-digit base cut to its last 40
// digits names no worktree, so the cleanup it was passed to refused and the
// caller's catch hid the refusal.
test("the last 40 digits of a SHA-256 handle are not its base, and cleanup refuses them", async () => {
  const fixture = await taskWorktreeFixture(OBJECT_FORMATS[1]);
  const { worktreeRef } = fixture.handle;
  await assert.rejects(fixture.worktrees.cleanup({ worktreeRef, baseCommit: worktreeRef.slice(-40) }), {
    code: "VES_GIT_WORKTREE_INPUT_INVALID"
  });
  assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 2);
  await fixture.worktrees.cleanupHandle(worktreeRef);
  assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 1);
});
