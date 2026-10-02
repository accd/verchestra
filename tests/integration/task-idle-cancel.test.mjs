// invariant: `vestra task cancel` of a run no process is driving removes the
// worktree that run left behind, from the handle in its marker alone. These
// cases run the CLI's own idle-cancel cleanup on real git in the SHA-1 and
// SHA-256 object formats, on every platform; the full command is covered by
// tests/e2e/task-cli-e2e.test.mjs where a credential store is available.
import assert from "node:assert/strict";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { writeJsonAtomic } from "../../apps/vestra-cli/src/task/task-files.ts";
import { worktreePath } from "../../apps/vestra-cli/src/task/task-run.ts";
import { removeIdleWorktree } from "../../apps/vestra-cli/src/task/task-status.ts";
import { saveCommit } from "../../apps/vestra-cli/src/task/task-surface.ts";
import {
  OBJECT_FORMATS,
  cleanupObjectFormatRepositories,
  commitFixtureTask,
  git,
  registeredWorktreeCount,
  taskBranches,
  taskWorktreeFixture
} from "../helpers/git-object-format-fixture.mjs";

afterEach(cleanupObjectFormatRepositories);

// why: the marker is written exactly as a run writes it when its driver
// resolves the worktree, so the cleanup reads what a crashed run left.
async function idleRun(format) {
  const fixture = await taskWorktreeFixture(format);
  const directory = join(fixture.root, "state", "tasks", "run_c1");
  await mkdir(directory, { recursive: true });
  await writeJsonAtomic(worktreePath(directory), { worktreeRef: fixture.handle.worktreeRef });
  const workspace = { repositoryRoot: fixture.repositoryRoot, layout: { worktreesRoot: fixture.worktreesRoot } };
  return { ...fixture, directory, workspace };
}

for (const format of OBJECT_FORMATS) {
  const { objectFormat } = format;

  test(`idle cancel removes the uncommitted worktree of a ${objectFormat} repository`, async () => {
    const run = await idleRun(format);
    await writeFile(join(run.worktreePath, "src", "value.txt"), "half done\n");
    assert.equal(registeredWorktreeCount(run.repositoryRoot), 2);
    await removeIdleWorktree(run.workspace, run.directory);
    assert.equal(registeredWorktreeCount(run.repositoryRoot), 1, "the worktree is no longer registered");
    await assert.rejects(access(run.worktreePath), { code: "ENOENT" });
    assert.equal(taskBranches(run.repositoryRoot), "");
    assert.equal(git(run.repositoryRoot, "status", "--porcelain=v1"), "");
  });

  test(`idle cancel keeps a verified ${objectFormat} task commit on its task branch`, async () => {
    const run = await idleRun(format);
    const { commitId } = await commitFixtureTask(run);
    await removeIdleWorktree(run.workspace, run.directory);
    assert.equal(taskBranches(run.repositoryRoot), `refs/heads/vestra/run_c1/T1 ${commitId}`);
    assert.equal(registeredWorktreeCount(run.repositoryRoot), 1);
  });

  test(`idle cancel refuses unexplained ${objectFormat} history instead of reporting a stop`, async () => {
    const run = await idleRun(format);
    await writeFile(join(run.worktreePath, "src", "value.txt"), "unexplained\n");
    git(run.worktreePath, "commit", "--quiet", "-am", "an unexplained commit");
    await assert.rejects(removeIdleWorktree(run.workspace, run.directory), { code: "VES_GIT_WORKTREE_CONFLICT" });
    await access(run.worktreePath);
    assert.equal(registeredWorktreeCount(run.repositoryRoot), 2);
  });

  test(`idle cancel refuses a ${objectFormat} marker that is not a handle`, async () => {
    const run = await idleRun(format);
    await writeJsonAtomic(worktreePath(run.directory), { worktreeRef: run.handle.worktreeRef.slice(0, -1) });
    await assert.rejects(removeIdleWorktree(run.workspace, run.directory), {
      code: "VES_GIT_WORKTREE_INPUT_INVALID"
    });
    assert.equal(registeredWorktreeCount(run.repositoryRoot), 2);
  });

  test(`idle cancel proceeds when the ${objectFormat} worktree is already gone`, async () => {
    const run = await idleRun(format);
    await run.worktrees.cleanup(run.handle);
    await removeIdleWorktree(run.workspace, run.directory);
    assert.equal(registeredWorktreeCount(run.repositoryRoot), 1);

    const deleted = await idleRun(format);
    await rm(deleted.worktreePath, { recursive: true, force: true });
    await removeIdleWorktree(deleted.workspace, deleted.directory);
    assert.equal(registeredWorktreeCount(deleted.repositoryRoot), 2, "the stale registration is left for git to prune");
  });

  test(`idle cancel leaves the ${objectFormat} worktree of a run that recorded its commit`, async () => {
    const run = await idleRun(format);
    const { commitId } = await commitFixtureTask(run);
    await saveCommit(run.directory, {
      commitId,
      baseCommit: run.baseCommit,
      gateEvidenceDigest: `sha256:${"5".repeat(64)}`,
      gateEvidenceRefs: ["evidence:gate:1"]
    });
    await removeIdleWorktree(run.workspace, run.directory);
    assert.equal(registeredWorktreeCount(run.repositoryRoot), 2);
    assert.equal(taskBranches(run.repositoryRoot), "");
  });
}

test("idle cancel of a run that never created a worktree touches nothing", async () => {
  const fixture = await taskWorktreeFixture(OBJECT_FORMATS[0]);
  const directory = join(fixture.root, "state", "tasks", "run_none");
  await mkdir(directory, { recursive: true });
  await removeIdleWorktree(
    { repositoryRoot: fixture.repositoryRoot, layout: { worktreesRoot: fixture.worktreesRoot } },
    directory
  );
  assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 2);
});
