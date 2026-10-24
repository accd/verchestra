// invariant: the one git runner and the ref and registration readers of the
// task worktree module, against real repositories in both object formats.
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { NodeGitWorktreeAdapter } from "../../packages/platform-node/src/index.ts";
import {
  refTarget,
  registeredWorktrees,
  runGit,
  runGitBytes,
  taskBranchRef
} from "../../packages/platform-node/src/task-worktree.ts";
import {
  OBJECT_FORMATS,
  cleanupObjectFormatRepositories,
  git,
  objectFormatRepository
} from "../helpers/git-object-format-fixture.mjs";
import { ranHooks, versionHooks } from "../helpers/versioned-hooks-fixture.mjs";

afterEach(cleanupObjectFormatRepositories);

for (const format of OBJECT_FORMATS) {
  const { objectFormat } = format;

  test(`the runner returns text and bytes from a ${objectFormat} repository`, async () => {
    const { repositoryRoot, baseCommit } = await objectFormatRepository(format);
    const text = await runGit(repositoryRoot, ["rev-parse", "HEAD"]);
    assert.deepEqual(text, { stdout: `${baseCommit}\n`, stderr: "" });
    const bytes = await runGitBytes(repositoryRoot, ["cat-file", "blob", "HEAD:src/value.txt"], 1024);
    assert.deepEqual(bytes, Buffer.from("base\n"));
  });

  test(`a task branch ref resolves to its exact ${objectFormat} target and to nothing else`, async () => {
    const { repositoryRoot, baseCommit } = await objectFormatRepository(format);
    const ref = taskBranchRef("run_405", "T405.3");
    assert.equal(await refTarget(repositoryRoot, ref), undefined);
    git(repositoryRoot, "update-ref", ref, baseCommit);
    assert.equal(await refTarget(repositoryRoot, ref), baseCommit);
    // why: for-each-ref matches a pattern as a path prefix, so the parent
    // directory of the ref lists the ref without being it.
    assert.equal(await refTarget(repositoryRoot, "refs/heads/vestra/run_405"), undefined);
    assert.equal(await refTarget(repositoryRoot, taskBranchRef("run_405", "T405")), undefined);
  });

  test(`the registration listing of a ${objectFormat} repository names each worktree HEAD`, async () => {
    const { repositoryRoot, worktreesRoot, baseCommit } = await objectFormatRepository(format);
    git(repositoryRoot, "worktree", "add", "--quiet", "--detach", "--", worktreesRoot, baseCommit);
    const entries = registeredWorktrees((await runGit(repositoryRoot, ["worktree", "list", "--porcelain"])).stdout);
    assert.deepEqual([...entries.values()], [baseCommit, baseCommit]);
  });
}

test("the runner rejects a failed command and an output beyond its bound", async () => {
  const { repositoryRoot } = await objectFormatRepository(OBJECT_FORMATS[0]);
  await assert.rejects(runGit(repositoryRoot, ["rev-parse", "--verify", "refs/heads/absent"]), (error) => {
    assert.equal(error.code, 128);
    return true;
  });
  await assert.rejects(runGitBytes(repositoryRoot, ["cat-file", "blob", "HEAD:src/value.txt"], 2), {
    code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
  });
  await assert.rejects(runGit(repositoryRoot, ["rev-parse", "HEAD"], 2), {
    code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
  });
});

test("the runner passes each argument as one argument and never through a shell", async () => {
  const { repositoryRoot, baseCommit } = await objectFormatRepository(OBJECT_FORMATS[0]);
  const hostile = "HEAD; echo injected";
  await assert.rejects(runGit(repositoryRoot, ["rev-parse", "--verify", "--end-of-options", hostile]));
  assert.equal((await runGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"])).stdout.trim(), baseCommit);
});

// invariant: a repository's own hooks never run on the task path. `--no-verify`
// skips pre-commit and commit-msg only, and a versioned `core.hooksPath` would
// otherwise run model-written hooks during checkout, commit and removal.
test("a versioned hooks path runs no hook on worktree create and remove", async () => {
  const { root, repositoryRoot, worktreesRoot } = await objectFormatRepository(OBJECT_FORMATS[0]);
  const sentinels = join(root, "sentinels");
  const baseCommit = await versionHooks(repositoryRoot, sentinels, git);
  // why: the control proves the versioned hooks are live for a plain git
  // command, so the empty sentinel set below is the runner's doing.
  git(repositoryRoot, "commit", "--allow-empty", "--quiet", "-m", "control");
  assert.deepEqual(await ranHooks(sentinels), ["post-commit", "reference-transaction"]);
  await rm(sentinels, { recursive: true, force: true });
  await mkdir(sentinels);
  const worktrees = new NodeGitWorktreeAdapter({ repositoryRoot, worktreesRoot });
  const handle = await worktrees.create({
    workspaceId: "workspace_hooks",
    runId: "run_hooks",
    taskId: "T1.1",
    sourceStateDigest: `sha256:${"2".repeat(64)}`,
    sourceRevision: baseCommit,
    changeScope: ["src"],
    protectedPaths: [".git"]
  });
  await worktrees.cleanup(handle);
  assert.deepEqual(await ranHooks(sentinels), []);
});
